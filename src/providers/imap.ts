import type { ImapFlow } from "imapflow";
import type { Transporter } from "nodemailer";
import { stripCRLF } from "../security/validation.js";
import { buildRawMimeMessage } from "./mime.js";
import type {
  MailProvider, ProviderCapabilities, EmailSummary, EmailMessage,
  EmailThread, Label, SendOptions, ReplyOptions, ForwardOptions,
  DraftOptions, DraftSummary, UnreadCount, ExportedMessage,
  BulkUndoRequest, TrashResult,
} from "./interface.js";
import { forwardedBody, forwardSubject, replyRecipients, replySubject, threadingFor } from "./compose.js";
import {
  attachmentFilename, collectAttachmentNodes, extractImapAttachments,
  findBodyNode, findReadableTextPart, formatAddress, formatAddresses,
  nodeMimeType, parseImapMessageId, readStreamToBuffer, readStreamToString,
  resolveImapFlags, toNodemailerAttachments, toSummary,
} from "./imap-parse.js";

export class ImapProvider implements MailProvider {
  readonly type = "imap";
  readonly capabilities: ProviderCapabilities = {
    threads: false, filters: false, templates: false,
    signatures: false, vacation: false, unsubscribe: false,
    attachments: true, inboxSummary: true,
    draftsEdit: false, sendAs: false,
  };

  private specialFolderCache: Map<string, string> = new Map();

  constructor(
    private imap: ImapFlow,
    private smtp: Transporter,
    private email: string
  ) {}

  private async findSpecialFolder(specialUse: string): Promise<string> {
    if (this.specialFolderCache.has(specialUse)) {
      return this.specialFolderCache.get(specialUse)!;
    }
    const folders = await this.imap.list();
    const match = folders.find((f: any) => f.specialUse === specialUse);
    // Fall back to the bare name without the backslash prefix (e.g. "Drafts", "Trash")
    const resolved = match?.path ?? specialUse.replace("\\", "");
    this.specialFolderCache.set(specialUse, resolved);
    return resolved;
  }

  async searchMessages(query: string, maxResults: number = 20, folder: string = "INBOX"): Promise<EmailSummary[]> {
    const lock = await this.imap.getMailboxLock(folder);
    try {
      const trimmed = query.trim();
      const isWildcard = trimmed === "" || trimmed === "*";
      const uids = isWildcard
        ? await this.listRecentUids(maxResults)
        : await this.searchByText(trimmed, maxResults);
      if (uids.length === 0) return [];

      const messages = await this.imap.fetchAll(uids, {
        envelope: true, flags: true, bodyStructure: true, uid: true,
      }, { uid: true });

      return messages.map((msg: any) => toSummary(msg, folder));
    } finally {
      lock.release();
    }
  }

  async findMessageIds(query: string, folder?: string, maxResults?: number): Promise<string[]> {
    const messages = await this.searchMessages(query, maxResults ?? 1000, folder);
    return messages.map((m) => m.id);
  }

  private async searchByText(query: string, maxResults: number): Promise<number[]> {
    // imapflow's search() returns sequence numbers without { uid: true }.
    // Without this, the downstream fetchAll treats the seq nums as UIDs and
    // either fetches the wrong rows or returns empty results on a mailbox
    // with expunged messages.
    const searchResult = await this.imap.search(
      { or: [{ subject: query }, { body: query }] },
      { uid: true },
    );
    let uids = searchResult || [];

    // Non-ASCII queries (Cyrillic, CJK, etc.) frequently return empty from IMAP
    // SEARCH even though imapflow sends CHARSET UTF-8: many servers match against
    // the raw RFC 2047-encoded Subject header (=?utf-8?B?...?=) rather than the
    // decoded text, and body search is often unindexed. Fall back to a bounded
    // client-side envelope scan so users aren't told their messages don't exist.
    if (uids.length === 0 && /[^\x00-\x7F]/.test(query)) {
      uids = await this.clientSideEnvelopeSearch(query, maxResults);
    }
    return uids.slice(-maxResults).reverse();
  }

  /**
   * Scan the tail of the open mailbox and match the query against the decoded
   * envelope (subject, from address, from name). Capped to avoid runaway scans
   * on large mailboxes. Returns UIDs to match the searchByText contract.
   */
  private async clientSideEnvelopeSearch(query: string, maxResults: number): Promise<number[]> {
    const status = (this.imap as any).mailbox;
    const total = status?.exists ?? 0;
    if (total === 0) return [];
    const SCAN_LIMIT = 1000;
    const startSeq = Math.max(1, total - SCAN_LIMIT + 1);
    const needle = query.toLowerCase();
    const matches: number[] = [];
    for await (const msg of this.imap.fetch(`${startSeq}:*`, { uid: true, envelope: true })) {
      const subject = (msg.envelope?.subject ?? "").toLowerCase();
      const from = msg.envelope?.from?.[0];
      const fromText = `${from?.name ?? ""} ${from?.address ?? ""}`.toLowerCase();
      if (subject.includes(needle) || fromText.includes(needle)) {
        matches.push(msg.uid);
        if (matches.length >= maxResults) break;
      }
    }
    return matches;
  }

  /** Fetch the N most recent UIDs from the currently locked mailbox. */
  private async listRecentUids(maxResults: number): Promise<number[]> {
    const status = (this.imap as any).mailbox;
    const total = status?.exists ?? 0;
    if (total === 0) return [];
    const startSeq = Math.max(1, total - maxResults + 1);
    const uids: number[] = [];
    for await (const msg of this.imap.fetch(`${startSeq}:*`, { uid: true })) {
      uids.push(msg.uid);
    }
    return uids.sort((a, b) => b - a);
  }

  async readMessage(messageId: string): Promise<EmailMessage> {
    return this.fetchMessage(messageId);
  }

  private async fetchMessage(messageId: string): Promise<EmailMessage> {
    const { folder, uid } = parseImapMessageId(messageId);
    const lock = await this.imap.getMailboxLock(folder);
    try {
      const meta = await this.imap.fetchOne(uid, {
        envelope: true, flags: true, bodyStructure: true, uid: true,
      }, { uid: true });
      if (!meta) throw new Error(`Message ${messageId} not found`);

      const textPart = findReadableTextPart(meta.bodyStructure);
      let body = "";
      if (textPart) {
        // download() decodes transfer-encoding (base64/quoted-printable) and
        // converts non-UTF-8 charsets to UTF-8 for text parts.
        const dl = await this.imap.download(uid, textPart, { uid: true });
        if (dl?.content) body = await readStreamToString(dl.content);
      } else if (!meta.bodyStructure?.childNodes) {
        // Single-part message with no explicit part path.
        const dl = await this.imap.download(uid, "TEXT", { uid: true });
        if (dl?.content) body = await readStreamToString(dl.content);
      }

      return {
        ...toSummary(meta, folder),
        cc: formatAddresses(meta.envelope?.cc),
        bcc: [],
        replyTo: formatAddress(meta.envelope?.replyTo?.[0]) || undefined,
        snippet: body.slice(0, 100),
        body,
        attachments: extractImapAttachments(meta.bodyStructure),
        rfcMessageId: meta.envelope?.messageId || undefined,
        references: meta.envelope?.inReplyTo || undefined,
      };
    } finally {
      lock.release();
    }
  }

  async readThread(threadId: string): Promise<EmailThread> {
    const message = await this.readMessage(threadId);
    return { id: threadId, subject: message.subject, messages: [message] };
  }

  async sendMessage(to: string[], subject: string, body: string, options?: SendOptions): Promise<string> {
    // No alias list to check against on plain IMAP/SMTP — the relay is the
    // authority on which senders it will accept, and it rejects at send time.
    const result = await this.smtp.sendMail({
      from: options?.from ? stripCRLF(options.from) : this.email,
      to: stripCRLF(to.join(", ")),
      cc: options?.cc ? stripCRLF(options.cc.join(", ")) : undefined,
      bcc: options?.bcc ? stripCRLF(options.bcc.join(", ")) : undefined,
      subject: stripCRLF(subject),
      [options?.html ? "html" : "text"]: body,
      attachments: toNodemailerAttachments(options?.attachments),
      inReplyTo: options?.inReplyTo,
      references: options?.references,
    });
    return result.messageId ?? "";
  }

  async replyToMessage(messageId: string, body: string, options?: ReplyOptions): Promise<string> {
    const original = await this.fetchMessage(messageId);
    const thread = threadingFor(original);
    return this.sendMessage(replyRecipients(original, options?.replyAll), replySubject(original.subject), body, {
      from: options?.from, cc: options?.cc, bcc: options?.bcc, html: options?.html, attachments: options?.attachments,
      inReplyTo: thread.inReplyTo, references: thread.references,
    });
  }

  async forwardMessage(messageId: string, to: string[], options?: ForwardOptions): Promise<string> {
    const original = await this.fetchMessage(messageId);
    return this.sendMessage(to, forwardSubject(original.subject), forwardedBody(original, options?.message), {
      from: options?.from, html: options?.html, attachments: options?.attachments,
    });
  }

  async createDraft(to: string[], subject: string, body: string, options?: DraftOptions): Promise<string> {
    const raw = buildRawMimeMessage({
      from: options?.from ?? this.email,
      to, subject, body,
      cc: options?.cc, bcc: options?.bcc,
      html: options?.html,
      attachments: options?.attachments,
    });

    const draftsFolder = await this.findSpecialFolder("\\Drafts");
    const lock = await this.imap.getMailboxLock(draftsFolder);
    try {
      const appended: any = await this.imap.append(draftsFolder, raw, ["\\Draft"]);
      const uid = appended?.uid;
      if (uid == null) {
        throw new Error("IMAP APPEND did not return a UID (UIDPLUS required). Use list_drafts to find the new draft.");
      }
      return `${draftsFolder}:${uid}`;
    } finally {
      lock.release();
    }
  }

  async trashMessages(messageIds: string[]): Promise<TrashResult[]> {
    const trashFolder = await this.findSpecialFolder("\\Trash");
    const byFolder = new Map<string, number[]>();
    for (const raw of messageIds) {
      const { folder, uid } = parseImapMessageId(raw);
      const list = byFolder.get(folder) ?? [];
      list.push(uid);
      byFolder.set(folder, list);
    }
    const hints: TrashResult[] = [];
    for (const [folder, uids] of byFolder) {
      const lock = await this.imap.getMailboxLock(folder);
      try {
        const moved: any = await this.imap.messageMove(uids.join(","), trashFolder, { uid: true });
        const copied: Map<number, number> | undefined = moved?.copied ?? moved?.uidMap;
        for (const uid of uids) {
          const newUid = copied?.get?.(uid) ?? moved?.uid ?? uid;
          hints.push({ id: `${trashFolder}:${newUid}`, restoreFolder: folder });
        }
      } finally {
        lock.release();
      }
    }
    return hints;
  }

  async undoBulk(request: BulkUndoRequest): Promise<void> {
    if (request.kind === "modify") {
      await this.batchModifyLabels(request.messageIds, request.addLabels, request.removeLabels);
      return;
    }
    const trashFolder = await this.findSpecialFolder("\\Trash");
    const restore = request.restore ?? request.messageIds.map((id) => {
      const parsed = parseImapMessageId(id);
      return { id, folder: parsed.folder };
    });
    const byDest = new Map<string, number[]>();
    for (const item of restore) {
      const dest = item.folder ?? "INBOX";
      const { uid } = parseImapMessageId(item.id);
      const list = byDest.get(dest) ?? [];
      list.push(uid);
      byDest.set(dest, list);
    }
    for (const [dest, uids] of byDest) {
      const lock = await this.imap.getMailboxLock(trashFolder);
      try {
        await this.imap.messageMove(uids.join(","), dest, { uid: true });
      } finally {
        lock.release();
      }
    }
  }

  async listLabels(): Promise<Label[]> {
    const folders = await this.imap.list();
    return folders.map((f: any) => ({
      id: f.path, name: f.path,
      type: f.specialUse ? ("system" as const) : ("user" as const),
    }));
  }

  async createLabel(name: string): Promise<Label> {
    await this.imap.mailboxCreate(name);
    return { id: name, name, type: "user" };
  }

  async deleteLabel(labelId: string): Promise<void> {
    await this.imap.mailboxDelete(labelId);
  }

  async modifyLabels(messageId: string, add: string[], remove: string[]): Promise<void> {
    const { folder, uid } = parseImapMessageId(messageId);
    const { addFlags, removeFlags } = resolveImapFlags(add, remove);
    const lock = await this.imap.getMailboxLock(folder);
    try {
      if (addFlags.length) await this.imap.messageFlagsAdd(uid, addFlags, { uid: true });
      if (removeFlags.length) await this.imap.messageFlagsRemove(uid, removeFlags, { uid: true });
    } finally {
      lock.release();
    }
  }

  async batchModifyLabels(messageIds: string[], add: string[], remove: string[]): Promise<void> {
    const { addFlags, removeFlags } = resolveImapFlags(add, remove);
    const byFolder = new Map<string, number[]>();
    for (const raw of messageIds) {
      const { folder, uid } = parseImapMessageId(raw);
      const list = byFolder.get(folder) ?? [];
      list.push(uid);
      byFolder.set(folder, list);
    }
    for (const [folder, uids] of byFolder) {
      const lock = await this.imap.getMailboxLock(folder);
      try {
        const range = uids.join(",");
        if (addFlags.length) await this.imap.messageFlagsAdd(range, addFlags, { uid: true });
        if (removeFlags.length) await this.imap.messageFlagsRemove(range, removeFlags, { uid: true });
      } finally {
        lock.release();
      }
    }
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<{ filename: string; data: Buffer; mimeType: string }> {
    const { folder, uid } = parseImapMessageId(messageId);
    const lock = await this.imap.getMailboxLock(folder);
    try {
      const meta = await this.imap.fetchOne(uid, { bodyStructure: true, uid: true }, { uid: true });
      if (!meta) throw new Error(`Message ${messageId} not found`);

      // Accept either the IMAP part path (e.g. "2") or the attachment filename.
      // read_email renders both — users naturally reach for the filename, which
      // historically failed because findBodyNode only matched on part path.
      const candidates = collectAttachmentNodes(meta.bodyStructure);
      const node =
        findBodyNode(meta.bodyStructure, attachmentId) ??
        candidates.find((n) => attachmentFilename(n) === attachmentId);
      if (!node) {
        const available = candidates
          .map((n) => attachmentFilename(n) ?? n.part)
          .filter(Boolean)
          .join(", ") || "(none)";
        throw new Error(`Attachment "${attachmentId}" not found. Available: ${available}`);
      }

      const partPath = node.part;
      const dl = await this.imap.download(uid, partPath, { uid: true });
      if (!dl?.content) throw new Error(`Attachment ${attachmentId} could not be downloaded`);
      const data = await readStreamToBuffer(dl.content);

      const filename = dl.meta?.filename
        ?? attachmentFilename(node)
        ?? `attachment-${partPath}`;
      const mimeType = dl.meta?.contentType
        ?? nodeMimeType(node)
        ?? "application/octet-stream";
      return { filename, data, mimeType };
    } finally {
      lock.release();
    }
  }

  async inboxSummary(): Promise<{ total: number; unread: number; recent: EmailSummary[] }> {
    const lock = await this.imap.getMailboxLock("INBOX");
    try {
      const status = (this.imap as any).mailbox;
      const total = status?.exists ?? 0;
      // mailbox.unseen is populated by imapflow at SELECT time and never
      // refreshed — marking messages read/unread, IDLE updates, and concurrent
      // changes from other clients don't touch it. Count fresh via SEARCH
      // against the locked mailbox instead. (Using SEARCH rather than STATUS
      // because RFC 3501 §6.3.10 says STATUS SHOULD NOT be used on the
      // currently-selected mailbox, and we're already inside a lock here.)
      const unseenUids = (await this.imap.search({ seen: false }, { uid: true })) || [];
      const unread = unseenUids.length;
      const uids = await this.listRecentUids(5);
      if (uids.length === 0) return { total, unread, recent: [] };

      const messages = await this.imap.fetchAll(uids, {
        envelope: true, flags: true, bodyStructure: true, uid: true,
      }, { uid: true });
      const recent: EmailSummary[] = messages.map((msg: any) => toSummary(msg, "INBOX"));
      return { total, unread, recent };
    } finally {
      lock.release();
    }
  }

  async markRead(messageId: string, read: boolean): Promise<void> {
    const { folder, uid } = parseImapMessageId(messageId);
    const lock = await this.imap.getMailboxLock(folder);
    try {
      if (read) await this.imap.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      else await this.imap.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
    } finally {
      lock.release();
    }
  }

  async starMessage(messageId: string, starred: boolean): Promise<void> {
    const { folder, uid } = parseImapMessageId(messageId);
    const lock = await this.imap.getMailboxLock(folder);
    try {
      if (starred) await this.imap.messageFlagsAdd(uid, ["\\Flagged"], { uid: true });
      else await this.imap.messageFlagsRemove(uid, ["\\Flagged"], { uid: true });
    } finally {
      lock.release();
    }
  }

  async archiveMessage(messageId: string): Promise<void> {
    const { folder, uid } = parseImapMessageId(messageId);
    const archive = await this.findSpecialFolder("\\Archive");
    const lock = await this.imap.getMailboxLock(folder);
    try {
      await this.imap.messageMove(uid, archive, { uid: true });
    } finally {
      lock.release();
    }
  }

  async listDrafts(maxResults: number = 20): Promise<DraftSummary[]> {
    const drafts = await this.findSpecialFolder("\\Drafts");
    const lock = await this.imap.getMailboxLock(drafts);
    try {
      const uids = await this.listRecentUids(maxResults);
      if (uids.length === 0) return [];
      const messages = await this.imap.fetchAll(uids, {
        envelope: true, uid: true, internalDate: true,
      }, { uid: true });
      return messages.map((msg: any) => ({
        id: `${drafts}:${msg.uid}`,
        subject: msg.envelope?.subject ?? "",
        to: formatAddresses(msg.envelope?.to),
        snippet: "",
        updatedAt: (msg.internalDate ?? msg.envelope?.date)?.toISOString?.() ?? "",
      }));
    } finally {
      lock.release();
    }
  }

  async sendDraft(draftId: string): Promise<string> {
    const { folder, uid } = parseImapMessageId(draftId);
    const lock = await this.imap.getMailboxLock(folder);
    let rawSource: Buffer;
    let envelope: any;
    try {
      const msg: any = await this.imap.fetchOne(uid, { source: true, envelope: true, uid: true }, { uid: true });
      if (!msg || !msg.source) throw new Error(`Draft ${draftId} not found`);
      rawSource = msg.source;
      envelope = msg.envelope;
    } finally {
      lock.release();
    }

    const to = formatAddresses(envelope?.to);
    const cc = formatAddresses(envelope?.cc);
    const bcc = formatAddresses(envelope?.bcc);
    const result = await this.smtp.sendMail({
      from: stripCRLF(this.email),
      to: stripCRLF(to.join(", ")),
      cc: cc.length ? stripCRLF(cc.join(", ")) : undefined,
      bcc: bcc.length ? stripCRLF(bcc.join(", ")) : undefined,
      raw: rawSource,
    });

    // Remove sent draft from Drafts folder
    const cleanupLock = await this.imap.getMailboxLock(folder);
    try {
      await this.imap.messageDelete(uid, { uid: true });
    } finally {
      cleanupLock.release();
    }

    return result.messageId ?? "";
  }

  async countUnreadByLabel(): Promise<UnreadCount[]> {
    const folders = ((await this.imap.list()) as any[])
      .filter((f) => !f.flags?.has?.("\\Noselect"));
    // Sequential STATUS round-trips on accounts with many folders pushed this past
    // MCP timeouts. IMAP servers tolerate small concurrency for STATUS commands.
    const CONCURRENCY = 8;
    const results: (UnreadCount | null)[] = new Array(folders.length).fill(null);
    let cursor = 0;
    const self = this;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= folders.length) return;
        const f = folders[i];
        try {
          const status = await (self.imap as any).status(f.path, { unseen: true });
          const unseen = status?.unseen ?? 0;
          if (unseen > 0) results[i] = { labelId: f.path, name: f.path, unread: unseen };
        } catch {
          // skip folders we can't STATUS
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, folders.length) }, () => worker()));
    return (results.filter(Boolean) as UnreadCount[]).sort((a, b) => b.unread - a.unread);
  }

  async exportMessage(messageId: string): Promise<ExportedMessage> {
    const { folder, uid } = parseImapMessageId(messageId);
    const lock = await this.imap.getMailboxLock(folder);
    try {
      const msg: any = await this.imap.fetchOne(uid, { source: true, uid: true }, { uid: true });
      if (!msg || !msg.source) throw new Error(`Message ${messageId} not found`);
      return {
        filename: `${uid}.eml`,
        data: msg.source,
        mimeType: "message/rfc822",
      };
    } finally {
      lock.release();
    }
  }

  async messagesSince(since: string, folder: string = "INBOX", maxResults: number = 50): Promise<EmailSummary[]> {
    const date = new Date(since);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid since timestamp: ${since}`);
    const lock = await this.imap.getMailboxLock(folder);
    try {
      // Same UID/seq mismatch as searchByText: search() returns seq nums by
      // default, fetchAll then treats them as UIDs. Pass { uid: true } at
      // both call sites so the pipeline is UID-based end to end.
      const uids = (await this.imap.search({ since: date }, { uid: true })) || [];
      const limited = uids.slice(-maxResults).reverse();
      if (limited.length === 0) return [];
      const messages = await this.imap.fetchAll(limited, {
        envelope: true, flags: true, bodyStructure: true, uid: true,
      }, { uid: true });
      return messages.map((msg: any) => toSummary(msg, folder));
    } finally {
      lock.release();
    }
  }
}
