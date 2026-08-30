import { number, rows, text, upper } from "./front-control-plane-projection-helpers.js";
import { currentUtc } from "./front-control-plane-common.js";

export function permissions(actor = {}) {
  const writeAllowed = ["operator_session", "api_key", "oauth"].includes(String(actor.kind || "")) && rows(actor.scopes).includes("desk.write");
  return [
    { capability: "front.read", allowed: true },
    { capability: "front.command", allowed: writeAllowed, reason: writeAllowed ? undefined : "WRITE_REQUIRES_OPERATOR_SESSION", requiresStepUp: !writeAllowed },
    { capability: "execution.paper", allowed: writeAllowed, reason: writeAllowed ? undefined : "WRITE_REQUIRES_OPERATOR_SESSION", requiresStepUp: !writeAllowed },
    { capability: "execution.live", allowed: false, reason: "LIVE_CUTOVER_LOCKED", requiresStepUp: true },
  ];
}

export function orderHumanGateProjection({ execution, portfolioIntent, actor, nowIso = currentUtc() }) {
  const gate = findHumanGate(execution, portfolioIntent);
  const status = gateStatus(gate, portfolioIntent);
  const operatorCanWrite = permissions(actor).some((item) => item.capability === "front.command" && item.allowed);
  return {
    gateId: text(gate?.human_execution_gate_id || portfolioIntent?.human_execution_gate_id, ""),
    status,
    revision: number(gate?.revision || portfolioIntent?.human_gate_revision, 0),
    expiresAt: text(gate?.expires_at_utc || portfolioIntent?.human_gate_expires_at_utc || portfolioIntent?.expires_at_utc, ""),
    confirmedAt: text(gate?.confirmed_at_utc || portfolioIntent?.human_gate_confirmed_at_utc, ""),
    rejectedAt: text(gate?.rejected_at_utc || portfolioIntent?.human_gate_rejected_at_utc, ""),
    undoExpiresAt: text(gate?.undo_expires_at_utc || portfolioIntent?.human_gate_undo_expires_at_utc, ""),
    undoneAt: text(gate?.undone_at_utc || portfolioIntent?.human_gate_undone_at_utc, ""),
    actions: gateActions({ execution, gate, status, portfolioIntent, operatorCanWrite, nowIso }),
    unavailableReason: gateUnavailableReason(gate, operatorCanWrite, nowIso),
  };
}

function findHumanGate(execution, portfolioIntent) {
  const portfolioOrderIntentId = text(portfolioIntent?.portfolio_order_intent_id, "");
  return rows(execution?.humanExecutionGates)
    .find((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId)
    || (portfolioIntent?.human_execution_gate_id ? portfolioIntent : null);
}

function gateStatus(gate, portfolioIntent) {
  return gate ? upper(gate.status || portfolioIntent?.human_gate_status || "UNKNOWN") : "NOT_CREATED";
}

function gateActions({ execution, gate, status, portfolioIntent, operatorCanWrite, nowIso }) {
  if (!gate) return [];
  if (status === "AWAITING_MANUAL_CONFIRMATION") return humanGateActions({ gate, portfolioIntent, operatorCanWrite });
  const undoExpiry = Date.parse(gate.undo_expires_at_utc || "");
  const now = Date.parse(nowIso || "");
  const portfolioOrderIntentId = text(portfolioIntent?.portfolio_order_intent_id || portfolioIntent?.payload?.order_intent_id, "");
  const providerCommandExists = rows(execution?.providerCommands).some((command) => text(command.portfolio_order_intent_id, "") === portfolioOrderIntentId);
  if (["CONFIRMED", "REJECTED"].includes(status) && Number.isFinite(undoExpiry) && Number.isFinite(now) && undoExpiry > now && !providerCommandExists) {
    return humanGateActions({ gate, portfolioIntent, operatorCanWrite, onlyUndo: true });
  }
  return [];
}

function gateUnavailableReason(gate, operatorCanWrite, nowIso) {
  if (!gate) return "HUMAN_GATE_NOT_CREATED";
  if (!operatorCanWrite) return "Session desk.write requise ; le front ne peut pas inventer d'autorisation locale.";
  const undoExpiry = Date.parse(gate.undo_expires_at_utc || "");
  const now = Date.parse(nowIso || "");
  if (["CONFIRMED", "REJECTED"].includes(upper(gate.status)) && (!Number.isFinite(undoExpiry) || undoExpiry <= now)) return "Fenêtre d’annulation backend terminée.";
  return "";
}

export function resourceAllowedActions({ resourceType, status, revision = "unavailable", actor = {}, expiresAt = "", additionalAllowedActions = [] }) {
  const operatorCanRead = permissions(actor).some((item) => item.capability === "front.read" && item.allowed);
  const operatorCanWrite = permissions(actor).some((item) => item.capability === "front.command" && item.allowed);
  const normalizedStatus = upper(status);
  const actions = operatorCanRead ? ["VIEW"] : [];
  const denialReasons = [];
  const awaitingGate = normalizedStatus === "AWAITING_MANUAL_CONFIRMATION" || normalizedStatus === "READY";
  if (["OrderIntent", "HumanGate"].includes(resourceType) && operatorCanWrite && awaitingGate) actions.push("CONFIRM", "REJECT");
  else if (["OrderIntent", "HumanGate"].includes(resourceType) && awaitingGate) denialReasons.push("WRITE_REQUIRES_OPERATOR_SESSION");
  if (["OrderIntent", "HumanGate"].includes(resourceType) && normalizedStatus === "HUMAN_GATE_NOT_CREATED") denialReasons.push("HUMAN_GATE_NOT_CREATED");
  if (["OrderIntent", "HumanGate"].includes(resourceType) && operatorCanWrite) {
    for (const action of rows(additionalAllowedActions).map(upper)) if (!["VIEW", "CONFIRM", "REJECT"].includes(action) && !actions.includes(action)) actions.push(action);
  }
  if (resourceType === "BrokerOrder") denialReasons.push("BROKER_ORDER_DIRECT_MUTATION_DENIED");
  return {
    resourceType,
    allowedActions: actions,
    denialReasons,
    revision,
    requiresStepUp: denialReasons.includes("WRITE_REQUIRES_OPERATOR_SESSION"),
    reasonRequired: actions.some((item) => ["CONFIRM", "REJECT", "RECONCILE", "RETRY"].includes(item)),
    expiresAt: expiresAt || null,
  };
}

function humanGateActions({ gate, portfolioIntent, operatorCanWrite, onlyUndo = false }) {
  const payload = portfolioIntent.order_intent_payload || portfolioIntent.payload || {};
  const portfolioOrderIntentId = text(portfolioIntent.portfolio_order_intent_id || payload.order_intent_id, "");
  const expectedRevision = text(gate?.revision || portfolioIntent.human_gate_revision, "unavailable");
  const permission = operatorCanWrite ? "ALLOWED" : "DENIED";
  const decisionActions = [
    {
      action: "CONFIRM",
      actionId: `human-gate.confirm.${portfolioOrderIntentId}`,
      label: "Confirmer OrderIntent PAPER",
      commandType: "execution.order_intent.confirm",
      environment: "PAPER",
      permission,
      requiresConfirmation: true,
      requiresReason: true,
      expectedRevision,
      impactPreview: "Autorise uniquement le passage Human Gate ; aucune preuve provider ni fill n'est créée par cette action.",
      payload: { portfolioOrderIntentId },
    },
    {
      action: "REJECT",
      actionId: `human-gate.reject.${portfolioOrderIntentId}`,
      label: "Rejeter OrderIntent",
      commandType: "execution.order_intent.reject",
      environment: "PAPER",
      permission,
      requiresConfirmation: true,
      requiresReason: true,
      expectedRevision,
      impactPreview: "Bloque l'intention post-risk sans modifier les termes immuables.",
      payload: { portfolioOrderIntentId },
    },
  ];
  if (!onlyUndo) return decisionActions;
  return [{
    action: "UNDO",
    actionId: `human-gate.undo.${portfolioOrderIntentId}.${expectedRevision}`,
    label: "Annuler la décision",
    commandType: "execution.order_intent.undo",
    environment: "PAPER",
    permission,
    requiresConfirmation: true,
    requiresReason: true,
    expectedRevision,
    impactPreview: "Rouvre le Human Gate uniquement si la fenêtre backend est encore active et qu’aucune commande provider n’existe.",
    payload: { portfolioOrderIntentId },
  }];
}
