import { validateNoSSRF } from "../security/validation.js";
import type { EmailMessage, EmailSummary } from "./interface.js";

export interface JmapSession {
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  accountId: string;
}

interface JmapAddress {
  name?: string;
  email: string;
}

export function requireSecureUrl(url: string, context: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${context}: invalid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${context}: HTTPS required, got ${parsed.protocol}`);
  }
  validateNoSSRF(url);
}

export function extractJmapBody(e: any): string {
  const values = e.bodyValues ?? {};
  const textPartId = e.textBody?.[0]?.partId;
  if (textPartId && values[textPartId]?.value) {
    return values[textPartId].value;
  }
  const htmlPartId = e.htmlBody?.[0]?.partId;
  if (htmlPartId && values[htmlPartId]?.value) {
    return values[htmlPartId].value;
  }
  return "";
}

export function formatJmapAddress(addr: JmapAddress | undefined): string {
  if (!addr) return "";
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

export function formatJmapAddresses(addrs: JmapAddress[] | undefined): string[] {
  return (addrs ?? []).map(formatJmapAddress).filter(Boolean);
}

export function toSummary(e: any): EmailSummary {
  return {
    id: e.id,
    threadId: e.threadId,
    from: formatJmapAddress(e.from?.[0]),
    to: formatJmapAddresses(e.to),
    subject: e.subject ?? "",
    snippet: e.preview ?? "",
    date: e.receivedAt ?? "",
    labels: Object.keys(e.mailboxIds ?? {}),
    hasAttachments: e.hasAttachment ?? false,
  };
}

export function toMessage(e: any): EmailMessage {
  return {
    ...toSummary(e),
    cc: formatJmapAddresses(e.cc),
    bcc: formatJmapAddresses(e.bcc),
    replyTo: formatJmapAddress(e.replyTo?.[0]) || undefined,
    body: extractJmapBody(e),
    attachments: (e.attachments ?? []).map((a: any) => ({
      id: a.blobId,
      filename: a.name ?? "attachment",
      mimeType: a.type ?? "application/octet-stream",
      size: a.size ?? 0,
    })),
    rfcMessageId: Array.isArray(e.messageId) ? e.messageId[0] : e.messageId,
    references: Array.isArray(e.references) ? e.references.join(" ") : e.references,
  };
}
