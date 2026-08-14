import { canonicalSha256 } from "./execution-scope.js";

export const PROMPT_BINDING_POLICY_VERSION_V1 = "1.0.0";
export const PROMPT_BINDING_RESOLUTION_SCHEMA_VERSION_V1 = "prompt_binding_resolution_v1";
export const PROMPT_DEPLOYMENT_STAGES_V1 = Object.freeze(["SHADOW", "CANARY", "ACTIVE", "ROLLED_BACK", "REVOKED"]);
export const PROMPT_RUNTIME_COMPOSITION_STATUSES_V1 = Object.freeze(["PUBLISHED"]);

export function resolveAgentPromptBindingV1(input = {}) {
  const bindings = matchingBindings(input.bindings, input);
  if (bindings.length !== 1) return failResolution(bindings.length ? "PROMPT_BINDING_AMBIGUOUS" : "PROMPT_BINDING_NOT_FOUND");
  const binding = bindings[0];
  const compositions = compositionMap(input.compositions);
  const selected = selectComposition(binding, compositions, input);
  if (!selected.ok) return failResolution(selected.reason, binding);
  return {
    ok: true,
    reasons: [],
    resolution: sealResolution({
      schema_version: PROMPT_BINDING_RESOLUTION_SCHEMA_VERSION_V1,
      binding_id: text(binding.agent_prompt_binding_id || binding.binding_id),
      binding_key: text(binding.binding_key),
      agent_role: text(binding.agent_role),
      mission_key: text(binding.mission_key),
      lane: text(binding.lane),
      environment: text(binding.environment),
      deployment_stage: stage(binding.deployment_stage),
      prompt_composition_id: selected.composition.prompt_composition_id,
      composition_key: selected.composition.composition_key,
      prompt_version_id: selected.composition.prompt_version_id,
      rendered_sha256: selected.composition.rendered_sha256,
      selection_mode: selected.selection_mode,
      canary_bucket: selected.canary_bucket,
      exact_version_pinned: true,
      resolved_at_utc: text(input.resolved_at_utc),
    }),
  };
}

export function buildPromptRollbackDecisionV1(input = {}) {
  const binding = objectOrEmpty(input.binding);
  const lastKnownGood = text(binding.last_known_good_composition_id);
  if (!lastKnownGood) return { ok: false, reasons: ["LAST_KNOWN_GOOD_REQUIRED"], next_binding: null, audit_event: null };
  const nextBinding = {
    ...binding,
    prompt_composition_id: lastKnownGood,
    deployment_stage: "ROLLED_BACK",
    canary_weight_pct: 0,
    active: true,
  };
  return {
    ok: true,
    reasons: [],
    next_binding: nextBinding,
    audit_event: {
      event_type: "PROMPT_ROLLBACK",
      target_type: "agent_prompt_binding",
      target_id: text(binding.agent_prompt_binding_id || binding.binding_id),
      actor: text(input.actor) || "system",
      reason: text(input.reason) || "rollback_to_last_known_good",
      previous_hash: `sha256:${canonicalSha256(binding)}`,
      next_hash: `sha256:${canonicalSha256(nextBinding)}`,
      created_at_utc: text(input.created_at_utc),
    },
  };
}

export function validateAgentPromptBindingV1(binding = {}) {
  const value = objectOrEmpty(binding);
  const reasons = [];
  if (!text(value.binding_key)) reasons.push("BINDING_KEY_REQUIRED");
  if (!text(value.agent_role)) reasons.push("AGENT_ROLE_REQUIRED");
  if (!text(value.mission_key)) reasons.push("MISSION_KEY_REQUIRED");
  if (!text(value.lane)) reasons.push("LANE_REQUIRED");
  if (!text(value.environment)) reasons.push("ENVIRONMENT_REQUIRED");
  if (!text(value.prompt_composition_id)) reasons.push("PROMPT_COMPOSITION_REQUIRED");
  if (!PROMPT_DEPLOYMENT_STAGES_V1.includes(stage(value.deployment_stage))) reasons.push("DEPLOYMENT_STAGE_INVALID");
  if (stage(value.deployment_stage) === "CANARY" && !text(value.last_known_good_composition_id)) reasons.push("CANARY_LAST_KNOWN_GOOD_REQUIRED");
  return { ok: reasons.length === 0, reasons };
}

function matchingBindings(bindings = [], input = {}) {
  return (Array.isArray(bindings) ? bindings : [])
    .filter((binding) => binding.active !== false)
    .filter((binding) => equals(binding.agent_role, input.agent_role))
    .filter((binding) => equals(binding.mission_key, input.mission_key))
    .filter((binding) => equals(binding.lane, input.lane))
    .filter((binding) => equals(binding.environment, input.environment))
    .filter((binding) => isWithinValidity(binding, input.resolved_at_utc));
}

function selectComposition(binding, compositions, input) {
  const validation = validateAgentPromptBindingV1(binding);
  if (!validation.ok) return { ok: false, reason: validation.reasons[0] };
  if (stage(binding.deployment_stage) === "REVOKED") return { ok: false, reason: "PROMPT_BINDING_REVOKED" };
  if (stage(binding.deployment_stage) === "CANARY") return selectCanaryComposition(binding, compositions, input);
  return selectPublishedComposition(text(binding.prompt_composition_id), compositions, "PRIMARY");
}

function selectCanaryComposition(binding, compositions, input) {
  const bucket = canaryBucket(input.canary_seed || input.worker_id || input.mission_key || binding.binding_key);
  const threshold = Number(binding.canary_weight_pct || 0);
  if (bucket < threshold) return selectPublishedComposition(text(binding.prompt_composition_id), compositions, "CANARY", bucket);
  return selectPublishedComposition(text(binding.last_known_good_composition_id), compositions, "LAST_KNOWN_GOOD", bucket);
}

function selectPublishedComposition(id, compositions, mode, bucket = null) {
  const composition = compositions.get(id);
  if (!composition) return { ok: false, reason: "PROMPT_COMPOSITION_NOT_FOUND" };
  if (!PROMPT_RUNTIME_COMPOSITION_STATUSES_V1.includes(status(composition.status))) return { ok: false, reason: "PROMPT_COMPOSITION_NOT_PUBLISHED" };
  if (!hash(composition.rendered_sha256)) return { ok: false, reason: "PROMPT_COMPOSITION_RENDER_HASH_REQUIRED" };
  return { ok: true, composition, selection_mode: mode, canary_bucket: bucket };
}

function sealResolution(resolution) {
  return {
    ...resolution,
    resolution_hash: `sha256:${canonicalSha256(resolution)}`,
  };
}

function compositionMap(compositions = []) {
  return new Map((Array.isArray(compositions) ? compositions : []).map((composition) => [
    text(composition.prompt_composition_id || composition.composition_id),
    {
      prompt_composition_id: text(composition.prompt_composition_id || composition.composition_id),
      composition_key: text(composition.composition_key),
      prompt_version_id: text(composition.prompt_version_id),
      rendered_sha256: text(composition.rendered_sha256),
      status: status(composition.status),
    },
  ]));
}

function isWithinValidity(binding, nowValue) {
  const now = Date.parse(nowValue || "1970-01-01T00:00:00.000Z");
  const from = Date.parse(binding.valid_from_utc || "1970-01-01T00:00:00.000Z");
  const until = Date.parse(binding.valid_until_utc || "9999-12-31T00:00:00.000Z");
  return Number.isFinite(now) && now >= from && now < until;
}

function canaryBucket(seed) {
  return Number.parseInt(canonicalSha256(String(seed || "default")).slice(0, 8), 16) % 100;
}

function failResolution(reason, binding = null) {
  return {
    ok: false,
    reasons: [reason],
    resolution: null,
    binding_key: text(binding?.binding_key),
  };
}

function equals(left, right) {
  return text(left) === text(right);
}

function stage(value) {
  return String(value || "SHADOW").toUpperCase();
}

function status(value) {
  return String(value || "").toUpperCase();
}

function hash(value) {
  return /^sha256:[a-f0-9]{64}$/.test(text(value) || "");
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
