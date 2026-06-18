// Build script for emdash-plugin-brevo.
//
// Produces the publishable dist/ artifacts:
//   - dist/index.mjs          (standard-format descriptor entry)
//   - dist/sandbox-entry.mjs  (sandboxed runtime: hooks + admin route)
//   - dist/manifest.json      (capabilities/hooks/routes the host reads)
//
// dist/ is gitignored and rebuilt here, so this file is the single source of
// truth for the published bundle. The manifest below MUST stay in sync with the
// hooks declared in src/sandbox-entry.ts and the descriptor in src/index.ts.

import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const outdir = "dist";

await mkdir(outdir, { recursive: true });

await build({
	entryPoints: ["src/index.ts", "src/sandbox-entry.ts"],
	outdir,
	outExtension: { ".js": ".mjs" },
	format: "esm",
	platform: "neutral",
	target: "es2022",
	bundle: true,
	// emdash is provided by the host at runtime — never bundle it.
	external: ["emdash", "emdash/*"],
});

// REQUEST_TIMEOUT_MS in src/sandbox-entry.ts (4500ms) is intentionally kept
// below this 5000ms host hook timeout so the plugin aborts with a clean error
// before the host force-kills the hook.
const manifest = {
	id: "emdash-plugin-brevo",
	version: "1.1.1",
	capabilities: ["hooks.email-transport:register", "network:request"],
	allowedHosts: ["api.brevo.com"],
	storage: {},
	hooks: [
		{ name: "plugin:install", priority: 100, timeout: 5000 },
		{ name: "email:deliver", priority: 100, timeout: 5000, exclusive: true },
	],
	routes: ["admin"],
	admin: {
		pages: [{ path: "/brevo", label: "Brevo Email", icon: "mail" }],
	},
};

await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");

console.log("[emdash-plugin-brevo] build complete → dist/");
