#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_BROWSER_SECRET_ROOT || defaultRoot);
const scope = String(process.env.DESK_BROWSER_SECRET_SCOPE || "vnext").toLowerCase();
const failures = [];
const warnings = [];

const allowedViteKeys = new Set([
  "VITE_DATA_MODE",
  "VITE_OPERATOR_AUTH_BASE_URL",
  "VITE_FRONT_API_BASE_URL",
  "VITE_FRONT_API_TIMEOUT_MS",
  "VITE_FEATURE_JARVIS_WORKSPACE",
]);

const highConfidenceSecretRules = [
  { name: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Telegram bot token", pattern: /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/ },
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
];

const deniedBrowserIdentifiers = [
  "DESK_MCP_API_KEY",
  "VITE_DESK_API_KEY",
  "DESK_OPERATOR_ADMIN_PIN",
  "TRADINGVIEW_WEBHOOK_SECRET",
  "TELEGRAM_ADMIN_BOT_TOKEN",
  "TELEGRAM_ALERT_BOT_TOKEN",
  "DESK_NINJA_ADDON_SHARED_SECRET",
  "NINJA_ADDON_SHARED_SECRET",
  "BROKER_API_KEY",
  "PROVIDER_API_KEY",
  "PROVIDER_SECRET",
  "RITHMIC_PASSWORD",
  "TRADOVATE_CLIENT_SECRET",
  "PICKMYTRADE_API_KEY",
];

const targetRoots = scope === "all"
  ? ["apps/desk-control-plane/src", "apps/desk-control-plane/index.html", "apps/desk-control-plane/public", "apps/desk-control-plane/dist", "src", "index.html", "dist"]
  : ["apps/desk-control-plane/src", "apps/desk-control-plane/index.html", "apps/desk-control-plane/public", "apps/desk-control-plane/dist"];

const files = [];
for (const target of targetRoots) await collectBrowserFiles(path.join(root, target), target);
for (const file of files) await scanFile(file);

if (failures.length) {
  console.error("[browser-secret-exposure] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    scope,
    scanned_files: files.length,
    allowed_vite_keys: [...allowedViteKeys].sort(),
    warnings,
  }, null, 2));
}

async function collectBrowserFiles(absPath, label) {
  const info = await stat(absPath).catch(() => null);
  if (!info) {
    warnings.push(`${label}:missing`);
    return;
  }
  if (info.isFile()) {
    if (shouldScan(absPath)) files.push(absPath);
    return;
  }
  if (!info.isDirectory()) return;
  const entries = await readdir(absPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".vite") continue;
    await collectBrowserFiles(path.join(absPath, entry.name), path.posix.join(label, entry.name));
  }
}

function shouldScan(file) {
  const normalized = file.replaceAll(path.sep, "/");
  if (normalized.includes("/src/test/") || normalized.includes("/__tests__/")) return false;
  return /\.(?:js|jsx|ts|tsx|mjs|cjs|html|css|json)$/i.test(file);
}

async function scanFile(absFile) {
  const rel = path.relative(root, absFile).replaceAll(path.sep, "/");
  const content = await readFile(absFile, "utf8").catch(() => "");
  scanViteKeys(rel, content);
  scanDeniedIdentifiers(rel, content);
  scanHighConfidenceSecrets(rel, content);
}

function scanViteKeys(rel, content) {
  const viteKeys = new Set([...content.matchAll(/\bVITE_[A-Z0-9_]+\b/g)].map((match) => match[0]));
  for (const key of viteKeys) {
    if (!allowedViteKeys.has(key)) failures.push(`${rel}: browser-exposed Vite key is not allowlisted (${key})`);
  }
}

function scanDeniedIdentifiers(rel, content) {
  const allowedPlaceholders = new Set(["DESK_OPERATOR_ADMIN_PIN"]);
  for (const identifier of deniedBrowserIdentifiers) {
    if (allowedPlaceholders.has(identifier) && new RegExp(`${identifier}\\s*=\\s*\\.\\.\\.`).test(content)) continue;
    if (content.includes(identifier)) failures.push(`${rel}: forbidden browser secret/provider identifier (${identifier})`);
  }
  const genericSensitiveNames = content.match(/\b[A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE_KEY|REFRESH_TOKEN)[A-Z0-9_]*\b/g) || [];
  for (const name of new Set(genericSensitiveNames)) {
    if (name === "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED") continue;
    if (allowedPlaceholders.has(name) && new RegExp(`${name}\\s*=\\s*\\.\\.\\.`).test(content)) continue;
    if (!allowedViteKeys.has(name)) failures.push(`${rel}: sensitive identifier must not be browser-addressable (${name})`);
  }
}

function scanHighConfidenceSecrets(rel, content) {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/example|placeholder|change-me|dummy|your_/i.test(line)) return;
    for (const rule of highConfidenceSecretRules) {
      if (rule.pattern.test(line)) failures.push(`${rel}:${index + 1}: possible ${rule.name}`);
    }
  });
}
