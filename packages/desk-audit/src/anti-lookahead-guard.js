import { parseInstant } from "./instant.js";
import { domainResult, resultFromIssues } from "./result.js";

export function buildDecisionAuditEnvelope(input = {}, options = {}) {
  if (!input || typeof input !== "object") {
    return withAudit(resultFromIssues({
      rejectReasons: ["missing_decision_audit_input"],
      flags: ["LOOKAHEAD_AUDIT_MISSING"],
    }), null);
  }

  const audit = cleanRecord({
    contract_name: input.contract_name || "DeskDecisionAuditContract",
    schema_version: input.schema_version || "decision_audit_v2",
    timezone: input.timezone || "Europe/Paris",
    decision_timestamp_paris: input.decision_timestamp_paris || options.decision_timestamp_paris,
    data_cutoff_paris: input.data_cutoff_paris || options.data_cutoff_paris,
    available_data_until: input.available_data_until || input.data_cutoff_paris || options.available_data_until || options.data_cutoff_paris,
    future_data_used: Boolean(input.future_data_used ?? false),
    entry_sl_tp_frozen: Boolean(input.entry_sl_tp_frozen ?? false),
    entry_sl_tp_frozen_at_paris: input.entry_sl_tp_frozen_at_paris || options.entry_sl_tp_frozen_at_paris,
    datasets_used: Array.isArray(input.datasets_used) ? input.datasets_used : [],
    macro_actuals_visible: Array.isArray(input.macro_actuals_visible) ? input.macro_actuals_visible : [],
    macro_actuals_blocked: Array.isArray(input.macro_actuals_blocked) ? input.macro_actuals_blocked : [],
    candles_visible: Array.isArray(input.candles_visible) ? input.candles_visible : undefined,
    source_pack_id: input.source_pack_id || options.source_pack_id,
    simulation_id: input.simulation_id || options.simulation_id,
    mission_id: input.mission_id || options.mission_id,
    decision_id: input.decision_id || options.decision_id,
    thesis_id: input.thesis_id || options.thesis_id,
    notes: input.notes || options.notes,
  });

  const validation = evaluateAntiLookahead({ decisionAudit: audit });
  return withAudit(domainResult({
    status: validation.status,
    reasons: validation.reasons,
    flags: validation.flags,
    evidence: {
      ...validation.evidence,
      contract_name: audit.contract_name,
      schema_version: audit.schema_version,
    },
  }), audit);
}

export function evaluateAntiLookahead({ decisionAudit } = {}) {
  const rejectReasons = [];
  const flags = [];
  const evidence = {};

  if (!decisionAudit || typeof decisionAudit !== "object") {
    return resultFromIssues({
      rejectReasons: ["missing_decision_audit"],
      flags: ["LOOKAHEAD_AUDIT_MISSING"],
      evidence,
    });
  }

  const cutoff = parseInstant(decisionAudit.data_cutoff_paris);
  const availableUntil = parseInstant(decisionAudit.available_data_until);
  const decisionTimestamp = parseInstant(decisionAudit.decision_timestamp_paris);
  evidence.decision_timestamp_paris = decisionAudit.decision_timestamp_paris ?? null;
  evidence.data_cutoff_paris = decisionAudit.data_cutoff_paris ?? null;
  evidence.available_data_until = decisionAudit.available_data_until ?? null;

  if (decisionAudit.decision_timestamp_paris === undefined || decisionAudit.decision_timestamp_paris === null) {
    rejectReasons.push("missing_or_invalid_decision_timestamp");
    flags.push("LOOKAHEAD_DECISION_TIMESTAMP_INVALID");
  } else if (decisionTimestamp === null) {
    rejectReasons.push("missing_or_invalid_decision_timestamp");
    flags.push("LOOKAHEAD_DECISION_TIMESTAMP_INVALID");
  }

  if (cutoff === null) {
    rejectReasons.push("missing_or_invalid_cutoff");
    flags.push("LOOKAHEAD_CUTOFF_INVALID");
  }

  if (decisionAudit.future_data_used === true) {
    rejectReasons.push("future_data_used");
    flags.push("LOOKAHEAD_FUTURE_DATA");
  }

  if (decisionAudit.entry_sl_tp_frozen === false) {
    rejectReasons.push("entry_sl_tp_not_frozen");
    flags.push("LOOKAHEAD_ENTRY_SL_TP_NOT_FROZEN");
  }

  if (decisionAudit.available_data_until === undefined || decisionAudit.available_data_until === null) {
    rejectReasons.push("missing_or_invalid_available_data_until");
    flags.push("LOOKAHEAD_AVAILABLE_UNTIL_INVALID");
  } else if (availableUntil === null) {
    rejectReasons.push("missing_or_invalid_available_data_until");
    flags.push("LOOKAHEAD_AVAILABLE_UNTIL_INVALID");
  } else if (cutoff !== null && availableUntil > cutoff) {
    rejectReasons.push("data_after_cutoff");
    flags.push("LOOKAHEAD_DATA_AFTER_CUTOFF");
  }

  if (decisionTimestamp !== null && cutoff !== null && cutoff > decisionTimestamp) {
    rejectReasons.push("cutoff_after_decision_timestamp");
    flags.push("LOOKAHEAD_CUTOFF_AFTER_DECISION");
  }

  const macroViolations = visibleMacroActualViolations(decisionAudit, cutoff);
  for (const violation of macroViolations) {
    rejectReasons.push(violation.reason);
    flags.push(violation.flag);
  }
  if (macroViolations.length > 0) {
    evidence.macro_actual_violations = macroViolations.map(({ flag, ...violation }) => violation);
  }

  const candleViolations = visibleCandleViolations(decisionAudit, cutoff);
  for (const violation of candleViolations) {
    rejectReasons.push(violation.reason);
    flags.push(violation.flag);
  }
  if (candleViolations.length > 0) {
    evidence.candle_violations = candleViolations.map(({ flag, ...violation }) => violation);
  }

  return resultFromIssues({ rejectReasons, flags, evidence });
}

function visibleMacroActualViolations(decisionAudit, cutoff) {
  const macroActualsVisible = Array.isArray(decisionAudit.macro_actuals_visible)
    ? decisionAudit.macro_actuals_visible
    : [];
  const violations = [];
  for (const [index, actual] of macroActualsVisible.entries()) {
    if (!actual || typeof actual !== "object" || !actual.published_at_paris) continue;
    const publishedAt = parseInstant(actual.published_at_paris);
    if (publishedAt === null) {
      violations.push({
        index,
        event: actual.event ?? null,
        published_at_paris: actual.published_at_paris,
        reason: "macro_actual_invalid_publish_time",
        flag: "LOOKAHEAD_MACRO_ACTUAL_INVALID_TIME",
      });
      continue;
    }
    if (cutoff !== null && publishedAt > cutoff) {
      violations.push({
        index,
        event: actual.event ?? null,
        published_at_paris: actual.published_at_paris,
        reason: "macro_actual_after_cutoff",
        flag: "LOOKAHEAD_MACRO_ACTUAL_AFTER_CUTOFF",
      });
    }
  }
  return violations;
}

function visibleCandleViolations(decisionAudit, cutoff) {
  const candles = visibleCandles(decisionAudit);
  const violations = [];
  for (const [index, candle] of candles.entries()) {
    if (!candle || typeof candle !== "object") continue;
    const rawTimestamp = candle.timestamp_paris || candle.timestamp_utc || candle.timestamp || candle.time;
    if (!rawTimestamp) continue;
    const timestamp = parseInstant(String(rawTimestamp));
    if (timestamp === null) {
      violations.push({
        index,
        timestamp: rawTimestamp,
        reason: "candle_invalid_timestamp",
        flag: "LOOKAHEAD_CANDLE_INVALID_TIME",
      });
      continue;
    }
    if (cutoff !== null && timestamp > cutoff) {
      violations.push({
        index,
        timestamp: rawTimestamp,
        reason: "candle_after_cutoff",
        flag: "LOOKAHEAD_CANDLE_AFTER_CUTOFF",
      });
    }
  }
  return violations;
}

function visibleCandles(decisionAudit) {
  for (const field of ["candles_visible", "market_candles_visible", "visible_candles"]) {
    if (Array.isArray(decisionAudit[field])) return decisionAudit[field];
  }
  return [];
}

function withAudit(result, audit) {
  return { ...result, audit, record: audit };
}

function cleanRecord(value) {
  if (Array.isArray(value)) return value.map(cleanRecord);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = cleanRecord(item);
  }
  return out;
}
