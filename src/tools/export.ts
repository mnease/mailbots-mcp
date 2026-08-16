import { registerTool } from "./registry.js";
import { writeDownload } from "../security/save-file.js";

registerTool({
  definition: {
    name: "export_email",
    description: "Export an email as a raw RFC 822 .eml file to a safe directory. Useful for archival, legal discovery, or migration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "Account alias" },
        message_id: { type: "string", description: "Message ID" },
        save_to: { type: "string", description: `Directory to save to (default ~/Downloads/mailbox-mcp). Allowed: ~/Downloads/mailbox-mcp or /tmp.` },
      },
      required: ["account", "message_id"],
    },
  },
  group: "attachments",
  handler: async (args, ctx) => {
    const provider = await ctx.getProvider(args.account as string);
    const result = await provider.exportMessage(args.message_id as string);
    const filePath = writeDownload(args.save_to as string | undefined, result.filename, result.data);
    return { content: [{ type: "text", text: `Exported "${result.filename}" (${result.data.length} bytes) to ${filePath}` }] };
  },
});

registerTool({
  definition: {
    name: "export_thread",
    description: "Export all messages in a thread as individual .eml files to a safe directory. Gmail/JMAP only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        account: { type: "string", description: "Account alias" },
        thread_id: { type: "string", description: "Thread ID" },
        save_to: { type: "string", description: `Directory to save to (default ~/Downloads/mailbox-mcp). Allowed: ~/Downloads/mailbox-mcp or /tmp.` },
      },
      required: ["account", "thread_id"],
    },
  },
  group: "attachments",
  requiredCapability: "threads",
  handler: async (args, ctx) => {
    const provider = await ctx.getProvider(args.account as string);
    const thread = await provider.readThread(args.thread_id as string);
    const written: string[] = [];
    for (const msg of thread.messages) {
      const exported = await provider.exportMessage(msg.id);
      written.push(writeDownload(args.save_to as string | undefined, exported.filename, exported.data));
    }
    return { content: [{ type: "text", text: `Exported ${written.length} messages from thread ${args.thread_id}:\n${written.join("\n")}` }] };
  },
});
