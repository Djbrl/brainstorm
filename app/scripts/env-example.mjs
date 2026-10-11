// Writes app/.env.example from the server's list of settings (app/server/src/core/config.ts). Build the server first:
//   cd app/server && npx tsc -p . && cd .. && node scripts/env-example.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { KNOBS } = require("../server/dist/core/config.js");
const lines = [
  "# Everything here is optional. Rundown runs with none of it, and nothing below is switched on by default.",
  "# Copy this file to app/.env for development. The plugin does not read it.",
  "# Generated from app/server/src/core/config.ts by app/scripts/env-example.mjs: change the list there.",
];
for (const k of KNOBS.filter((k) => !k.hidden)) lines.push("", `# ${k.about}`, `# ${k.name}=${k.example ?? ""}`);
writeFileSync(fileURLToPath(new URL("../.env.example", import.meta.url)), lines.join("\n") + "\n");
