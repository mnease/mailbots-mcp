import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountManager } from "../../src/accounts.js";
import { handleToolCall, type ToolContext } from "../../src/tools/registry.js";
import "../../src/tools/account.js";

describe("authenticate with existing Gmail token", () => {
  let tempDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mailbots-existing-token-"));
    ctx = { accountManager: new AccountManager(tempDir), getProvider() { throw new Error("unused"); } };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finishes the account when token.json is already on disk", async () => {
    const dir = join(tempDir, "accounts", "business");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "token.json"), JSON.stringify({
      access_token: "ya29.test",
      refresh_token: "1//test",
      token_type: "Bearer",
    }));
    const result = await handleToolCall("authenticate", {
      alias: "business",
      provider: "gmail",
      email: "mike@example.com",
    }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("authenticated successfully");
    expect(ctx.accountManager.listAccounts().business).toMatchObject({
      provider: "gmail",
      email: "mike@example.com",
    });
  });
});
