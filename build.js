import * as esbuild from "esbuild";
import fs from "fs";

// ── Bundle the CLI entry (for local npm install usage) ────────────────────────
await esbuild.build({
  entryPoints: ["bin/og-assistant.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  minify: true,
  outfile: "dist/cli.js",
}).catch(() => process.exit(1));

const file = "dist/cli.js";
let code = fs.readFileSync(file, "utf8");
code = code.replace(/^#!(.*)/gm, "");
code = code.trimStart();
const absoluteTop = `#!/usr/bin/env node\nprocess.env.NODE_ENV = "production";\n`;
fs.writeFileSync(file, absoluteTop + code);

// ── Bundle the server entry (for Render / cloud deployment) ──────────────────
await esbuild.build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  minify: false,
  outfile: "dist/server.js",
}).catch(() => process.exit(1));
