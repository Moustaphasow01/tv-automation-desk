import { canonicalSha256 } from "@tv-automation/desk-domain";

export const SIMULATION_REPRODUCIBILITY_PROOF_SCHEMA_VERSION_V1 = "simulation_reproducibility_proof_v1";

export function buildSimulationReproducibilityProofV1({ baseline, candidate, checked_at_utc = null } = {}) {
  const left = runEntry(baseline);
  const right = runEntry(candidate);
  const reasons = proofReasons(left, right);
  const key = reproducibilityKey(left);
  return Object.freeze({
    schema_version: SIMULATION_REPRODUCIBILITY_PROOF_SCHEMA_VERSION_V1,
    checked_at_utc,
    ok: reasons.length === 0,
    reasons,
    baseline_run_id: left?.simulation_run_id || null,
    candidate_run_id: right?.simulation_run_id || null,
    reproducibility_key: key,
    reproducibility_key_hash: key ? `sha256:${canonicalSha256(key)}` : null,
    metrics_hash_match: hash(left?.metrics_hash) === hash(right?.metrics_hash),
    result_hash_match: hash(left?.result_hash) === hash(right?.result_hash),
    dataset_hash_match: hash(left?.dataset_hash) === hash(right?.dataset_hash),
    engine_version_match: text(left?.simulation_engine_version) === text(right?.simulation_engine_version),
  });
}

export function reproducibilityKey(run) {
  const entry = runEntry(run);
  if (!entry) return null;
  return {
    strategy_version_id: text(entry.strategy_version_id),
    dataset_id: text(entry.dataset_id),
    parameters_hash: hash(entry.parameters_hash),
    reproducibility_seed: text(entry.reproducibility_seed),
  };
}

function proofReasons(left, right) {
  const reasons = [];
  if (!left) reasons.push("BASELINE_RUN_REQUIRED");
  if (!right) reasons.push("CANDIDATE_RUN_REQUIRED");
  if (reasons.length) return reasons;
  if (!sameJson(reproducibilityKey(left), reproducibilityKey(right))) reasons.push("REPRODUCIBILITY_KEY_MISMATCH");
  if (hash(left.dataset_hash) !== hash(right.dataset_hash)) reasons.push("DATASET_HASH_MISMATCH");
  if (text(left.simulation_engine_version) !== text(right.simulation_engine_version)) reasons.push("ENGINE_VERSION_MISMATCH");
  if (hash(left.metrics_hash) !== hash(right.metrics_hash)) reasons.push("METRICS_HASH_MISMATCH");
  if (hash(left.result_hash) !== hash(right.result_hash)) reasons.push("RESULT_HASH_MISMATCH");
  return reasons;
}

function runEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value.run && typeof value.run === "object" ? value.run : value;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hash(value) {
  const normalized = text(value);
  return /^sha256:[a-f0-9]{64}$/.test(normalized || "") ? normalized : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
