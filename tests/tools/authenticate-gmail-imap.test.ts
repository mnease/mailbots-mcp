import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountManager } from "../../src/accounts.js";
import { handleToolCall, type ToolContext } from "../../src/tools/registry.js";
import "../../src/tools/account.js";

describe("Gmail IMAP app-password authenticate", () => {
  let tempDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mailbots-gmail-imap-"));
    ctx = { accountManager: new AccountManager(tempDir), getProvider() { throw new Error("unused"); } };
    process.env.MAILBOTS_MCP_PASSPHRASE = "test-passphrase-not-a-secret";
  });

  afterEach(() => {
    delete process.env.MAILBOTS_MCP_PASSPHRASE;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores a Gmail account as IMAP when a password is provided", async () => {
    const result = await handleToolCall("authenticate", {
      alias: "business",
      provider: "gmail",
      email: "mike@example.com",
      password: "xxxx xxxx xxxx xxxx",
    }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Gmail IMAP");
    const saved = ctx.accountManager.listAccounts().business;
    expect(saved).toMatchObject({
      provider: "imap",
      email: "mike@example.com",
      host: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
  });
});
