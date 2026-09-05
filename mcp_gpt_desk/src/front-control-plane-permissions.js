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
  const status = gateStatus(gate, nowIso);
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
    || joinedHumanGate(portfolioIntent);
}

function joinedHumanGate(intent) {
  if (!intent?.human_execution_gate_id) return null;
  return {
    human_execution_gate_id: intent.human_execution_gate_id,
    status: intent.human_gate_status,
    revision: intent.human_gate_revision,
    expires_at_utc: intent.human_gate_expires_at_utc,
    confirmed_at_utc: intent.human_gate_confirmed_at_utc,
    rejected_at_utc: intent.human_gate_rejected_at_utc,
    undo_expires_at_utc: intent.human_gate_undo_expires_at_utc,
    undone_at_utc: intent.human_gate_undone_at_utc,
  };
}

function gateStatus(gate, nowIso) {
  if (!gate) return "NOT_CREATED";
  const status = upper(gate.status || "UNKNOWN");
  const expiry = Date.parse(gate.expires_at_utc || "");
  return status === "AWAITING_MANUAL_CONFIRMATION" && expiry <= Date.parse(nowIso)
    ? "EXPIRED" : status;
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
  const publishedActions = rows(additionalAllowedActions).map(upper);
  if (["OrderIntent", "HumanGate"].includes(resourceType) && operatorCanWrite && awaitingGate) {
    actions.push(...publishedActions.filter((action) => ["CONFIRM", "REJECT"].includes(action)));
    if (!actions.includes("CONFIRM")) denialReasons.push("HUMAN_GATE_ACTION_UNAVAILABLE");
  }
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

export function manualExecutionTransition({
  operatorDecision = "",
  manualStatus = "",
  tradeStatus = "",
  theoreticalStatus = "",
  planComplete = false,
  actor = {},
} = {}) {
  const operatorCanWrite = permissions(actor).some((item) => item.capability === "execution.paper" && item.allowed);
  const decision = upper(operatorDecision);
  const manual = upper(manualStatus || "NOT_REPORTED");
  const trade = upper(tradeStatus);
  const theoretical = upper(theoreticalStatus);
  const allowedEventTypes = [];
  const denialReasons = [];

  if (!operatorCanWrite) denialReasons.push("WRITE_REQUIRES_OPERATOR_SESSION");
  if (decision !== "CONFIRMED") denialReasons.push("HUMAN_GATE_CONFIRMATION_REQUIRED");
  if (!planComplete) denialReasons.push("ORDER_PLAN_INCOMPLETE");
  if (["EXPIRED", "ENTRY_EXPIRED", "REJECTED", "INVALIDATED"].includes(theoretical)) denialReasons.push("ORDER_INTENT_NOT_ACTIONABLE");
  if (["CLOSED", "SKIPPED"].includes(manual)) denialReasons.push("MANUAL_EXECUTION_TERMINAL");

  if (!denialReasons.length) {
    if (["", "NOT_REPORTED", "NOTE", "MODIFIED"].includes(manual)) allowedEventTypes.push("PLACED", "SKIPPED");
    if (manual === "PLACED") allowedEventTypes.push("FILLED", "MODIFIED", "SKIPPED", "NOTE");
    if (manual === "FILLED" || (manual === "MODIFIED" && !["CLOSED", "CANCELLED", "EXPIRED"].includes(trade))) allowedEventTypes.push("CLOSED", "MODIFIED", "NOTE");
  }

  return { allowedEventTypes, denialReasons, operatorCanWrite };
}

export function manualExecutionActionProjection({
  portfolioOrderIntentId,
  tradeId = "",
  instrument = "",
  side = "",
  quantity = null,
  operatorDecision = "",
  manualStatus = "",
  tradeStatus = "",
  theoreticalStatus = "",
  planComplete = false,
  revision = "unavailable",
  actor = {},
  stopPlaced = false,
} = {}) {
  const transition = manualExecutionTransition({ operatorDecision, manualStatus, tradeStatus, theoreticalStatus, planComplete, actor });
  const actionDefinitions = {
    PLACED: { action: "REPORT_PLACED", commandType: "execution.order_intent.manual_placed", label: "J’ai passé l’ordre", requiresPrice: true, requiresQuantity: true, impactPreview: "Enregistre une déclaration opérateur observationnelle. Aucun fill broker ni fill théorique n’est créé." },
    FILLED: { action: "REPORT_FILLED", commandType: "execution.order_intent.manual_filled", label: "Déclarer le fill manuel", requiresPrice: true, requiresQuantity: true, impactPreview: "Enregistre le prix et la quantité déclarés par l’opérateur sans modifier le suivi théorique backend." },
    CLOSED: { action: "REPORT_CLOSED", commandType: "execution.order_intent.manual_closed", label: "J’ai clôturé la position", requiresPrice: true, requiresQuantity: false, impactPreview: "Enregistre une clôture manuelle déclarative. Le résultat théorique reste indépendant." },
    SKIPPED: { action: "REPORT_SKIPPED", commandType: "execution.order_intent.manual_skipped", label: "Je n’ai pas pris l’ordre", requiresPrice: false, requiresQuantity: false, impactPreview: "Enregistre une opportunité non exécutée manuellement sans annuler son suivi théorique." },
    MODIFIED: { action: "REPORT_MODIFIED", commandType: "execution.order_intent.manual_modified", label: "Corriger ma déclaration", requiresPrice: false, requiresQuantity: false, impactPreview: "Ajoute une correction auditée ; l’historique précédent reste conservé." },
    NOTE: { action: "REPORT_STOP_PLACED", commandType: "execution.order_intent.manual_note", label: "Stop de protection placé", requiresPrice: false, requiresQuantity: false, impactPreview: "Consigne que le stop de protection a été placé manuellement. Cette déclaration ne modifie pas le plan Risk." },
  };
  const payload = {
    portfolioOrderIntentId: text(portfolioOrderIntentId, ""),
    tradeId: text(tradeId, ""),
    instrument: text(instrument, ""),
    side: text(side, ""),
    expectedQuantity: Number.isFinite(Number(quantity)) ? Number(quantity) : 0,
  };
  return {
    status: upper(manualStatus || "NOT_REPORTED"),
    allowedActions: transition.allowedEventTypes.filter((eventType) => eventType !== "NOTE" || !stopPlaced).map((eventType) => {
      const definition = actionDefinitions[eventType];
      return {
        ...definition,
        eventType,
        actionId: `manual-execution.${eventType.toLowerCase()}.${text(portfolioOrderIntentId, "unknown")}.${revision}`,
        environment: "PAPER",
        permission: "ALLOWED",
        requiresConfirmation: true,
        requiresReason: ["SKIPPED", "MODIFIED"].includes(eventType),
        expectedRevision: text(revision, "unavailable"),
        payload: eventType === "NOTE" ? { ...payload, noteType: "STOP_PLACED" } : payload,
      };
    }),
    denialReasons: transition.denialReasons,
    stopPlacement: { placed: stopPlaced, source: stopPlaced ? "trade_manual_execution_events" : "NOT_REPORTED" },
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
