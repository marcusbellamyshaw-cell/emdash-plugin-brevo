import type { PluginDescriptor } from "emdash";

export interface BrevoPluginOptions {
	/** Brevo API key (xkeysib-...). Can be configured via admin UI instead. */
	apiKey?: string;
	/** Sender email address. Can be configured via admin UI instead. */
	fromEmail?: string;
	/** Sender display name. Can be configured via admin UI instead. */
	fromName?: string;
}

export function brevoPlugin(options: BrevoPluginOptions = {}): PluginDescriptor<BrevoPluginOptions> {
	return {
		id: "emdash-plugin-brevo",
		version: "1.0.0",
		format: "standard",
		entrypoint: "emdash-plugin-brevo/sandbox",
		capabilities: ["hooks.email-transport:register", "network:request"],
		allowedHosts: ["api.brevo.com"],
		adminPages: [{ path: "/brevo", label: "Brevo Email", icon: "mail" }],
		options,
	};
}
