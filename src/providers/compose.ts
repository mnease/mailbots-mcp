import { ensureForwardPrefix, ensureReplyPrefix } from "./headers.js";
import type { EmailMessage } from "./interface.js";

/** Build In-Reply-To / References from the original message's RFC 5322 ids. */
export function threadingFor(original: {
  rfcMessageId?: string;
  references?: string;
}): { inReplyTo?: string; references?: string } {
  if (!original.rfcMessageId) return {};
  const refs = original.references
    ? `${original.references} ${original.rfcMessageId}`
    : original.rfcMessageId;
  return { inReplyTo: original.rfcMessageId, references: refs };
}

export function replyRecipients(original: EmailMessage, replyAll?: boolean): string[] {
  const replyAddress = original.replyTo || original.from;
  if (!replyAll) return [replyAddress].filter(Boolean);
  return [replyAddress, ...original.to, ...original.cc].filter(Boolean);
}

export function replySubject(subject: string): string {
  return ensureReplyPrefix(subject);
}

export function forwardSubject(subject: string): string {
  return ensureForwardPrefix(subject);
}

export function forwardedBody(original: EmailMessage, preface?: string): string {
  const block = `---------- Forwarded message ----------\n${original.body}`;
  return preface ? `${preface}\n\n${block}` : block;
}
