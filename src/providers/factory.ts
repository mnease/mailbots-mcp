import { AccountManager } from "../accounts.js";
import { GmailProvider } from "./gmail.js";
import type { MailProvider } from "./interface.js";
import { getGmailClient } from "../auth/gmail-oauth.js";
import { decryptCredentialsFile } from "../auth/credentials.js";
import { redactTokens } from "../security/sanitize.js";

export class ProviderFactory {
  private cache = new Map<string, MailProvider>();
  private inflight = new Map<string, Promise<MailProvider>>();

  constructor(private accountManager: AccountManager) {}

  async getProvider(alias: string): Promise<MailProvider> {
    const cached = this.cache.get(alias);
    if (cached) return cached;
    const pending = this.inflight.get(alias);
    if (pending) return pending;
    const created = this.create(alias)
      .then((provider) => {
        this.cache.set(alias, provider);
        return provider;
      })
      .finally(() => {
        this.inflight.delete(alias);
      });
    this.inflight.set(alias, created);
    return created;
  }

  clear(alias: string): void {
    this.cache.delete(alias);
  }

  evictIfMatch(alias: string, provider: MailProvider): void {
    if (this.cache.get(alias) === provider) this.cache.delete(alias);
  }

  private async create(alias: string): Promise<MailProvider> {
    const config = this.accountManager.getAccount(alias);
    const configDir = this.accountManager.getConfigDir();

    if (config.provider === "gmail") {
      const gmail = await getGmailClient(configDir, alias);
      return new GmailProvider(gmail);
    }

    if (config.provider === "imap") {
      const { ImapFlow } = await import("imapflow");
      const { createTransport } = await import("nodemailer");
      const passphrase = process.env.MAILBOX_MCP_PASSPHRASE;
      if (!passphrase) {
        throw new Error(`IMAP account "${alias}" requires MAILBOX_MCP_PASSPHRASE to decrypt credentials. Set it in your MCP server environment.`);
      }
      const creds = decryptCredentialsFile(configDir, alias, passphrase, "IMAP");

      const imap = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: true,
        tls: { rejectUnauthorized: true },
        auth: { user: creds.username, pass: creds.password },
        logger: false,
      });
      await imap.connect();
      try {
        const smtp = createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpPort === 465,
          requireTLS: true,
          tls: { rejectUnauthorized: true },
          auth: { user: creds.username, pass: creds.password },
        });

        const { ImapProvider } = await import("./imap.js");
        const provider = new ImapProvider(imap, smtp, config.email);
        imap.on("close", () => {
          this.evictIfMatch(alias, provider);
          console.error(`IMAP connection closed for "${alias}"; will reconnect on next request`);
        });
        imap.on("error", (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`IMAP error on "${alias}":`, redactTokens(msg));
        });
        return provider;
      } catch (err) {
        try { await imap.logout(); } catch { /* ignore */ }
        throw err;
      }
    }

    if (config.provider === "jmap") {
      const passphrase = process.env.MAILBOX_MCP_PASSPHRASE;
      if (!passphrase) {
        throw new Error(`JMAP account "${alias}" requires MAILBOX_MCP_PASSPHRASE to decrypt credentials. Set it in your MCP server environment.`);
      }
      const creds = decryptCredentialsFile(configDir, alias, passphrase, "JMAP");
      const { JmapProvider } = await import("./jmap.js");
      return new JmapProvider(
        config.host,
        config.email,
        creds.username,
        creds.password,
        config.sessionUrl,
      );
    }

    throw new Error(`Unknown provider type: "${(config as { provider: string }).provider}"`);
  }
}
