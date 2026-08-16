import type { ProviderCapabilities } from "../src/providers/interface.js";

export const GMAIL_CAPS: ProviderCapabilities = {
  threads: true, filters: true, templates: true, signatures: true,
  vacation: true, unsubscribe: true, attachments: true, inboxSummary: true,
  draftsEdit: true, sendAs: true,
};

export const IMAP_CAPS: ProviderCapabilities = {
  threads: false, filters: false, templates: false, signatures: false,
  vacation: false, unsubscribe: false, attachments: true, inboxSummary: true,
  draftsEdit: false, sendAs: false,
};
