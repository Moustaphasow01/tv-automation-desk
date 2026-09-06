import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HOST_FILES = [
  "us-grains-strategy-suite",
  "us-grains-causal-context",
  "us-grains-causal-session",
  "us-grains-causal-values",
  "us-grains-chicago-time",
  "us-grains-signal-proposal",
  "us-grains-data-quality",
  "us-grains-strategy-catalog",
  "grains-causal-detection-audit",
  "us-grains-context-theoretical-replay",
  "us-grains-theoretical-replay",
  "theoretical-execution-engine",
  "grains-causal-context-prefilter",
  "grains-calendar-coverage",
];

// Pin the complete owning packages, not only their re-exporting index files.
export async function captureGrainsSourceManifest() {
  const files = HOST_FILES.map((name) => `mcp_gpt_desk/src/${name}.js`);
  for (const owner of ["desk-domain", "desk-replay-engine", "desk-time"]) {
    await collectPackage(`packages/${owner}/src`, files);
    files.push(`packages/${owner}/package.json`, `packages/${owner}/index.js`);
  }
  files.push("mcp_gpt_desk/scripts/lib/grains-source-manifest.mjs");
  return hashFiles(files);
}

export async function captureGrainsCanonicalReplaySourceManifest() {
  const core = await captureGrainsSourceManifest();
  const files = ["mcp_gpt_desk/package.json", "mcp_gpt_desk/package-lock.json",
    "mcp_gpt_desk/scripts/replay_us_grains_causal_postgres.mjs",
    "mcp_gpt_desk/scripts/lib/grains-replay-risk-policy.mjs"];
  await collectPackage("mcp_gpt_desk/src", files);
  await collectPackage("packages/desk-contracts", files);
  await collectPackage("packages/desk-audit/src", files);
  files.push("packages/desk-audit/package.json", "packages/desk-audit/index.js");
  await collectMigrations(files);
  return { ...core, ...await hashFiles(files) };
}

async function collectMigrations(files) {
  for (const name of await readdir(path.join(ROOT, "infra/postgres/init"))) {
    if (name.endsWith(".sql")) files.push(`infra/postgres/init/${name}`);
  }
}

async function hashFiles(files) {
  const hashes = {};
  for (const relativePath of files.sort()) {
    hashes[relativePath] = createHash("sha256")
      .update(await readFile(path.join(ROOT, relativePath)))
      .digest("hex");
  }
  return hashes;
}

async function collectPackage(relativeDir, files) {
  for (const entry of await readdir(path.join(ROOT, relativeDir), {
    withFileTypes: true,
  })) {
    if (["node_modules", "test", "tests", "dist", ".git"].includes(entry.name)) continue;
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) await collectPackage(relativePath, files);
    else if (/\.(?:js|mjs|json)$/.test(entry.name)) files.push(relativePath);
  }
}
