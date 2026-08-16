import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountManager } from "../../src/accounts.js";
import { handleToolCall, type ToolContext } from "../../src/tools/registry.js";

vi.mock("../../src/auth/gmail-oauth.js", () => ({
  authenticateGmail: vi.fn().mockRejectedValue(new Error("oauth cancelled")),
}));

import "../../src/tools/account.js";

describe("atomic authenticate", () => {
  let tempDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mailbox-mcp-auth-"));
    ctx = { accountManager: new AccountManager(tempDir), getProvider: vi.fn() };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("failed Gmail OAuth leaves no list_accounts entry", async () => {
    const result = await handleToolCall("authenticate", {
      alias: "personal",
      provider: "gmail",
      email: "user@example.com",
    }, ctx);
    expect(result.isError).toBe(true);
    expect(ctx.accountManager.listAccounts()).toEqual({});
  });

  it("IMAP authenticate with missing fields does not add an account", async () => {
    const result = await handleToolCall("authenticate", {
      alias: "work",
      provider: "imap",
      email: "me@work.com",
    }, ctx);
    expect(result.isError).toBe(true);
    expect(ctx.accountManager.listAccounts()).toEqual({});
  });
});
