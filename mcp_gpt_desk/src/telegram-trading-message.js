const ORDER_TYPE_LABELS = Object.freeze({
  market: "MARKET",
  limit: "LIMIT",
  stop_market: "STOP MARKET",
  stop_limit: "STOP LIMIT",
});

const MANAGEMENT_ACTION_LABELS = Object.freeze({
  move_stop: "Déplacer le stop",
  reduce_position: "Réduire la position",
  close_position: "Clôturer la position",
});

export function buildTelegramTradingMessage({ kind, state, sourceId, payload = {}, occurredAt = null, manualTelegramExecution = false } = {}) {
  if (kind === "order_intent" && manualTelegramExecution) {
    return formatManualEntryTicket({ state, sourceId, payload, occurredAt });
  }
  if (kind === "management_intent" && manualTelegramExecution) {
    return formatManualManagementTicket({ state, sourceId, payload, occurredAt });
  }
  return formatGenericTradingMessage({ kind, state, sourceId, payload });
}

export function buildTelegramTradingCandidate(row = {}, { manualTelegramExecution = false, hash = stableJsonHash } = {}) {
  const payload = row.payload || {};
  const state = String(row.source_state || "unknown").toLowerCase();
  const kind = String(row.source_kind || "trade_event");
  if (!isTelegramTradingAlertSourceAllowed({ kind, sourceId: row.source_id, payload })) return null;
  if (kind === "trade_decision" && (state === "draft" || !payload.side)) return null;
  return {
    profile: "trading",
    sourceKey: `${kind}:${row.source_id}`,
    sourceKind: kind,
    state,
    fingerprint: hash({ state, payload }),
    priority: kind === "broker_order_event" || kind === "trade" ? 80 : 65,
    silent: kind === "trade_decision" && ["draft", "no_trade"].includes(state),
    message: buildTelegramTradingMessage({
      kind,
      state,
      sourceId: row.source_id,
      payload,
      occurredAt: row.occurred_at,
      manualTelegramExecution,
    }),
    payload: { source_id: row.source_id, occurred_at: dateTime(row.occurred_at), ...payload },
  };
}

export function isTelegramTradingAlertSourceAllowed({ kind, sourceId, payload = {} } = {}) {
  const haystack = [
    kind,
    sourceId,
    payload.reason,
    payload.rationale,
    payload.strategy,
    payload.strategy_id,
    payload.trade_id,
    payload.decision_id,
    payload.source_document_id,
    payload.run_id,
  ].filter((value) => value !== null && value !== undefined).join(" ");
  return !NON_OPERATIONAL_TRADING_ALERT_PATTERNS.some((pattern) => pattern.test(haystack));
}

function formatManualEntryTicket({ state, sourceId, payload, occurredAt }) {
  const side = sideLabel(payload.side);
  const instrument = text(payload.instrument || payload.broker_symbol || payload.symbol, "Instrument N/D");
  const orderType = orderTypeLabel(payload.order_type);
  const entry = entryInstruction(payload);
  const gateStatus = field(payload, ["human_gate_status", "humanGateStatus", "human_execution_gate_status"], "AWAITING_MANUAL_CONFIRMATION");
  const strategyId = field(payload, ["strategy_id", "strategyId"]);
  const strategyInstanceId = field(payload, ["strategy_instance_id", "strategyInstanceId"]);
  const stop = pickPrice(payload, [["protective_stop"], ["bracket", "stop_price"], ["stop_loss"]]);
  const target = pickPrice(payload, [["profit_target"], ["bracket", "target_price"], ["take_profit"]]);
  const riskDecision = field(payload, ["risk_decision", "risk_status"]);
  const contextDecision = field(payload, ["context_gate_decision", "ai_context_recommendation"]);
  const lines = [
    `🚨 MANUAL ACTION REQUIRED — ${side.icon} ${side.label} ${instrument}`,
    `État desk: ${upper(state)} · Human Gate: ${upper(gateStatus)} · Type: ${orderType}`,
    `Strategy: ${text(strategyId, "N/D")} · Instance: ${text(strategyInstanceId, "N/D")}`,
    `Quantité: ${quantity(payload.quantity)} contrat(s)`,
    `Entrée: ${entry}`,
    `Stop: ${price(stop)}`,
    `TP: ${price(target)}`,
    `Risk: ${text(riskDecision, "N/D")} · Context: ${text(contextDecision, "N/D")}`,
    `Validité: ${dateTime(payload.expires_at || payload.valid_until)}`,
    "⚠️ Aucun ordre Ninja/broker n’a été envoyé. Action manuelle opérateur requise.",
    `OrderIntent: ${text(payload.order_intent_id || sourceId, "N/D")}`,
  ];
  if (payload.invalidation) lines.push(`Invalidation: ${oneLine(invalidationReason(payload.invalidation))}`);
  if (payload.rationale) lines.push(`Lecture: ${oneLine(payload.rationale)}`);
  lines.push(`Réf: ${text(sourceId)} · ${dateTime(occurredAt)}`);
  return lines.join("\n");
}

function formatManualManagementTicket({ state, sourceId, payload, occurredAt }) {
  const action = MANAGEMENT_ACTION_LABELS[String(payload.action || "").toLowerCase()] || text(payload.action, "Gestion requise");
  const instrument = text(payload.instrument || payload.broker_symbol || payload.symbol, "Instrument N/D");
  const lines = [
    `🛡️ GESTION MANUELLE — ${action}`,
    `Instrument: ${instrument} · État desk: ${upper(state)}`,
    `Quantité: ${quantity(payload.quantity)}`,
    `Nouveau stop: ${price(payload.stop_price ?? payload.requested_stop_price)}`,
    `Raison: ${oneLine(payload.reason || "mise à jour du plan de gestion")}`,
    "⚠️ Aucun ordre Ninja/broker n’a été envoyé. Modifier manuellement la position si elle est ouverte.",
    `Trade: ${text(payload.trade_id, "N/D")} · Réf: ${text(sourceId)} · ${dateTime(occurredAt)}`,
  ];
  return lines.join("\n");
}

function formatGenericTradingMessage({ kind, state, sourceId, payload }) {
  const icon = terminalStates.has(String(state || "").toLowerCase())
    ? "🏁"
    : kind === "trade_decision"
      ? "🧠"
      : kind === "management_intent"
        ? "🛡️"
        : "📈";
  const title = {
    trade_decision: "Décision trading",
    order_intent: "Ordre préparé",
    broker_order_event: "Événement broker",
    trade: "Cycle de trade",
    management_intent: "Gestion de position",
  }[kind] || "Événement trading";
  const details = Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .slice(0, 7)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `${icon} ${title}\nÉtat: ${upper(state)}\n${details || `Référence: ${sourceId}`}`;
}

const terminalStates = new Set(["closed", "cancelled", "rejected", "expired", "error", "failed"]);
const NON_OPERATIONAL_TRADING_ALERT_PATTERNS = Object.freeze([
  /n14_addon_acceptance/i,
  /n14 physical acceptance/i,
  /physical n14 addon acceptance/i,
  /manual_execution_test/i,
  /manual_test/i,
]);

function sideLabel(value) {
  const normalized = String(value || "").toLowerCase();
  if (["sell", "short"].includes(normalized)) return { label: "VENTE", icon: "🔴" };
  return { label: "ACHAT", icon: "🟢" };
}

function orderTypeLabel(value) {
  return ORDER_TYPE_LABELS[String(value || "").toLowerCase()] || upper(value || "ordre");
}

function entryInstruction(payload) {
  const type = String(payload.order_type || "").toLowerCase();
  if (type === "market") return "MARKET maintenant";
  if (type === "limit") return `LIMIT ${price(payload.limit_price ?? payload.entry_price)}`;
  if (type === "stop_market") return `STOP ${price(payload.stop_price ?? payload.entry_price)}`;
  if (type === "stop_limit") return `STOP ${price(payload.stop_price)} / LIMIT ${price(payload.limit_price)}`;
  return price(payload.entry_price ?? payload.limit_price ?? payload.stop_price);
}

function quantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "N/D";
}

function price(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? formatNumber(parsed) : "N/D";
}

function formatNumber(value) {
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 4, useGrouping: true });
}

function dateTime(value) {
  if (!value) return "N/D";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace(".000Z", "Z") : String(value);
}

function oneLine(value) {
  return text(value, "N/D").replace(/\s+/g, " ").slice(0, 500);
}

function upper(value) {
  return text(value, "UNKNOWN").toUpperCase();
}

function text(value, fallback = "") {
  const result = value === null || value === undefined ? "" : String(value).trim();
  return result || fallback;
}

function field(source, keys, fallback = null) {
  const record = source && typeof source === "object" ? source : {};
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return fallback;
}

function pickPrice(source, paths) {
  for (const path of paths) {
    const value = nestedField(source, path);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function nestedField(source, path) {
  let cursor = source;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = cursor[key];
  }
  return cursor;
}

function invalidationReason(value) {
  if (!value || typeof value !== "object") return value;
  return value.reason || value.condition || value.reason_code || value;
}

function stableJsonHash(value) {
  return JSON.stringify(value);
}
