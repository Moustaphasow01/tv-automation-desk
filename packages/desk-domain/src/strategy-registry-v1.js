import { createHash } from "node:crypto";
import { canonicalJson, canonicalSha256 } from "./execution-scope.js";
import { DOMAIN_STATUSES } from "./result.js";

export const STRATEGY_REGISTRY_SCHEMA_VERSION_V1 = "strategy_registry_v1";
export const STRATEGY_DEFINITION_SCHEMA_VERSION_V1 = "strategy_definition_v1";
export const STRATEGY_VERSION_SCHEMA_VERSION_V1 = "strategy_version_v1";
export const STRATEGY_INSTANCE_SCHEMA_VERSION_V1 = "strategy_instance_v1";
export const STRATEGY_VERSION_STATUSES_V1 = Object.freeze([
  "DRAFT",
  "IN_SIMULATION",
  "VALIDATED",
  "PUBLISHED",
  "DEPRECATED",
]);
export const STRATEGY_INSTANCE_RUNTIME_STATES_V1 = Object.freeze([
  "CREATED",
  "STARTING",
  "RUNNING",
  "PAUSED",
  "STOPPING",
  "STOPPED",
  "FAILED_TO_START",
  "ERRORED",
]);

export const STRATEGY_INSTANCE_EXECUTION_MODES_V1 = Object.freeze([
  "SHADOW",
  "PAPER",
  "LIVE",
]);

export const STRATEGY_VERSION_TRANSITIONS_V1 = Object.freeze({
  DRAFT: Object.freeze(["DRAFT", "IN_SIMULATION"]),
  IN_SIMULATION: Object.freeze(["IN_SIMULATION", "DRAFT", "VALIDATED"]),
  VALIDATED: Object.freeze(["VALIDATED", "PUBLISHED"]),
  PUBLISHED: Object.freeze(["PUBLISHED", "DEPRECATED"]),
  DEPRECATED: Object.freeze(["DEPRECATED"]),
});

export const STRATEGY_INSTANCE_RUNTIME_TRANSITIONS_V1 = Object.freeze({
  CREATED: Object.freeze(["CREATED", "STARTING"]),
  STARTING: Object.freeze(["STARTING", "RUNNING", "FAILED_TO_START"]),
  RUNNING: Object.freeze(["RUNNING", "PAUSED", "STOPPING", "ERRORED"]),
  PAUSED: Object.freeze(["PAUSED", "RUNNING", "STOPPING"]),
  STOPPING: Object.freeze(["STOPPING", "STOPPED"]),
  STOPPED: Object.freeze(["STOPPED"]),
  FAILED_TO_START: Object.freeze(["FAILED_TO_START"]),
  ERRORED: Object.freeze(["ERRORED", "STOPPING"]),
});

export const STRATEGY_INSTANCE_EXECUTION_MODE_TRANSITIONS_V1 = Object.freeze({
  SHADOW: Object.freeze(["SHADOW", "PAPER"]),
  PAPER: Object.freeze(["PAPER", "SHADOW", "LIVE"]),
  LIVE: Object.freeze(["LIVE", "PAPER"]),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const EXTERNAL_KEY_RE = /^[a-z0-9][a-z0-9_.:-]{1,126}[a-z0-9]$/;

const VERSION_IMMUTABLE_FIELDS = Object.freeze([
  "strategy_version_id",
  "strategy_definition_id",
  "version_label",
  "dsl_source_hash",
  "compiled_artifact_ref",
  "compiled_artifact_hash",
  "validated_metrics_ref",
  "runtime_contract_bundle_version",
  "metadata",
]);

export function validateStrategyDefinitionV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: STRATEGY_DEFINITION_SCHEMA_VERSION_V1,
    strategy_definition_id: requiredUuid(entity.strategy_definition_id ?? entity.id, "strategy_definition_id", issues),
    external_key: optionalText(entity.external_key),
    name: requiredText(entity.name, "name", issues),
    description: nullableText(entity.description),
    owner: requiredText(entity.owner, "owner", issues),
    asset_class: normalizeUpperText(entity.asset_class, "asset_class", issues, { optional: true }),
    default_instruments: normalizeStringArray(entity.default_instruments, {
      path: "default_instruments",
      transform: (value) => value.toUpperCase(),
    }),
    tags: normalizeStringArray(entity.tags, {
      path: "tags",
      transform: (value) => value.toLowerCase(),
    }),
    metadata: normalizedMetadata(entity.metadata),
    created_at: requiredTimestamp(entity.created_at, "created_at", issues),
    updated_at: optionalTimestamp(entity.updated_at, "updated_at", issues),
  };
  if (normalized.external_key && !EXTERNAL_KEY_RE.test(normalized.external_key)) {
    issues.push(issue("STRATEGY_DEFINITION_EXTERNAL_KEY_INVALID", "external_key", {
      value: normalized.external_key,
    }));
  }
  if (normalized.updated_at && normalized.created_at
    && Date.parse(normalized.updated_at) < Date.parse(normalized.created_at)) {
    issues.push(issue("STRATEGY_DEFINITION_UPDATED_BEFORE_CREATED", "updated_at", {
      created_at: normalized.created_at,
      updated_at: normalized.updated_at,
    }));
  }
  return validationResult("strategy_definition", normalized, issues);
}

export function validateStrategyVersionV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const dslSource = typeof entity.dsl_source === "string" ? entity.dsl_source : null;
  const compiledArtifact = objectOrNull(entity.compiled_artifact);
  const normalized = {
    schema_version: STRATEGY_VERSION_SCHEMA_VERSION_V1,
    strategy_version_id: requiredUuid(entity.strategy_version_id ?? entity.id, "strategy_version_id", issues),
    strategy_definition_id: requiredUuid(entity.strategy_definition_id, "strategy_definition_id", issues),
    version_label: requiredText(entity.version_label, "version_label", issues),
    status: normalizeEnum(entity.status, STRATEGY_VERSION_STATUSES_V1, "status", issues),
    dsl_source_hash: normalizeHash(entity.dsl_source_hash, "dsl_source_hash", issues, {
      computed: dslSource ? sha256Text(dslSource) : null,
      required: true,
    }),
    compiled_artifact_ref: requiredText(entity.compiled_artifact_ref, "compiled_artifact_ref", issues),
    compiled_artifact_hash: normalizeHash(entity.compiled_artifact_hash, "compiled_artifact_hash", issues, {
      computed: compiledArtifact ? sha256Canonical(compiledArtifact) : null,
      required: false,
    }),
    validated_metrics_ref: nullableUuid(entity.validated_metrics_ref, "validated_metrics_ref", issues),
    runtime_contract_bundle_version: requiredText(
      entity.runtime_contract_bundle_version,
      "runtime_contract_bundle_version",
      issues,
    ),
    metadata: normalizedMetadata(entity.metadata),
    created_at: requiredTimestamp(entity.created_at, "created_at", issues),
    updated_at: optionalTimestamp(entity.updated_at, "updated_at", issues),
    published_at: optionalTimestamp(entity.published_at, "published_at", issues),
    deprecated_at: optionalTimestamp(entity.deprecated_at, "deprecated_at", issues),
  };

  if (normalized.version_label && !SEMVER_RE.test(normalized.version_label)) {
    issues.push(issue("STRATEGY_VERSION_LABEL_INVALID", "version_label", {
      version_label: normalized.version_label,
    }));
  }
  validateStrategyVersionStatusFields(normalized, issues);
  validateChronology([
    ["created_at", normalized.created_at],
    ["updated_at", normalized.updated_at],
    ["published_at", normalized.published_at],
    ["deprecated_at", normalized.deprecated_at],
  ], issues);

  return validationResult("strategy_version", normalized, issues);
}

export function validateStrategyInstanceV1(input = {}, options = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: STRATEGY_INSTANCE_SCHEMA_VERSION_V1,
    strategy_instance_id: requiredUuid(entity.strategy_instance_id ?? entity.id, "strategy_instance_id", issues),
    strategy_version_id: requiredUuid(entity.strategy_version_id, "strategy_version_id", issues),
    runtime_state: normalizeEnum(
      entity.runtime_state,
      STRATEGY_INSTANCE_RUNTIME_STATES_V1,
      "runtime_state",
      issues,
    ),
    execution_mode: normalizeEnum(
      entity.execution_mode,
      STRATEGY_INSTANCE_EXECUTION_MODES_V1,
      "execution_mode",
      issues,
    ),
    account_scope: nullableText(entity.account_scope),
    instrument_scope: normalizeStringArray(entity.instrument_scope, {
      path: "instrument_scope",
      transform: (value) => value.toUpperCase(),
    }),
    session_scope: normalizeStringArray(entity.session_scope, {
      path: "session_scope",
      transform: (value) => value.toLowerCase(),
    }),
    risk_budget_ref: nullableUuid(entity.risk_budget_ref, "risk_budget_ref", issues),
    triple_lock_validated: requiredBoolean(entity.triple_lock_validated, "triple_lock_validated", issues),
    operator_approval_id: nullableText(entity.operator_approval_id),
    metadata: normalizedMetadata(entity.metadata),
    created_at: requiredTimestamp(entity.created_at, "created_at", issues),
    updated_at: optionalTimestamp(entity.updated_at, "updated_at", issues),
    last_heartbeat_at: optionalTimestamp(entity.last_heartbeat_at, "last_heartbeat_at", issues),
    started_at: optionalTimestamp(entity.started_at, "started_at", issues),
    stopped_at: optionalTimestamp(entity.stopped_at, "stopped_at", issues),
    failed_at: optionalTimestamp(entity.failed_at, "failed_at", issues),
  };

  validateStrategyInstanceCrossFields(normalized, options, issues);
  validateTimestampNotBefore("updated_at", normalized.updated_at, "created_at", normalized.created_at, issues);
  validateTimestampNotBefore("started_at", normalized.started_at, "created_at", normalized.created_at, issues);
  validateTimestampNotBefore(
    "last_heartbeat_at",
    normalized.last_heartbeat_at,
    "started_at",
    normalized.started_at,
    issues,
  );
  validateTimestampNotBefore("stopped_at", normalized.stopped_at, "started_at", normalized.started_at, issues);
  validateTimestampNotBefore("failed_at", normalized.failed_at, "started_at", normalized.started_at, issues);

  return validationResult("strategy_instance", normalized, issues);
}

export function validateStrategyVersionTransitionV1(previousInput = {}, nextInput = {}) {
  const previous = validateStrategyVersionV1(previousInput);
  const next = validateStrategyVersionV1(nextInput);
  const issues = [...previous.issues, ...next.issues];
  if (previous.ok && next.ok) {
    validateTransition(
      previous.normalized.status,
      next.normalized.status,
      STRATEGY_VERSION_TRANSITIONS_V1,
      "STRATEGY_VERSION_TRANSITION_FORBIDDEN",
      "status",
      issues,
    );
    if (["PUBLISHED", "DEPRECATED"].includes(previous.normalized.status)) {
      for (const field of VERSION_IMMUTABLE_FIELDS) {
        if (canonicalJson(previous.normalized[field]) !== canonicalJson(next.normalized[field])) {
          issues.push(issue("STRATEGY_VERSION_IMMUTABLE", field, {
            previous: previous.normalized[field] ?? null,
            next: next.normalized[field] ?? null,
          }, { problem_code: "DESK_CONFLICT" }));
        }
      }
    }
  }
  return validationResult("strategy_version_transition", {
    previous_status: previous.normalized?.status ?? null,
    next_status: next.normalized?.status ?? null,
  }, issues);
}

export function validateStrategyInstanceTransitionV1(previousInput = {}, nextInput = {}, options = {}) {
  const previous = validateStrategyInstanceV1(previousInput, options);
  const next = validateStrategyInstanceV1(nextInput, options);
  const issues = [...previous.issues, ...next.issues];
  if (previous.ok && next.ok) {
    validateTransition(
      previous.normalized.runtime_state,
      next.normalized.runtime_state,
      STRATEGY_INSTANCE_RUNTIME_TRANSITIONS_V1,
      "STRATEGY_INSTANCE_RUNTIME_TRANSITION_FORBIDDEN",
      "runtime_state",
      issues,
    );
    validateTransition(
      previous.normalized.execution_mode,
      next.normalized.execution_mode,
      STRATEGY_INSTANCE_EXECUTION_MODE_TRANSITIONS_V1,
      "STRATEGY_INSTANCE_EXECUTION_MODE_TRANSITION_FORBIDDEN",
      "execution_mode",
      issues,
    );
    if (previous.normalized.execution_mode === "PAPER"
      && next.normalized.execution_mode === "LIVE"
      && !next.normalized.operator_approval_id) {
      issues.push(issue("STRATEGY_INSTANCE_LIVE_OPERATOR_APPROVAL_REQUIRED", "operator_approval_id", { previous_mode: previous.normalized.execution_mode, next_mode: next.normalized.execution_mode }, { problem_code: "DESK_OPERATOR_ACTION_REQUIRED" }));
    }
    if (previous.normalized.execution_mode === "SHADOW"
      && next.normalized.execution_mode === "PAPER"
      && !next.normalized.operator_approval_id) {
      issues.push(issue("STRATEGY_INSTANCE_PAPER_OPERATOR_APPROVAL_REQUIRED", "operator_approval_id", { previous_mode: previous.normalized.execution_mode, next_mode: next.normalized.execution_mode }, { problem_code: "DESK_OPERATOR_ACTION_REQUIRED" }));
    }
  }
  return validationResult("strategy_instance_transition", {
    previous_runtime_state: previous.normalized?.runtime_state ?? null,
    next_runtime_state: next.normalized?.runtime_state ?? null,
    previous_execution_mode: previous.normalized?.execution_mode ?? null,
    next_execution_mode: next.normalized?.execution_mode ?? null,
  }, issues);
}

export function strategyDefinitionHashV1(input = {}) {
  return validationContentHash(validateStrategyDefinitionV1(input));
}

export function strategyVersionHashV1(input = {}) {
  return validationContentHash(validateStrategyVersionV1(input));
}

export function strategyInstanceHashV1(input = {}) {
  return validationContentHash(validateStrategyInstanceV1(input));
}

function validateStrategyVersionStatusFields(version, issues) {
  if (["VALIDATED", "PUBLISHED", "DEPRECATED"].includes(version.status) && !version.validated_metrics_ref) {
    issues.push(issue("STRATEGY_VERSION_VALIDATED_METRICS_REQUIRED", "validated_metrics_ref", {
      status: version.status,
    }));
  }
  if (["PUBLISHED", "DEPRECATED"].includes(version.status) && !version.published_at) {
    issues.push(issue("STRATEGY_VERSION_PUBLISHED_AT_REQUIRED", "published_at", {
      status: version.status,
    }));
  }
  if (version.status === "DEPRECATED" && !version.deprecated_at) {
    issues.push(issue("STRATEGY_VERSION_DEPRECATED_AT_REQUIRED", "deprecated_at"));
  }
  if (["DRAFT", "IN_SIMULATION"].includes(version.status) && version.published_at) {
    issues.push(issue("STRATEGY_VERSION_PUBLISHED_AT_FORBIDDEN", "published_at", {
      status: version.status,
    }));
  }
  if (version.status !== "DEPRECATED" && version.deprecated_at) {
    issues.push(issue("STRATEGY_VERSION_DEPRECATED_AT_FORBIDDEN", "deprecated_at", {
      status: version.status,
    }));
  }
}

function validateStrategyInstanceCrossFields(instance, options, issues) {
  if (["PAPER", "LIVE"].includes(instance.execution_mode) && !instance.account_scope) {
    issues.push(issue("STRATEGY_INSTANCE_ACCOUNT_SCOPE_REQUIRED", "account_scope", {
      execution_mode: instance.execution_mode,
    }));
  }
  if (options.liveAccountConflict === true
    && instance.execution_mode === "LIVE"
    && instance.triple_lock_validated !== true) {
    issues.push(issue("STRATEGY_INSTANCE_TRIPLE_LOCK_REQUIRED", "triple_lock_validated", {
      execution_mode: instance.execution_mode,
      account_scope: instance.account_scope ?? null,
    }, { problem_code: "DESK_OPERATOR_ACTION_REQUIRED" }));
  }
  if (["STARTING", "RUNNING", "PAUSED"].includes(instance.runtime_state) && !instance.last_heartbeat_at) {
    issues.push(issue("STRATEGY_INSTANCE_HEARTBEAT_REQUIRED", "last_heartbeat_at", {
      runtime_state: instance.runtime_state,
    }));
  }
  if (instance.runtime_state === "STOPPED" && !instance.stopped_at) {
    issues.push(issue("STRATEGY_INSTANCE_STOPPED_AT_REQUIRED", "stopped_at"));
  }
  if (["FAILED_TO_START", "ERRORED"].includes(instance.runtime_state) && !instance.failed_at) {
    issues.push(issue("STRATEGY_INSTANCE_FAILED_AT_REQUIRED", "failed_at", {
      runtime_state: instance.runtime_state,
    }));
  }
  if (instance.stopped_at && instance.runtime_state !== "STOPPED") {
    issues.push(issue("STRATEGY_INSTANCE_STOPPED_AT_FORBIDDEN", "stopped_at", {
      runtime_state: instance.runtime_state,
    }));
  }
  if (instance.failed_at && !["FAILED_TO_START", "ERRORED"].includes(instance.runtime_state)) {
    issues.push(issue("STRATEGY_INSTANCE_FAILED_AT_FORBIDDEN", "failed_at", {
      runtime_state: instance.runtime_state,
    }));
  }
}

function validateTransition(previous, next, matrix, code, path, issues) {
  const allowed = matrix[previous] || [];
  if (!allowed.includes(next)) {
    issues.push(issue(code, path, { previous, next, allowed }, { problem_code: "DESK_CONFLICT" }));
  }
}

function validationResult(entity, normalized, issues) {
  const cleanIssues = dedupeIssues(issues);
  const status = cleanIssues.length > 0 ? DOMAIN_STATUSES.REJECTED : DOMAIN_STATUSES.ACCEPTED;
  return Object.freeze({
    ok: cleanIssues.length === 0,
    status,
    entity,
    schema_version: STRATEGY_REGISTRY_SCHEMA_VERSION_V1,
    reasons: cleanIssues.map((entry) => entry.code),
    flags: cleanIssues.map((entry) => entry.problem_code),
    issues: cleanIssues,
    normalized: stripUndefined(normalized),
    evidence: Object.freeze({
      issue_count: cleanIssues.length,
      content_hash: cleanIssues.length === 0 ? sha256Canonical(stripUndefined(normalized)) : null,
    }),
  });
}

function validationContentHash(result) {
  if (!result.ok) {
    const error = new Error(`strategy_validation_failed:${result.reasons.join(",")}`);
    error.code = "DESK_VALIDATION_FAILED";
    error.details = { reasons: result.reasons };
    throw error;
  }
  return result.evidence.content_hash;
}

function issue(code, path, details = {}, options = {}) {
  return Object.freeze({
    code,
    path,
    message: strategyIssueMessage(code, path),
    problem_code: options.problem_code || "DESK_VALIDATION_FAILED",
    severity: options.severity || "error",
    details: stripUndefined(details),
  });
}

function strategyIssueMessage(code, path) {
  return `${code}${path ? ` at ${path}` : ""}`;
}

function requiredUuid(value, path, issues) {
  const normalized = optionalText(value);
  if (!normalized) {
    issues.push(issue("STRATEGY_FIELD_REQUIRED", path));
    return null;
  }
  if (!UUID_RE.test(normalized)) {
    issues.push(issue("STRATEGY_UUID_INVALID", path, { value: normalized }));
    return normalized;
  }
  return normalized.toLowerCase();
}

function nullableUuid(value, path, issues) {
  const normalized = nullableText(value);
  if (normalized === null) return null;
  if (!UUID_RE.test(normalized)) {
    issues.push(issue("STRATEGY_UUID_INVALID", path, { value: normalized }));
    return normalized;
  }
  return normalized.toLowerCase();
}

function requiredText(value, path, issues) {
  const normalized = optionalText(value);
  if (!normalized) {
    issues.push(issue("STRATEGY_FIELD_REQUIRED", path));
    return "";
  }
  return normalized;
}

function optionalText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nullableText(value) {
  const normalized = optionalText(value);
  return normalized || null;
}

function normalizeUpperText(value, path, issues, options = {}) {
  const normalized = optionalText(value);
  if (!normalized && options.optional === true) return null;
  if (!normalized) {
    issues.push(issue("STRATEGY_FIELD_REQUIRED", path));
    return "";
  }
  return normalized.toUpperCase();
}

function normalizeEnum(value, allowed, path, issues) {
  const normalized = normalizeUpperText(value, path, issues);
  if (normalized && !allowed.includes(normalized)) {
    issues.push(issue("STRATEGY_ENUM_INVALID", path, { value: normalized, allowed }));
  }
  return normalized;
}

function requiredBoolean(value, path, issues) {
  if (typeof value !== "boolean") {
    issues.push(issue("STRATEGY_BOOLEAN_REQUIRED", path, { value }));
    return false;
  }
  return value;
}

function requiredTimestamp(value, path, issues) {
  const normalized = optionalTimestamp(value, path, issues);
  if (!normalized) {
    issues.push(issue("STRATEGY_FIELD_REQUIRED", path));
    return null;
  }
  return normalized;
}

function optionalTimestamp(value, path, issues) {
  const normalized = optionalText(value);
  if (!normalized) return null;
  const millis = Date.parse(normalized);
  if (!Number.isFinite(millis) || !normalized.includes("T")) {
    issues.push(issue("STRATEGY_TIMESTAMP_INVALID", path, { value: normalized }));
    return normalized;
  }
  return new Date(millis).toISOString();
}

function normalizeHash(value, path, issues, options = {}) {
  const normalized = optionalText(value).toLowerCase();
  const computed = options.computed ? String(options.computed).toLowerCase() : null;
  if (!normalized && computed) return computed;
  if (!normalized && options.required === true) {
    issues.push(issue("STRATEGY_HASH_REQUIRED", path));
    return "";
  }
  if (!normalized) return null;
  if (!HASH_RE.test(normalized)) {
    issues.push(issue("STRATEGY_HASH_INVALID", path, { value: normalized }));
  }
  if (computed && normalized !== computed) {
    issues.push(issue("STRATEGY_HASH_MISMATCH", path, { expected: computed, actual: normalized }));
  }
  return normalized;
}

function normalizeStringArray(value, options = {}) {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  const transform = options.transform || ((item) => item);
  return [...new Set(list.map((item) => optionalText(item)).filter(Boolean).map(transform))];
}

function normalizedMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function validateChronology(entries, issues) {
  let previous = null;
  for (const [path, value] of entries) {
    if (!value) continue;
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) continue;
    if (previous && millis < previous.millis) {
      issues.push(issue("STRATEGY_TIMESTAMP_REGRESSION", path, {
        previous_path: previous.path,
        previous_value: previous.value,
        value,
      }));
    }
    previous = { path, value, millis };
  }
}

function validateTimestampNotBefore(path, value, floorPath, floorValue, issues) {
  if (!value || !floorValue) return;
  const millis = Date.parse(value);
  const floorMillis = Date.parse(floorValue);
  if (!Number.isFinite(millis) || !Number.isFinite(floorMillis)) return;
  if (millis < floorMillis) {
    issues.push(issue("STRATEGY_TIMESTAMP_REGRESSION", path, {
      floor_path: floorPath,
      floor_value: floorValue,
      value,
    }));
  }
}

function sha256Text(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256Canonical(value) {
  return `sha256:${canonicalSha256(value)}`;
}

function dedupeIssues(issues) {
  const seen = new Set();
  const result = [];
  for (const entry of issues) {
    const key = canonicalJson([entry.code, entry.path, entry.details]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)]),
  );
}
