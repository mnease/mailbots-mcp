import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const PRODUCT_NAME = "Mailbots-MCP";
export const PACKAGE_NAME = "mailbots-mcp";
export const LEGACY_PACKAGE_NAME = "mailbox-mcp";

const ENV_PREFIX = "MAILBOTS_MCP_";
const LEGACY_ENV_PREFIX = "MAILBOX_MCP_";

/** Read MAILBOTS_MCP_<suffix>, then the legacy MAILBOX_MCP_<suffix>. */
export function env(suffix: string): string | undefined {
  const next = process.env[ENV_PREFIX + suffix];
  if (next != null && next !== "") return next;
  const prev = process.env[LEGACY_ENV_PREFIX + suffix];
  if (prev != null && prev !== "") return prev;
  return undefined;
}

/** Whichever matching env var is set, including empty, for error text. */
export function envDisplay(suffix: string): string {
  if (process.env[ENV_PREFIX + suffix] != null) return ENV_PREFIX + suffix;
  if (process.env[LEGACY_ENV_PREFIX + suffix] != null) return LEGACY_ENV_PREFIX + suffix;
  return ENV_PREFIX + suffix;
}

export const CONFIG_DIR_NAME = ".mailbots-mcp";
export const LEGACY_CONFIG_DIR_NAME = ".mailbox-mcp";

/** Prefer ~/.mailbots-mcp; keep using ~/.mailbox-mcp if that is where data already lives. */
export function defaultConfigDir(): string {
  const override = env("CONFIG_DIR");
  if (override) return override;
  const next = join(homedir(), CONFIG_DIR_NAME);
  const prev = join(homedir(), LEGACY_CONFIG_DIR_NAME);
  if (existsSync(next)) return next;
  if (existsSync(prev)) return prev;
  return next;
}

/**
 * True when this process is hosted by Grok Build or Grok Bot.
 * Grok Bot (Cursor) often has no GROK_* vars; set MAILBOTS_MCP_HOST=grok in MCP env.
 */
export function isGrokHost(): boolean {
  const host = env("HOST")?.trim().toLowerCase();
  if (host === "grok" || host === "grok-build" || host === "grok-bot") return true;
  if (host === "off" || process.env.VITEST) return false;
  return Boolean(
    process.env.GROK_HOME
    || process.env.GROK_SESSION_ID
    || process.env.GROK_MAX_MCP_OUTPUT_BYTES
    || process.env.GROK_MCP_STARTUP_TIMEOUT_SECS,
  );
}

/**
 * Max tool-result characters. 0 means do not clip.
 * Grok's default MCP output cap is 20_000 bytes; stay under that.
 */
export function resultBudgetBytes(): number {
  const raw = env("MAX_RESULT_BYTES");
  if (raw && /^\d+$/.test(raw)) return Math.max(1024, Number(raw));
  const grokCap = process.env.GROK_MAX_MCP_OUTPUT_BYTES;
  if (grokCap && /^\d+$/.test(grokCap)) return Math.max(1024, Number(grokCap) - 2000);
  if (isGrokHost()) return 18_000;
  return 0;
}

export const DEFAULT_DOWNLOAD_DIR_NAME = "mailbots-mcp";
export const LEGACY_DOWNLOAD_DIR_NAME = "mailbox-mcp";
