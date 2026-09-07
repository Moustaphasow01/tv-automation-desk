import { canonicalSha256, resolveTheoreticalTradeAdministrativeReviewV1 } from "@tv-automation/desk-domain";

export const THEORETICAL_TRADE_ADMINISTRATIVE_RESOLUTION_MODES = Object.freeze({
  DRY_RUN: "DRY_RUN", APPLY: "APPLY",
});
const MANIFEST_SCHEMA = "theoretical_trade_administrative_resolution_manifest_v1";
const MANIFEST_ID = "theoretical-trade-administrative-resolution-20260908";
const EXACT_TRADE_ID = "trade_portfolio_order_intent_a056d3b3696a71192b2a6484";
const EXACT_INTENT_ID = "portfolio_order_intent_a056d3b3696a71192b2a6484";
const APPROVED_MANIFEST_HASH = "782f1722ae8b7d82061586f6f927d00ebff27a44cc61d60764a12fd2234240d0";

export async function resolveTheoreticalTradeAdministrativeReview(command, dependencies) {
  const normalized = normalizeCommand(command);
  validateManifest(normalized.manifest);
  const manifestHash = canonicalSha256(normalized.manifest);
  const attestationHash = canonicalSha256(normalized.operatorAttestation);
  return dependencies.repository.execute({ mode: normalized.mode, batchId: normalized.manifest.manifest_id },
    async (transaction) => {
      const specification = normalized.manifest.resolutions[0];
      const applied = await transaction.findApplied(specification.idempotency_key);
      if (applied) return summary(normalized, manifestHash,
        verifyApplied(applied, normalized, specification, manifestHash, attestationHash));
      const candidate = await transaction.loadCandidate(specification);
      if (!candidate) fail("THEORETICAL_ADMIN_RESOLUTION_CANDIDATE_NOT_FOUND", specification.trade_id);
      const decision = resolveTheoreticalTradeAdministrativeReviewV1({
        trade_id: specification.trade_id,
        portfolio_order_intent_id: specification.portfolio_order_intent_id,
        trade: candidateTrade(candidate),
        expectation: { status: specification.expected_trade_status,
          revision: specification.expected_trade_revision,
          quantity_open: specification.expected_quantity_open },
        execution_evidence: candidate,
        operator_attestation: normalized.operatorAttestation,
        effective_at_utc: normalized.effectiveAtUtc,
      });
      if (candidate.current_lineage_payload_hash !== specification.expected_lineage_payload_hash) {
        fail("THEORETICAL_ADMIN_RESOLUTION_LINEAGE_HASH_MISMATCH", specification.trade_id);
      }
      const resolved = normalized.mode === "DRY_RUN"
        ? item("WOULD_APPEND", specification, candidate, decision)
        : item("RESOLVED", specification, await transaction.appendResolution({ specification, candidate,
          decision, manifestHash, attestationHash, command: normalized }), decision);
      return summary(normalized, manifestHash, resolved);
    });
}

function candidateTrade(candidate) {
  return { trade_id: candidate.trade_id,
    portfolio_order_intent_id: candidate.portfolio_order_intent_id,
    revision: Number(candidate.current_trade_revision), status: candidate.current_trade_status,
    quantity_open: Number(candidate.current_quantity_open), source: candidate.trade_source,
    theoretical_review_required: candidate.theoretical_review_required === true,
    created_at: candidate.trade_created_at };
}

function verifyApplied(applied, command, specification, manifestHash, attestationHash) {
  const exact = [
    [applied.trade_id, specification.trade_id],
    [applied.portfolio_order_intent_id, specification.portfolio_order_intent_id],
    [Number(applied.expected_trade_revision), specification.expected_trade_revision],
    [applied.expected_trade_status, specification.expected_trade_status],
    [Number(applied.expected_quantity_open), specification.expected_quantity_open],
    [applied.expected_lineage_payload_hash, specification.expected_lineage_payload_hash],
    [applied.status, "ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE"],
    [applied.exposure_disposition, "ADMINISTRATIVELY_RELEASED"],
    [applied.historical_outcome_disposition, "UNDETERMINED_PRESERVED"],
    [new Date(applied.effective_at_utc).toISOString(), command.effectiveAtUtc],
    [applied.resolved_by, command.actor], [applied.resolution_reason, command.reason],
    [applied.operator_attestation_hash, attestationHash],
    [canonicalSha256(applied.operator_attestation), attestationHash],
    [applied.manifest_hash, manifestHash],
  ];
  if (exact.some(([actual, expected]) => actual !== expected)) {
    fail("THEORETICAL_ADMIN_RESOLUTION_IDEMPOTENCY_MISMATCH", specification.trade_id);
  }
  return item("ALREADY_APPLIED", specification, applied);
}

function item(status, specification, value, decision = null) {
  return { status, trade_id: specification.trade_id,
    portfolio_order_intent_id: specification.portfolio_order_intent_id,
    resolution_status: decision?.status || value.status,
    exposure_disposition: decision?.exposure_disposition || value.exposure_disposition,
    historical_outcome_disposition: decision?.historical_outcome_disposition
      || value.historical_outcome_disposition,
    effective_at_utc: decision?.effective_at_utc || new Date(value.effective_at_utc).toISOString() };
}

function summary(command, manifestHash, resolved) {
  return { ok: true, status: command.mode === "APPLY" ? "APPLIED" : "DRY_RUN_VERIFIED",
    mode: command.mode, manifest_id: command.manifest.manifest_id, manifest_hash: manifestHash,
    effective_at_utc: command.effectiveAtUtc, item_count: 1,
    replayed_count: resolved.status === "ALREADY_APPLIED" ? 1 : 0,
    exposure_effect: "ADMINISTRATIVELY_RELEASED_AS_OF_EFFECTIVE_AND_KNOWN_AT",
    historical_outcome_effect: "UNDETERMINED_PRESERVED", market_execution_effect: "NONE",
    items: [resolved] };
}

function normalizeCommand(command = {}) {
  const mode = String(command.mode || "DRY_RUN").toUpperCase().replace("-", "_");
  if (!Object.values(THEORETICAL_TRADE_ADMINISTRATIVE_RESOLUTION_MODES).includes(mode)) {
    fail("THEORETICAL_ADMIN_RESOLUTION_MODE_INVALID");
  }
  const effectiveAtUtc = iso(command.effective_at_utc);
  const actor = text(command.actor);
  const reason = text(command.reason);
  if (!effectiveAtUtc || !actor || !reason || !command.operator_attestation) {
    fail("THEORETICAL_ADMIN_RESOLUTION_AUDIT_REQUIRED");
  }
  return { mode, manifest: command.manifest, effectiveAtUtc, actor, reason,
    operatorAttestation: command.operator_attestation };
}

function validateManifest(manifest) {
  validateManifestEnvelope(manifest);
  validateResolutionSpecification(manifest.resolutions[0]);
  if (canonicalSha256(manifest) !== APPROVED_MANIFEST_HASH) {
    fail("THEORETICAL_ADMIN_RESOLUTION_MANIFEST_HASH_MISMATCH");
  }
}

function validateManifestEnvelope(manifest) {
  if (!manifest) fail("THEORETICAL_ADMIN_RESOLUTION_MANIFEST_INVALID");
  if (manifest.schema_version !== MANIFEST_SCHEMA) fail("THEORETICAL_ADMIN_RESOLUTION_MANIFEST_INVALID");
  if (manifest.manifest_id !== MANIFEST_ID) fail("THEORETICAL_ADMIN_RESOLUTION_MANIFEST_INVALID");
  if (text(manifest.scope) === "") fail("THEORETICAL_ADMIN_RESOLUTION_MANIFEST_INVALID");
  if (!Array.isArray(manifest.resolutions)) fail("THEORETICAL_ADMIN_RESOLUTION_MANIFEST_INVALID");
  if (manifest.resolutions.length !== 1) fail("THEORETICAL_ADMIN_RESOLUTION_MANIFEST_INVALID");
  const allowedManifestFields = new Set(["schema_version", "manifest_id", "scope", "resolutions"]);
  if (Object.keys(manifest).some((field) => !allowedManifestFields.has(field))) {
    fail("THEORETICAL_ADMIN_RESOLUTION_MANIFEST_INVALID");
  }
}

function validateResolutionSpecification(specification) {
  const allowed = new Set(["idempotency_key", "trade_id", "portfolio_order_intent_id",
    "expected_trade_revision", "expected_trade_status", "expected_quantity_open",
    "expected_lineage_payload_hash"]);
  const expectedKey = `theoretical-trade-administrative-resolution-20260908.${EXACT_TRADE_ID.slice(-24)}`;
  if (!specification) fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (Object.keys(specification).length !== allowed.size) fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (Object.keys(specification).some((field) => !allowed.has(field))) fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (specification.trade_id !== EXACT_TRADE_ID) fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (specification.portfolio_order_intent_id !== EXACT_INTENT_ID) fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (specification.idempotency_key !== expectedKey) fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (specification.expected_trade_revision !== 0) fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (specification.expected_trade_status !== "open") fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (specification.expected_quantity_open !== 2) fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  if (!/^sha256:[a-f0-9]{64}$/.test(String(specification.expected_lineage_payload_hash || ""))) {
    fail("THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH");
  }
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function text(value) { return String(value || "").trim(); }
function fail(code, id = null) {
  const error = new Error(id ? `${code}:${id}` : code);
  error.code = code;
  throw error;
}
