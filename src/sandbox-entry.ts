import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";

interface EmailMessage {
	to: string;
	subject: string;
	text?: string;
	html?: string;
}

interface AdminInteraction {
	type: string;
	action_id?: string;
	page?: string;
	values?: Record<string, string>;
}

interface BrevoConfig {
	apiKey: string;
	fromEmail: string;
	fromName: string;
}

/** Shared Brevo send logic — single code path used by both the hook and the test button */
async function sendViaBrevo(
	http: PluginContext["http"],
	config: BrevoConfig,
	message: { to: string; subject: string; text?: string; html?: string },
): Promise<void> {
	const MAX_ATTEMPTS = 2;
	const RETRY_DELAY_MS = 500;

	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const res = await http!.fetch("https://api.brevo.com/v3/smtp/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"api-key": config.apiKey,
			},
			body: JSON.stringify({
				sender: { email: config.fromEmail, name: config.fromName },
				to: [{ email: message.to }],
				subject: message.subject,
				textContent: message.text,
				htmlContent: message.html,
			}),
		});

		if (res.ok) return;

		const body = await res.text();

		// Don't retry auth/validation errors — they won't self-heal
		if (res.status >= 400 && res.status < 500) {
			throw new Error(`Brevo ${res.status}: ${body}`);
		}

		lastError = new Error(`Brevo ${res.status}: ${body}`);

		if (attempt < MAX_ATTEMPTS) {
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
		}
	}

	throw lastError ?? new Error("Brevo: unknown delivery failure");
}

export default definePlugin({
	hooks: {
		"plugin:install": {
			handler: async (_event: unknown, ctx: PluginContext) => {
				const existing = await ctx.kv.get<string>("config:apiKey");
				if (existing === null || existing === undefined) {
					await ctx.kv.set("config:apiKey", "");
					await ctx.kv.set("config:fromEmail", "");
					await ctx.kv.set("config:fromName", "");
				}
				ctx.log.info("[emdash-plugin-brevo] Installed. Configure Brevo API key in Settings > Brevo Email.");
			},
		},

		"email:deliver": {
			exclusive: true,
			handler: async (event: unknown, ctx: PluginContext) => {
				const { message } = event as { message: EmailMessage; source: string };

				const pluginOptions = (ctx.plugin as unknown as { options?: { apiKey?: string; fromEmail?: string; fromName?: string } }).options;

				const apiKey =
					(await ctx.kv.get<string>("config:apiKey")) || pluginOptions?.apiKey || "";
				const fromEmail =
					(await ctx.kv.get<string>("config:fromEmail")) || pluginOptions?.fromEmail || "";
				const fromName =
					(await ctx.kv.get<string>("config:fromName")) || pluginOptions?.fromName || "";

				if (!apiKey) {
					throw new Error("Brevo API key is not configured. Set it in Settings > Brevo Email.");
				}

				try {
					await sendViaBrevo(ctx.http, { apiKey, fromEmail, fromName }, message);
					ctx.log.info(`[emdash-plugin-brevo] Email delivered to ${message.to}`);
				} catch (err) {
					ctx.log.error(`[emdash-plugin-brevo] Delivery failed: ${err}`);
					throw err;
				}
			},
		},
	},

	routes: {
		admin: {
			handler: async (routeCtx: unknown, ctx: PluginContext) => {
				const interaction = (routeCtx as { input: AdminInteraction }).input;

				// ── Page load ──────────────────────────────────────────────────────────
				if (interaction.type === "page_load") {
					const apiKey = await ctx.kv.get<string>("config:apiKey");
					const fromEmail = await ctx.kv.get<string>("config:fromEmail");
					const fromName = await ctx.kv.get<string>("config:fromName");
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
										placeholder: "Your Brevo API key",
										initial_value: apiKey ?? "",
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
									},
									{
										type: "form",
										block_id: "test",
										fields: [
											{
												type: "text_input",
												action_id: "testRecipient",
												label: "Send test email to",
												placeholder: "you@example.com",
												initial_value: fromEmail ?? "",
											},
										],
										submit: { label: "Send Test Email", action_id: "sendTest" },
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

					await ctx.kv.set("config:apiKey", newApiKey);
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
					const apiKey = await ctx.kv.get<string>("config:apiKey");
					const fromEmail = await ctx.kv.get<string>("config:fromEmail");
					const fromName = await ctx.kv.get<string>("config:fromName");

					if (!apiKey || !fromEmail) {
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
						await sendViaBrevo(
							ctx.http,
							{ apiKey, fromEmail, fromName: fromName ?? "" },
							{
								to: (interaction.values?.["testRecipient"] ?? "").trim() || fromEmail,
								subject: "Brevo test email from EmDash",
								text: "This is a test email sent from your EmDash site to verify Brevo email delivery is working.",
							},
						);

						const testRecipient2 = (interaction.values?.["testRecipient"] ?? "").trim() || fromEmail;
						ctx.log.info(`[emdash-plugin-brevo] Test email sent to ${testRecipient2}`);
						return {
							blocks: [
								{
									type: "banner",
									title: "Test email sent",
									description: `A test email has been sent to ${fromEmail}.`,
									variant: "default",
								},
							],
							toast: { message: "Test email sent!", type: "success" },
						};
					} catch (err) {
						ctx.log.error(`[emdash-plugin-brevo] Test email failed: ${err}`);
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
});