#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const failures = [];
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const strategyLock = await readJson("config/strategy-contract-lock.json");
const executionLock = await readJson("config/execution-policy-lock.json");
const registry = await readJson("packages/desk-contracts/registry.json");
const packagePrefix = "packages/desk-contracts/";

function fail(message) { failures.push(message); }
function relativeRegistryPath(relative) {
  return relative.startsWith(packagePrefix) ? relative.slice(packagePrefix.length) : relative;
}
async function digest(relative, label = relative) {
  const absolute = path.resolve(root, relative || "");
  if (!absolute.startsWith(`${root}${path.sep}`)) { fail(`${label}: path escapes repository root`); return null; }
  try { return createHash("sha256").update(await readFile(absolute)).digest("hex"); }
  catch (error) { fail(`${label}: ${error.code || error.message}`); return null; }
}
async function requireFile(relative, label = relative) { await digest(relative, label); }
function equal(label, actual, expected) {
  if (actual !== expected) fail(`${label}: expected ${expected ?? "<missing>"}, received ${actual ?? "<missing>"}`);
}

async function verifyLocked(record, bucketName, expectedStatus, expectedRuntime) {
  const label = `${bucketName}.${record.registry_key}`;
  const actualHash = await digest(record.path, label);
  if (actualHash) equal(`${label}.sha256`, actualHash, record.sha256);
  const entry = registry[bucketName]?.[record.registry_key];
  if (!entry) { fail(`${label}: registry entry missing`); return; }
  equal(`${label}.markdown_path`, entry.markdown_path, relativeRegistryPath(record.path));
  equal(`${label}.schema_version`, entry.schema_version, record.schema_version);
  equal(`${label}.hash`, entry.hash, record.sha256);
  equal(`${label}.status`, entry.status, expectedStatus);
  equal(`${label}.runtime_exposed`, entry.runtime_exposed, expectedRuntime);
}

const runtimeRoot = path.resolve(root, strategyLock.runtime_contract_root || "");
equal("runtime_contract_root", runtimeRoot, path.resolve(root, "packages/desk-contracts/contracts"));
for (const record of strategyLock.active_contracts || []) await verifyLocked(record, "active_contracts", "active", true);
for (const record of strategyLock.legacy_contracts || []) await verifyLocked(record, "legacy_contracts", "archived", false);
await verifyLocked(executionLock.policy || {}, "active_contracts", "active", true);
for (const component of executionLock.components || []) {
  await verifyLocked(component, "active_contracts", "active", true);
  if (component.schema_path) await requireFile(component.schema_path, `${component.registry_key}.schema_path`);
  if (component.artifact_path) {
    const actual = await digest(component.artifact_path, `${component.registry_key}.artifact_path`);
    if (actual) equal(`${component.registry_key}.artifact_sha256`, actual, component.artifact_sha256);
  }
}

for (const [bucketName, expectedStatus, expectedRuntime] of [["active_contracts", "active", true], ["legacy_contracts", "archived", false]]) {
  for (const [key, entry] of Object.entries(registry[bucketName] || {})) {
    const label = `registry.${bucketName}.${key}`;
    equal(`${label}.status`, entry.status, expectedStatus);
    equal(`${label}.runtime_exposed`, entry.runtime_exposed, expectedRuntime);
    const actual = await digest(`${packagePrefix}${entry.markdown_path}`, label);
    if (actual) equal(`${label}.hash`, actual, entry.hash);
    await requireFile(`${packagePrefix}${entry.schema_path}`, `${label}.schema_path`);
    for (const schemaPath of entry.companion_schema_paths || []) await requireFile(`${packagePrefix}${schemaPath}`, `${label}.companion_schema_paths`);
    if (entry.catalog_path) await requireFile(`${packagePrefix}${entry.catalog_path}`, `${label}.catalog_path`);
  }
}

if (failures.length) {
  console.error("[strategy-contract-guard] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  console.error("Contract lock updates require an explicit strategy review; hashes are never repaired automatically.");
  process.exitCode = 1;
} else {
  console.log(`[strategy-contract-guard] ok active=${strategyLock.active_contracts.length} legacy=${strategyLock.legacy_contracts.length} policy=${executionLock.policy.schema_version} components=${executionLock.components.length}`);
}
