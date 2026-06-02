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

				if (!ctx.http) {
					throw new Error("[emdash-plugin-brevo] ctx.http is not available. Verify the plugin has the 'network:request' capability.");
				}
				// 10-second timeout — prevents a stalled Brevo API from holding
				// the email:deliver hook open indefinitely.
				const deliverCtrl = new AbortController();
				const deliverTid = setTimeout(() => deliverCtrl.abort(), 10_000);
				const res = await ctx.http.fetch("https://api.brevo.com/v3/smtp/email", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"api-key": apiKey,
					},
					body: JSON.stringify({
						sender: { email: fromEmail, name: fromName },
						to: [{ email: message.to }],
						subject: message.subject,
						textContent: message.text,
						htmlContent: message.html,
					}),
					signal: deliverCtrl.signal,
				}).finally(() => clearTimeout(deliverTid));

				if (!res.ok) {
					const body = await res.text();
					ctx.log.error(`[emdash-plugin-brevo] Delivery failed ${res.status}: ${body}`);
					throw new Error(`Brevo ${res.status}: ${body}`);
				}

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
										placeholder: "xkeysib-...",
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

					if (newApiKey && !newApiKey.startsWith("xkeysib-")) {
						return {
							blocks: [
								{
									type: "banner",
									title: "Invalid API key format",
									description:
										"Brevo API keys start with xkeysib-. Please check your key in the Brevo dashboard.",
									variant: "alert",
								},
							],
						};
					}

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
						const testCtrl = new AbortController();
						const testTid = setTimeout(() => testCtrl.abort(), 10_000);
						const res = await ctx.http!.fetch("https://api.brevo.com/v3/smtp/email", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"api-key": apiKey,
							},
							body: JSON.stringify({
								sender: { email: fromEmail, name: fromName },
								to: [{ email: fromEmail }],
								subject: "Brevo test email from EmDash",
								textContent:
									"This is a test email sent from your EmDash site to verify Brevo email delivery is working.",
							}),
							signal: testCtrl.signal,
						}).finally(() => clearTimeout(testTid));

						if (!res.ok) {
							const body = await res.text();
							ctx.log.error(`[emdash-plugin-brevo] Test email failed ${res.status}: ${body}`);
							return {
								blocks: [
									{
										type: "banner",
										title: "Test failed",
										description: `Brevo returned ${res.status}: ${body}`,
										variant: "error",
									},
								],
							};
						}

						ctx.log.info(`[emdash-plugin-brevo] Test email sent to ${fromEmail}`);
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
