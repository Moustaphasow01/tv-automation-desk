#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scanRootIds = ["mcp_gpt_desk/src", "mcp_gpt_desk/scripts", "scripts", "docs"];
const referenceRootIds = [...scanRootIds, "packages"];
const scanRoots = scanRootIds.map((item) => join(root, item));
const referenceRoots = referenceRootIds.map((item) => join(root, item));
const sourceRoots = ["mcp_gpt_desk/src", "mcp_gpt_desk/scripts", "scripts"].map((item) => join(root, item));
const excludedFindingScopes = [
  "docs/archive",
  "docs/MIGRATION_*",
  "docs/FIRESTORE_*",
  "docs/MARKET_CANDLES_*",
  "docs/POSTGRES_*",
  "docs/AUTOPILOT_V4_*",
  "docs/M17_BACKEND_CLEANUP_RUNBOOK.md",
  "docs/PREPROD_PROJECT_MANIFEST.md",
];
const cleanupPatterns = [
  { id: "firebase_or_firestore", pattern: /\b(firebase|firestore)\b/i, severity: "review" },
  { id: "cloudrun_or_gcloud", pattern: /\b(cloud\s*run|cloudrun|gcloud)\b/i, severity: "review" },
  { id: "historical_marker", pattern: /\b(legacy|deprecated|obsolete|ancien)\b/i, severity: "review" },
  { id: "backfill_or_publish_script", pattern: /\b(backfill|publish_pack|firestore_pack)\b/i, severity: "candidate" },
];
const ignore = new Set(["node_modules", ".git", "dist", "output", "local_data"]);

const extraFiles = ["package.json", "mcp_gpt_desk/package.json"].map((item) => join(root, item));
const files = [...new Set([...referenceRoots.flatMap((dir) => walk(dir)), ...extraFiles])]
  .filter((file) => /\.(js|mjs|ts|tsx|md|json|py|ps1|sh)$/.test(file));
const findingFiles = files
  .filter((file) => scanRoots.some((dir) => file.startsWith(dir)) || extraFiles.includes(file))
  .filter((file) => !isExcludedFindingDocument(file));
const sourceFiles = files
  .filter((file) => sourceRoots.some((dir) => file.startsWith(dir)))
  .filter((file) => !relative(root, file).replace(/\\/g, "/").includes("/archive/"));
const contentByFile = new Map(files.map((file) => [file, safeRead(file)]));
const findings = [];

for (const file of findingFiles) {
  if (relative(root, file) === "mcp_gpt_desk/scripts/audit_backend_cleanup_candidates.mjs") continue;
  const text = contentByFile.get(file) || "";
  for (const rule of cleanupPatterns) {
    if (!rule.pattern.test(text) && !rule.pattern.test(relative(root, file))) continue;
    findings.push({
      rule: rule.id,
      severity: rule.severity,
      file: relative(root, file),
      lines: matchingLines(text, rule.pattern).slice(0, 8),
    });
  }
}

const scriptCandidates = sourceFiles
  .filter((file) => file.includes(`${separator()}scripts${separator()}`))
  .map((file) => {
    const rel = relative(root, file);
    const basename = rel.split(/[\\/]/).pop();
    const references = [...contentByFile.entries()]
      .filter(([other]) => other !== file)
      .filter(([, text]) => text.includes(rel) || text.includes(basename))
      .map(([other]) => relative(root, other));
    return { file: rel, references };
  })
  .filter((item) => item.references.length === 0);

const report = {
  generatedAt: new Date().toISOString(),
  scope: scanRootIds,
  referenceScope: referenceRootIds,
  excludedFindingScopes,
  summary: {
    scannedFiles: files.length,
    findingFiles: findingFiles.length,
    findings: findings.length,
    unreferencedScripts: scriptCandidates.length,
  },
  findings,
  unreferencedScripts: scriptCandidates,
  policy: {
    deleteAutomatically: false,
    rule: "Toute suppression doit être faite par lot, avec preuve rg, tests ciblés puis test:stack.",
  },
};

console.log(JSON.stringify(report, null, 2));

function walk(dir) {
  try {
    const entries = readdirSync(dir);
    return entries.flatMap((entry) => {
      if (ignore.has(entry)) return [];
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) return walk(full);
      return stat.isFile() ? [full] : [];
    });
  } catch {
    return [];
  }
}

function safeRead(file) {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

function matchingLines(text, pattern) {
  return text.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line.trim() })).filter((entry) => pattern.test(entry.text));
}

function isExcludedFindingDocument(file) {
  const rel = relative(root, file).replace(/\\/g, "/");
  return rel.startsWith("docs/archive/")
    || rel.includes("/archive/")
    || /^docs\/(MIGRATION_|FIRESTORE_|MARKET_CANDLES_|POSTGRES_|AUTOPILOT_V4_)[^/]+$/.test(rel)
    || rel === "docs/M17_BACKEND_CLEANUP_RUNBOOK.md"
    || rel === "docs/PREPROD_PROJECT_MANIFEST.md";
}

function separator() {
  return process.platform === "win32" ? "\\" : "/";
}
