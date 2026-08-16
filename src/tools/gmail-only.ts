import { registerTool } from "./registry.js";
import { fenceEmailHeader, fenceEmailContent } from "../security/sanitize.js";
import { checkSendLimit, recordSuccessfulSend } from "./write.js";
import { asGmailAccount } from "../providers/gmail.js";
import { loadAttachments } from "../security/attachment-loader.js";

function mapLabelIdsToNames(action: Record<string, unknown>, names: Map<string, string>): Record<string, unknown> {
  const named = (ids: unknown) =>
    Array.isArray(ids) ? ids.map((id) => names.get(id as string) ?? id) : ids;
  return { ...action, addLabelIds: named(action.addLabelIds), removeLabelIds: named(action.removeLabelIds) };
}

registerTool({
  definition: { name: "list_filters", description: "List Gmail filters",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" } }, required: ["account"] } },
  group: "gmail-extras",
  requiredCapability: "filters",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const filters = await gmail.listFilters();
    if (filters.length === 0) return { content: [{ type: "text", text: "No filters configured." }] };
    const names = await gmail.labelNamesById();
    const describe = (part: unknown, withNames = false) => {
      if (!part) return "{}";
      const value = withNames ? mapLabelIdsToNames(part as Record<string, unknown>, names) : part;
      return fenceEmailContent(JSON.stringify(value));
    };
    const lines = filters.map((f) => `- **${f.id}**: ${describe(f.criteria)} → ${describe(f.action, true)}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
});

registerTool({
  definition: { name: "create_filter", description: "Create a Gmail filter",
    inputSchema: { type: "object" as const, properties: {
      account: { type: "string", description: "Account alias" },
      from: { type: "string", description: "Filter by sender" }, to: { type: "string", description: "Filter by recipient" },
      subject: { type: "string", description: "Filter by subject" }, query: { type: "string", description: "Filter by search query" },
      add_label: { type: "string", description: "Label to apply, by name (e.g. 'Investing' or 'Newsletters/Investing') or by label ID" },
      remove_label: { type: "string", description: "Label to remove, by name or ID" },
      create_label: { type: "boolean", description: "Create add_label if no label with that name exists (default false)" },
      archive: { type: "boolean", description: "Skip inbox" }, mark_read: { type: "boolean", description: "Mark as read" },
    }, required: ["account"] } },
  group: "gmail-extras",
  requiredCapability: "filters",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const id = await gmail.createFilter({
      from: args.from as string | undefined,
      to: args.to as string | undefined,
      subject: args.subject as string | undefined,
      query: args.query as string | undefined,
      addLabel: args.add_label as string | undefined,
      removeLabel: args.remove_label as string | undefined,
      createLabel: args.create_label as boolean | undefined,
      archive: args.archive as boolean | undefined,
      markRead: args.mark_read as boolean | undefined,
    });
    return { content: [{ type: "text", text: `Filter created: ${id}` }] };
  },
});

registerTool({
  definition: { name: "delete_filter", description: "Delete a Gmail filter",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" }, filter_id: { type: "string", description: "Filter ID to delete" } }, required: ["account", "filter_id"] } },
  group: "gmail-extras",
  requiredCapability: "filters",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    await gmail.deleteFilter(args.filter_id as string);
    return { content: [{ type: "text", text: `Filter "${args.filter_id}" deleted.` }] };
  },
});

registerTool({
  definition: { name: "save_template", description: "Save an email template as a Gmail draft labelled mailbox-mcp-template",
    inputSchema: { type: "object" as const, properties: {
      account: { type: "string", description: "Account alias" }, name: { type: "string", description: "Template name" },
      subject: { type: "string", description: "Template subject" }, body: { type: "string", description: "Template body" },
    }, required: ["account", "name", "subject", "body"] } },
  group: "gmail-extras",
  requiredCapability: "templates",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const id = await gmail.saveTemplate(args.name as string, args.subject as string, args.body as string);
    return { content: [{ type: "text", text: `Template "${args.name}" saved as draft ${id}.` }] };
  },
});

registerTool({
  definition: { name: "list_templates", description: "List saved email templates",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" } }, required: ["account"] } },
  group: "gmail-extras",
  requiredCapability: "templates",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const results = await gmail.listTemplates();
    if (results.length === 0) return { content: [{ type: "text", text: "No templates saved." }] };
    const lines = results.map((m) => `- **${m.id}**: ${fenceEmailContent(m.subject, "subject")}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
});

registerTool({
  definition: { name: "delete_template", description: "Delete a saved template",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" }, message_id: { type: "string", description: "Template message ID" } }, required: ["account", "message_id"] } },
  group: "gmail-extras",
  requiredCapability: "templates",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    await gmail.deleteTemplate(args.message_id as string);
    return { content: [{ type: "text", text: `Template deleted.` }] };
  },
});

registerTool({
  definition: { name: "send_template", description: "Send an email using a saved template",
    inputSchema: { type: "object" as const, properties: {
      account: { type: "string", description: "Account alias" }, message_id: { type: "string", description: "Template message ID" },
      to: { type: "array", items: { type: "string" }, description: "Recipients" },
    }, required: ["account", "message_id", "to"] } },
  group: "gmail-extras",
  requiredCapability: "templates",
  handler: async (args, ctx) => {
    const limitError = checkSendLimit(args.account as string);
    if (limitError) return { content: [{ type: "text", text: limitError }], isError: true };
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const id = await gmail.sendTemplate(args.message_id as string, args.to as string[]);
    recordSuccessfulSend(args.account as string);
    return { content: [{ type: "text", text: `Sent from template. Message ID: ${id}` }] };
  },
});

registerTool({
  definition: { name: "get_signature", description: "Get the email signature for a Gmail account",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" } }, required: ["account"] } },
  group: "gmail-extras",
  requiredCapability: "signatures",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const signature = await gmail.getSignature();
    return { content: [{ type: "text", text: fenceEmailContent(signature || "(no signature set)") }] };
  },
});

registerTool({
  definition: { name: "set_signature", description: "Update the email signature for a Gmail account",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" }, signature: { type: "string", description: "HTML signature content" } }, required: ["account", "signature"] } },
  group: "gmail-extras",
  requiredCapability: "signatures",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    await gmail.setSignature(args.signature as string);
    return { content: [{ type: "text", text: "Signature updated." }] };
  },
});

registerTool({
  definition: { name: "get_vacation", description: "Get vacation auto-reply settings",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" } }, required: ["account"] } },
  group: "gmail-extras",
  requiredCapability: "vacation",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const v = await gmail.getVacation();
    const status = v.enabled ? "enabled" : "disabled";
    const text = [`**Status:** ${status}`, v.subject ? `**Subject:** ${fenceEmailContent(v.subject, "subject")}` : "", v.bodyHtml ? `**Body:** ${fenceEmailContent(v.bodyHtml)}` : ""].filter(Boolean).join("\n");
    return { content: [{ type: "text", text }] };
  },
});

registerTool({
  definition: { name: "set_vacation", description: "Configure vacation auto-reply",
    inputSchema: { type: "object" as const, properties: {
      account: { type: "string", description: "Account alias" }, enabled: { type: "boolean", description: "Enable or disable auto-reply" },
      subject: { type: "string", description: "Auto-reply subject" }, body: { type: "string", description: "Auto-reply body (HTML)" },
      start_time: { type: "string", description: "Start date (ISO format, e.g. '2026-03-10')" },
      end_time: { type: "string", description: "End date (ISO format, e.g. '2026-03-20')" },
      contacts_only: { type: "boolean", description: "Only reply to contacts" },
      domain_only: { type: "boolean", description: "Only reply to same domain" },
    }, required: ["account", "enabled"] } },
  group: "gmail-extras",
  requiredCapability: "vacation",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    await gmail.setVacation({
      enabled: args.enabled as boolean,
      subject: args.subject as string | undefined,
      body: args.body as string | undefined,
      startTime: args.start_time as string | undefined,
      endTime: args.end_time as string | undefined,
      contactsOnly: args.contacts_only as boolean | undefined,
      domainOnly: args.domain_only as boolean | undefined,
    });
    return { content: [{ type: "text", text: `Vacation auto-reply ${args.enabled ? "enabled" : "disabled"}.` }] };
  },
});

registerTool({
  definition: { name: "unsubscribe", description: "Unsubscribe from a mailing list by finding the List-Unsubscribe header",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" }, message_id: { type: "string", description: "Message ID from the mailing list" } }, required: ["account", "message_id"] } },
  group: "gmail-extras",
  requiredCapability: "unsubscribe",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const header = await gmail.getUnsubscribeHeader(args.message_id as string);
    if (!header.listUnsubscribe) return { content: [{ type: "text", text: "No List-Unsubscribe header found on this message." }], isError: true };
    return { content: [{ type: "text", text: `Unsubscribe link: ${fenceEmailContent(header.listUnsubscribe)}\n\nOpen this URL to unsubscribe.` }] };
  },
});

registerTool({
  definition: { name: "bulk_unsubscribe", description: "Find unsubscribe links for multiple mailing list messages",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" }, message_ids: { type: "array", items: { type: "string" }, description: "Message IDs" } }, required: ["account", "message_ids"] } },
  group: "gmail-extras",
  requiredCapability: "unsubscribe",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const rows = await gmail.getUnsubscribeHeaders(args.message_ids as string[]);
    const results = rows.map((row) => {
      const from = row.from ?? "unknown";
      return row.listUnsubscribe
        ? `- ${fenceEmailHeader(from, "from")}: ${fenceEmailContent(row.listUnsubscribe)}`
        : `- ${fenceEmailHeader(from, "from")}: no unsubscribe link`;
    });
    return { content: [{ type: "text", text: results.join("\n") }] };
  },
});

registerTool({
  definition: {
    name: "update_draft",
    description: "Replace the contents of an existing Gmail draft. The draft's thread association is preserved automatically.",
    inputSchema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "Account alias" },
        draft_id: { type: "string", description: "Draft ID returned by create_draft" },
        to: { type: "array", items: { type: "string" }, description: "Recipient email addresses" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" },
        from: {
          type: "string",
          description: "Sender address. Must be a verified send-as alias on the account. Defaults to the primary address.",
        },
        cc: { type: "array", items: { type: "string" }, description: "CC recipients" },
        bcc: { type: "array", items: { type: "string" }, description: "BCC recipients" },
        html: { type: "boolean", description: "Send as HTML (default false)" },
        attachments: {
          type: "array", items: { type: "string" },
          description: "Optional list of local file paths to attach. Each must be a regular file under 25 MB.",
        },
      },
      required: ["account", "draft_id", "to", "subject", "body"],
    },
  },
  group: "gmail-extras",
  requiredCapability: "draftsEdit",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const attachments = loadAttachments(args.attachments as string[] | undefined);
    await gmail.updateDraft(
      args.draft_id as string,
      args.to as string[],
      args.subject as string,
      args.body as string,
      {
        from: args.from as string | undefined,
        cc: args.cc as string[] | undefined,
        bcc: args.bcc as string[] | undefined,
        html: args.html as boolean | undefined,
        attachments,
      },
    );
    return { content: [{ type: "text", text: `Draft ${args.draft_id} updated.` }] };
  },
});

registerTool({
  definition: {
    name: "delete_draft",
    description: "Permanently delete a Gmail draft. This cannot be undone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "Account alias" },
        draft_id: { type: "string", description: "Draft ID to delete" },
      },
      required: ["account", "draft_id"],
    },
  },
  group: "gmail-extras",
  requiredCapability: "draftsEdit",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    await gmail.deleteDraft(args.draft_id as string);
    return { content: [{ type: "text", text: `Draft ${args.draft_id} deleted.` }] };
  },
});

registerTool({
  definition: { name: "list_send_as", description: "List send-as aliases configured on a Gmail account",
    inputSchema: { type: "object" as const, properties: { account: { type: "string", description: "Account alias" } }, required: ["account"] } },
  group: "gmail-extras",
  requiredCapability: "sendAs",
  handler: async (args, ctx) => {
    const gmail = asGmailAccount(await ctx.getProvider(args.account as string));
    const aliases = await gmail.listSendAs();
    const lines = aliases.map((a) => `- ${a.email}${a.isPrimary ? " (primary)" : ""}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
});
