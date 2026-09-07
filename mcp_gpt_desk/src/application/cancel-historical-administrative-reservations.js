import { cancelAdministrativeReservationV1, canonicalSha256 } from "@tv-automation/desk-domain";
import { HISTORICAL_ADMINISTRATIVE_RESERVATION_CANCELLATION_INTENT_IDS as EXACT_INTENT_IDS }
  from "./historical-administrative-reservation-cancellation-scope.js";

export const ADMINISTRATIVE_RESERVATION_CANCELLATION_MODES = Object.freeze({ DRY_RUN: "DRY_RUN", APPLY: "APPLY" });
const MANIFEST_SCHEMA = "historical_administrative_reservation_cancellation_manifest_v1";
const MANIFEST_ID = "grains-administrative-reservation-cancellation-20260907";
const APPROVED_MANIFEST_HASH = "ff288ef3b29008b8968d6e45e8dece5ece8fe51aa431bfda7427a3bfa20f455b";

export async function cancelHistoricalAdministrativeReservations(command, dependencies) {
  const normalized = normalizeCommand(command);
  validateManifest(normalized.manifest);
  const manifestHash = canonicalSha256(normalized.manifest);
  const attestationHash = canonicalSha256(normalized.operatorAttestation);
  return dependencies.repository.execute({ mode: normalized.mode, batchId: normalized.manifest.manifest_id },
    async (transaction) => {
      const items = [];
      for (const specification of normalized.manifest.cancellations) {
        items.push(await cancelOne(transaction, normalized, specification, manifestHash, attestationHash));
      }
      return summary(normalized, manifestHash, items);
    });
}

async function cancelOne(transaction, command, specification, manifestHash, attestationHash) {
  const applied = await transaction.findApplied(specification.idempotency_key);
  if (applied) return verifyApplied(applied, command, specification, manifestHash, attestationHash);
  const candidate = await transaction.loadCandidate(specification);
  if (!candidate) fail("ADMIN_CANCELLATION_CANDIDATE_NOT_FOUND", specification.portfolio_order_intent_id);
  if (!Number.isInteger(Number(candidate.previous_revision))
    || Number(candidate.previous_revision) !== specification.expected_previous_cancellation_revision) {
    fail("ADMIN_CANCELLATION_REVISION_MISMATCH", specification.portfolio_order_intent_id);
  }
  const decision = cancelAdministrativeReservationV1({
    portfolio_order_intent_id: specification.portfolio_order_intent_id,
    lineage: { status: candidate.current_lineage_status, payload_hash: candidate.current_lineage_payload_hash,
      created_at_utc: candidate.lineage_created_at_utc },
    expectation: { status: specification.expected_lineage_status,
      payload_hash: specification.expected_lineage_payload_hash },
    execution_evidence: candidate, operator_attestation: command.operatorAttestation,
    effective_at_utc: command.effectiveAtUtc,
  });
  if (command.mode === "DRY_RUN") return item("WOULD_APPEND", specification, candidate, decision);
  const appended = await transaction.appendCancellation({ specification, candidate, decision,
    manifestHash, attestationHash, command });
  return item("CANCELLED", specification, appended, decision);
}

function verifyApplied(applied, command, specification, manifestHash, attestationHash) {
  const exact = [
    [applied.portfolio_order_intent_id, specification.portfolio_order_intent_id],
    [applied.manifest_hash, manifestHash],
    [Number(applied.revision), specification.expected_previous_cancellation_revision + 1],
    [Number(applied.expected_previous_revision), specification.expected_previous_cancellation_revision],
    [applied.expected_lineage_payload_hash, specification.expected_lineage_payload_hash],
    [applied.expected_lineage_status, specification.expected_lineage_status],
    [applied.status, "CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE"],
    [applied.reservation_disposition, "ADMINISTRATIVELY_RELEASED"],
    [applied.historical_outcome_disposition, "UNDETERMINED_PRESERVED"],
    [new Date(applied.effective_at_utc).toISOString(), command.effectiveAtUtc],
    [applied.cancelled_by, command.actor], [applied.cancellation_reason, command.reason],
    [applied.operator_attestation_hash, attestationHash],
    [canonicalSha256(applied.operator_attestation), attestationHash],
  ];
  if (exact.some(([actual, expected]) => actual !== expected)) {
    fail("ADMIN_CANCELLATION_IDEMPOTENCY_MISMATCH", specification.portfolio_order_intent_id);
  }
  return item("ALREADY_APPLIED", specification, applied);
}

function item(status, specification, value, decision = null) {
  return { status, portfolio_order_intent_id: specification.portfolio_order_intent_id,
    revision: Number(value.revision || Number(value.previous_revision) + 1),
    cancellation_status: decision?.status || value.status,
    reservation_disposition: decision?.reservation_disposition || value.reservation_disposition,
    historical_outcome_disposition: decision?.historical_outcome_disposition
      || value.historical_outcome_disposition,
    effective_at_utc: decision?.effective_at_utc || new Date(value.effective_at_utc).toISOString() };
}

function summary(command, manifestHash, items) {
  return { ok: true, status: command.mode === "APPLY" ? "APPLIED" : "DRY_RUN_VERIFIED",
    mode: command.mode, manifest_id: command.manifest.manifest_id, manifest_hash: manifestHash,
    effective_at_utc: command.effectiveAtUtc, item_count: items.length,
    replayed_count: items.filter((entry) => entry.status === "ALREADY_APPLIED").length,
    reservation_effect: "ADMINISTRATIVELY_RELEASED_AS_OF_EFFECTIVE_AND_KNOWN_AT",
    historical_outcome_effect: "UNDETERMINED_PRESERVED", market_execution_effect: "NONE", items };
}

function normalizeCommand(command = {}) {
  const mode = String(command.mode || "DRY_RUN").toUpperCase().replace("-", "_");
  if (!Object.values(ADMINISTRATIVE_RESERVATION_CANCELLATION_MODES).includes(mode)) {
    fail("ADMIN_CANCELLATION_MODE_INVALID");
  }
  const effectiveAtUtc = iso(command.effective_at_utc);
  const actor = text(command.actor);
  const reason = text(command.reason);
  if (!effectiveAtUtc || !actor || !reason || !command.operator_attestation) {
    fail("ADMIN_CANCELLATION_AUDIT_REQUIRED");
  }
  return { mode, manifest: command.manifest, effectiveAtUtc, actor, reason,
    operatorAttestation: command.operator_attestation };
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema_version !== MANIFEST_SCHEMA || manifest.manifest_id !== MANIFEST_ID) {
    fail("ADMIN_CANCELLATION_MANIFEST_INVALID");
  }
  const allowedManifestFields = new Set(["schema_version", "manifest_id", "scope", "cancellations"]);
  if (Object.keys(manifest).some((field) => !allowedManifestFields.has(field)) || !text(manifest.scope)) {
    fail("ADMIN_CANCELLATION_MANIFEST_INVALID");
  }
  const entries = Array.isArray(manifest.cancellations) ? manifest.cancellations : [];
  const ids = entries.map((entry) => entry.portfolio_order_intent_id).sort();
  if (ids.length !== EXACT_INTENT_IDS.length || ids.some((id, index) => id !== EXACT_INTENT_IDS[index])) {
    fail("ADMIN_CANCELLATION_ALLOWLIST_MISMATCH");
  }
  const keys = new Set();
  for (const entry of entries) validateSpecification(entry, keys);
  if (canonicalSha256(manifest) !== APPROVED_MANIFEST_HASH) fail("ADMIN_CANCELLATION_MANIFEST_HASH_MISMATCH");
}

function validateSpecification(entry, keys) {
  const allowed = new Set(["idempotency_key", "portfolio_order_intent_id",
    "expected_previous_cancellation_revision", "expected_lineage_payload_hash", "expected_lineage_status"]);
  if (!entry || Object.keys(entry).some((field) => !allowed.has(field))
    || Object.keys(entry).length !== allowed.size || keys.has(entry.idempotency_key)) {
    fail("ADMIN_CANCELLATION_SPECIFICATION_INVALID");
  }
  keys.add(entry.idempotency_key);
  const expectedKey = `grains-administrative-reservation-cancellation-20260907.${entry.portfolio_order_intent_id.slice(-24)}`;
  if (entry.idempotency_key !== expectedKey || entry.expected_previous_cancellation_revision !== 0
    || entry.expected_lineage_status !== "EXPIRED"
    || !/^sha256:[a-f0-9]{64}$/.test(String(entry.expected_lineage_payload_hash || ""))) {
    fail("ADMIN_CANCELLATION_EXPECTATION_INVALID", entry.portfolio_order_intent_id);
  }
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function text(value) { return String(value || "").trim(); }
function fail(code, intentId = null) {
  const error = new Error(intentId ? `${code}:${intentId}` : code);
  error.code = code;
  throw error;
}
