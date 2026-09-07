import {
  adjudicateInvalidOriginReservationV1,
  canonicalSha256,
} from "@tv-automation/desk-domain";

export const INVALID_ORIGIN_ADJUDICATION_MODES = Object.freeze({ DRY_RUN: "DRY_RUN", APPLY: "APPLY" });
const QUALIFICATION_MANIFEST_HASH = "831b7fa057f851ef81a5eaaf270d1118d63b83ac3793d3c295717aa8586c9ba1";
const EXACT_INTENT_IDS = Object.freeze([
  "portfolio_order_intent_0bd7386b2bdb2f001386303a",
  "portfolio_order_intent_282a54a876b4fae76f7617b3",
  "portfolio_order_intent_32ae43edc75abf9acd80b208",
  "portfolio_order_intent_712451937a93497bcfeb328e",
  "portfolio_order_intent_76cdf00503a3dd6bc1d4c290",
  "portfolio_order_intent_992136b97674b2ab89264b93",
  "portfolio_order_intent_a2859895e880da7307ea1b43",
  "portfolio_order_intent_b50eab184ac98b50fd084140",
]);

export async function adjudicateHistoricalInvalidOriginIntents(command, dependencies) {
  const normalized = normalizeCommand(command);
  validateManifest(normalized.manifest);
  const manifestHash = canonicalSha256(normalized.manifest);
  const attestationHash = canonicalSha256(normalized.operatorAttestation);
  return dependencies.repository.execute({ mode: normalized.mode,
    batchId: normalized.manifest.manifest_id }, async (transaction) => {
    const items = [];
    for (const specification of normalized.manifest.adjudications) {
      items.push(await adjudicateOne(transaction, normalized, specification, manifestHash, attestationHash));
    }
    return summary(normalized, manifestHash, items);
  });
}

async function adjudicateOne(transaction, command, specification, manifestHash, attestationHash) {
  const applied = await transaction.findApplied(specification.idempotency_key);
  if (applied) return verifyApplied(applied, command, specification, manifestHash, attestationHash);
  const candidate = await transaction.loadCandidate(specification);
  if (!candidate) fail("ADJUDICATION_CANDIDATE_NOT_FOUND", specification.portfolio_order_intent_id);
  if (!Number.isInteger(Number(candidate.previous_revision))
    || Number(candidate.previous_revision) !== specification.expected_previous_adjudication_revision) {
    fail("ADJUDICATION_REVISION_MISMATCH", specification.portfolio_order_intent_id);
  }
  const decision = adjudicateInvalidOriginReservationV1(policyInput(command, specification, candidate));
  if (command.mode === "DRY_RUN") return item("WOULD_APPEND", specification, candidate, decision);
  const appended = await transaction.appendAdjudication({ specification, candidate, decision,
    manifestHash, attestationHash, command });
  return item("ADJUDICATED", specification, appended, decision);
}

function policyInput(command, specification, candidate) {
  return {
    portfolio_order_intent_id: specification.portfolio_order_intent_id,
    qualification: {
      revision: Number(candidate.qualification_revision), manifest_hash: candidate.qualification_manifest_hash,
      lineage_payload_hash: candidate.current_lineage_payload_hash,
      expected_lineage_payload_hash: candidate.expected_lineage_payload_hash,
      current_lineage_status: candidate.current_lineage_status,
      origin_classification: candidate.origin_classification, reconstruction_status: candidate.reconstruction_status,
      provider_evidence_status: candidate.provider_evidence_status,
      reservation_disposition: candidate.qualification_reservation_disposition,
      qualified_at_utc: candidate.qualified_at_utc,
    },
    expectation: { revision: specification.expected_qualification_revision,
      manifest_hash: specification.expected_qualification_manifest_hash },
    execution_evidence: candidate,
    operator_attestation: command.operatorAttestation,
    effective_at_utc: command.effectiveAtUtc,
  };
}

function verifyApplied(applied, command, specification, manifestHash, attestationHash) {
  const exact = [
    [applied.portfolio_order_intent_id, specification.portfolio_order_intent_id],
    [applied.manifest_hash, manifestHash],
    [Number(applied.revision), specification.expected_previous_adjudication_revision + 1],
    [Number(applied.expected_qualification_revision), specification.expected_qualification_revision],
    [applied.expected_qualification_manifest_hash, specification.expected_qualification_manifest_hash],
    [applied.status, "CANCELLED_INVALID_ORIGIN"],
    [applied.reservation_disposition, "ADMINISTRATIVELY_RELEASED"],
    [new Date(applied.effective_at_utc).toISOString(), command.effectiveAtUtc],
    [applied.adjudicated_by, command.actor], [applied.adjudication_reason, command.reason],
    [applied.operator_attestation_hash, attestationHash],
    [canonicalSha256(applied.operator_attestation), attestationHash],
  ];
  if (exact.some(([actual, expected]) => actual !== expected)) {
    fail("ADJUDICATION_IDEMPOTENCY_MISMATCH", specification.portfolio_order_intent_id);
  }
  return item("ALREADY_APPLIED", specification, applied);
}

function item(status, specification, value, decision = null) {
  return { status, portfolio_order_intent_id: specification.portfolio_order_intent_id,
    revision: Number(value.revision || value.previous_revision + 1),
    adjudication_status: decision?.status || value.status,
    reservation_disposition: decision?.reservation_disposition || value.reservation_disposition,
    effective_at_utc: decision?.effective_at_utc || new Date(value.effective_at_utc).toISOString() };
}

function summary(command, manifestHash, items) {
  return { ok: true, status: command.mode === "APPLY" ? "APPLIED" : "DRY_RUN_VERIFIED",
    mode: command.mode, manifest_id: command.manifest.manifest_id, manifest_hash: manifestHash,
    effective_at_utc: command.effectiveAtUtc, item_count: items.length,
    replayed_count: items.filter((entry) => entry.status === "ALREADY_APPLIED").length,
    reservation_effect: "ADMINISTRATIVELY_RELEASED_AS_OF_EFFECTIVE_AT", market_execution_effect: "NONE", items };
}

function normalizeCommand(command = {}) {
  const mode = String(command.mode || "DRY_RUN").toUpperCase().replace("-", "_");
  if (!Object.values(INVALID_ORIGIN_ADJUDICATION_MODES).includes(mode)) fail("ADJUDICATION_MODE_INVALID");
  const effectiveAtUtc = iso(command.effective_at_utc);
  const actor = text(command.actor);
  const reason = text(command.reason);
  if (!effectiveAtUtc || !actor || !reason || !command.operator_attestation) fail("ADJUDICATION_AUDIT_REQUIRED");
  return { mode, manifest: command.manifest, effectiveAtUtc, actor, reason,
    operatorAttestation: command.operator_attestation };
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema_version !== "historical_invalid_origin_adjudication_manifest_v1"
    || manifest.manifest_id !== "grains-invalid-origin-adjudication-20260907") fail("ADJUDICATION_MANIFEST_INVALID");
  const entries = Array.isArray(manifest.adjudications) ? manifest.adjudications : [];
  const ids = entries.map((entry) => entry.portfolio_order_intent_id).sort();
  if (ids.length !== EXACT_INTENT_IDS.length || ids.some((id, index) => id !== EXACT_INTENT_IDS[index])) {
    fail("ADJUDICATION_ALLOWLIST_MISMATCH");
  }
  const keys = new Set();
  for (const entry of entries) validateSpecification(entry, keys);
}

function validateSpecification(entry, keys) {
  const required = ["idempotency_key", "portfolio_order_intent_id", "qualification_idempotency_key",
    "expected_qualification_manifest_hash"];
  if (required.some((field) => !text(entry[field])) || keys.has(entry.idempotency_key)) fail("ADJUDICATION_SPECIFICATION_INVALID");
  keys.add(entry.idempotency_key);
  if (entry.expected_previous_adjudication_revision !== 0 || entry.expected_qualification_revision !== 1
    || entry.expected_qualification_manifest_hash !== QUALIFICATION_MANIFEST_HASH
    || entry.qualification_idempotency_key !== `grains-historical-intent-qualification-20260907.${entry.portfolio_order_intent_id.slice(-24)}`) {
    fail("ADJUDICATION_EXPECTATION_INVALID", entry.portfolio_order_intent_id);
  }
}

function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function text(value) { return String(value || "").trim(); }
function fail(code, intentId = null) { const error = new Error(intentId ? `${code}:${intentId}` : code); error.code = code; throw error; }
