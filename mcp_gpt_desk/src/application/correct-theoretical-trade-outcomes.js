import { calculateTradeOutcome, canonicalSha256 } from "@tv-automation/desk-domain";

export const OUTCOME_CORRECTION_MODES = Object.freeze({ DRY_RUN: "DRY_RUN", APPLY: "APPLY" });

export async function correctTheoreticalTradeOutcomes(command, dependencies) {
  const normalized = normalizeCommand(command);
  validateManifest(normalized.manifest);
  const manifestHash = canonicalSha256(normalized.manifest);
  return dependencies.repository.execute({ mode: normalized.mode, batchId: normalized.manifest.manifest_id }, async (transaction) => {
    const items = [];
    for (const specification of normalized.manifest.corrections) {
      items.push(await correctOne(transaction, normalized, specification, manifestHash));
    }
    return {
      ok: true,
      status: normalized.mode === OUTCOME_CORRECTION_MODES.APPLY ? "APPLIED" : "DRY_RUN_VERIFIED",
      mode: normalized.mode,
      manifest_id: normalized.manifest.manifest_id,
      manifest_hash: manifestHash,
      correction_known_at_utc: normalized.correctionKnownAtUtc,
      corrected_by: normalized.correctedBy,
      item_count: items.length,
      replayed_count: items.filter((item) => item.status === "ALREADY_APPLIED").length,
      items,
    };
  });
}

async function correctOne(transaction, command, specification, manifestHash) {
  const applied = await transaction.findApplied(specification.idempotency_key);
  if (applied) return verifyApplied(applied, command, specification, manifestHash);
  const candidate = await transaction.loadCandidate(specification);
  assertCandidate(candidate, specification);
  const calculated = calculateCandidate(candidate, specification.canonical_point_value, command.correctionKnownAtUtc);
  assertExpectedCorrection(calculated, specification);
  if (command.mode === OUTCOME_CORRECTION_MODES.DRY_RUN) {
    return projectResult("WOULD_APPLY", candidate, calculated, specification);
  }
  const corrected = await transaction.appendCorrection({
    specification,
    candidate,
    manifestId: command.manifest.manifest_id,
    manifestHash,
    correctionKnownAtUtc: command.correctionKnownAtUtc,
    economicFinalizedAtUtc: specification.expected_economic_finalized_at_utc,
    correctedBy: command.correctedBy,
    reason: command.reason,
  });
  assertPersistedCorrection(corrected, candidate, calculated, specification);
  return projectResult("CORRECTED", candidate, corrected, specification);
}

function assertCandidate(candidate, specification) {
  if (!candidate) throw correctionError("EXPECTED_FINAL_OUTCOME_NOT_FOUND", specification.trade_id);
  const exact = [
    [candidate.trade_outcome_id, specification.expected_trade_outcome_id, "OUTCOME_ID_MISMATCH"],
    [Number(candidate.revision), specification.expected_revision, "OUTCOME_REVISION_MISMATCH"],
    [candidate.evidence_hash, specification.expected_evidence_hash, "OUTCOME_EVIDENCE_HASH_MISMATCH"],
    [candidate.portfolio_order_intent_id, specification.portfolio_order_intent_id, "OUTCOME_INTENT_MISMATCH"],
    [candidate.outcome_status, "final", "OUTCOME_NOT_FINAL"],
    [candidate.trade_status, "closed", "TRADE_NOT_CLOSED"],
    [candidate.trade_source, "theoretical_execution_engine", "TRADE_NOT_THEORETICAL"],
    [iso(candidate.finalized_at_utc), specification.expected_economic_finalized_at_utc, "ECONOMIC_TIME_MISMATCH"],
  ];
  for (const [actual, expected, code] of exact) if (actual !== expected) throw correctionError(code, specification.trade_id);
  requireNumber(candidate.evidence?.point_value, specification.expected_evidence_point_value, "EVIDENCE_POINT_VALUE_MISMATCH");
  requireCanonicalValues(candidate, specification);
  if (candidate.execution_point_value !== null && candidate.execution_point_value !== undefined) {
    requireNumber(candidate.execution_point_value, specification.canonical_point_value, "EXECUTION_POINT_VALUE_CONFLICT");
  }
}

function calculateCandidate(candidate, pointValue, calculatedAt) {
  const entrySide = candidate.side === "long" ? "buy" : "sell";
  const entryFills = candidate.fills.filter((fill) => fill.side === entrySide).map(projectFill);
  const exitFills = candidate.fills.filter((fill) => fill.side !== entrySide).map(projectFill);
  return calculateTradeOutcome({
    side: candidate.side,
    entryPrice: Number(candidate.avg_entry_price),
    initialStopPrice: Number(candidate.initial_stop_price),
    initialQuantity: Number(candidate.quantity_planned),
    pointValue,
    entryFills,
    exitFills,
    calculatedAt,
    finalized: true,
  });
}

function assertExpectedCorrection(calculated, specification) {
  requireNumber(calculated.net_realized_pnl, specification.expected_corrected_net_pnl_usd, "CORRECTED_NET_PNL_MISMATCH");
  requireNumber(calculated.result_r, specification.expected_result_r, "CORRECTED_RESULT_R_MISMATCH");
  requireNumber(calculated.evidence.point_value, specification.canonical_point_value, "CORRECTED_POINT_VALUE_MISMATCH");
}

function assertPersistedCorrection(corrected, previous, calculated, specification) {
  if (Number(corrected.revision) !== specification.expected_revision + 1) throw correctionError("CORRECTED_REVISION_MISMATCH", specification.trade_id);
  if (corrected.status !== "final" || corrected.evidence_hash !== calculated.evidence_hash) throw correctionError("CORRECTED_EVIDENCE_MISMATCH", specification.trade_id);
  if (iso(corrected.finalized_at_utc) !== specification.expected_economic_finalized_at_utc) throw correctionError("CORRECTED_ECONOMIC_TIME_MISMATCH", specification.trade_id);
  if (corrected.trade_outcome_id === previous.trade_outcome_id) throw correctionError("OUTCOME_WAS_MUTATED_IN_PLACE", specification.trade_id);
}

function verifyApplied(applied, command, specification, manifestHash) {
  const exact = [
    [applied.trade_id, specification.trade_id, "IDEMPOTENCY_TRADE_MISMATCH"],
    [applied.manifest_hash, manifestHash, "IDEMPOTENCY_MANIFEST_MISMATCH"],
    [applied.corrected_status, "final", "IDEMPOTENCY_FINAL_MISSING"],
    [Number(applied.corrected_revision), specification.expected_revision + 1, "IDEMPOTENCY_REVISION_MISMATCH"],
    [iso(applied.economic_finalized_at_utc), specification.expected_economic_finalized_at_utc, "IDEMPOTENCY_ECONOMIC_TIME_MISMATCH"],
  ];
  for (const [actual, expected, code] of exact) if (actual !== expected) throw correctionError(code, specification.trade_id);
  requireNumber(applied.corrected_evidence?.point_value, specification.canonical_point_value, "IDEMPOTENCY_POINT_VALUE_MISMATCH");
  requireNumber(applied.corrected_net_realized_pnl, specification.expected_corrected_net_pnl_usd, "IDEMPOTENCY_NET_PNL_MISMATCH");
  return {
    status: "ALREADY_APPLIED",
    trade_id: specification.trade_id,
    previous_trade_outcome_id: applied.previous_trade_outcome_id,
    corrected_trade_outcome_id: applied.corrected_trade_outcome_id,
    correction_known_at_utc: iso(applied.correction_known_at_utc),
    requested_correction_known_at_utc: command.correctionKnownAtUtc,
  };
}

function projectResult(status, previous, corrected, specification) {
  return {
    status,
    trade_id: specification.trade_id,
    portfolio_order_intent_id: specification.portfolio_order_intent_id,
    previous: outcomeProjection(previous),
    corrected: outcomeProjection(corrected),
    economic_finalized_at_utc: specification.expected_economic_finalized_at_utc,
  };
}

function outcomeProjection(value) {
  return {
    trade_outcome_id: value.trade_outcome_id || null,
    revision: Number(value.revision || 0) || null,
    evidence_hash: value.evidence_hash,
    point_value: numericOrNull(value.evidence?.point_value),
    net_realized_pnl: numericOrNull(value.net_realized_pnl),
    result_r: numericOrNull(value.result_r),
  };
}

function normalizeCommand(command = {}) {
  const mode = String(command.mode || OUTCOME_CORRECTION_MODES.DRY_RUN).toUpperCase();
  if (!Object.values(OUTCOME_CORRECTION_MODES).includes(mode)) throw correctionError("CORRECTION_MODE_INVALID");
  const correctionKnownAtUtc = iso(command.correction_known_at_utc || new Date().toISOString());
  const correctedBy = text(command.corrected_by);
  const reason = text(command.reason);
  if (mode === OUTCOME_CORRECTION_MODES.APPLY && (!correctedBy || !reason || !command.correction_known_at_utc)) {
    throw correctionError("APPLY_AUDIT_FIELDS_REQUIRED");
  }
  return { mode, manifest: command.manifest, correctionKnownAtUtc, correctedBy: correctedBy || "dry-run", reason: reason || "dry-run" };
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema_version !== "trade_outcome_correction_manifest_v1") throw correctionError("CORRECTION_MANIFEST_INVALID");
  if (!text(manifest.manifest_id) || !Array.isArray(manifest.corrections) || manifest.corrections.length === 0) throw correctionError("CORRECTION_MANIFEST_EMPTY");
  const keys = new Set();
  for (const item of manifest.corrections) {
    const required = ["idempotency_key", "trade_id", "portfolio_order_intent_id", "expected_trade_outcome_id", "expected_evidence_hash", "expected_economic_finalized_at_utc"];
    if (required.some((field) => !text(item[field]))) throw correctionError("CORRECTION_SPECIFICATION_INCOMPLETE", item.trade_id);
    if (keys.has(item.idempotency_key)) throw correctionError("CORRECTION_IDEMPOTENCY_DUPLICATE", item.trade_id);
    keys.add(item.idempotency_key);
    iso(item.expected_economic_finalized_at_utc);
  }
}

function projectFill(fill) {
  return { quantity: Number(fill.quantity), price: Number(fill.price), commission: Number(fill.commission || 0), filled_at: fill.filled_at, fill_ref: fill.broker_fill_ref };
}

function requireNumber(actual, expected, code) {
  if (actual === null || actual === undefined || actual === ""
    || !Number.isFinite(Number(actual)) || Number(actual) !== Number(expected)) throw correctionError(code);
}

function requireCanonicalValues(candidate, specification) {
  const values = [candidate.intent_economics_point_value, candidate.intent_point_value,
    candidate.target_economics_point_value, candidate.target_point_value]
    .filter((value) => value !== null && value !== undefined && value !== "");
  if (!values.length) throw correctionError("CANONICAL_POINT_VALUE_MISSING", specification.trade_id);
  for (const value of values) requireNumber(value, specification.canonical_point_value, "CANONICAL_POINT_VALUE_CONFLICT");
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function iso(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) throw correctionError("CORRECTION_TIMESTAMP_INVALID");
  return new Date(parsed).toISOString();
}

function text(value) { return String(value || "").trim(); }
function correctionError(code, tradeId = null) {
  const error = new Error(tradeId ? `${code}:${tradeId}` : code);
  error.code = code;
  return error;
}
