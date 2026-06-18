import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

interface EmailMessage {
	to: string;
	subject: string;
	text?: string;
	html?: string;
}

interface AdminInteraction {
	type: string;
	action_id?: string;
	values?: Record<string, string>;
}

interface BrevoConfig {
	apiKey: string;
	fromEmail: string;
	fromName: string;
}

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

// Client-side timeout, kept below the 5s host hook timeout declared in
// manifest.json for email:deliver so the plugin returns a clean, descriptive
// error before the host force-kills the hook.
//
// This is implemented with Promise.race rather than an AbortController/
// AbortSignal on purpose. In the sandbox, ctx.http is a remote RPC stub and the
// fetch init is structured-cloned across the isolate boundary. Cloudflare
// Workers cannot serialize an AbortSignal — passing `signal` threw
// "DataCloneError: AbortSignal serialization is not enabled" before the request
// was ever sent, which is exactly what broke the Send Test Email button.
const REQUEST_TIMEOUT_MS = 4500;

async function loadConfig(ctx: PluginContext): Promise<BrevoConfig> {
	return {
		apiKey: (await ctx.kv.get<string>("config:apiKey")) ?? "",
		fromEmail: (await ctx.kv.get<string>("config:fromEmail")) ?? "",
		fromName: (await ctx.kv.get<string>("config:fromName")) ?? "",
	};
}

/**
 * Send one email through Brevo's HTTP transactional API.
 *
 * Shared by the email:deliver hook and the admin "Send Test Email" action so
 * the request shape, timeout, and error normalization can never drift between
 * the two paths. Throws an Error with a human-readable message on any failure
 * (missing key, missing http capability, timeout, or a non-2xx Brevo response).
 */
async function sendBrevoEmail(
	ctx: PluginContext,
	cfg: BrevoConfig,
	message: EmailMessage,
): Promise<void> {
	if (!cfg.apiKey) {
		throw new Error("Brevo API key is not configured. Set it in Settings > Brevo Email.");
	}
	if (!ctx.http) {
		throw new Error(
			"[emdash-plugin-brevo] ctx.http is not available. Verify the plugin has the 'network:request' capability.",
		);
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`Brevo request timed out after ${REQUEST_TIMEOUT_MS}ms`)),
			REQUEST_TIMEOUT_MS,
		);
	});

	// Do NOT put an AbortSignal in this init — it is not cloneable across the
	// sandbox's RPC boundary (see REQUEST_TIMEOUT_MS note above). The timer above
	// enforces the timeout instead; if it wins, the host hook timeout reaps the
	// still-pending request.
	const request = ctx.http.fetch(BREVO_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"api-key": cfg.apiKey,
		},
		body: JSON.stringify({
			sender: { email: cfg.fromEmail, name: cfg.fromName },
			to: [{ email: message.to }],
			subject: message.subject,
			textContent: message.text,
			htmlContent: message.html,
		}),
	});
	// If the timeout wins the race, `request` stays pending; swallow its eventual
	// settlement so it can never surface as an unhandled rejection.
	void request.then(
		() => {},
		() => {},
	);

	try {
		const res = await Promise.race([request, timeout]);

		if (!res.ok) {
			const body = await res.text();
			ctx.log.error(`[emdash-plugin-brevo] Brevo API error ${res.status}: ${body}`);
			throw new Error(`Brevo ${res.status}: ${body}`);
		}
	} finally {
		clearTimeout(timer);
	}
}

export default {
	hooks: {
		"plugin:install": {
			handler: async (_event: unknown, ctx: PluginContext) => {
				const existing = await ctx.kv.get<string>("config:apiKey");
				if (existing === null || existing === undefined) {
					await ctx.kv.set("config:apiKey", "");
					await ctx.kv.set("config:fromEmail", "");
					await ctx.kv.set("config:fromName", "");
				}
				ctx.log.info(
					"[emdash-plugin-brevo] Installed. Configure your Brevo API key in Settings > Brevo Email.",
				);
			},
		},

		"email:deliver": {
			exclusive: true,
			handler: async (event: unknown, ctx: PluginContext) => {
				const { message } = event as { message: EmailMessage; source: string };
				const cfg = await loadConfig(ctx);
				await sendBrevoEmail(ctx, cfg, message);
				ctx.log.info(`[emdash-plugin-brevo] Email delivered to ${message.to}`);
			},
		},
	},

	routes: {
		admin: {
			handler: async (routeCtx: unknown, ctx: PluginContext) => {
				const interaction = (routeCtx as { input: AdminInteraction }).input;

				// ── Page load ──────────────────────────────────────────────────────────
				if (interaction.type === "page_load") {
					const { apiKey, fromEmail, fromName } = await loadConfig(ctx);
					const isConfigured = !!(apiKey && fromEmail);

					return {
						blocks: [
							// Section 1 — Configuration
							{ type: "header", text: "Brevo Email Configuration" },
							{
								type: "form",
								block_id: "config",
								fields: [
									{
										type: "secret_input",
										action_id: "apiKey",
										label: "Brevo API Key",
										// Never echo the stored secret back to the browser. When a
										// key is already saved, the placeholder tells the operator
										// that leaving this blank keeps the current key.
										placeholder: isConfigured
											? "•••••••• saved — leave blank to keep current key"
											: "xkeysib-...",
										initial_value: "",
									},
									{
										type: "text_input",
										action_id: "fromEmail",
										label: "From Email Address",
										placeholder: "noreply@yourdomain.com",
										initial_value: fromEmail ?? "",
									},
									{
										type: "text_input",
										action_id: "fromName",
										label: "From Name",
										placeholder: "Your Site Name",
										initial_value: fromName ?? "",
									},
								],
								submit: { label: "Save Configuration", action_id: "saveConfig" },
							},

							// Section 2 — Status
							{ type: "divider" },
							{ type: "header", text: "Status" },
							...(isConfigured
								? [
										{
											type: "section",
											text: `Configured — sending from ${fromEmail}`,
											accessory: {
												type: "button",
												text: "Send Test Email",
												action_id: "sendTest",
												style: "primary",
											},
										},
									]
								: [
										{
											type: "banner",
											title: "Not configured",
											description:
												"Enter your Brevo API key and sender details above to enable email delivery.",
											variant: "alert",
										},
									]),
						],
					};
				}

				// ── Save configuration ─────────────────────────────────────────────────
				if (interaction.action_id === "saveConfig") {
					const values = interaction.values ?? {};
					const newApiKey = (values["apiKey"] ?? "").trim();
					const newFromEmail = (values["fromEmail"] ?? "").trim();
					const newFromName = (values["fromName"] ?? "").trim();

					// Catch the most common mistake explicitly: pasting a Brevo *SMTP*
					// key (xsmtpsib-). This plugin sends over Brevo's HTTP API, which
					// authenticates with an *API* key (xkeysib-). SMTP keys only work
					// with Brevo's SMTP relay (smtp-relay.brevo.com over TCP), which a
					// sandboxed Emdash plugin cannot reach. Other formats (e.g. future
					// or sub-account keys) are accepted and validated live via the
					// Send Test Email button rather than blocked here.
					if (newApiKey.startsWith("xsmtpsib-")) {
						return {
							blocks: [
								{
									type: "banner",
									title: "That looks like a Brevo SMTP key",
									description:
										"This plugin sends through Brevo's HTTP API, which needs an API key that starts with xkeysib- (Brevo > SMTP & API > API Keys). SMTP keys (xsmtpsib-) only work with Brevo's SMTP relay, which Emdash plugins can't use.",
									variant: "alert",
								},
							],
						};
					}

					// Only overwrite the stored API key when a new value was actually
					// entered. The secret field is never pre-filled (see page_load), so a
					// blank submission means "keep the current key" — without this guard,
					// editing only the sender fields would silently wipe the saved key.
					if (newApiKey) {
						await ctx.kv.set("config:apiKey", newApiKey);
					}
					await ctx.kv.set("config:fromEmail", newFromEmail);
					await ctx.kv.set("config:fromName", newFromName);

					ctx.log.info("[emdash-plugin-brevo] Configuration saved");

					return {
						blocks: [
							{
								type: "banner",
								title: "Configuration saved",
								description: "Brevo email settings have been updated.",
								variant: "default",
							},
						],
						toast: { message: "Configuration saved", type: "success" },
					};
				}

				// ── Send test email ────────────────────────────────────────────────────
				if (interaction.action_id === "sendTest") {
					const cfg = await loadConfig(ctx);

					if (!cfg.apiKey || !cfg.fromEmail) {
						return {
							blocks: [
								{
									type: "banner",
									title: "Not configured",
									description: "Please save your API key and sender email before sending a test.",
									variant: "error",
								},
							],
						};
					}

					try {
						await sendBrevoEmail(ctx, cfg, {
							to: cfg.fromEmail,
							subject: "Brevo test email from EmDash",
							text: "This is a test email sent from your EmDash site to verify Brevo email delivery is working.",
						});

						ctx.log.info(`[emdash-plugin-brevo] Test email sent to ${cfg.fromEmail}`);
						return {
							blocks: [
								{
									type: "banner",
									title: "Test email sent",
									description: `A test email has been sent to ${cfg.fromEmail}.`,
									variant: "default",
								},
							],
							toast: { message: "Test email sent!", type: "success" },
						};
					} catch (err) {
						return {
							blocks: [
								{
									type: "banner",
									title: "Test failed",
									description: String(err),
									variant: "error",
								},
							],
						};
					}
				}

				return { blocks: [] };
			},
		},
	},
} satisfies SandboxedPlugin;
