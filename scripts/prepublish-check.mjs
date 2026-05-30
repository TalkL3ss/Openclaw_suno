import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(__filename));

const requiredFiles = [
  "README.md",
  "LICENSE",
  "package.json",
  "openclaw.plugin.json",
  "index.mjs",
  ".env.example",
  "scripts/doctor.mjs"
];

const forbiddenFiles = [
  ".env",
  "suno-history.json"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

let ok = true;

for (const file of requiredFiles) {
  const exists = fs.existsSync(path.join(root, file));
  console.log(`${exists ? "OK" : "MISSING"} ${file}`);
  if (!exists) ok = false;
}

for (const file of forbiddenFiles) {
  const exists = fs.existsSync(path.join(root, file));
  console.log(`${exists ? "LOCAL_ONLY" : "OK"} ${file}`);
}

const pkg = readJson("package.json");
const manifest = readJson("openclaw.plugin.json");

if (!pkg.name || !pkg.version || !pkg.openclaw?.extensions?.length) {
  console.error("package.json is missing required ClawHub/OpenClaw metadata.");
  ok = false;
}

if (!pkg.openclaw?.compat?.pluginApi || !pkg.openclaw?.build?.openclawVersion) {
  console.error("package.json must include openclaw.compat.pluginApi and openclaw.build.openclawVersion before ClawHub publishing.");
  ok = false;
}

if (!manifest.id || !manifest.configSchema || !Array.isArray(manifest.contracts?.tools)) {
  console.error("openclaw.plugin.json is missing id, configSchema, or contracts.tools.");
  ok = false;
}

if (pkg.name.startsWith("@")) {
  const scope = pkg.name.split("/")[0].slice(1);
  console.log(`Scoped package detected. Publish owner should be: ${scope}`);
} else {
  console.log("Unscoped package. If publishing under a scoped owner, rename package.json name to @owner/openclaw-suno-music first.");
}

process.exit(ok ? 0 : 1);
