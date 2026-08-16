import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const connect = vi.fn();
vi.mock("imapflow", () => ({
  ImapFlow: class {
    connect = (...args: unknown[]) => connect(...args);
    on() {}
    logout = vi.fn();
  },
}));
vi.mock("nodemailer", () => ({
  createTransport: () => ({}),
}));

import { AccountManager } from "../../src/accounts.js";
import { encryptCredentialsFile } from "../../src/auth/credentials.js";
import { ProviderFactory } from "../../src/providers/factory.js";

describe("ProviderFactory", () => {
  let tempDir: string;
  const prev = process.env.MAILBOX_MCP_PASSPHRASE;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mailbox-mcp-factory-"));
    process.env.MAILBOX_MCP_PASSPHRASE = "factory-test-passphrase";
    connect.mockReset();
    connect.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.MAILBOX_MCP_PASSPHRASE;
    else process.env.MAILBOX_MCP_PASSPHRASE = prev;
  });

  it("shares one in-flight IMAP connect for concurrent first calls", async () => {
    const accounts = new AccountManager(tempDir);
    encryptCredentialsFile(tempDir, "work", { username: "u", password: "p" }, process.env.MAILBOX_MCP_PASSPHRASE!, "IMAP");
    accounts.addAccount("work", {
      provider: "imap",
      email: "u@work.example",
      host: "imap.example",
      port: 993,
      smtpHost: "smtp.example",
      smtpPort: 587,
    });
    const factory = new ProviderFactory(accounts);
    const [a, b] = await Promise.all([factory.getProvider("work"), factory.getProvider("work")]);
    expect(a).toBe(b);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
