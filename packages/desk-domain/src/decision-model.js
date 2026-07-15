import { createHash } from "node:crypto";
import { evaluateAntiLookahead } from "./anti-lookahead-guard.js";
import { evaluateGates } from "./gate-evaluator.js";
import { resultFromIssues } from "./result.js";

export const DECISION_SCHEMA_VERSION = "decision_v2";
export const DECISION_MODEL_VERSION = "single_decision_chain_v1";
export const DECISION_SOURCE_ROLE = "proposer";
export const DECISION_SOURCE_TYPES = Object.freeze(["dashboard", "gpt", "strategy", "worker", "manual", "system"]);

const CANONICAL_DECISIONS = new Set(["prendre", "ne_pas_prendre", "wait", "gestion_seule"]);
const SOURCE_TYPE_ALIASES = Object.freeze({
  chatgpt: "gpt",
  chatgpt_desk: "gpt",
  gpt_desk: "gpt",
  api_worker: "worker",
  dashboard_command: "dashboard",
  paper: "dashboard",
});

export function normalizeDecision(input = {}, options = {}) {
  const raw = unpackDecisionInput(input);
  const sourceType = normalizeSourceType(raw.source_type ?? options.source_type ?? raw.source ?? raw.origin ?? "manual");
  const decisionValue = normalizeDecisionValue(raw.decision_value ?? raw.final_decision ?? raw.action ?? raw.verdict ?? raw.decision, raw);
  const direction = normalizeDirection(raw.direction ?? raw.side);
  const audit = objectOrNull(raw.decision_audit ?? raw.decisionAudit ?? options.decision_audit);
  const auditId = stringOrNull(raw.audit_id ?? raw.decision_audit_id ?? audit?.audit_id);
  const decisionTimestampParis = stringOrNull(
    raw.decision_timestamp_paris
      ?? raw.timestamp_paris
      ?? raw.created_at_paris
      ?? audit?.decision_timestamp_paris
      ?? options.decision_timestamp_paris,
  );
  const createdAtUtc = stringOrNull(raw.created_at_utc ?? raw.saved_at_utc ?? options.created_at_utc);
  const createdAtParis = stringOrNull(raw.created_at_paris ?? raw.saved_at_paris ?? decisionTimestampParis ?? options.created_at_paris);
  const decisionGates = raw.decision_gates ?? raw.gates ?? options.decision_gates;
  const timeWindows = raw.time_windows ?? options.time_windows ?? [];
  const hasGateInput = Boolean(decisionGates) || (Array.isArray(timeWindows) && timeWindows.length > 0);
  const gateResult = hasGateInput
    ? evaluateGates({
      decision: {
        ...raw,
        decision: decisionValue,
        direction,
        created_at: raw.created_at ?? createdAtParis ?? createdAtUtc,
        decision_timestamp_paris: decisionTimestampParis,
      },
      decisionGates,
      timeWindows,
      decisionTimestamp: decisionTimestampParis ?? raw.created_at ?? createdAtParis ?? createdAtUtc,
    })
    : resultFromIssues({
      reviewReasons: ["decision_gate_required"],
      flags: ["DECISION_GATE_REQUIRED"],
      evidence: { checked_gates: [] },
    });
  const auditResult = audit ? evaluateAntiLookahead({ decisionAudit: audit }) : null;

  const rejectReasons = [];
  const reviewReasons = [];
  const flags = [];
  if (!sourceType) {
    reviewReasons.push("decision_source_required");
    flags.push("DECISION_SOURCE_REQUIRED");
  }
  if (!CANONICAL_DECISIONS.has(decisionValue)) {
    reviewReasons.push("decision_value_required");
    flags.push("DECISION_VALUE_REQUIRED");
  }
  if (!audit) {
    reviewReasons.push("decision_audit_required");
    flags.push("DECISION_AUDIT_REQUIRED");
  } else if (!auditResult.ok) {
    rejectReasons.push(...auditResult.reasons);
    flags.push(...auditResult.flags);
  }
  if (!gateResult.ok) {
    if (gateResult.status === "rejected") rejectReasons.push(...gateResult.reasons);
    else reviewReasons.push(...gateResult.reasons);
    flags.push(...gateResult.flags);
  }

  const status = resultFromIssues({
    rejectReasons,
    reviewReasons,
    flags,
    evidence: {
      audit: auditResult?.evidence ?? {},
      gates: gateResult.evidence,
    },
  });
  const sourceRef = stringOrNull(raw.source_ref ?? raw.paper_decision_id ?? raw.mission_id ?? raw.gpt_decision_id ?? raw.candidate_id ?? raw.analysis_id ?? raw.pack_id);
  const decisionId = stringOrNull(raw.decision_id ?? raw.canonical_decision_id)
    ?? stableDecisionId([sourceType, sourceRef, raw.thesis_id, raw.mission_id, raw.setup_id ?? raw.linked_setup_id, auditId, decisionValue]);
  const chain = compactObject({
    thesis_id: stringOrNull(raw.thesis_id ?? raw.linked_thesis_id),
    mission_id: stringOrNull(raw.mission_id ?? raw.worker_mission_id),
    gate_status: gateStatus(status, auditResult, gateResult),
    decision_id: decisionId,
    position_id: stringOrNull(raw.position_id ?? raw.paper_position_id ?? raw.linked_position_id),
    outcome_id: stringOrNull(raw.outcome_id ?? raw.paper_outcome_id),
    audit_id: auditId,
  });
  const record = compactObject({
    schema_version: DECISION_SCHEMA_VERSION,
    decision_model: DECISION_MODEL_VERSION,
    decision_id: decisionId,
    source_type: sourceType,
    source_role: DECISION_SOURCE_ROLE,
    source_ref: sourceRef,
    proposer_id: stringOrNull(raw.proposer_id ?? raw.requested_by ?? options.proposer_id),
    status: status.status,
    decision: CANONICAL_DECISIONS.has(decisionValue) ? decisionValue : "wait",
    direction,
    instrument: stringOrNull(raw.instrument ?? raw.symbol),
    session: stringOrNull(raw.session),
    date: stringOrNull(raw.date ?? isoDate(createdAtParis ?? createdAtUtc ?? decisionTimestampParis)),
    timezone: stringOrNull(raw.timezone) ?? "Europe/Paris",
    thesis_id: chain.thesis_id,
    mission_id: chain.mission_id,
    setup_id: stringOrNull(raw.setup_id ?? raw.linked_setup_id ?? raw.paper_setup_id),
    position_id: chain.position_id,
    outcome_id: chain.outcome_id,
    audit_id: auditId,
    decision_audit: audit,
    gate_status: chain.gate_status,
    reasons: status.reasons,
    flags: status.flags,
    evidence: status.evidence,
    chain,
    source_payload: objectOrNull(raw.source_payload ?? raw.payload),
    created_at_utc: createdAtUtc,
    created_at_paris: createdAtParis,
  });

  return {
    ...status,
    decision: record,
    record,
    audit_result: auditResult,
    gate_result: gateResult,
  };
}

function unpackDecisionInput(input) {
  if (!input || typeof input !== "object") return {};
  if (input.decision && typeof input.decision === "object" && !Array.isArray(input.decision)) {
    const { decision, ...rest } = input;
    return { ...decision, ...rest, source_payload: input.source_payload ?? decision };
  }
  return { ...input };
}

function normalizeSourceType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const mapped = SOURCE_TYPE_ALIASES[raw] || raw;
  return DECISION_SOURCE_TYPES.includes(mapped) ? mapped : "manual";
}

function normalizeDecisionValue(value, raw = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (CANONICAL_DECISIONS.has(normalized)) return normalized;
  if (["go", "take", "trade", "entry", "buy", "sell"].includes(normalized)) return "prendre";
  if (["no_trade", "not_take", "reject", "rejected", "block"].includes(normalized)) return "ne_pas_prendre";
  if (["manage_only", "management_only", "position_management"].includes(normalized)) return "gestion_seule";
  if (["observe", "observe_only", "draft", "pending", "none"].includes(normalized)) return "wait";
  const side = String(raw.side || raw.direction || "").toLowerCase();
  if (["long", "short"].includes(side)) return "prendre";
  return "wait";
}

function normalizeDirection(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["long", "short", "neutral", "wait"].includes(normalized)) return normalized;
  if (["buy"].includes(normalized)) return "long";
  if (["sell"].includes(normalized)) return "short";
  return "wait";
}

function gateStatus(status, auditResult, gateResult) {
  if (status.status === "rejected") return "blocked";
  if (!auditResult) return "audit_required";
  if (auditResult.status === "rejected") return "blocked";
  if (gateResult.status === "review_required") return "review_required";
  if (status.status === "review_required") return "review_required";
  return "green";
}

function stableDecisionId(parts) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "_")).join("|"))
    .digest("hex")
    .slice(0, 16);
  return `decision_${digest}`;
}

function isoDate(value) {
  const raw = stringOrNull(value);
  if (!raw) return null;
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function stringOrNull(value) {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  return stringValue.length ? stringValue : null;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  );
}
