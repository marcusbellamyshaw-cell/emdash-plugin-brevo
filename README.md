# emdash-plugin-brevo

Brevo transactional email provider for [EmDash CMS](https://emdashcms.com). Implements the `email:deliver` exclusive hook via the Brevo HTTP API — fully compatible with Cloudflare Workers (no Node.js dependencies).

## What it does

Registers itself as the active email transport for your EmDash site. When anything triggers `ctx.email.send()` — contact forms, password reset, magic link auth — this plugin delivers the email via [Brevo's transactional email API](https://developers.brevo.com/reference/sendtransacemail).

Configuration is managed through the EmDash admin UI. No redeploy needed to change your API key or sender address.

## Installation

```bash
npm install emdash-plugin-brevo
```

### Register in `astro.config.mjs`

```typescript
import { brevoPlugin } from "emdash-plugin-brevo";
import { sandbox } from "@emdash-cms/cloudflare";

export default defineConfig({
  integrations: [
    emdash({
      sandboxed: [brevoPlugin()],
      sandboxRunner: sandbox(),
    }),
  ],
});
```

> **Note:** The Email Settings page may show "No email provider configured" even when Brevo is working. This is a known cosmetic limitation in EmDash — the provider status UI does not currently check sandboxed plugins. Email delivery works correctly regardless of what the status page shows. Use the **Send Test Email** button in **Plugins > Brevo Email** to confirm delivery.

## Configuration

### Admin UI (the only supported method)

After installing and deploying, go to **Settings > Brevo Email** in your EmDash admin. Enter your Brevo API key, sender email, and display name, then click **Save Configuration**.

Configuration is stored in the plugin's KV settings and can be changed any time without a redeploy. Leaving the API-key field blank when you save keeps the previously stored key (the field is never pre-filled with your secret), so you can edit the sender details without re-entering the key.

> **Why not constructor options?** Earlier versions documented a `brevoPlugin({ apiKey, fromEmail, fromName })` form. This plugin runs **sandboxed** (`format: "standard"`), and Emdash does not pass descriptor `options` into the sandbox at runtime — so those values never reached the email hook. The factory still accepts the arguments for source-compatibility, but they are ignored. Configure everything through the admin UI.

## Brevo setup tips

- **API key:** Go to Brevo > Settings > SMTP & API > **API Keys** and generate a key. Use the **API key** (starts with `xkeysib-`). Do **not** use an SMTP key (`xsmtpsib-`) — see [About SMTP](#about-smtp) below.
- **IP restrictions:** Cloudflare Workers use dynamic egress IPs. If your Brevo API key has IP restrictions enabled, disable them or the requests will be silently rejected.
- **Sender verification:** Make sure your sender domain is verified under Brevo > Senders, Domains, IPs. Unverified senders are rejected at the API level.

## About SMTP

A common question: *"Can this plugin send over SMTP (e.g. `smtp-relay.brevo.com:587`) instead of the HTTP API?"*

**No — and no Emdash sandboxed plugin can.** SMTP is a raw TCP protocol. Sandboxed plugins are given exactly one network primitive — `ctx.http.fetch()`, which speaks HTTP/HTTPS only and is restricted to the hosts in `allowedHosts`. There is no TCP/socket capability in the plugin sandbox, so a plugin physically cannot open an SMTP connection.

The good news: you don't need SMTP. Brevo's **HTTP transactional API** (`POST https://api.brevo.com/v3/smtp/email`, which this plugin uses) sends the same mail through the same Brevo infrastructure. It is the correct, sandbox-compatible way to send email from Emdash on Cloudflare Workers.

Practical consequences:

- Authenticate with a Brevo **API key** (`xkeysib-`), **not** an SMTP key (`xsmtpsib-`). SMTP keys only authenticate the SMTP relay, which can't be reached from the sandbox. The admin form will flag an `xsmtpsib-` key and tell you to use an API key.
- If you specifically need to talk to an arbitrary third-party SMTP server (not Brevo), that also isn't possible from a plugin. It would require either an HTTP→SMTP gateway service, or an SMTP transport built into Emdash core itself (Cloudflare Workers can open TCP sockets via `connect()`, but only the host can, not a sandboxed plugin).

## Getting a Brevo account

Sign up at [brevo.com](https://www.brevo.com). The free plan includes 300 emails/day — enough for most small sites.

## About

Brevo email transport plugin for EmDash CMS. Designed by Marcus Shaw for [Every Bit Texas](https://everybittexas.com). Coded by [Claude Code](https://claude.ai/code).

Built for [EmDash CMS](https://github.com/emdash-cms/emdash) — star the repo to support open-source CMS development.

## License

MIT