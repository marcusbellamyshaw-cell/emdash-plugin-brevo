import type { PluginDescriptor } from "emdash";

export interface BrevoPluginOptions {
	/**
	 * @deprecated Sandboxed (standard-format) plugins are configured through the
	 * admin UI, not constructor options. Emdash does not pass descriptor
	 * `options` into the sandbox at runtime, so values set here never reach the
	 * email:deliver hook. Configure your key and sender in Settings > Brevo Email
	 * instead. Kept only for backward source-compatibility.
	 */
	apiKey?: string;
	/** @deprecated See {@link BrevoPluginOptions.apiKey}. Configure via the admin UI. */
	fromEmail?: string;
	/** @deprecated See {@link BrevoPluginOptions.apiKey}. Configure via the admin UI. */
	fromName?: string;
}

export function brevoPlugin(options: BrevoPluginOptions = {}): PluginDescriptor<BrevoPluginOptions> {
	return {
		id: "emdash-plugin-brevo",
		version: "1.1.0",
		format: "standard",
		entrypoint: "emdash-plugin-brevo/sandbox",
		capabilities: ["hooks.email-transport:register", "network:request"],
		allowedHosts: ["api.brevo.com"],
		adminPages: [{ path: "/brevo", label: "Brevo Email", icon: "mail" }],
		options,
	};
}
