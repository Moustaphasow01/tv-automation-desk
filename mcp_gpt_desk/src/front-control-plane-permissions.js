import { number, rows, text, upper } from "./front-control-plane-projection-helpers.js";

export function permissions(actor = {}) {
  const writeAllowed = ["operator_session", "api_key", "oauth"].includes(String(actor.kind || "")) && rows(actor.scopes).includes("desk.write");
  return [
    { capability: "front.read", allowed: true },
    { capability: "front.command", allowed: writeAllowed, reason: writeAllowed ? undefined : "WRITE_REQUIRES_OPERATOR_SESSION", requiresStepUp: !writeAllowed },
    { capability: "execution.paper", allowed: writeAllowed, reason: writeAllowed ? undefined : "WRITE_REQUIRES_OPERATOR_SESSION", requiresStepUp: !writeAllowed },
    { capability: "execution.live", allowed: false, reason: "LIVE_CUTOVER_LOCKED", requiresStepUp: true },
  ];
}

export function orderHumanGateProjection({ execution, portfolioIntent, actor }) {
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
    actions: gateActions({ gate, status, portfolioIntent, operatorCanWrite }),
    unavailableReason: gateUnavailableReason(gate, operatorCanWrite),
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

function gateActions({ gate, status, portfolioIntent, operatorCanWrite }) {
  return gate && status === "AWAITING_MANUAL_CONFIRMATION"
    ? humanGateActions({ portfolioIntent, operatorCanWrite })
    : [];
}

function gateUnavailableReason(gate, operatorCanWrite) {
  if (!gate) return "HUMAN_GATE_NOT_CREATED";
  return operatorCanWrite ? "" : "Session desk.write requise ; le front ne peut pas inventer d'autorisation locale.";
}

export function resourceAllowedActions({ resourceType, status, revision = "unavailable", actor = {}, expiresAt = "" }) {
  const operatorCanRead = permissions(actor).some((item) => item.capability === "front.read" && item.allowed);
  const operatorCanWrite = permissions(actor).some((item) => item.capability === "front.command" && item.allowed);
  const normalizedStatus = upper(status);
  const actions = operatorCanRead ? ["VIEW"] : [];
  const denialReasons = [];
  const awaitingGate = normalizedStatus === "AWAITING_MANUAL_CONFIRMATION" || normalizedStatus === "READY";
  if (["OrderIntent", "HumanGate"].includes(resourceType) && operatorCanWrite && awaitingGate) actions.push("CONFIRM", "REJECT");
  else if (["OrderIntent", "HumanGate"].includes(resourceType) && awaitingGate) denialReasons.push("WRITE_REQUIRES_OPERATOR_SESSION");
  if (["OrderIntent", "HumanGate"].includes(resourceType) && normalizedStatus === "HUMAN_GATE_NOT_CREATED") denialReasons.push("HUMAN_GATE_NOT_CREATED");
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

function humanGateActions({ portfolioIntent, operatorCanWrite }) {
  const payload = portfolioIntent.order_intent_payload || portfolioIntent.payload || {};
  const portfolioOrderIntentId = text(portfolioIntent.portfolio_order_intent_id || payload.order_intent_id, "");
  const expectedRevision = text(portfolioIntent.order_intent_hash || payload.order_intent_hash || portfolioIntent.human_gate_revision, "unavailable");
  const permission = operatorCanWrite ? "ALLOWED" : "DENIED";
  return [
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
}
