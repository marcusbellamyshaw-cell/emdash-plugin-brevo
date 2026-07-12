import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import plugin from "../src/sandbox-entry.js";

function makeCtx(overrides: { kvSeed?: Record<string, unknown>; fetchImpl?: typeof fetch } = {}) {
	const store = new Map<string, unknown>(Object.entries(overrides.kvSeed ?? {}));
	const fetchImpl = overrides.fetchImpl ?? vi.fn();
	return {
		kv: {
			get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
			set: vi.fn(async (key: string, value: unknown) => {
				store.set(key, value);
			}),
		},
		http: { fetch: fetchImpl },
		log: { info: vi.fn(), error: vi.fn() },
		store,
	};
}

function configuredCtx(fetchImpl?: typeof fetch) {
	return makeCtx({
		kvSeed: {
			"config:apiKey": "xkeysib-real-key",
			"config:fromEmail": "sender@example.com",
			"config:fromName": "Example Site",
		},
		fetchImpl,
	});
}

describe("plugin:install hook", () => {
	it("seeds blank config on first install", async () => {
		const ctx = makeCtx();
		await plugin.hooks["plugin:install"].handler(undefined, ctx as never);

		expect(ctx.kv.set).toHaveBeenCalledWith("config:apiKey", "");
		expect(ctx.kv.set).toHaveBeenCalledWith("config:fromEmail", "");
		expect(ctx.kv.set).toHaveBeenCalledWith("config:fromName", "");
	});

	it("does not overwrite existing config on reinstall", async () => {
		const ctx = configuredCtx();
		await plugin.hooks["plugin:install"].handler(undefined, ctx as never);

		expect(ctx.kv.set).not.toHaveBeenCalled();
	});
});

describe("email:deliver hook", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("sends via Brevo's HTTP API with the configured sender and message", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
		const ctx = configuredCtx(fetchImpl);

		await plugin.hooks["email:deliver"].handler(
			{ message: { to: "reader@example.com", subject: "Hi", text: "Body" }, source: "test" },
			ctx as never,
		);

		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe("https://api.brevo.com/v3/smtp/email");
		expect(init.headers["api-key"]).toBe("xkeysib-real-key");
		const body = JSON.parse(init.body);
		expect(body.sender).toEqual({ email: "sender@example.com", name: "Example Site" });
		expect(body.to).toEqual([{ email: "reader@example.com" }]);
		expect(body.subject).toBe("Hi");
		expect(body.textContent).toBe("Body");
	});

	it("throws when no API key is configured", async () => {
		const ctx = makeCtx();

		await expect(
			plugin.hooks["email:deliver"].handler(
				{ message: { to: "a@b.com", subject: "s" }, source: "test" },
				ctx as never,
			),
		).rejects.toThrow(/API key is not configured/);
	});

	it("throws a normalized error on a non-2xx Brevo response", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" });
		const ctx = configuredCtx(fetchImpl);

		await expect(
			plugin.hooks["email:deliver"].handler(
				{ message: { to: "a@b.com", subject: "s" }, source: "test" },
				ctx as never,
			),
		).rejects.toThrow(/Brevo 401: unauthorized/);
	});

	it("times out instead of hanging forever when Brevo never responds", async () => {
		const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {}));
		const ctx = configuredCtx(fetchImpl);

		const promise = plugin.hooks["email:deliver"].handler(
			{ message: { to: "a@b.com", subject: "s" }, source: "test" },
			ctx as never,
		);
		const assertion = expect(promise).rejects.toThrow(/timed out after 4500ms/);
		await vi.advanceTimersByTimeAsync(4501);
		await assertion;
	});
});

describe("admin route — page_load", () => {
	it("shows the not-configured banner when unconfigured", async () => {
		const ctx = makeCtx();
		const result = await plugin.routes.admin.handler({ input: { type: "page_load" } } as never, ctx as never);

		const banner = result.blocks.find((b: { type: string }) => b.type === "banner");
		expect(banner?.title).toBe("Not configured");
	});

	it("shows the configured status with a Send Test Email button when configured", async () => {
		const ctx = configuredCtx();
		const result = await plugin.routes.admin.handler({ input: { type: "page_load" } } as never, ctx as never);

		const section = result.blocks.find((b: { accessory?: { action_id: string } }) => b.accessory?.action_id === "sendTest");
		expect(section).toBeDefined();
		expect(section.text).toContain("sender@example.com");
	});
});

describe("admin route — saveConfig", () => {
	it("rejects an SMTP key (xsmtpsib-) with a clear explanation instead of saving it", async () => {
		const ctx = makeCtx();
		const result = await plugin.routes.admin.handler(
			{ input: { action_id: "saveConfig", values: { apiKey: "xsmtpsib-wrongtype", fromEmail: "a@b.com", fromName: "A" } } } as never,
			ctx as never,
		);

		expect(ctx.kv.set).not.toHaveBeenCalledWith("config:apiKey", expect.anything());
		expect(result.blocks[0].title).toBe("That looks like a Brevo SMTP key");
	});

	it("saves a new API key when one is entered", async () => {
		const ctx = makeCtx();
		await plugin.routes.admin.handler(
			{ input: { action_id: "saveConfig", values: { apiKey: "xkeysib-new", fromEmail: "a@b.com", fromName: "A" } } } as never,
			ctx as never,
		);

		expect(ctx.kv.set).toHaveBeenCalledWith("config:apiKey", "xkeysib-new");
	});

	it("keeps the existing API key when the field is left blank", async () => {
		const ctx = configuredCtx();
		await plugin.routes.admin.handler(
			{ input: { action_id: "saveConfig", values: { apiKey: "", fromEmail: "new@b.com", fromName: "New" } } } as never,
			ctx as never,
		);

		expect(ctx.kv.set).not.toHaveBeenCalledWith("config:apiKey", expect.anything());
		expect(ctx.kv.set).toHaveBeenCalledWith("config:fromEmail", "new@b.com");
	});
});

describe("admin route — sendTest", () => {
	it("returns an error banner when not configured", async () => {
		const ctx = makeCtx();
		const result = await plugin.routes.admin.handler({ input: { action_id: "sendTest" } } as never, ctx as never);

		expect(result.blocks[0].title).toBe("Not configured");
	});

	it("sends a test email and reports success when configured", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
		const ctx = configuredCtx(fetchImpl);

		const result = await plugin.routes.admin.handler({ input: { action_id: "sendTest" } } as never, ctx as never);

		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(result.toast).toEqual({ message: "Test email sent!", type: "success" });
	});

	it("reports failure in the UI instead of throwing when Brevo rejects the test send", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" });
		const ctx = configuredCtx(fetchImpl);

		const result = await plugin.routes.admin.handler({ input: { action_id: "sendTest" } } as never, ctx as never);

		expect(result.blocks[0].title).toBe("Test failed");
		expect(result.blocks[0].description).toContain("401");
	});
});
