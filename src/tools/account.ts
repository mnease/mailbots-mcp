import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { registerTool, type ToolContext } from "./registry.js";
import { clearSendLimit } from "./write.js";
import { env, isGrokHost } from "../identity.js";

registerTool({
  definition: {
    name: "list_accounts",
    description: "List all configured email accounts with their provider type and email address",
    inputSchema: { type: "object" as const, properties: {} },
  },
  group: "core",
  handler: async (_args, ctx) => {
    const accounts = ctx.accountManager.listAccounts();
    const entries = Object.entries(accounts);
    if (entries.length === 0) {
      return { content: [{ type: "text", text: "No accounts configured. Use authenticate to add one." }] };
    }
    const lines = entries.map(([alias, config]) => `- **${alias}** (${config.provider}): ${config.email}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
});

registerTool({
  definition: {
    name: "authenticate",
    description: "Add an email account. Gmail with a password uses Gmail IMAP (any Google account; use a Google app password). Gmail without a password uses Gmail API OAuth (needs oauth-keys.json and a published/test-user OAuth app). IMAP/JMAP store encrypted credentials. Username/password can come from the environment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        alias: { type: "string", description: "Short name for this account (e.g. 'personal', 'work')" },
        provider: { type: "string", enum: ["gmail", "imap", "jmap"], description: "Email provider type" },
        email: { type: "string", description: "Email address" },
        host: { type: "string", description: "IMAP server hostname (IMAP only)" },
        port: { type: "number", description: "IMAP server port (IMAP only, default 993)" },
        smtpHost: { type: "string", description: "SMTP server hostname (IMAP only)" },
        smtpPort: { type: "number", description: "SMTP server port (IMAP only, default 587)" },
        username: { type: "string", description: "IMAP/SMTP username (default: email for Gmail IMAP)" },
        password: { type: "string", description: "IMAP/SMTP password or Google app password. If set with provider=gmail, uses Gmail IMAP instead of OAuth." },
        sessionUrl: { type: "string", description: "JMAP session URL override (JMAP only, auto-discovered from host by default)" },
      },
      required: ["alias", "provider", "email"],
    },
  },
  group: "core",
  handler: async (args, ctx) => {
    const alias = args.alias as string;
    const provider = args.provider as string;
    const email = args.email as string;

    try {
      ctx.accountManager.assertAliasAvailable(alias);
    } catch (e: any) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }

    const configDir = ctx.accountManager.getConfigDir();
    const rollbackDir = () => {
      const dir = join(configDir, "accounts", alias);
      if (existsSync(dir) && !ctx.accountManager.listAccounts()[alias]) {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    if (provider === "gmail") {
      const appPassword = (args.password as string) || env("GMAIL_APP_PASSWORD") || env("IMAP_PASSWORD");
      if (appPassword) {
        const username = (args.username as string) || env("IMAP_USERNAME") || email;
        return addImapAccount(ctx, {
          alias, email, username, password: appPassword,
          host: "imap.gmail.com", port: 993,
          smtpHost: "smtp.gmail.com", smtpPort: 587,
          rollbackDir,
        });
      }
      const tokenPath = join(configDir, "accounts", alias, "token.json");
      if (existsSync(tokenPath)) {
        if (!ctx.accountManager.listAccounts()[alias]) {
          ctx.accountManager.addAccount(alias, { provider: "gmail", email });
        }
        return { content: [{ type: "text", text: `Gmail account "${alias}" (${email}) authenticated successfully.` }] };
      }
      try {
        const {
          authenticateGmail,
          beginGmailOAuth,
          awaitGmailOAuth,
          hasPendingGmailOAuth,
        } = await import("../auth/gmail-oauth.js");
        const onAuthUrl = (url: string) => {
          ctx.notify?.(`Gmail OAuth URL (open on this machine, not a different laptop): ${url}`);
        };
        if (hasPendingGmailOAuth(alias)) {
          await awaitGmailOAuth(alias);
        } else if (isGrokHost()) {
          const { authUrl } = beginGmailOAuth(configDir, alias, { onAuthUrl });
          return {
            content: [{
              type: "text",
              text: [
                `Gmail OAuth started for "${alias}" (${email}).`,
                "Open this URL in a browser on the SAME machine that runs mailbots-mcp.",
                "Grok Bot: that is the Bot computer, not your laptop. The callback is http://127.0.0.1:4895.",
                "",
                authUrl,
                "",
                `After Google redirects, call authenticate again with alias="${alias}" provider="gmail" email="${email}".`,
              ].join("\n"),
            }],
          };
        } else {
          await authenticateGmail(configDir, alias, { onAuthUrl });
        }
        ctx.accountManager.addAccount(alias, { provider: "gmail", email });
      } catch (e) {
        rollbackDir();
        throw e;
      }
      return { content: [{ type: "text", text: `Gmail account "${alias}" (${email}) authenticated successfully.` }] };
    }

    if (provider === "imap") {
      const host = args.host as string;
      const port = (args.port as number) ?? 993;
      const smtpHost = args.smtpHost as string;
      const smtpPort = (args.smtpPort as number) ?? 587;
      const username = (args.username as string) || env("IMAP_USERNAME");
      const password = (args.password as string) || env("IMAP_PASSWORD");
      if (!host || !smtpHost || !username || !password) {
        return { content: [{ type: "text", text: "IMAP accounts require: host, smtpHost, username, and password" }], isError: true };
      }
      return addImapAccount(ctx, {
        alias, email, username, password, host, port, smtpHost, smtpPort, rollbackDir,
      });
    }

    if (provider === "jmap") {
      const host = args.host as string;
      const username = (args.username as string) || env("JMAP_USERNAME");
      const password = (args.password as string) || env("JMAP_PASSWORD");
      const passphrase = env("PASSPHRASE") ?? "";
      const sessionUrl = args.sessionUrl as string | undefined;

      if (!host || !username || !password) {
        return { content: [{ type: "text", text: "JMAP accounts require: host, username, and password" }], isError: true };
      }
      if (!passphrase) {
        return { content: [{ type: "text", text: "JMAP accounts require a passphrase for credential encryption. Set MAILBOTS_MCP_PASSPHRASE in the server environment." }], isError: true };
      }

      if (sessionUrl) {
        const { validateNoSSRF } = await import("../security/validation.js");
        try {
          const parsed = new URL(sessionUrl);
          if (parsed.protocol !== "https:") {
            return { content: [{ type: "text", text: "JMAP sessionUrl must use HTTPS." }], isError: true };
          }
          validateNoSSRF(sessionUrl);
        } catch (e: any) {
          return { content: [{ type: "text", text: `Invalid JMAP sessionUrl: ${e.message}` }], isError: true };
        }
      }

      try {
        const { encryptCredentialsFile } = await import("../auth/credentials.js");
        encryptCredentialsFile(configDir, alias, { username, password }, passphrase, "JMAP");
        const config = sessionUrl
          ? { provider: "jmap" as const, email, host, sessionUrl }
          : { provider: "jmap" as const, email, host };
        ctx.accountManager.addAccount(alias, config);
      } catch (e) {
        rollbackDir();
        throw e;
      }
      return { content: [{ type: "text", text: `JMAP account "${alias}" (${email}) configured. Credentials encrypted.` }] };
    }

    return { content: [{ type: "text", text: `Unknown provider: ${provider}` }], isError: true };
  },
});

registerTool({
  definition: {
    name: "reauth",
    description: "Re-run OAuth for an existing Gmail account without removing it. Grok Build/Grok Bot return a URL to open on this machine, then call reauth again. Use when the refresh token expires (invalid_grant) or scopes change.",
    inputSchema: {
      type: "object" as const,
      properties: { alias: { type: "string", description: "Account alias to re-authenticate" } },
      required: ["alias"],
    },
  },
  group: "core",
  handler: async (args, ctx) => {
    const alias = args.alias as string;
    const account = ctx.accountManager.getAccount(alias);
    if (account.provider !== "gmail") {
      return {
        content: [{ type: "text", text: `reauth is Gmail-only. Account "${alias}" is ${account.provider}; re-run authenticate to rotate its credentials.` }],
        isError: true,
      };
    }
    const {
      authenticateGmail,
      beginGmailOAuth,
      awaitGmailOAuth,
      hasPendingGmailOAuth,
    } = await import("../auth/gmail-oauth.js");
    const onAuthUrl = (url: string) => {
      ctx.notify?.(`Gmail OAuth URL (open on this machine, not a different laptop): ${url}`);
    };
    const configDir = ctx.accountManager.getConfigDir();
    if (hasPendingGmailOAuth(alias)) {
      await awaitGmailOAuth(alias);
    } else if (isGrokHost()) {
      const { authUrl } = beginGmailOAuth(configDir, alias, { onAuthUrl });
      return {
        content: [{
          type: "text",
          text: [
            `Gmail reauth started for "${alias}" (${account.email}).`,
            "Open this URL on the SAME machine that runs mailbots-mcp (Grok Bot: the Bot computer).",
            "",
            authUrl,
            "",
            `After Google redirects, call reauth again with alias="${alias}".`,
          ].join("\n"),
        }],
      };
    } else {
      await authenticateGmail(configDir, alias, { onAuthUrl });
    }
    ctx.clearProviderCache?.(alias);
    return { content: [{ type: "text", text: `Gmail account "${alias}" (${account.email}) re-authenticated successfully.` }] };
  },
});

registerTool({
  definition: {
    name: "remove_account",
    description: "Remove a configured email account and its stored credentials",
    inputSchema: {
      type: "object" as const,
      properties: { alias: { type: "string", description: "Account alias to remove" } },
      required: ["alias"],
    },
  },
  group: "core",
  handler: async (args, ctx) => {
    const alias = args.alias as string;
    ctx.accountManager.removeAccount(alias);
    ctx.clearProviderCache?.(alias);
    clearSendLimit(alias);
    return { content: [{ type: "text", text: `Account "${alias}" removed.` }] };
  },
});

async function addImapAccount(
  ctx: ToolContext,
  opts: {
    alias: string;
    email: string;
    username: string;
    password: string;
    host: string;
    port: number;
    smtpHost: string;
    smtpPort: number;
    rollbackDir: () => void;
  },
) {
  const passphrase = env("PASSPHRASE") ?? "";
  if (!passphrase) {
    return {
      content: [{
        type: "text" as const,
        text: "IMAP / Gmail app-password accounts require MAILBOTS_MCP_PASSPHRASE in the server environment so credentials can be encrypted at rest.",
      }],
      isError: true,
    };
  }
  try {
    const { encryptCredentialsFile } = await import("../auth/credentials.js");
    encryptCredentialsFile(
      ctx.accountManager.getConfigDir(),
      opts.alias,
      { username: opts.username, password: opts.password },
      passphrase,
      "IMAP",
    );
    ctx.accountManager.addAccount(opts.alias, {
      provider: "imap",
      email: opts.email,
      host: opts.host,
      port: opts.port,
      smtpHost: opts.smtpHost,
      smtpPort: opts.smtpPort,
    });
  } catch (e) {
    opts.rollbackDir();
    throw e;
  }
  const viaGmail = opts.host === "imap.gmail.com";
  return {
    content: [{
      type: "text" as const,
      text: viaGmail
        ? `Gmail IMAP account "${opts.alias}" (${opts.email}) configured. Uses an app password over IMAP/SMTP (any Google account). Gmail-only tools (filters, vacation, send-as) are not available on this path.`
        : `IMAP account "${opts.alias}" (${opts.email}) configured. Credentials encrypted.`,
    }],
  };
}
