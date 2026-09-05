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
];

// Pin the complete owning packages, not only their re-exporting index files.
export async function captureGrainsSourceManifest() {
  const files = HOST_FILES.map((name) => `mcp_gpt_desk/src/${name}.js`);
  for (const owner of ["desk-domain", "desk-replay-engine", "desk-time"]) {
    await collectPackage(`packages/${owner}/src`, files);
    files.push(`packages/${owner}/package.json`);
  }
  files.push("mcp_gpt_desk/scripts/lib/grains-source-manifest.mjs");
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
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) await collectPackage(relativePath, files);
    else if (/\.(?:js|mjs|json)$/.test(entry.name)) files.push(relativePath);
  }
}
