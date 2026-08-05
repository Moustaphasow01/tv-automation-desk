import { canonicalSha256 } from "./execution-scope.js";

const CANONICAL_FIELDS = Object.freeze([
  "schema_version",
  "plan_id",
  "compiler_version",
  "disposition",
  "source_reference",
  "analytical_scope",
  "policy",
  "gates",
  "thesis_plan",
  "ranked_setups",
  "no_setup_proof",
  "opportunity_diagnostic",
  "diagnostics",
]);

export function isCanonicalMasterPlanV1(value) {
  return Boolean(
    value
      && typeof value === "object"
      && value.schema_version === "deterministic_execution_plan_v1"
      && Array.isArray(value.ranked_setups),
  );
}

export function acceptCanonicalMasterPlanV1(value, {
  sourceMode = null,
  scope = {},
} = {}) {
  const canonical = Object.fromEntries(
    CANONICAL_FIELDS.map((field) => [field, cloneJsonValue(value[field])]),
  );
  const canonicalHash = canonicalSha256(canonical);
  const diagnostics = canonical.diagnostics && typeof canonical.diagnostics === "object"
    ? canonical.diagnostics
    : { errors: [{ code: "CANONICAL_DIAGNOSTICS_MISSING", evidence: null }], warnings: [], normalizations: [] };
  const suppliedHash = stringOrNull(value.canonical_hash);
  const hashMatches = !suppliedHash || suppliedHash === canonicalHash;
  return {
    ...canonical,
    diagnostics,
    canonical_hash: canonicalHash,
    valid: Array.isArray(diagnostics.errors) && diagnostics.errors.length === 0 && hashMatches,
    transport_context: {
      source_mode: normalizeTransportMode(sourceMode || scope.mode || value.transport_context?.source_mode),
    },
  };
}

export function normalizeTransportMode(value) {
  const normalized = String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (normalized === "BACKTEST") return "REPLAY";
  if (["LIVE", "REPLAY", "BACK_FORWARD", "PAPER"].includes(normalized)) return normalized;
  return null;
}

function cloneJsonValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function stringOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}
