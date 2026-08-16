import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountManager } from "../../src/accounts.js";
import { handleToolCall, type ToolContext } from "../../src/tools/registry.js";

vi.mock("../../src/auth/gmail-oauth.js", () => ({
  authenticateGmail: vi.fn(),
  beginGmailOAuth: vi.fn().mockReturnValue({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
    done: new Promise(() => {}),
  }),
  awaitGmailOAuth: vi.fn().mockResolvedValue(undefined),
  hasPendingGmailOAuth: vi.fn().mockReturnValue(false),
}));

import "../../src/tools/account.js";
import { beginGmailOAuth, hasPendingGmailOAuth, awaitGmailOAuth } from "../../src/auth/gmail-oauth.js";

describe("Grok Gmail authenticate", () => {
  let tempDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mailbots-grok-auth-"));
    ctx = { accountManager: new AccountManager(tempDir), getProvider: vi.fn() };
    process.env.MAILBOTS_MCP_HOST = "grok";
    vi.mocked(hasPendingGmailOAuth).mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.MAILBOTS_MCP_HOST;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the OAuth URL instead of blocking", async () => {
    const result = await handleToolCall("authenticate", {
      alias: "personal",
      provider: "gmail",
      email: "user@example.com",
    }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(result.content[0].text).toContain("Bot computer");
    expect(ctx.accountManager.listAccounts()).toEqual({});
    expect(beginGmailOAuth).toHaveBeenCalled();
  });

  it("finishes the account on the second authenticate", async () => {
    vi.mocked(hasPendingGmailOAuth).mockReturnValue(true);
    const result = await handleToolCall("authenticate", {
      alias: "personal",
      provider: "gmail",
      email: "user@example.com",
    }, ctx);
    expect(awaitGmailOAuth).toHaveBeenCalledWith("personal");
    expect(result.content[0].text).toContain("authenticated successfully");
    expect(ctx.accountManager.listAccounts().personal).toMatchObject({
      provider: "gmail",
      email: "user@example.com",
    });
  });
});
