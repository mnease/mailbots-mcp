import { createServer } from "node:http";
import { URL } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { OAuth2Client } from "google-auth-library";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { secureWriteFile, ensureDir } from "../security/permissions.js";
import { env } from "../identity.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",      // Read, send, trash, labels, filters
  "https://www.googleapis.com/auth/gmail.compose",      // Create drafts, send messages
  "https://www.googleapis.com/auth/gmail.settings.basic", // Signatures, vacation, send-as, filters
];

const DEFAULT_REDIRECT_PORT = 4895;
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Desktop OAuth clients register `http://localhost` (no path). Google then
 * accepts `http://localhost:<port>` / `http://127.0.0.1:<port>`. A custom
 * path such as /oauth2callback is a 400 redirect_uri_mismatch.
 */
export function resolveGmailRedirect(redirectUris?: string[]): { uri: string; port: number; host: string } {
  const override = env("OAUTH_REDIRECT");
  if (override) {
    const u = new URL(override);
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    return { uri: override.replace(/\/$/, ""), port, host: u.hostname };
  }
  const port = DEFAULT_REDIRECT_PORT;
  const uris = redirectUris ?? [];
  const withPort = uris.find((u) => /localhost:\d+|127\.0\.0\.1:\d+/.test(u));
  if (withPort) {
    const u = new URL(withPort);
    return { uri: withPort.replace(/\/$/, ""), port: Number(u.port || port), host: u.hostname };
  }
  if (uris.some((u) => /^https?:\/\/localhost\/?$/.test(u))) {
    return { uri: `http://localhost:${port}`, port, host: "localhost" };
  }
  if (uris.some((u) => /^https?:\/\/127\.0\.0\.1\/?$/.test(u))) {
    return { uri: `http://127.0.0.1:${port}`, port, host: "127.0.0.1" };
  }
  return { uri: `http://127.0.0.1:${port}`, port, host: "127.0.0.1" };
}

function isOAuthCallbackPath(pathname: string): boolean {
  return pathname === "/" || pathname === "" || pathname === "/oauth2callback";
}

function openerCandidates(): Array<{ cmd: string; args: string[] }> {
  const os = platform();
  if (os === "darwin") return [{ cmd: "open", args: [] }];
  if (os === "win32") return [{ cmd: "cmd", args: ["/c", "start", ""] }];
  return [
    { cmd: "xdg-open", args: [] },
    { cmd: "gio", args: ["open"] },
    { cmd: "gnome-open", args: [] },
  ];
}

/** Best-effort local browser open. Grok Bot's cloud computer may have no opener. */
export function openInBrowser(url: string): boolean {
  for (const opener of openerCandidates()) {
    const bin = opener.cmd === "cmd" ? "cmd" : opener.cmd;
    const resolved = opener.cmd === "cmd" || existsSync(opener.cmd) || existsSync(`/usr/bin/${opener.cmd}`) || existsSync(`/bin/${opener.cmd}`);
    if (!resolved && opener.cmd !== "open" && opener.cmd !== "cmd") continue;
    try {
      const child = spawn(bin, [...opener.args, url], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

interface OAuthClientBlock {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

interface OAuthKeys {
  installed?: OAuthClientBlock;
  web?: OAuthClientBlock;
}

function loadOAuthKeys(configDir: string): { clientId: string; clientSecret: string; redirectUris?: string[] } {
  const keysPath = join(configDir, "oauth-keys.json");
  if (!existsSync(keysPath)) {
    throw new Error(
      `OAuth keys not found at ${keysPath}. Download from Google Cloud Console and save there.`
    );
  }
  const keys: OAuthKeys = JSON.parse(readFileSync(keysPath, "utf-8"));
  const creds = keys.installed ?? keys.web;
  if (!creds) {
    throw new Error("Invalid oauth-keys.json: expected 'installed' or 'web' credentials");
  }
  return { clientId: creds.client_id, clientSecret: creds.client_secret, redirectUris: creds.redirect_uris };
}

export interface PendingGmailOAuth {
  authUrl: string;
  done: Promise<void>;
}

const pendingByAlias = new Map<string, PendingGmailOAuth>();

export function hasPendingGmailOAuth(alias: string): boolean {
  return pendingByAlias.has(alias);
}

/** Start localhost OAuth. Safe to call twice for the same alias (returns the in-flight session). */
export function beginGmailOAuth(
  configDir: string,
  alias: string,
  opts?: { onAuthUrl?: (url: string) => void },
): PendingGmailOAuth {
  const existing = pendingByAlias.get(alias);
  if (existing) {
    opts?.onAuthUrl?.(existing.authUrl);
    return existing;
  }

  const { clientId, clientSecret, redirectUris } = loadOAuthKeys(configDir);
  const redirect = resolveGmailRedirect(redirectUris);
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirect.uri);
  const state = randomBytes(32).toString("hex");
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });

  const securityHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  };

  const done = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      fn();
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${redirect.host}:${redirect.port}`);
      if (!isOAuthCallbackPath(url.pathname)) {
        res.writeHead(404);
        res.end();
        return;
      }

      const returnedState = url.searchParams.get("state");
      if (returnedState !== state) {
        res.writeHead(403, securityHeaders);
        res.end("<h1>Authentication failed</h1><p>State mismatch. Possible CSRF. You can close this tab.</p>");
        finish(() => reject(new Error("OAuth state mismatch: possible CSRF attack")));
        return;
      }

      const authCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, securityHeaders);
        res.end("<h1>Authentication failed</h1><p>You can close this tab.</p>");
        finish(() => reject(new Error(`OAuth error: ${error}`)));
        return;
      }

      if (!authCode) {
        res.writeHead(400, securityHeaders);
        res.end("<h1>Missing authorization code</h1>");
        finish(() => reject(new Error("No authorization code received")));
        return;
      }

      res.writeHead(200, securityHeaders);
      res.end("<h1>Authentication successful</h1><p>You can close this tab.</p>");
      finish(() => {
        oauth2Client.getToken(authCode).then(({ tokens }) => {
          const accountDir = join(configDir, "accounts", alias);
          ensureDir(accountDir);
          secureWriteFile(join(accountDir, "token.json"), JSON.stringify(tokens, null, 2));
          resolve();
        }).catch(reject);
      });
    });

    const timeout = setTimeout(() => {
      finish(() => reject(new Error(
        `OAuth callback not received within ${OAUTH_TIMEOUT_MS / 1000}s. Open this URL on the same machine that runs mailbots-mcp:\n${authUrl}`,
      )));
    }, OAUTH_TIMEOUT_MS);

    server.listen(redirect.port, "127.0.0.1", () => {
      console.error(`\nGmail OAuth. Open this URL on THIS machine (Grok Bot: the Bot computer, not your laptop):\n\n${authUrl}\n`);
      openInBrowser(authUrl);
    });

    server.on("error", (err) => finish(() => reject(err)));
  });

  const session: PendingGmailOAuth = { authUrl, done };
  pendingByAlias.set(alias, session);
  void done.finally(() => {
    if (pendingByAlias.get(alias) === session) pendingByAlias.delete(alias);
  });
  opts?.onAuthUrl?.(authUrl);
  return session;
}

export async function awaitGmailOAuth(alias: string): Promise<void> {
  const session = pendingByAlias.get(alias);
  if (!session) {
    throw new Error(`No in-flight Gmail OAuth for "${alias}". Call authenticate again to start a new flow.`);
  }
  await session.done;
}

export async function authenticateGmail(
  configDir: string,
  alias: string,
  opts?: { onAuthUrl?: (url: string) => void },
): Promise<void> {
  const { done } = beginGmailOAuth(configDir, alias, opts);
  await done;
}

export async function getGmailClient(configDir: string, alias: string) {
  const { clientId, clientSecret, redirectUris } = loadOAuthKeys(configDir);
  const tokenPath = join(configDir, "accounts", alias, "token.json");

  if (!existsSync(tokenPath)) {
    throw new Error(`No OAuth token for account "${alias}". Run authenticate first.`);
  }

  const tokens = JSON.parse(readFileSync(tokenPath, "utf-8"));
  const redirect = resolveGmailRedirect(redirectUris);
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirect.uri);
  oauth2Client.setCredentials(tokens);

  oauth2Client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    secureWriteFile(tokenPath, JSON.stringify(merged, null, 2));
  });

  // Lazy require() to avoid loading all 300+ googleapis services at startup
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const { gmail } = req("googleapis/build/src/apis/gmail/index.js");
  return gmail({ version: "v1", auth: oauth2Client });
}
