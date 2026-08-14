import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inventoryFile = "config/prompt-registry/runtime-prompt-inventory.v1.json";
const seedFile = "config/prompt-registry/live-replay-2.4.0-seed.v1.json";

export async function buildPromptRegistryOverview({ root = repoRoot, nowUtc = null } = {}) {
  const [inventory, seed] = await Promise.all([
    readJson(root, inventoryFile),
    readJson(root, seedFile),
  ]);
  const inventoryByKey = new Map((inventory.active_runtime_prompts || []).map((entry) => [entry.prompt_key, entry]));
  const items = await Promise.all((seed.entries || []).map((entry) => projectPromptEntry(root, entry, inventoryByKey)));
  return {
    contract: "DeskPromptRegistryOverviewV1",
    schemaVersion: "1.0.0",
    generatedAt: nowUtc,
    summary: summarize(items, inventory),
    items,
    dynamicPrompts: inventory.dynamic_runtime_prompts || [],
    source: sourceDescriptor(seed),
  };
}

async function projectPromptEntry(root, seedEntry, inventoryByKey) {
  const definition = seedEntry.prompt_definition || {};
  const version = seedEntry.prompt_version || {};
  const composition = seedEntry.composition || {};
  const inventoryEntry = inventoryByKey.get(definition.prompt_key) || {};
  const source = await sourceHash(root, version.source_path);
  const parityStatus = source.hash === version.content_sha256 && source.hash === composition.rendered_sha256 ? "OK" : "DRIFT";
  return {
    promptKey: definition.prompt_key,
    lane: seedEntry.lane,
    runtimeStack: seedEntry.runtime_stack,
    missionKey: definition.mission_key,
    semanticVersion: version.semantic_version,
    promptVersionId: version.prompt_version_id,
    compositionId: composition.prompt_composition_id,
    compositionKey: composition.composition_key,
    binding: seedEntry.binding || null,
    status: composition.status,
    deploymentStage: seedEntry.binding?.deployment_stage || "UNKNOWN",
    sourcePath: version.source_path,
    sourceBytes: source.bytes,
    contentSha256: version.content_sha256,
    renderedSha256: composition.rendered_sha256,
    actualSourceSha256: source.hash,
    parityStatus,
    consumers: inventoryEntry.consumer_paths || [],
    contracts: inventoryEntry.contracts || [],
    evaluation: evaluationProjection(parityStatus),
    rollback: {
      lastKnownGoodCompositionId: composition.prompt_composition_id,
      canRollback: Boolean(composition.prompt_composition_id),
    },
  };
}

function summarize(items, inventory) {
  return {
    activePrompts: (inventory.active_runtime_prompts || []).length,
    publishedCompositions: items.filter((item) => item.status === "PUBLISHED").length,
    activeBindings: items.filter((item) => item.deploymentStage === "ACTIVE").length,
    parityOk: items.filter((item) => item.parityStatus === "OK").length,
    parityDrift: items.filter((item) => item.parityStatus !== "OK").length,
    dynamicPromptsToReplace: dynamicReplacementCount(inventory),
  };
}

function sourceDescriptor(seed) {
  return {
    registry: "git_seed_pending_postgres_hydration",
    inventoryPath: inventoryFile,
    seedPath: seedFile,
    parityMode: seed.parity_mode,
    writeApiEnabled: false,
    writeApiReason: "TD2-PRM-008 permissions/audit gate required before operator mutations",
  };
}

function evaluationProjection(parityStatus) {
  return {
    status: parityStatus === "OK" ? "PENDING_BASELINE_RUN" : "BLOCKED_BY_PARITY",
    qualityScore: null,
    costUsd: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    reason: "TD2-PRM-006 policy available; persisted evaluation records arrive with the agents service.",
  };
}

function dynamicReplacementCount(inventory) {
  return (inventory.dynamic_runtime_prompts || []).filter((entry) => entry.must_be_replaced_by_registry).length;
}

async function sourceHash(root, relativePath) {
  try {
    const content = await readFile(path.join(root, relativePath));
    return {
      hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      bytes: content.byteLength,
    };
  } catch {
    return { hash: null, bytes: null };
  }
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}
