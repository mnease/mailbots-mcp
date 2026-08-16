import { registerTool } from "./registry.js";
import { writeDownload } from "../security/save-file.js";

registerTool({
  definition: {
    name: "download_attachment",
    description: "Download an email attachment to a safe directory",
    inputSchema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "Account alias" },
        message_id: { type: "string", description: "Message ID" },
        attachment_id: { type: "string", description: "Attachment filename (recommended — stable) or ID from read_email (Gmail IDs are ephemeral)" },
        save_to: { type: "string", description: `Directory to save to (default ~/Downloads/mailbots-mcp). Allowed: ~/Downloads/mailbots-mcp or /tmp.` },
      },
      required: ["account", "message_id", "attachment_id"],
    },
  },
  group: "attachments",
  handler: async (args, ctx) => {
    const provider = await ctx.getProvider(args.account as string);
    const result = await provider.downloadAttachment(args.message_id as string, args.attachment_id as string);
    const filePath = writeDownload(args.save_to as string | undefined, result.filename, result.data);
    return { content: [{ type: "text", text: `Downloaded "${result.filename}" (${result.mimeType}, ${result.data.length} bytes) to ${filePath}` }] };
  },
});
