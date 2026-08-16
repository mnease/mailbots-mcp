import { describe, it, expect, afterEach } from "vitest";
import { resolveGmailRedirect } from "../../src/auth/gmail-oauth.js";

describe("resolveGmailRedirect", () => {
  afterEach(() => {
    delete process.env.MAILBOTS_MCP_OAUTH_REDIRECT;
  });

  it("uses localhost:port when the desktop client lists http://localhost", () => {
    const r = resolveGmailRedirect(["http://localhost"]);
    expect(r.uri).toBe("http://localhost:4895");
    expect(r.port).toBe(4895);
    expect(r.host).toBe("localhost");
  });

  it("does not invent /oauth2callback", () => {
    const r = resolveGmailRedirect(["http://localhost"]);
    expect(r.uri).not.toContain("oauth2callback");
  });

  it("keeps an explicit port URI from the client JSON", () => {
    const r = resolveGmailRedirect(["http://127.0.0.1:9999"]);
    expect(r.uri).toBe("http://127.0.0.1:9999");
    expect(r.port).toBe(9999);
  });

  it("honors MAILBOTS_MCP_OAUTH_REDIRECT", () => {
    process.env.MAILBOTS_MCP_OAUTH_REDIRECT = "http://127.0.0.1:4895/oauth2callback";
    const r = resolveGmailRedirect(["http://localhost"]);
    expect(r.uri).toBe("http://127.0.0.1:4895/oauth2callback");
    expect(r.port).toBe(4895);
  });
});
