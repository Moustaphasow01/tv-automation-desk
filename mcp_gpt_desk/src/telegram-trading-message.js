import { telegramOrderQualificationReason } from "./telegram-order-qualification.js";

const ORDER_TYPE_LABELS = Object.freeze({
  market: "AU MARCHÉ",
  limit: "LIMITE",
  stop_market: "STOP AU MARCHÉ",
  stop_limit: "STOP LIMITE",
});

const MANAGEMENT_ACTION_LABELS = Object.freeze({
  move_stop: "Déplacer le stop",
  reduce_position: "Réduire la position",
  close_position: "Clôturer la position",
});

export function buildTelegramTradingMessage({ kind, state, sourceId, payload = {}, occurredAt = null, manualTelegramExecution = false } = {}) {
  if (kind === "theoretical_execution_event") {
    return formatTheoreticalExecutionTicket({ state, sourceId, payload, occurredAt });
  }
  if (kind === "manual_execution_event") {
    return formatManualExecutionReceipt({ state, sourceId, payload, occurredAt });
  }
  if (kind === "order_intent" && manualTelegramExecution) {
    return formatManualEntryTicket({ state, sourceId, payload, occurredAt });
  }
  if (kind === "management_intent" && manualTelegramExecution) {
    return formatManualManagementTicket({ state, sourceId, payload, occurredAt });
  }
  return formatGenericTradingMessage({ kind, state, sourceId, payload });
}

export function buildTelegramTradingCandidate(row = {}, { manualTelegramExecution = false, hash = stableJsonHash, now = Date.now() } = {}) {
  const payload = row.payload || {};
  const state = String(row.source_state || "unknown").toLowerCase();
  const kind = String(row.source_kind || "trade_event");
  if (!isTelegramTradingAlertSourceAllowed({ kind, sourceId: row.source_id, payload })) return null;
  if (telegramTradingDeliverySuppressionReason({ sourceKind: kind, state, payload }, { now })) return null;
  // Raw detections belong in the desk journal, never in the qualified-order channel.
  if (kind === "trade_decision") return null;
  return {
    profile: "trading",
    sourceKey: `${kind}:${row.source_id}`,
    sourceKind: kind,
    state,
    fingerprint: hash({ state, payload }),
    priority: kind === "broker_order_event" || kind === "trade" || kind === "theoretical_execution_event" ? 80 : 65,
    silent: kind === "trade_decision" && ["draft", "no_trade"].includes(state),
    message: buildTelegramTradingMessage({
      kind,
      state,
      sourceId: row.source_id,
      payload,
      occurredAt: row.occurred_at,
      manualTelegramExecution,
    }),
    payload: { ...payload, source_id: row.source_id, source_state: state, occurred_at: dateTime(row.occurred_at) },
  };
}

export function telegramTradingDeliverySuppressionReason(delivery = {}, { now = Date.now() } = {}) {
  const sourceKind = String(delivery.sourceKind || delivery.source_kind || "").toLowerCase();
  if (sourceKind !== "order_intent") return null;
  const payload = delivery.payload && typeof delivery.payload === "object" ? delivery.payload : {};
  const state = String(delivery.state || delivery.sourceState || payload.source_state || "").toLowerCase();
  if (state === "expired") return "ORDER_INTENT_EXPIRED_BEFORE_TELEGRAM_DELIVERY";
  const expiresAt = field(payload, [
    "expires_at",
    "expiresAt",
    "expires_at_utc",
    "valid_until",
    "validUntil",
    "valid_until_utc",
    "human_gate_expires_at_utc",
  ]);
  const expiresAtMs = Date.parse(String(expiresAt || ""));
  const nowMs = epochMs(now);
  if (Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && nowMs >= expiresAtMs) {
    return "ORDER_INTENT_EXPIRED_BEFORE_TELEGRAM_DELIVERY";
  }
  if (!Number.isFinite(nowMs)) return "ORDER_INTENT_CLOCK_UNVERIFIED";
  return telegramOrderQualificationReason(payload);
}

function formatTheoreticalExecutionTicket({ state, sourceId, payload, occurredAt }) {
  const event = String(payload.event_type || state || "unknown").toLowerCase();
  const presentation = {
    entry_filled: ["🟦", "ENTRÉE THÉORIQUE TOUCHÉE"],
    target_hit: ["🎯", "OBJECTIF THÉORIQUE TOUCHÉ"],
    stop_hit: ["🛑", "STOP THÉORIQUE TOUCHÉ"],
    entry_expired: ["⌛", "ORDRE THÉORIQUE EXPIRÉ"],
    exit_review_required: ["⚠️", "SORTIE THÉORIQUE À REVOIR"],
  }[event] || ["📊", `SUIVI THÉORIQUE ${upper(event)}`];
  const resultR = finite(payload.result_r);
  const lines = [
    `${presentation[0]} ${presentation[1]}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `📍 ${text(payload.instrument, "Instrument N/D")} · ${upper(payload.side)}`,
    `• Prix événement: ${price(payload.price)}`,
    `• Entrée suivie: ${price(payload.entry_price)}`,
    `• Sortie: ${price(payload.exit_price)}`,
    `• Résultat théorique: ${resultR === null ? "en cours / N.D." : `${resultR >= 0 ? "+" : ""}${formatNumber(resultR)}R`}`,
    "",
    "🧪 Simulation backend déterministe",
    "⚠️ Aucun fill broker n’est déduit de cet événement.",
    `🧾 OrderIntent: ${text(payload.portfolio_order_intent_id, "N/D")}`,
    `🔎 Trade: ${text(payload.trade_id, "N/D")} · Réf: ${text(sourceId)} · ${dateTime(occurredAt)}`,
  ];
  return lines.join("\n");
}

function formatManualExecutionReceipt({ state, sourceId, payload, occurredAt }) {
  return [
    `👤 DÉCLARATION OPÉRATEUR — ${upper(payload.event_type || state)}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `📍 ${text(payload.instrument, "Instrument N/D")}`,
    `• Quantité déclarée: ${quantity(payload.quantity)}`,
    `• Prix déclaré: ${price(payload.price)}`,
    `• Source: ${text(payload.source, "N/D")} · acteur: ${text(payload.actor, "N/D")}`,
    `📝 ${oneLine(payload.reason || "Aucun motif publié")}`,
    "ℹ️ Cette déclaration sert à l’attribution opérateur ; elle ne réécrit pas le suivi théorique.",
    `🔎 OrderIntent: ${text(payload.portfolio_order_intent_id, "N/D")} · Réf: ${text(sourceId)} · ${dateTime(occurredAt)}`,
  ].join("\n");
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
  const gateStatus = field(payload, ["human_gate_status", "humanGateStatus", "human_execution_gate_status"], "NON PUBLIÉ");
  const strategyId = field(payload, ["strategy_id", "strategyId"]);
  const strategyInstanceId = field(payload, ["strategy_instance_id", "strategyInstanceId"]);
  const stop = pickPrice(payload, [["protective_stop"], ["bracket", "stop_price"], ["stop_loss"]]);
  const target = pickPrice(payload, [["profit_target"], ["bracket", "target_price"], ["take_profit"]]);
  const riskDecision = field(payload, ["risk_decision", "risk_status"]);
  const contextDecision = field(payload, ["context_gate_decision", "ai_context_recommendation"]);
  const riskAmount = field(payload, ["risk_amount", "riskAmount"]);
  const expectedR = field(payload, ["expected_r", "expectedR", "reward_risk", "rewardRisk"]);
  const validity = dateTime(payload.expires_at || payload.valid_until);
  const orderIntentId = text(payload.order_intent_id || sourceId, "N/D");
  const lines = [
    `${telegramOrderQualificationReason(payload) ? "ℹ️ DOSSIER À VÉRIFIER" : "🔔 ORDRE QUALIFIÉ — À CONFIRMER"} — ${side.icon} ${side.label} ${instrument}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `🎯 Action: ${side.label} · ${orderType}`,
    `🧾 OrderIntent: ${orderIntentId}`,
    `🧠 Stratégie: ${text(strategyId, "N/D")}`,
    `🧩 Instance: ${text(strategyInstanceId, "N/D")}`,
    "",
    "📍 Prix à poser",
    `• Quantité: ${quantity(payload.quantity)} contrat(s)`,
    `• Entrée: ${entry}`,
    `• Stop: ${price(stop)}`,
    `• TP: ${price(target)}`,
    "",
    "🛡️ Contrôles desk",
    `• Desk: ${upper(state)}`,
    `• Validation humaine: ${upper(gateStatus)}`,
    `• Décision risque: ${text(riskDecision, "N/D")}`,
    `• Contexte: ${text(contextDecision, "N/D")}`,
    `• Risque: ${riskAmount === null || riskAmount === undefined ? "N/D" : text(riskAmount)}${expectedR === null || expectedR === undefined ? "" : ` · RR/R attendu: ${text(expectedR)}`}`,
    "",
    `⏱️ Validité: ${validity}`,
    "⚠️ Notification ≠ exécution. Vérifier le dossier et les actions autorisées dans le Desk avant toute intervention.",
  ];
  if (payload.invalidation) lines.push(`Invalidation: ${oneLine(invalidationReason(payload.invalidation))}`);
  if (payload.rationale) lines.push(`📝 Lecture: ${oneLine(payload.rationale)}`);
  lines.push(`🔎 Réf: ${text(sourceId)} · ${dateTime(occurredAt)}`);
  return lines.join("\n");
}

function formatManualManagementTicket({ state, sourceId, payload, occurredAt }) {
  const action = MANAGEMENT_ACTION_LABELS[String(payload.action || "").toLowerCase()] || text(payload.action, "Gestion requise");
  const instrument = text(payload.instrument || payload.broker_symbol || payload.symbol, "Instrument N/D");
  const lines = [
    `🛡️ GESTION MANUELLE — ${action}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `📍 Instrument: ${instrument}`,
    `• État desk: ${upper(state)}`,
    `• Quantité: ${quantity(payload.quantity)}`,
    `• Nouveau stop: ${price(payload.stop_price ?? payload.requested_stop_price)}`,
    `📝 Raison: ${oneLine(payload.reason || "mise à jour du plan de gestion")}`,
    "⚠️ Aucun ordre Ninja/broker n’a été envoyé. Modifier manuellement la position si elle est ouverte.",
    `🔎 Trade: ${text(payload.trade_id, "N/D")} · Réf: ${text(sourceId)} · ${dateTime(occurredAt)}`,
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
    theoretical_execution_event: "Suivi théorique",
    manual_execution_event: "Déclaration opérateur",
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
  if (["buy", "long"].includes(normalized)) return { label: "ACHAT", icon: "🟢" };
  return { label: "SENS NON PUBLIÉ", icon: "⚪" };
}

function orderTypeLabel(value) {
  return ORDER_TYPE_LABELS[String(value || "").toLowerCase()] || upper(value || "ordre");
}

function entryInstruction(payload) {
  const type = String(payload.order_type || "").toLowerCase();
  if (type === "market") return "AU MARCHÉ — après validation opérateur";
  if (type === "limit") return `LIMITE ${price(payload.limit_price ?? payload.entry_price)}`;
  if (type === "stop_market") return `STOP ${price(payload.stop_price ?? payload.entry_price)}`;
  if (type === "stop_limit") return `STOP ${price(payload.stop_price)} / LIMIT ${price(payload.limit_price)}`;
  return price(payload.entry_price ?? payload.limit_price ?? payload.stop_price);
}

function quantity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "N/D";
}

function price(value) {
  const parsed = finite(value);
  return parsed === null ? "N/D" : formatNumber(parsed);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function epochMs(value) {
  const resolved = typeof value === "function" ? value() : value;
  if (typeof resolved === "number") return resolved;
  if (resolved instanceof Date) return resolved.getTime();
  const parsed = Date.parse(String(resolved || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}
