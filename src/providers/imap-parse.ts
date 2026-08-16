import type { Attachment, AttachmentInfo, EmailSummary } from "./interface.js";

export function formatAddress(addr: { address?: string; name?: string } | undefined): string {
  if (!addr) return "";
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address ?? "";
}

export function formatAddresses(addrs: Array<{ address?: string; name?: string }> | undefined): string[] {
  return (addrs ?? []).map(formatAddress).filter(Boolean);
}

export function flagsToLabels(flags: Set<string> | string[] | undefined): string[] {
  const set = flags instanceof Set ? flags : new Set(flags ?? []);
  const labels: string[] = [];
  if (!set.has("\\Seen") && !set.has("\\seen")) labels.push("UNREAD");
  if (set.has("\\Flagged") || set.has("\\flagged")) labels.push("STARRED");
  if (set.has("\\Draft") || set.has("\\draft")) labels.push("DRAFT");
  if (set.has("\\Answered") || set.has("\\answered")) labels.push("ANSWERED");
  for (const f of set) {
    if (typeof f === "string" && !f.startsWith("\\")) labels.push(f);
  }
  return labels;
}

export function toSummary(msg: any, folder: string): EmailSummary {
  return {
    id: `${folder}:${msg.uid}`,
    from: formatAddress(msg.envelope?.from?.[0]),
    to: formatAddresses(msg.envelope?.to),
    subject: msg.envelope?.subject ?? "",
    snippet: "",
    date: msg.envelope?.date?.toISOString() ?? "",
    labels: flagsToLabels(msg.flags),
    hasAttachments: collectAttachmentNodes(msg.bodyStructure).length > 0,
  };
}

export interface ImapMessageId {
  folder: string;
  uid: number;
}

export function parseImapMessageId(raw: string): ImapMessageId {
  const idx = raw.lastIndexOf(":");
  if (idx > 0) {
    const folder = raw.slice(0, idx);
    const uid = parseInt(raw.slice(idx + 1), 10);
    if (!Number.isNaN(uid)) return { folder, uid };
  }
  const uid = parseInt(raw, 10);
  if (Number.isNaN(uid)) {
    throw new Error(`Invalid IMAP message id: "${raw}"`);
  }
  return { folder: "INBOX", uid };
}

const IMAP_SYSTEM_FLAGS: Record<string, string> = {
  seen: "\\Seen",
  answered: "\\Answered",
  flagged: "\\Flagged",
  deleted: "\\Deleted",
  draft: "\\Draft",
  recent: "\\Recent",
};

interface ResolvedFlag {
  flag: string;
  invert: boolean;
}

function resolveImapFlag(name: string): ResolvedFlag {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Empty flag name");
  }
  if (trimmed.toLowerCase() === "unread") {
    return { flag: "\\Seen", invert: true };
  }
  if (trimmed.toLowerCase() === "starred") {
    return { flag: "\\Flagged", invert: false };
  }
  const bare = trimmed.startsWith("\\") ? trimmed.slice(1) : trimmed;
  const canonical = IMAP_SYSTEM_FLAGS[bare.toLowerCase()];
  if (canonical) {
    return { flag: canonical, invert: false };
  }
  return { flag: trimmed, invert: false };
}

export function resolveImapFlags(add: string[], remove: string[]): { addFlags: string[]; removeFlags: string[] } {
  const addFlags: string[] = [];
  const removeFlags: string[] = [];
  for (const name of add) {
    const r = resolveImapFlag(name);
    (r.invert ? removeFlags : addFlags).push(r.flag);
  }
  for (const name of remove) {
    const r = resolveImapFlag(name);
    (r.invert ? addFlags : removeFlags).push(r.flag);
  }
  return { addFlags, removeFlags };
}

export function nodeMimeType(node: any): string {
  if (!node) return "";
  if (node.subtype) return `${node.type}/${node.subtype}`.toLowerCase();
  return (node.type ?? "").toLowerCase();
}

export function findBodyNode(bodyStructure: any, partPath: string): any | undefined {
  if (!bodyStructure) return undefined;
  if (bodyStructure.part === partPath) return bodyStructure;
  for (const child of bodyStructure.childNodes ?? []) {
    const hit = findBodyNode(child, partPath);
    if (hit) return hit;
  }
  return undefined;
}

export function attachmentFilename(node: any): string | undefined {
  return node?.dispositionParameters?.filename ?? node?.parameters?.name;
}

export function collectAttachmentNodes(node: any, out: any[] = []): any[] {
  if (!node) return out;
  const isAttachment =
    node.disposition === "attachment" ||
    (node.part && attachmentFilename(node) && !nodeMimeType(node).startsWith("multipart/"));
  if (isAttachment && node.part) out.push(node);
  for (const child of node.childNodes ?? []) collectAttachmentNodes(child, out);
  return out;
}

export function findReadableTextPart(bodyStructure: any): string | undefined {
  if (!bodyStructure) return undefined;
  const plain = findTextPart(bodyStructure, "text/plain");
  if (plain) return plain;
  return findTextPart(bodyStructure, "text/html");
}

function findTextPart(node: any, target: string): string | undefined {
  if (!node) return undefined;
  if (nodeMimeType(node) === target && node.disposition !== "attachment" && node.part) {
    return node.part;
  }
  for (const child of node.childNodes ?? []) {
    const hit = findTextPart(child, target);
    if (hit) return hit;
  }
  return undefined;
}

export async function readStreamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

export function toNodemailerAttachments(atts: Attachment[] | undefined) {
  if (!atts || atts.length === 0) return undefined;
  return atts.map((a) => ({
    filename: a.filename,
    content: a.data,
    contentType: a.mimeType,
  }));
}

export function extractImapAttachments(bodyStructure: any): AttachmentInfo[] {
  return collectAttachmentNodes(bodyStructure).map((node) => ({
    id: node.part ?? "",
    filename: attachmentFilename(node) ?? "",
    mimeType: nodeMimeType(node) || "application/octet-stream",
    size: node.size ?? 0,
  }));
}
