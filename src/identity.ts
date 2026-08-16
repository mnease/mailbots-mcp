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
  const next = join(homedir(), CONFIG_DIR_NAME);
  const prev = join(homedir(), LEGACY_CONFIG_DIR_NAME);
  if (existsSync(next)) return next;
  if (existsSync(prev)) return prev;
  return next;
}

export const DEFAULT_DOWNLOAD_DIR_NAME = "mailbots-mcp";
export const LEGACY_DOWNLOAD_DIR_NAME = "mailbox-mcp";
