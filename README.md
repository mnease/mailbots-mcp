<div align="center">

# Mailbots-MCP

[![npm](https://img.shields.io/badge/NPM-mailbots--mcp-CB3837?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/mailbots-mcp)
[![License](https://img.shields.io/badge/LICENSE-MIT-5C9E31?style=for-the-badge)](LICENSE)
[![Built by](https://img.shields.io/badge/BUILT%20BY-AGENTVANIA-8A2BE2?style=for-the-badge)](https://agentvania.com)

**Give your AI tools access to your email. Search, read, send, and manage messages across multiple accounts without leaving your terminal.**

</div>

Mailbots-MCP is an [MCP server](https://modelcontextprotocol.io) that connects your email to [Grok Build](https://docs.x.ai/build/overview), [Grok Bot](https://x.ai/news/introducing-grok-bot), Claude Code, Cursor, Windsurf, or any AI tool that supports the Model Context Protocol. Instead of switching between your terminal and Gmail, you ask the AI to find that invoice, summarize a thread, or draft a reply, and it does.

**What makes this different from the 60+ other email MCP servers:**

- **Multiple accounts, one server.** Work email, personal email, client accounts — all accessible through a single server. No need to run separate instances.
- **Not just Gmail.** Supports Gmail (full API), any IMAP/SMTP provider (ProtonMail, corporate mail, self-hosted), and JMAP (Fastmail, Stalwart, Topicbox). Add providers without changing a line of tool code.
- **Security-conscious.** Encrypted credentials (AES-256-GCM), prompt injection fencing on email content, rate limiting, TLS enforcement, SSRF protection with IP encoding evasion detection, input validation.
- **Tools for the workflows that matter.** Search, read, send, reply, forward, drafts, labels, filters, templates, signatures, vacation replies, attachments, unsubscribe, and more.
- **Zero native dependencies.** Pure Node.js. Install and run anywhere.

## Quick Start

### Install

The package runs from npm via `npx`. Pick the client you use.

#### Grok Build

Add a stdio server in `~/.grok/config.toml` (or `.grok/config.toml` in a repo), then restart or `/mcps`:

```toml
[mcp_servers.mailbots]
command = "npx"
args = ["-y", "mailbots-mcp"]
env = { MAILBOTS_MCP_PASSPHRASE = "a-long-random-passphrase", MAILBOTS_MCP_HOST = "grok" }
enabled = true
startup_timeout_sec = 60
tool_timeout_sec = 600
```

Or from the CLI:

```bash
grok mcp add mailbots -e MAILBOTS_MCP_PASSPHRASE=a-long-random-passphrase -e MAILBOTS_MCP_HOST=grok -- npx -y mailbots-mcp
grok mcp doctor mailbots
```

Grok Build also reads Claude Code MCP entries (`~/.claude.json` and project `.mcp.json`), so the JSON block below works there too.

#### Grok Bot

Grok Bot uses the same MCP policy and config as Cursor ([team MCP settings](https://docs.x.ai/grok-bot/teams-and-enterprises) apply if you are on a team). Add Mailbots as a command server in **Grok Bot → Plugins** or **Cursor Settings → MCP**:

```json
{
  "mcpServers": {
    "mailbots": {
      "command": "npx",
      "args": ["-y", "mailbots-mcp"],
      "env": {
        "MAILBOTS_MCP_PASSPHRASE": "a-long-random-passphrase",
        "MAILBOTS_MCP_HOST": "grok"
      }
    }
  }
}
```

The Bot runs that process on **its** cloud computer. Gmail OAuth, IMAP/JMAP creds, and `~/.mailbots-mcp` live there, not on your laptop.

Gmail `authenticate` is two steps on Grok: the tool returns a URL. Open it in the Bot computer's browser (callback is `http://127.0.0.1:4895`). Then call `authenticate` again with the same alias. Do not open that URL on your laptop.

#### Claude Code, Cursor, Windsurf

Add to Claude Code (`~/.claude.json`), Cursor MCP settings, or Windsurf:

```json
{
  "mcpServers": {
    "mailbots": {
      "command": "npx",
      "args": ["-y", "mailbots-mcp"],
      "env": {
        "MAILBOTS_MCP_PASSPHRASE": "a-long-random-passphrase"
      }
    }
  }
}
```

`MAILBOTS_MCP_PASSPHRASE` is the passphrase used to encrypt IMAP/JMAP credentials at rest; it's required before adding an IMAP or JMAP account, and unused for Gmail-only setups. The older `MAILBOX_MCP_PASSPHRASE` name is still accepted.

<details>
<summary>From source instead</summary>

```bash
git clone https://github.com/mnease/mailbots-mcp.git
cd mailbots-mcp
npm install && npm run build
```

Then point the config at the build with `"command": "node", "args": ["/path/to/mailbots-mcp/dist/server.js"]`.
</details>

### Any Gmail account (like a normal mail client)

Apple Mail, Thunderbird, and Outlook can sign into **any** Gmail inbox because **they** already have a Google-verified OAuth app. Mailbots cannot do that with a personal Cloud Console client:

- Gmail API scopes (`gmail.modify`, `gmail.compose`, settings) are **restricted**.
- An app in **Testing** only allows listed test users (and hits `redirect_uri_mismatch` if the desktop client does not allow our loopback URI).
- **Any Google account** via the Gmail API requires a **published** OAuth consent screen plus Google's restricted-scope verification (privacy policy, brand check, CASA). That is a product process, not a config toggle.

**What works today for any Gmail / Workspace address** (same idea as Thunderbird + an app password):

1. In the Google account: [App passwords](https://myaccount.google.com/apppasswords) (2-Step Verification must be on).
2. Set `MAILBOTS_MCP_PASSPHRASE` in the MCP server env.
3. Authenticate with `provider="gmail"` **and** that app password. Mailbots uses `imap.gmail.com` / `smtp.gmail.com`. No Cloud Console project, no test-user list.

```
authenticate alias="business" provider="gmail" email="you@company.com" password="<google-app-password>"
```

This path is IMAP. Search, read, send, drafts, labels, and trash work. Gmail-only tools (filters, vacation, send-as, templates) need the Gmail API OAuth path below.

**Gmail API OAuth** (filters and the rest) is for accounts you add as test users, or for everyone after the Mailbots OAuth app is verified. Use a **Desktop** client JSON at `~/.mailbots-mcp/oauth-keys.json` (or `~/.mailbox-mcp` if that directory already exists). Mailbots now sends `http://localhost:4895` with no path, which is what desktop clients allow.

### Add a Gmail Account (API / OAuth)

#### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project
2. Enable the **Gmail API**: [APIs & Services > Library > Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) > Enable

#### 2. Set up OAuth consent screen

1. Go to [Google Auth Platform > Branding](https://console.cloud.google.com/auth/branding)
2. Set **App name** and **User support email**
3. Go to [Audience](https://console.cloud.google.com/auth/audience), select **External**
4. Add the Google account you'll sign in with as a **test user** (this must be the exact `@gmail.com` address you use to authenticate, not a workspace alias)

#### 3. Create OAuth credentials

1. Go to [Google Auth Platform > Clients](https://console.cloud.google.com/auth/clients) > Create Client
2. **Application type**: Desktop app
3. Click **Create**
4. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials), find your client, and click the download icon to get the JSON
5. Save the file as `~/.mailbots-mcp/oauth-keys.json` (on the machine that runs the MCP server: your laptop for Grok Build, the Bot computer for Grok Bot)

#### 4. Authenticate

In Grok Build, Grok Bot, or Claude Code, run: `authenticate alias="personal" provider="gmail" email="you@gmail.com"`

This opens a browser window to complete the OAuth flow. Your tokens are stored locally in `~/.mailbots-mcp/accounts/`. If you already have `~/.mailbox-mcp`, that directory is still used.

### Add an IMAP Account

In Grok Build, Grok Bot, or Claude Code, run:

```
authenticate alias="work" provider="imap" email="you@company.com" host="imap.company.com" smtpHost="smtp.company.com" username="you@company.com" password="<app-password>"
```

Credentials are encrypted at rest using AES-256-GCM.

### Add a JMAP Account

In Grok Build, Grok Bot, or Claude Code, run:

```
authenticate alias="fastmail" provider="jmap" email="you@fastmail.com" host="fastmail.com" username="you@fastmail.com" password="<app-password>"
```

JMAP auto-discovers the API endpoint via `.well-known/jmap`. Credentials are encrypted at rest using AES-256-GCM.

**Supported JMAP servers:** Fastmail, Stalwart, Topicbox, Cyrus IMAP, and any RFC 8620-compliant server.

**JMAP advantages over IMAP:**
- Native thread support (real conversations, not synthetic)
- Server-side search (faster, more accurate)
- Batch operations in a single HTTP request
- No persistent connection required

## Tools

### Universal (Gmail + IMAP + JMAP)

| Tool | Description |
|------|-------------|
| `list_accounts` | List configured accounts |
| `authenticate` | Add a new account |
| `reauth` | Re-run OAuth for an existing Gmail account (use when refresh token expires with `invalid_grant`) |
| `remove_account` | Remove an account |
| `search_emails` | Search messages (optional `folder` to scope the search) |
| `multi_account_search` | Run the same query across every configured account in parallel |
| `read_email` | Read a message |
| `read_thread` | Read a conversation thread (Gmail + JMAP) |
| `send_email` | Send a new email (supports `from`, `attachments`) |
| `reply_email` | Reply to a message (supports `from`, `attachments`) |
| `forward_email` | Forward a message (supports `from`, `attachments`) |
| `create_draft` | Create a draft (supports reply drafts via `in_reply_to`, plus `from`, `attachments`) |
| `list_drafts` | List drafts for an account |
| `send_draft` | Send an existing draft |
| `trash_emails` | Trash messages |
| `mark_read` | Mark a message as read or unread |
| `star_email` | Star or unstar a message |
| `archive_email` | Archive a message (remove from inbox) |
| `list_labels` | List labels/folders |
| `create_label` | Create a label/folder |
| `delete_label` | Delete a label/folder |
| `modify_email` | Modify message labels |
| `batch_modify_emails` | Bulk modify labels |
| `bulk_modify` | Add/remove labels on every message matching a query (search-then-batch; `dry_run` supported) |
| `bulk_trash` | Trash every message matching a query (`dry_run` supported) |
| `list_recent_bulk_ops` | List recorded bulk operations from the transaction log |
| `undo_bulk_op` | Reverse a recorded bulk operation against the exact ids it touched |
| `count_unread_by_label` | Show unread message counts per label/folder |
| `download_attachment` | Download an attachment |
| `export_email` | Save a message as a `.eml` file |
| `export_thread` | Save every message in a thread as `.eml` files (Gmail + JMAP) |
| `emails_since` | List messages received after a given timestamp |
| `inbox_summary` | Inbox overview |

### Gmail-Only

| Tool | Description |
|------|-------------|
| `update_draft` | Replace the contents of an existing draft (thread association preserved) |
| `delete_draft` | Permanently delete a draft |
| `create_filter` | Create a filter |
| `list_filters` | List filters |
| `delete_filter` | Delete a filter |
| `save_template` | Save a template |
| `list_templates` | List templates |
| `delete_template` | Delete a template |
| `send_template` | Send from template |
| `get_signature` | Get signature |
| `set_signature` | Update signature |
| `get_vacation` | Get vacation settings |
| `set_vacation` | Configure vacation reply (supports date ranges, domain-only) |
| `unsubscribe` | Find unsubscribe link |
| `bulk_unsubscribe` | Bulk unsubscribe |
| `list_send_as` | List send-as aliases |

## Choosing which tools load

49 tool schemas cost roughly 6,000 tokens in clients that load every definition into context. In everyday use a handful of tools do most of the work, so you can expose only the groups you need with `MAILBOTS_MCP_TOOLS` (comma-separated). Unset means everything loads. `MAILBOX_MCP_TOOLS` is still accepted.

```json
"env": {
  "MAILBOTS_MCP_TOOLS": "core,attachments"
}
```

| Group | Tools | What it covers |
|-------|-------|----------------|
| `core` | 17 | accounts, search, read, send, reply, forward, create/list/send draft, inbox summary |
| `organize` | 9 | labels, star, archive, trash, modify |
| `bulk` | 4 | query-wide modify/trash with dry-run and undo (undo restores trash on Gmail, IMAP, and JMAP) |
| `attachments` | 3 | download attachments, export `.eml` |
| `gmail-extras` | 16 | filters, templates, signatures, vacation, unsubscribe, send-as, update/delete draft |

`create_draft` on IMAP returns a `folder:uid` id that `send_draft` can send.

Calls to tools in disabled groups fail with an error naming the group to enable.

## Sending attachments

`send_email`, `reply_email`, `forward_email`, and `create_draft` accept an optional `attachments` parameter — an array of local file paths. The server reads each file, detects its MIME type from the extension, and embeds it in the outgoing message (or draft).

```
send_email account="personal" to=["friend@example.com"] subject="The report" body="See attached." attachments=["/path/to/report.pdf", "/path/to/chart.png"]
```

- Each file must be a regular file ≤ 25 MB; total per message is capped at 25 MB (Gmail's hard limit).
- Paths are resolved through any symlinks, and filenames are stripped of CRLF before going into headers.
- Gmail routes messages with attachments through the multipart upload endpoint (35 MB API limit) instead of the JSON endpoint, so the 25 MB message cap is the real ceiling.
- JMAP uploads each file to the server's upload URL first, then references the resulting blobIds in the Email/set call.

## Choosing the sender address

One account often speaks for several addresses. `send_email`, `reply_email`, `forward_email`, `create_draft`, and `update_draft` accept an optional `from` parameter; without it, the account's primary address is used.

```
reply_email account="personal" message_id="18f..." from="jean@example.com" body="Thanks, sorted."
```

Accepted forms are `alias@example.com` and `Name <alias@example.com>`; matching is case-insensitive.

The address is checked against the account before anything is sent, and the call fails with the list of usable addresses if it doesn't match. This matters because Gmail silently falls back to the primary address when the `From` header names an address you haven't verified, so a message can be sent from the wrong identity and still look like it succeeded. Some recipients (Amazon's customer service, for one) reject mail that doesn't come from the address on file.

- Gmail: the address must be a send-as alias with verification completed. Run `list_send_as` to see them. Pending aliases are refused.
- JMAP: the address must match one of the account's identities; its `identityId` is attached to the submission.
- IMAP: no alias list exists to check against, so any `from` is passed to the SMTP relay, which accepts or rejects it at send time.

## License

MIT

Built at [AgentVania](https://agentvania.com).
