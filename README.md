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

### Method 1 — Admin UI (recommended)

After installing and deploying, go to **Settings > Brevo Email** in your EmDash admin. Enter your Brevo API key, sender email, and display name, then click **Save Configuration**.

### Method 2 — Pass options directly (useful for local dev)

```typescript
sandboxed: [
  brevoPlugin({
    apiKey: "your-brevo-api-key",
    fromEmail: "noreply@yourdomain.com",
    fromName: "Your Site Name",
  }),
]
```

Options passed to the factory function serve as fallback defaults. Values stored via the admin UI take precedence.

## Brevo setup tips

- **API key:** Go to Brevo > Settings > SMTP & API > API Keys and generate a key. Both `xkeysib-` and `xsmtpsib-` key formats work.
- **IP restrictions:** Cloudflare Workers use dynamic egress IPs. If your Brevo API key has IP restrictions enabled, disable them or the requests will be silently rejected.
- **Sender verification:** Make sure your sender domain is verified under Brevo > Senders, Domains, IPs. Unverified senders are rejected at the API level.

## Getting a Brevo account

Sign up at [brevo.com](https://www.brevo.com). The free plan includes 300 emails/day — enough for most small sites.

## License

MIT