import { canonicalSha256 } from "@tv-automation/desk-domain";

export const HISTORICAL_QUALIFICATION_MODES = Object.freeze({ DRY_RUN: "DRY_RUN", APPLY: "APPLY" });
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

export async function qualifyHistoricalGrainsIntents(command, dependencies) {
  const normalized = normalizeCommand(command);
  validateManifest(normalized.manifest);
  const manifestHash = canonicalSha256(normalized.manifest);
  return dependencies.repository.execute({ mode: normalized.mode, batchId: normalized.manifest.manifest_id }, async (transaction) => {
    const items = [];
    for (const specification of normalized.manifest.qualifications) {
      items.push(await qualifyOne(transaction, normalized, specification, manifestHash));
    }
    return {
      ok: true,
      status: normalized.mode === "APPLY" ? "APPLIED" : "DRY_RUN_VERIFIED",
      mode: normalized.mode,
      manifest_id: normalized.manifest.manifest_id,
      manifest_hash: manifestHash,
      qualified_at_utc: normalized.qualifiedAtUtc,
      item_count: items.length,
      replayed_count: items.filter((item) => item.status === "ALREADY_APPLIED").length,
      reservation_effect: "NONE_RETAINED",
      items,
    };
  });
}

async function qualifyOne(transaction, command, specification, manifestHash) {
  const applied = await transaction.findApplied(specification.idempotency_key);
  if (applied) return verifyApplied(applied, specification, manifestHash);
  const candidate = await transaction.loadCandidate(specification);
  assertCandidate(candidate, specification);
  if (command.mode === "DRY_RUN") return result("WOULD_APPEND", specification, candidate);
  const appended = await transaction.appendQualification({
    specification, candidate, manifestHash,
    qualifiedAtUtc: command.qualifiedAtUtc,
    qualifiedBy: command.qualifiedBy,
    reason: command.reason,
  });
  return result("QUALIFIED", specification, appended);
}

function assertCandidate(candidate, specification) {
  if (!candidate) throw qualificationError("HISTORICAL_INTENT_NOT_FOUND", specification.portfolio_order_intent_id);
  const exact = [
    [candidate.target_position_id, specification.target_position_id, "TARGET_POSITION_MISMATCH"],
    [candidate.source_signal_id, specification.source_signal_id, "SOURCE_SIGNAL_MISMATCH"],
    [candidate.lineage_status, "EXPIRED", "LINEAGE_STATUS_MISMATCH"],
    [candidate.lineage_payload_hash, specification.expected_lineage_payload_hash, "LINEAGE_HASH_MISMATCH"],
    [candidate.target_payload_hash, specification.expected_target_payload_hash, "TARGET_HASH_MISMATCH"],
    [candidate.signal_payload_hash, specification.expected_signal_payload_hash, "SIGNAL_HASH_MISMATCH"],
    [Number(candidate.previous_revision), specification.expected_previous_revision, "QUALIFICATION_REVISION_MISMATCH"],
    [Number(candidate.theoretical_event_count), specification.expected_theoretical_event_count, "THEORETICAL_EVENT_COUNT_MISMATCH"],
    [Number(candidate.unproven_expiry_count), specification.expected_unproven_expiry_count, "UNPROVEN_EXPIRY_COUNT_MISMATCH"],
  ];
  for (const [actual, expected, code] of exact) if (actual !== expected) throw qualificationError(code, specification.portfolio_order_intent_id);
  for (const field of ["intent_entry_price", "target_entry_price", "signal_entry_price"]) {
    if (candidate[field] !== null) throw qualificationError("ENTRY_PRICE_WAS_NOT_MISSING", specification.portfolio_order_intent_id);
  }
  if (candidate.intent_economics_availability !== "UNAVAILABLE" || candidate.target_economics_availability !== "UNAVAILABLE") {
    throw qualificationError("ECONOMICS_WERE_NOT_UNAVAILABLE", specification.portfolio_order_intent_id);
  }
  for (const field of ["provider_command_count", "provider_event_count", "trade_count", "fill_count"]) {
    if (Number(candidate[field]) !== 0) throw qualificationError("EXECUTION_EVIDENCE_PRESENT", specification.portfolio_order_intent_id);
  }
}

function verifyApplied(applied, specification, manifestHash) {
  const exact = [
    [applied.portfolio_order_intent_id, specification.portfolio_order_intent_id],
    [applied.manifest_hash, manifestHash],
    [Number(applied.revision), specification.expected_previous_revision + 1],
    [applied.origin_classification, "INVALID_ORIGIN_PLAN"],
    [applied.reconstruction_status, "UNQUALIFIABLE"],
    [applied.provider_evidence_status, "ABSENT"],
    [applied.reservation_disposition, "RETAINED"],
  ];
  if (exact.some(([actual, expected]) => actual !== expected)) {
    throw qualificationError("QUALIFICATION_IDEMPOTENCY_MISMATCH", specification.portfolio_order_intent_id);
  }
  return result("ALREADY_APPLIED", specification, applied);
}

function result(status, specification, value) {
  return {
    status,
    portfolio_order_intent_id: specification.portfolio_order_intent_id,
    revision: Number(value.revision || value.previous_revision + 1),
    origin_classification: "INVALID_ORIGIN_PLAN",
    reconstruction_status: "UNQUALIFIABLE",
    provider_evidence_status: "ABSENT",
    reservation_disposition: "RETAINED",
  };
}

function normalizeCommand(command = {}) {
  const mode = String(command.mode || "DRY_RUN").toUpperCase().replace("-", "_");
  if (!Object.values(HISTORICAL_QUALIFICATION_MODES).includes(mode)) throw qualificationError("QUALIFICATION_MODE_INVALID");
  const qualifiedAtUtc = iso(command.qualified_at_utc || new Date().toISOString());
  const qualifiedBy = text(command.qualified_by);
  const reason = text(command.reason);
  if (mode === "APPLY" && (!qualifiedBy || !reason || !command.qualified_at_utc)) throw qualificationError("QUALIFICATION_AUDIT_REQUIRED");
  return { mode, manifest: command.manifest, qualifiedAtUtc, qualifiedBy: qualifiedBy || "dry-run", reason: reason || "dry-run" };
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema_version !== "historical_grains_intent_qualification_manifest_v1"
    || manifest.manifest_id !== "grains-historical-intent-qualification-20260907") throw qualificationError("QUALIFICATION_MANIFEST_INVALID");
  const ids = Array.isArray(manifest.qualifications)
    ? manifest.qualifications.map((item) => item.portfolio_order_intent_id).sort() : [];
  if (ids.length !== EXACT_INTENT_IDS.length || ids.some((id, index) => id !== EXACT_INTENT_IDS[index])) {
    throw qualificationError("QUALIFICATION_ALLOWLIST_MISMATCH");
  }
  const keys = new Set();
  for (const item of manifest.qualifications) {
    const required = ["idempotency_key", "target_position_id", "source_signal_id", "expected_lineage_payload_hash",
      "expected_target_payload_hash", "expected_signal_payload_hash"];
    if (required.some((field) => !text(item[field])) || keys.has(item.idempotency_key)) throw qualificationError("QUALIFICATION_SPECIFICATION_INVALID");
    keys.add(item.idempotency_key);
    if (item.expected_previous_revision !== 0 || ![0, 1].includes(item.expected_theoretical_event_count)
      || ![0, 1].includes(item.expected_unproven_expiry_count)
      || item.expected_theoretical_event_count !== item.expected_unproven_expiry_count) {
      throw qualificationError("QUALIFICATION_EXPECTATION_INVALID", item.portfolio_order_intent_id);
    }
  }
}

function iso(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) throw qualificationError("QUALIFICATION_TIMESTAMP_INVALID");
  return new Date(parsed).toISOString();
}
function text(value) { return String(value || "").trim(); }
function qualificationError(code, intentId = null) {
  const error = new Error(intentId ? `${code}:${intentId}` : code);
  error.code = code;
  return error;
}
