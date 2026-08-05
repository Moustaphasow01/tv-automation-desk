#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";

const releaseRoot = parseReleaseRoot(process.argv.slice(2));
const failures = [];
const readJson = async (relativePath) => JSON.parse(await readFile(safePath(relativePath), "utf8"));
const strategyLock = await readJson("config/strategy-contract-lock.json");
const executionLock = await readJson("config/execution-policy-lock.json");
const registry = await readJson("app/packages/desk-contracts/registry.json");
const releaseManifest = await readJson("release-manifest.json");

function fail(message) {
  failures.push(message);
}

function safePath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized || isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`RELEASE_CONTRACT_PATH_UNSAFE:${relativePath || "missing"}`);
  }
  const absolute = resolve(releaseRoot, normalized);
  const fromRoot = relative(releaseRoot, absolute);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new Error(`RELEASE_CONTRACT_PATH_UNSAFE:${relativePath}`);
  }
  return absolute;
}

function packagedPath(repositoryPath) {
  const normalized = String(repositoryPath || "").replaceAll("\\", "/");
  return normalized.startsWith("packages/") || normalized.startsWith("mcp_gpt_desk/")
    ? `app/${normalized}`
    : normalized;
}

function registryArtifactPath(relativePath) {
  return `app/packages/desk-contracts/${String(relativePath || "").replaceAll("\\", "/")}`;
}

async function digest(relativePath, label = relativePath) {
  try {
    return createHash("sha256").update(await readFile(safePath(relativePath))).digest("hex");
  } catch (error) {
    fail(`${label}:${error.code || error.message}`);
    return null;
  }
}

function equal(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label}:expected=${expected ?? "<missing>"}:actual=${actual ?? "<missing>"}`);
  }
}

async function verifyLocked(record, bucketName, expectedStatus, expectedRuntime) {
  const label = `${bucketName}.${record?.registry_key || "missing"}`;
  const actualHash = await digest(packagedPath(record?.path), label);
  if (actualHash) equal(`${label}.sha256`, actualHash, record?.sha256);
  if (record?.schema_path) {
    const actualSchemaHash = await digest(packagedPath(record.schema_path), `${label}.schema`);
    if (!record.schema_sha256) fail(`${label}.schema_sha256:missing`);
    if (actualSchemaHash) equal(`${label}.schema_sha256`, actualSchemaHash, record.schema_sha256);
  }
  for (const companion of record?.companion_schemas || []) {
    const companionLabel = `${label}.companion.${companion?.path || "missing"}`;
    const actualCompanionHash = await digest(packagedPath(companion?.path), companionLabel);
    if (!companion?.sha256) fail(`${companionLabel}.sha256:missing`);
    if (actualCompanionHash) equal(`${companionLabel}.sha256`, actualCompanionHash, companion.sha256);
  }
  const entry = registry[bucketName]?.[record?.registry_key];
  if (!entry) {
    fail(`${label}:registry-entry-missing`);
    return;
  }
  equal(`${label}.schema_version`, entry.schema_version, record.schema_version);
  equal(`${label}.hash`, entry.hash, record.sha256);
  equal(`${label}.status`, entry.status, expectedStatus);
  equal(`${label}.runtime_exposed`, entry.runtime_exposed, expectedRuntime);
  equal(
    `${label}.markdown_path`,
    entry.markdown_path,
    String(record.path).replace(/^packages\/desk-contracts\//, ""),
  );
  if (record?.schema_path) {
    equal(
      `${label}.schema_path`,
      entry.schema_path,
      String(record.schema_path).replace(/^packages\/desk-contracts\//, ""),
    );
  }
}

equal("release_manifest.profile", releaseManifest.release_profile, "deterministic_strategy_v5_frozen");
if (stableJson(releaseManifest.strategy_contract_lock) !== stableJson(strategyLock)) {
  fail("release_manifest.strategy_contract_lock:differs-from-packaged-lock");
}
if (stableJson(releaseManifest.execution_policy_lock) !== stableJson(executionLock)) {
  fail("release_manifest.execution_policy_lock:differs-from-packaged-lock");
}

for (const record of strategyLock.active_contracts || []) {
  await verifyLocked(record, "active_contracts", "active", true);
}
for (const record of strategyLock.legacy_contracts || []) {
  await verifyLocked(record, "legacy_contracts", "archived", false);
}
await verifyLocked(executionLock.policy || {}, "active_contracts", "active", true);
for (const component of executionLock.components || []) {
  await verifyLocked(component, "active_contracts", "active", true);
  if (component.artifact_path) {
    const actualHash = await digest(packagedPath(component.artifact_path), `${component.registry_key}.artifact_path`);
    if (!component.artifact_sha256) fail(`${component.registry_key}.artifact_sha256:missing`);
    if (actualHash) equal(`${component.registry_key}.artifact_sha256`, actualHash, component.artifact_sha256);
  }
}
for (const legacyPolicy of executionLock.legacy_policies || []) {
  await verifyLocked(legacyPolicy, "legacy_contracts", "archived", false);
}
for (const legacyComponent of executionLock.legacy_components || []) {
  await verifyLocked(legacyComponent, "legacy_contracts", "archived", false);
  if (legacyComponent.artifact_path) {
    const actualHash = await digest(packagedPath(legacyComponent.artifact_path), `${legacyComponent.registry_key}.artifact_path`);
    if (!legacyComponent.artifact_sha256) fail(`${legacyComponent.registry_key}.artifact_sha256:missing`);
    if (actualHash) equal(`${legacyComponent.registry_key}.artifact_sha256`, actualHash, legacyComponent.artifact_sha256);
  }
}
for (const artifact of executionLock.compiler?.artifacts || []) {
  const label = `compiler.${artifact?.path || "missing"}`;
  const actualHash = await digest(packagedPath(artifact?.path), label);
  if (!artifact?.sha256) fail(`${label}.sha256:missing`);
  if (actualHash) equal(`${label}.sha256`, actualHash, artifact.sha256);
}

for (const [bucketName, expectedStatus, expectedRuntime] of [
  ["active_contracts", "active", true],
  ["legacy_contracts", "archived", false],
]) {
  for (const [key, entry] of Object.entries(registry[bucketName] || {})) {
    const label = `registry.${bucketName}.${key}`;
    equal(`${label}.status`, entry.status, expectedStatus);
    equal(`${label}.runtime_exposed`, entry.runtime_exposed, expectedRuntime);
    const actualHash = await digest(registryArtifactPath(entry.markdown_path), label);
    if (actualHash) equal(`${label}.hash`, actualHash, entry.hash);
    await digest(registryArtifactPath(entry.schema_path), `${label}.schema_path`);
    for (const schemaPath of entry.companion_schema_paths || []) {
      await digest(registryArtifactPath(schemaPath), `${label}.companion_schema_paths`);
    }
    if (entry.catalog_path) await digest(registryArtifactPath(entry.catalog_path), `${label}.catalog_path`);
  }
}

if (failures.length) {
  process.stderr.write(`[release-contract-integrity] ok=false failures=${failures.length}\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    release_profile: releaseManifest.release_profile,
    active_contracts: (strategyLock.active_contracts || []).length,
    legacy_contracts: (strategyLock.legacy_contracts || []).length,
    execution_policy_version: executionLock.policy?.schema_version || null,
    execution_components: (executionLock.components || []).length,
  })}\n`);
}

function parseReleaseRoot(argv) {
  const argument = argv.find((value) => String(value).startsWith("--release-root="));
  if (!argument || argv.length !== 1) {
    throw new Error("RELEASE_ROOT_REQUIRED: use --release-root=<absolute-or-relative-path>");
  }
  return resolve(String(argument).slice("--release-root=".length));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
