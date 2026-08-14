import { canonicalSha256 } from "@tv-automation/desk-domain";

export { canonicalSha256 };

export const DEFAULT_REPOSITORY_NOW_UTC = "1970-01-01T00:00:00.000Z";

export function normalizeLineage(lineage = {}) {
  const payload = intentPayload(lineage);
  return {
    ...lineage,
    portfolio_order_intent_id: text(lineage.portfolio_order_intent_id || payload.order_intent_id),
    target_position_id: text(lineage.target_position_id || payload.target_position_id),
    trade_order_intent_id: text(lineage.trade_order_intent_id) || null,
    idempotency_key: text(lineage.idempotency_key || payload.idempotency_key),
    status: text(lineage.status || payload.status || "READY").toUpperCase(),
    broker_submission_allowed: lineage.broker_submission_allowed === true || payload.broker_submission_allowed === true,
    quantity: integer(lineage.quantity || payload.quantity),
    order_intent_payload: payload,
    payload,
    target_account_id: text(lineage.target_account_id || payload.account_id || payload.broker_account_id),
    target_instrument: text(lineage.target_instrument || payload.instrument).toUpperCase(),
    candidate_allocation_ids: array(lineage.candidate_allocation_ids || payload.source?.candidate_allocation_ids),
    risk_decision_ids: array(lineage.risk_decision_ids || payload.source?.risk_decision_ids),
    expires_at_utc: nullableText(lineage.expires_at_utc || lineage.expires_at || payload.expires_at_utc || payload.expires_at),
    human_execution_gate_id: nullableText(lineage.human_execution_gate_id || lineage.human_gate_id),
    human_gate_status: nullableText(lineage.human_gate_status),
    human_gate_revision: integer(lineage.human_gate_revision),
    human_gate_operator_id: nullableText(lineage.human_gate_operator_id),
    human_gate_confirmed_at_utc: nullableText(lineage.human_gate_confirmed_at_utc),
    human_gate_rejected_at_utc: nullableText(lineage.human_gate_rejected_at_utc),
    human_gate_expires_at_utc: nullableText(lineage.human_gate_expires_at_utc),
    human_gate_terms_hash: nullableText(lineage.human_gate_terms_hash),
  };
}

export function intentPayload(lineage = {}) {
  return record(lineage.order_intent_payload) || record(lineage.payload) || record(lineage.intent) || {};
}

export function providerCommandEnvelope({ lineage, plan, nowUtc }) {
  return {
    schema_version: "execution_provider_command_envelope_v1",
    materialized_at_utc: nowUtc,
    plan_hash: plan.plan_hash,
    provider_command: plan.provider_command,
    order_intent_payload: lineage.order_intent_payload || lineage.payload || null,
    portfolio_order_intent_id: lineage.portfolio_order_intent_id,
    target_position_id: lineage.target_position_id,
    source: {
      kind: "PORTFOLIO_ORDER_INTENT_LINEAGE",
      portfolio_order_intent_id: lineage.portfolio_order_intent_id,
      target_position_id: lineage.target_position_id,
      trade_order_intent_id: lineage.trade_order_intent_id || null,
    },
  };
}

export function activeProviderStatuses() {
  return new Set(["pending", "leased", "sent", "acknowledged", "unknown", "reconciliation_required"]);
}

export function toSqlCommandType(value) { return String(value || "").toLowerCase(); }
export async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows || []; }
export async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
export function repositoryError(code, message) { const error = new Error(message || code); error.code = code; error.statusCode = 503; return error; }
export function json(value) { return JSON.stringify(value ?? {}); }
export function clone(value) { return JSON.parse(JSON.stringify(value)); }
export function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
export function array(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
export function text(value) { return String(value ?? "").trim(); }
export function integer(value) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0; }
export function boundedLimit(value) { return Math.max(1, Math.min(Number(value) || 100, 500)); }
export function nullableText(value) { const normalized = text(value); return normalized || null; }
export function hash(value) { return `sha256:${canonicalSha256(value)}`; }

export function isExpired(value, nowUtc) {
  if (!value) return false;
  const expiry = Date.parse(value);
  const now = Date.parse(nowUtc || DEFAULT_REPOSITORY_NOW_UTC);
  return Number.isFinite(expiry) && Number.isFinite(now) && expiry <= now;
}

export function hasValue(value) { return value !== undefined && value !== null && value !== ""; }

export function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
