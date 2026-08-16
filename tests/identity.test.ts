import { describe, it, expect, afterEach } from "vitest";
import { env, envDisplay, isGrokHost, resultBudgetBytes, defaultConfigDir } from "../src/identity.js";

describe("identity env", () => {
  const keys = [
    "MAILBOTS_MCP_PASSPHRASE", "MAILBOX_MCP_PASSPHRASE",
    "MAILBOTS_MCP_TOOLS", "MAILBOX_MCP_TOOLS",
    "MAILBOTS_MCP_HOST", "MAILBOTS_MCP_MAX_RESULT_BYTES", "MAILBOTS_MCP_CONFIG_DIR",
  ];
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    for (const k of keys) delete saved[k];
  });

  function stash(...names: string[]) {
    for (const n of names) saved[n] = process.env[n];
  }

  it("prefers MAILBOTS_MCP_ over the legacy MAILBOX_MCP_ name", () => {
    stash("MAILBOTS_MCP_PASSPHRASE", "MAILBOX_MCP_PASSPHRASE");
    process.env.MAILBOTS_MCP_PASSPHRASE = "new";
    process.env.MAILBOX_MCP_PASSPHRASE = "old";
    expect(env("PASSPHRASE")).toBe("new");
    expect(envDisplay("PASSPHRASE")).toBe("MAILBOTS_MCP_PASSPHRASE");
  });

  it("falls back to MAILBOX_MCP_ when the new name is unset", () => {
    stash("MAILBOTS_MCP_PASSPHRASE", "MAILBOX_MCP_PASSPHRASE");
    delete process.env.MAILBOTS_MCP_PASSPHRASE;
    process.env.MAILBOX_MCP_PASSPHRASE = "legacy";
    expect(env("PASSPHRASE")).toBe("legacy");
    expect(envDisplay("PASSPHRASE")).toBe("MAILBOX_MCP_PASSPHRASE");
  });

  it("detects Grok via MAILBOTS_MCP_HOST", () => {
    stash("MAILBOTS_MCP_HOST");
    process.env.MAILBOTS_MCP_HOST = "grok";
    expect(isGrokHost()).toBe(true);
  });

  it("does not treat GROK_HOME as Grok while running tests", () => {
    stash("MAILBOTS_MCP_HOST");
    delete process.env.MAILBOTS_MCP_HOST;
    expect(isGrokHost()).toBe(false);
  });

  it("uses an 18k result budget on Grok", () => {
    stash("MAILBOTS_MCP_HOST", "MAILBOTS_MCP_MAX_RESULT_BYTES");
    delete process.env.MAILBOTS_MCP_MAX_RESULT_BYTES;
    process.env.MAILBOTS_MCP_HOST = "grok-bot";
    expect(resultBudgetBytes()).toBe(18_000);
  });

  it("honors MAILBOTS_MCP_CONFIG_DIR", () => {
    stash("MAILBOTS_MCP_CONFIG_DIR");
    process.env.MAILBOTS_MCP_CONFIG_DIR = "/tmp/mailbots-config-test";
    expect(defaultConfigDir()).toBe("/tmp/mailbots-config-test");
  });
});

