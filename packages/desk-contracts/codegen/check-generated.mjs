#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const codegenRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(codegenRoot, "..");
const generatedRoots = [
  resolve(packageRoot, "generated", "ts"),
  resolve(packageRoot, "generated", "runtime-data.js"),
];

const before = await snapshot(generatedRoots);
execFileSync(process.execPath, [resolve(codegenRoot, "generate.mjs")], {
  cwd: packageRoot,
  stdio: "inherit",
});
const after = await snapshot(generatedRoots);

const changed = [...new Set([...before.keys(), ...after.keys()])]
  .filter((file) => before.get(file) !== after.get(file))
  .sort();
if (changed.length) {
  console.error("[desk-contracts] generated artifacts were stale:");
  for (const file of changed) console.error(`- ${file}`);
  process.exit(1);
}
console.log(`[desk-contracts] generated artifacts are current (${after.size} files).`);

async function snapshot(paths) {
  const result = new Map();
  for (const path of paths) {
    const entries = await files(path);
    for (const file of entries) {
      const bytes = await readFile(file);
      result.set(relative(packageRoot, file).replaceAll("\\", "/"), createHash("sha256").update(bytes).digest("hex"));
    }
  }
  return result;
}

async function files(path) {
  const statEntries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!statEntries) return [path];
  const result = [];
  for (const entry of statEntries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) result.push(...await files(child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}
