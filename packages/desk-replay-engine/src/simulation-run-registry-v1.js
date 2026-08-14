import { canonicalSha256 } from "@tv-automation/desk-domain";

export const SIMULATION_RUN_REGISTRY_SCHEMA_VERSION_V1 = "simulation_run_registry_entry_v1";
export const SIMULATION_RUN_ARTIFACT_SCHEMA_VERSION_V1 = "simulation_run_artifact_v1";

export const SIMULATION_RUN_STATUSES_V1 = Object.freeze([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "REVIEW_REQUIRED",
]);

export const SIMULATION_RUN_ARTIFACT_KINDS_V1 = Object.freeze([
  "INPUT_MANIFEST",
  "ORDER_SIMULATION_POLICY",
  "RESULT",
  "METRICS",
  "EVENTS",
  "POSITIONS",
  "ROBUSTNESS_REPORT",
  "ERROR",
]);

export function buildSimulationRunRegistrationV1(input = {}) {
  const result = objectOrNull(input.result);
  const issues = validateResultEnvelope(result);
  if (issues.length) return rejectedRegistration(issues, input);
  const run = buildRunEntry(input, result);
  return {
    ok: true,
    reasons: [],
    run,
    artifacts: buildArtifacts(run, result),
  };
}

export function simulationRunRegistryHashV1(run) {
  return `sha256:${canonicalSha256(normalizeHashableRun(run))}`;
}

export function simulationRunArtifactsHashV1(artifacts) {
  return `sha256:${canonicalSha256((Array.isArray(artifacts) ? artifacts : []).map(normalizeHashableArtifact))}`;
}

function validateResultEnvelope(result) {
  const issues = [];
  if (!result) issues.push("SIMULATION_RESULT_REQUIRED");
  if (result && result.schema_version !== "canonical_simulation_result_v1") issues.push("SIMULATION_RESULT_SCHEMA_UNSUPPORTED");
  if (result && !hashOrNull(result.content_hash)) issues.push("SIMULATION_RESULT_HASH_REQUIRED");
  if (result && !hashOrNull(result.metrics_hash)) issues.push("SIMULATION_METRICS_HASH_REQUIRED");
  if (result && !hashOrNull(result.parameters_hash)) issues.push("SIMULATION_PARAMETERS_HASH_REQUIRED");
  if (result && !hashOrNull(result.dataset_hash)) issues.push("SIMULATION_DATASET_HASH_REQUIRED");
  return issues;
}

function rejectedRegistration(reasons, input) {
  return {
    ok: false,
    reasons,
    run: null,
    artifacts: [],
    evidence: {
      supplied_run_id: text(input.simulation_run_id) || text(input.result?.run_id),
      rejected_at_utc: text(input.created_at_utc) || null,
    },
  };
}

function buildRunEntry(input, result) {
  const status = normalizeStatus(input.status || result.status);
  const now = registrationTimestamp(input, result);
  const runId = text(input.simulation_run_id) || deterministicRunUuid(result, input);
  const refs = runArtifactRefs(runId);
  return {
    schema_version: SIMULATION_RUN_REGISTRY_SCHEMA_VERSION_V1,
    simulation_run_id: runId,
    source_run_id: text(result.run_id),
    strategy_version_id: requiredText(input.strategy_version_id || result.strategy_version_id, "strategy_version_id"),
    dataset_id: requiredText(input.dataset_id || result.dataset_id, "dataset_id"),
    parameters_hash: result.parameters_hash,
    reproducibility_seed: text(result.reproducibility_seed) || "default-seed-v1",
    status,
    simulation_engine: text(result.simulation_engine) || "desk-replay-engine",
    simulation_engine_version: text(result.simulation_engine_version) || "unknown",
    result_schema_version: result.schema_version,
    cutoff: text(result.cutoff),
    dataset_hash: result.dataset_hash,
    compiled_artifact_hash: hashOrNull(input.compiled_artifact_hash || result.compiled_artifact_hash),
    result_hash: result.content_hash,
    metrics_hash: result.metrics_hash,
    result_ref: refs.result_ref,
    metrics_ref: refs.metrics_ref,
    started_at_utc: runStartedAt(result, now),
    completed_at_utc: terminalStatus(status) ? (text(input.completed_at_utc) || now) : null,
    failure_code: text(input.failure_code || result.failure_code),
    failure_message: text(input.failure_message || result.failure_message),
    metadata: objectOrEmpty(input.metadata),
    created_at_utc: now,
    updated_at_utc: text(input.updated_at_utc) || now,
  };
}

function registrationTimestamp(input, result) {
  return text(input.created_at_utc) || text(result.run_started_at_utc) || new Date(0).toISOString();
}

function runArtifactRefs(runId) {
  return {
    result_ref: artifactRef(runId, "result"),
    metrics_ref: artifactRef(runId, "metrics"),
  };
}

function runStartedAt(result, fallback) {
  return text(result.run_started_at_utc) || fallback;
}

function buildArtifacts(run, result) {
  const artifacts = [
    artifact(run, "INPUT_MANIFEST", inputManifest(run)),
    artifact(run, "ORDER_SIMULATION_POLICY", objectOrEmpty(result.order_simulation_policy)),
    artifact(run, "RESULT", result, result.content_hash),
    artifact(run, "METRICS", objectOrEmpty(result.metrics), result.metrics_hash),
    artifact(run, "EVENTS", { items: arrayOrEmpty(result.events) }),
    artifact(run, "POSITIONS", { items: arrayOrEmpty(result.positions) }),
  ];
  const robustnessReport = objectOrNull(result.robustness_report);
  if (robustnessReport) artifacts.push(artifact(run, "ROBUSTNESS_REPORT", robustnessReport, robustnessReport.content_hash));
  return artifacts;
}

function artifact(run, kind, payload, suppliedHash = null) {
  const contentHash = hashOrNull(suppliedHash) || `sha256:${canonicalSha256(payload)}`;
  return {
    schema_version: SIMULATION_RUN_ARTIFACT_SCHEMA_VERSION_V1,
    simulation_run_artifact_id: deterministicArtifactId(run.simulation_run_id, kind, contentHash),
    simulation_run_id: run.simulation_run_id,
    artifact_kind: kind,
    content_hash: contentHash,
    storage_ref: artifactRef(run.simulation_run_id, kind.toLowerCase()),
    payload,
    created_at_utc: run.updated_at_utc,
  };
}

function inputManifest(run) {
  return {
    strategy_version_id: run.strategy_version_id,
    dataset_id: run.dataset_id,
    parameters_hash: run.parameters_hash,
    reproducibility_seed: run.reproducibility_seed,
    cutoff: run.cutoff,
    dataset_hash: run.dataset_hash,
    compiled_artifact_hash: run.compiled_artifact_hash,
    simulation_engine_version: run.simulation_engine_version,
  };
}

function deterministicRunUuid(result, input) {
  return uuidFromHash(canonicalSha256({
    source_run_id: result.run_id,
    strategy_version_id: input.strategy_version_id || result.strategy_version_id,
    dataset_id: input.dataset_id || result.dataset_id,
    parameters_hash: result.parameters_hash,
    reproducibility_seed: result.reproducibility_seed,
    result_hash: result.content_hash,
  }));
}

function deterministicArtifactId(runId, kind, contentHash) {
  return uuidFromHash(canonicalSha256({ run_id: runId, artifact_kind: kind, content_hash: contentHash }));
}

function uuidFromHash(hash) {
  const clean = String(hash || "").replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(clean[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-4${clean.slice(13, 16)}-${variant}${clean.slice(17, 20)}-${clean.slice(20, 32)}`;
}

function normalizeStatus(value) {
  const status = String(value || "FAILED").toUpperCase();
  return SIMULATION_RUN_STATUSES_V1.includes(status) ? status : "FAILED";
}

function terminalStatus(status) {
  return ["COMPLETED", "FAILED", "CANCELLED", "REJECTED", "REVIEW_REQUIRED"].includes(status);
}

function artifactRef(runId, name) {
  return `artifact://simulation-runs/${runId}/${name}`;
}

function normalizeHashableRun(run) {
  const { created_at_utc, updated_at_utc, ...hashable } = objectOrEmpty(run);
  return hashable;
}

function normalizeHashableArtifact(artifactValue) {
  const { created_at_utc, ...hashable } = objectOrEmpty(artifactValue);
  return hashable;
}

function requiredText(value, field) {
  const normalized = text(value);
  if (normalized) return normalized;
  throw new TypeError(`${field} is required for Simulation Run registration.`);
}

function hashOrNull(value) {
  const normalized = text(value);
  return /^sha256:[a-f0-9]{64}$/.test(normalized || "") ? normalized : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function objectOrEmpty(value) {
  return objectOrNull(value) || {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}
