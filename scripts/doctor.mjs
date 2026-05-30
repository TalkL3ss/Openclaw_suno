import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(__filename));

function exists(name) {
  return fs.existsSync(path.join(root, name));
}

const checks = [
  ["openclaw.plugin.json", exists("openclaw.plugin.json")],
  ["package.json", exists("package.json")],
  ["index.mjs", exists("index.mjs")],
  [".env", exists(".env")],
  ["node_modules", exists("node_modules")]
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? "✅" : "❌"} ${name}`);
  if (!pass && name !== ".env") ok = false;
}

if (!exists(".env")) {
  console.log("\n⚠️  .env is missing. Run: cp .env.example .env && nano .env");
}

process.exit(ok ? 0 : 1);
