#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const seedPath = path.join(repoRoot, "config/prompt-registry/live-replay-2.4.0-seed.v1.json");
const seed = JSON.parse(await readFile(seedPath, "utf8"));

if (process.argv.includes("--summary")) {
  console.log(JSON.stringify({ ok: true, entries: seed.entries.length, seed: path.relative(repoRoot, seedPath) }, null, 2));
} else {
  console.log(await buildSeedSql(seed));
}

export async function buildSeedSql(value) {
  const statements = [];
  for (const entry of value.entries || []) statements.push(await buildEntrySql(entry));
  return statements.join("\n\n");
}

async function buildEntrySql(entry) {
  const definition = entry.prompt_definition;
  const version = entry.prompt_version;
  const composition = entry.composition;
  const binding = entry.binding;
  const promptText = await readFile(path.join(repoRoot, version.source_path), "utf8");
  return [
    insertPromptDefinition(definition),
    insertPromptVersion(definition, version, promptText),
    insertPromptComposition(composition, version),
    insertPromptCompositionItems(composition, version),
    insertAgentPromptBinding(binding, composition),
  ].join("\n");
}

function insertPromptDefinition(definition) {
  return `INSERT INTO prompt_definitions (prompt_definition_id, prompt_key, display_name, mission_key, output_contract, owner_role)
VALUES (${literal(definition.prompt_definition_id)}, ${literal(definition.prompt_key)}, ${literal(definition.display_name)}, ${literal(definition.mission_key)}, ${literal(definition.output_contract)}, ${literal(definition.owner_role)})
ON CONFLICT (prompt_key) DO NOTHING;`;
}

function insertPromptVersion(definition, version, promptText) {
  return `INSERT INTO prompt_versions (prompt_version_id, prompt_definition_id, semantic_version, status, prompt_text, variables_schema, output_contracts, content_sha256, published_at_utc)
VALUES (${literal(version.prompt_version_id)}, ${literal(definition.prompt_definition_id)}, ${literal(version.semantic_version)}, 'PUBLISHED', ${literal(promptText)}, ${json(version.variables_schema)}, '[]'::jsonb, ${literal(version.content_sha256)}, ${literal(version.published_at_utc)}::timestamptz)
ON CONFLICT (prompt_definition_id, semantic_version) DO NOTHING;`;
}

function insertPromptComposition(composition, version) {
  return `INSERT INTO prompt_compositions (prompt_composition_id, composition_key, status, prompt_version_id, rendered_sha256, environment, metadata, published_at_utc)
VALUES (${literal(composition.prompt_composition_id)}, ${literal(composition.composition_key)}, 'PUBLISHED', ${literal(version.prompt_version_id)}, ${literal(composition.rendered_sha256)}, ${literal(composition.environment)}, ${json({ render_mode: composition.render_mode })}, ${literal(composition.published_at_utc)}::timestamptz)
ON CONFLICT (composition_key) DO NOTHING;`;
}

function insertPromptCompositionItems(composition, version) {
  return (composition.items || []).map((item) => `INSERT INTO prompt_composition_items (prompt_composition_item_id, prompt_composition_id, ordinal, item_kind, prompt_version_id, content_sha256, metadata)
VALUES (${literal(item.prompt_composition_item_id)}, ${literal(composition.prompt_composition_id)}, ${Number(item.ordinal)}, 'PROMPT', ${literal(version.prompt_version_id)}, ${literal(item.content_sha256)}, ${json({ item_key: item.item_key, source_path: item.source_path })})
ON CONFLICT (prompt_composition_id, ordinal) DO NOTHING;`).join("\n");
}

function insertAgentPromptBinding(binding, composition) {
  return `INSERT INTO agent_prompt_bindings (agent_prompt_binding_id, binding_key, agent_role, mission_key, lane, environment, prompt_composition_id, last_known_good_composition_id, deployment_stage, canary_weight_pct, valid_from_utc, active)
VALUES (${literal(binding.agent_prompt_binding_id)}, ${literal(binding.binding_key)}, ${literal(binding.agent_role)}, ${literal(binding.mission_key)}, ${literal(binding.lane)}, ${literal(binding.environment)}, ${literal(composition.prompt_composition_id)}, ${literal(composition.prompt_composition_id)}, ${literal(binding.deployment_stage)}, ${Number(binding.canary_weight_pct || 0)}, ${literal(binding.valid_from_utc)}::timestamptz, true)
ON CONFLICT (binding_key) DO NOTHING;`;
}

function json(value) {
  return `${literal(JSON.stringify(value || {}))}::jsonb`;
}

function literal(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}
