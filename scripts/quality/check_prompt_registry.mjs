#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_PROMPT_REGISTRY_ROOT || defaultRoot);
const inventoryPath = path.join(root, "config/prompt-registry/runtime-prompt-inventory.v1.json");
const seedPath = path.join(root, "config/prompt-registry/live-replay-2.4.0-seed.v1.json");
const governancePath = path.join(root, "config/prompt-registry/prompt-governance.v1.json");
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const seed = JSON.parse(await readFile(seedPath, "utf8"));
const governance = JSON.parse(await readFile(governancePath, "utf8"));
const failures = [];

validateInventoryShape(inventory);
validateGovernance(governance);
await validatePromptEntries(inventory.active_runtime_prompts || []);
await validateDynamicEntries(inventory.dynamic_runtime_prompts || []);
await validateLiveReplaySeed(seed, inventory.active_runtime_prompts || []);

if (failures.length) {
  console.error("[prompt-registry] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    active_runtime_prompts: (inventory.active_runtime_prompts || []).length,
    dynamic_runtime_prompts: (inventory.dynamic_runtime_prompts || []).length,
    inventory: path.relative(root, inventoryPath),
    seed: path.relative(root, seedPath),
    governance: path.relative(root, governancePath),
  }, null, 2));
}

function validateInventoryShape(value) {
  if (value.schema_version !== "desk_prompt_runtime_inventory_v1") failures.push("inventory schema_version must be desk_prompt_runtime_inventory_v1");
  if (!Array.isArray(value.active_runtime_prompts)) failures.push("active_runtime_prompts must be an array");
  if (!Array.isArray(value.dynamic_runtime_prompts)) failures.push("dynamic_runtime_prompts must be an array");
}

async function validatePromptEntries(entries) {
  const seenKeys = new Set();
  for (const entry of entries) {
    validatePromptKey(entry, seenKeys);
    await validateFileHash(entry.source_path, entry.content_sha256, `${entry.prompt_key}.source`);
    await validateNoSecrets(entry.source_path, entry.prompt_key);
    for (const consumer of entry.consumer_paths || []) await validateFileExists(consumer, `${entry.prompt_key}.consumer`);
    for (const contract of entry.contracts || []) await validateFileHash(contract.path, contract.sha256, `${entry.prompt_key}.${contract.name}`);
  }
}

async function validateDynamicEntries(entries) {
  for (const entry of entries) {
    if (!entry.prompt_key) failures.push("dynamic prompt missing prompt_key");
    for (const consumer of entry.consumer_paths || []) await validateFileExists(consumer, `${entry.prompt_key}.consumer`);
    if (entry.must_be_replaced_by_registry !== true) failures.push(`${entry.prompt_key}: dynamic runtime prompt must be marked for registry replacement`);
  }
}

async function validateLiveReplaySeed(value, inventoryEntries) {
  if (value.schema_version !== "desk_prompt_registry_seed_v1") failures.push("seed schema_version must be desk_prompt_registry_seed_v1");
  if (value.parity_mode !== "BYTE_EXACT_SOURCE") failures.push("seed parity_mode must be BYTE_EXACT_SOURCE");
  const entries = Array.isArray(value.entries) ? value.entries : [];
  if (entries.length < 2) failures.push("seed must contain live and replay entries");
  const inventoryByKey = new Map(inventoryEntries.map((entry) => [entry.prompt_key, entry]));
  for (const entry of entries) await validateSeedEntry(entry, inventoryByKey);
}

function validateGovernance(value) {
  if (value.schema_version !== "desk_prompt_registry_governance_v1") failures.push("governance schema_version must be desk_prompt_registry_governance_v1");
  if (value.secret_policy !== "NO_SECRET_ALLOWED") failures.push("governance secret_policy must be NO_SECRET_ALLOWED");
  if (value.default_effect !== "DENY") failures.push("governance default_effect must be DENY");
  for (const rule of value.write_actions || []) validateWriteGovernanceRule(rule);
}

function validateWriteGovernanceRule(rule) {
  if (rule.audit_required !== true) failures.push(`${rule.action}: write action must require audit`);
  if (rule.requires_reason !== true) failures.push(`${rule.action}: write action must require reason`);
  if (!rule.confirmation_phrase) failures.push(`${rule.action}: write action must require confirmation phrase`);
  if (!Array.isArray(rule.roles) || !rule.roles.includes("prompt_registry_admin")) {
    failures.push(`${rule.action}: write action must require prompt_registry_admin`);
  }
}

async function validateSeedEntry(entry, inventoryByKey) {
  const definition = entry.prompt_definition || {};
  const version = entry.prompt_version || {};
  const composition = entry.composition || {};
  const binding = entry.binding || {};
  const inventoryEntry = inventoryByKey.get(definition.prompt_key);
  if (!inventoryEntry) failures.push(`${definition.prompt_key}: seed prompt not found in runtime inventory`);
  if (version.status !== "PUBLISHED") failures.push(`${definition.prompt_key}: prompt version must be PUBLISHED`);
  if (composition.status !== "PUBLISHED") failures.push(`${definition.prompt_key}: composition must be PUBLISHED`);
  if (binding.deployment_stage !== "ACTIVE") failures.push(`${definition.prompt_key}: binding must be ACTIVE for parity seed`);
  if (binding.prompt_composition_id !== composition.prompt_composition_id) failures.push(`${definition.prompt_key}: binding must pin composition id`);
  if (binding.last_known_good_composition_id !== composition.prompt_composition_id) failures.push(`${definition.prompt_key}: binding must pin last-known-good`);
  await validateSeedHashes(entry, inventoryEntry);
}

async function validateSeedHashes(entry, inventoryEntry) {
  const version = entry.prompt_version || {};
  const rendered = await materializeComposition(entry.composition || {}, entry.prompt_definition?.prompt_key);
  await validateFileHash(version.source_path, version.content_sha256, `${entry.prompt_definition?.prompt_key}.seed.version`);
  if (inventoryEntry && version.content_sha256 !== inventoryEntry.content_sha256) {
    failures.push(`${entry.prompt_definition.prompt_key}: seed hash differs from inventory`);
  }
  if (rendered !== null && rendered.hash !== entry.composition?.rendered_sha256) {
    failures.push(`${entry.prompt_definition?.prompt_key}: rendered seed hash drift ${rendered.hash}`);
  }
}

async function materializeComposition(composition, label) {
  const items = Array.isArray(composition.items) ? [...composition.items] : [];
  if (!items.length) {
    failures.push(`${label}: composition items required`);
    return null;
  }
  items.sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
  const buffers = [];
  for (const item of items) {
    const content = await readRequiredFile(item.source_path, `${label}.${item.item_key || item.ordinal}`);
    if (content === null) return null;
    const actualHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (actualHash !== item.content_sha256) failures.push(`${label}.${item.item_key}: item hash drift ${actualHash}`);
    buffers.push(content);
  }
  const rendered = Buffer.concat(buffers);
  return { hash: `sha256:${createHash("sha256").update(rendered).digest("hex")}` };
}

function validatePromptKey(entry, seenKeys) {
  if (!entry.prompt_key) failures.push("active prompt missing prompt_key");
  if (seenKeys.has(entry.prompt_key)) failures.push(`${entry.prompt_key}: duplicate prompt_key`);
  seenKeys.add(entry.prompt_key);
  if (!entry.semantic_version) failures.push(`${entry.prompt_key}: missing semantic_version`);
  if (entry.secret_policy !== "NO_SECRET_ALLOWED") failures.push(`${entry.prompt_key}: secret_policy must be NO_SECRET_ALLOWED`);
}

async function validateFileHash(relativePath, expectedHash, label) {
  const content = await readRequiredFile(relativePath, label);
  if (content === null) return;
  const actualHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (actualHash !== expectedHash) failures.push(`${label}: hash drift ${actualHash} !== ${expectedHash}`);
}

async function validateNoSecrets(relativePath, label) {
  const content = await readRequiredFile(relativePath, label);
  if (content === null) return;
  const lines = content.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of secretRules()) {
      if (rule.pattern.test(line) && !isAllowedPlaceholder(line)) failures.push(`${relativePath}:${index + 1}: possible ${rule.name} in ${label}`);
    }
  });
}

async function validateFileExists(relativePath, label) {
  await readRequiredFile(relativePath, label);
}

async function readRequiredFile(relativePath, label) {
  if (!relativePath) {
    failures.push(`${label}: missing path`);
    return null;
  }
  try {
    return await readFile(path.join(root, relativePath));
  } catch {
    failures.push(`${label}: missing file ${relativePath}`);
    return null;
  }
}

function secretRules() {
  return [
    { name: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
    { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
    { name: "Telegram bot token", pattern: /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/ },
    { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
    { name: "operator PIN", pattern: /\bPIN\s*[:=]\s*[^{}\s]{4,}/i },
  ];
}

function isAllowedPlaceholder(line) {
  return /placeholder|example|dummy|change-me|\{\{[A-Z0-9_]+\}\}/i.test(line);
}
