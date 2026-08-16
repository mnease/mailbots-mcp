import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { MailProvider, ProviderCapabilities } from "../providers/interface.js";
import type { AccountManager } from "../accounts.js";
import { env, envDisplay } from "../identity.js";

export interface ToolContext {
  accountManager: AccountManager;
  getProvider: (alias: string) => MailProvider | Promise<MailProvider>;
  clearProviderCache?: (alias: string) => void;
}

export interface ToolHandler {
  (args: Record<string, unknown>, ctx: ToolContext): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

export type ToolGroup = "core" | "organize" | "bulk" | "attachments" | "gmail-extras";

interface RegisteredTool {
  definition: Tool;
  handler: ToolHandler;
  group: ToolGroup;
  requiredCapability?: keyof ProviderCapabilities;
}

const tools: RegisteredTool[] = [];

export function registerTool(opts: {
  definition: Tool;
  handler: ToolHandler;
  group: ToolGroup;
  requiredCapability?: keyof ProviderCapabilities;
}): void {
  if (tools.some((t) => t.definition.name === opts.definition.name)) {
    throw new Error(`Tool "${opts.definition.name}" is already registered`);
  }
  tools.push({
    definition: opts.definition,
    handler: opts.handler,
    group: opts.group,
    requiredCapability: opts.requiredCapability,
  });
}

/** Test helper: every registered tool must have declared a group. */
export function registeredToolGroups(): Record<string, ToolGroup> {
  return Object.fromEntries(tools.map((t) => [t.definition.name, t.group]));
}

function enabledGroups(): Set<string> | null {
  const raw = env("TOOLS")?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((g) => g.trim().toLowerCase()).filter(Boolean));
}

function isToolEnabled(tool: RegisteredTool): boolean {
  const groups = enabledGroups();
  if (!groups) return true;
  return groups.has(tool.group);
}

export function getAllToolDefinitions(): Tool[] {
  return tools.filter(isToolEnabled).map((t) => t.definition);
}

export function sanitizeErrorMessage(message: string, redactTokens: (s: string) => string): string {
  return redactTokens(message).replace(/\/[^\s:,'"]+\//g, "[path]/");
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  if (!isToolEnabled(tool)) {
    return {
      content: [{
        type: "text",
        text: `Tool "${name}" is disabled: its group "${tool.group}" is not in ${envDisplay("TOOLS")} (currently "${env("TOOLS")}").`,
      }],
      isError: true,
    };
  }

  if (tool.requiredCapability && args.account) {
    const provider = await ctx.getProvider(args.account as string);
    if (!provider.capabilities[tool.requiredCapability]) {
      return {
        content: [{
          type: "text",
          text: `${provider.type.toUpperCase()} accounts don't support ${tool.requiredCapability}.`,
        }],
        isError: true,
      };
    }
  }

  try {
    return await tool.handler(args, ctx);
  } catch (error) {
    const { redactTokens } = await import("../security/sanitize.js");
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: sanitizeErrorMessage(message, redactTokens) }], isError: true };
  }
}
