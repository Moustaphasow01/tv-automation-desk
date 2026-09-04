import type { LiveFocusView } from "@/domains/front-api/viewModels";
import { operatorCode, operatorCopy, operatorReason } from "@/design-system/operatorVocabulary";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { displayTime, displayValue } from "./mapper";

export type FocusQueueFilter = "ALL" | "ACTIONABLE" | "QUALIFIED" | "EXPIRED";
type FocusQueueItemKind = "trade";
type FocusQueueStepTone = "done" | "active" | "blocked" | "muted";
type FocusSignalFlowTone = "neutral" | "info" | "warning" | "danger";

export type FocusQueueTimelineStep = {
  label: string;
  value: string;
  tone: FocusQueueStepTone;
};

export type FocusQueueOrderPlan = {
  orderType: string;
  entry: string;
  stop: string;
  target1: string;
  target2: string;
};

export type FocusQueueItem = {
  kind: FocusQueueItemKind;
  key: string;
  instrument: string;
  side: string;
  title: string;
  status: string;
  statusTone: "success" | "warning" | "info" | "neutral" | "danger";
  createdAt: string | null;
  expiresAt: string | null;
  signalId: string | null;
  route: string | null;
  source: string | null;
  asOf: string | null;
  terminal: boolean;
  actionable: boolean;
  priority: string;
  levelLine: string;
  orderPlan: FocusQueueOrderPlan | null;
  rLine: string;
  reasonLine: string;
  expirationLine: string;
  freshnessLine: string;
  lifecycleLine: string;
  timeline: FocusQueueTimelineStep[];
  card?: LiveFocusView["tradeCards"][number];
  searchText: string;
};

export type FocusSignalFlowItem = {
  key: string;
  instrument: string;
  side: string;
  title: string;
  status: string;
  statusTone: FocusSignalFlowTone;
  gateLabel: string;
  blockerLine: string;
  reasonLine: string;
  createdAt: string | null;
  expiresAt: string | null;
  signalId: string;
  route: string;
  source: string;
  asOf: string | null;
  terminal: boolean;
  expirationLine: string;
  freshnessLine: string;
  searchText: string;
};

export function focusCardActionable(card: LiveFocusView["tradeCards"][number]): boolean {
  const allowed = card.allowedActions.map((action) => String(action).trim().toUpperCase());
  return Boolean((card.actionable ?? allowed.includes("CONFIRM")) && !focusCardTerminal(card));
}

export function focusCardTerminal(card: LiveFocusView["tradeCards"][number]): boolean {
  const statuses = [card.operatorState, card.theoreticalState, card.temporalState, card.terminalReason].map((value) => String(value ?? "").toUpperCase());
  return Boolean(card.terminal || card.expiredByTime || statuses.some((status) => (
    status.includes("EXPIRED")
    || status.includes("CANCEL")
    || status.includes("REJECT")
    || status.includes("STOP_HIT")
    || status.includes("TARGET_HIT")
    || status === "CLOSED"
    || status.includes("VOIDED")
  )));
}

export function focusCardStatus(card: LiveFocusView["tradeCards"][number]): string {
  if (card.lifecycleLabel) return card.lifecycleLabel;
  if (focusCardActionable(card)) return "À décider";
  if (focusCardTerminal(card)) return "Historique";
  return presentBackendStatus(card.operatorState).label;
}

function focusOpportunityTerminal(opportunity: LiveFocusView["observedOpportunities"][number]): boolean {
  const status = String(opportunity.status ?? "").toUpperCase();
  return Boolean(opportunity.terminal || status.includes("EXPIRED") || status.includes("CANCEL") || status.includes("REJECT"));
}

export function focusOpportunityStatus(opportunity: LiveFocusView["observedOpportunities"][number]): string {
  if (opportunity.statusLabel) return opportunity.statusLabel;
  if (focusOpportunityTerminal(opportunity)) return "Signal non actif";
  return presentBackendStatus(opportunity.status).label;
}

function tradeCardLevelSummary(card: LiveFocusView["tradeCards"][number]): string {
  const orderPlan = tradeCardOrderPlan(card);
  const quantity = card.authorizedQuantity === null || card.authorizedQuantity === undefined ? "qty non publiée" : `qty ${displayValue(card.authorizedQuantity)}`;
  return [
    quantity,
    `entrée ${orderPlan.entry}`,
    `stop ${orderPlan.stop}`,
    orderPlan.target1 !== "—" ? `objectif ${[orderPlan.target1, orderPlan.target2].filter((value) => value !== "—").join(" / ")}` : "objectif non publié",
  ].join(" · ");
}

function tradeCardOrderPlan(card: LiveFocusView["tradeCards"][number]): FocusQueueOrderPlan {
  const plan = recordValue(card.riskAuthorizedPlan ?? card.contextAdjustedPlan ?? card.strategyProposedPlan);
  return orderPlanFromTradePlan(plan);
}

function observedOpportunityOrderPlan(opportunity: LiveFocusView["observedOpportunities"][number]): FocusQueueOrderPlan | null {
  const plan = recordValue(opportunity.strategyProposedPlan);
  if (!Object.keys(plan).length) return null;
  return orderPlanFromTradePlan(plan);
}

function orderPlanFromTradePlan(plan: Record<string, unknown>): FocusQueueOrderPlan {
  const targets = recordRows(plan.targets)
    .map((target) => priceText(target.price ?? target.value ?? target.targetPrice ?? target.target_price))
    .filter((value) => value !== "—");
  const orderType = displayValue(plan.orderType ?? plan.order_type, "Non publié");
  return {
    orderType: operatorCode(orderType),
    entry: priceText(plan.entry ?? plan.entryPrice ?? plan.entry_price),
    stop: priceText(plan.stop ?? plan.stopPrice ?? plan.stop_price),
    target1: targets[0] ?? "—",
    target2: targets[1] ?? "—",
  };
}

function priceText(value: unknown): string {
  const price = recordValue(value).price ?? recordValue(value).value ?? recordValue(value).mid ?? value;
  return displayValue(price, "—");
}

export function buildFocusQueueItems(focus: LiveFocusView): FocusQueueItem[] {
  const trades = focus.tradeCards.map((card) => tradeJournalItem(card, focus.asOf));
  return trades.sort(sortFocusQueueItems);
}

export function buildFocusSignalFlowItems(focus: LiveFocusView): FocusSignalFlowItem[] {
  return focus.observedOpportunities
    .map((opportunity) => observedSignalFlowItem(opportunity, focus.asOf))
    .sort((a, b) => (timeValue(b.createdAt) ?? 0) - (timeValue(a.createdAt) ?? 0));
}

function tradeJournalItem(card: LiveFocusView["tradeCards"][number], asOf: string): FocusQueueItem {
  const terminal = focusCardTerminal(card);
  const actionable = focusCardActionable(card);
  const rLine = card.expectedR === null || card.expectedR === undefined ? "R prévisionnel non publié" : `${card.expectedR > 0 ? "+" : ""}${card.expectedR.toFixed(2)} R prévisionnel`;
  const reasonLine = card.attentionReason ? operatorReason(card.attentionReason) : operatorCopy(card.strategyName);
  const expirationLine = focusExpirationLabel(card.expiresAt, asOf, terminal);
  const freshnessLine = focusFreshnessLabel(card.asOf, asOf);
  const lifecycleLine = terminal
    ? `Historique · ${operatorReason(card.terminalReason ?? card.closeReason ?? "TERMINAL")}`
    : actionable
      ? "Action possible uniquement via capability backend"
      : card.denialReasons.length
        ? card.denialReasons.map((reason) => operatorReason(reason)).join(" · ")
        : "Consultation uniquement";
  return {
    kind: "trade",
    key: `trade:${card.orderIntentId}`,
    instrument: card.instrument,
    side: card.side,
    title: operatorCopy(card.strategyName),
    status: terminal ? "Historique — ne pas poser" : focusCardStatus(card),
    statusTone: actionable ? "success" : terminal ? "warning" : "info",
    createdAt: card.createdAt,
    expiresAt: card.expiresAt,
    signalId: card.signalId,
    route: card.route,
    source: card.source,
    asOf: card.asOf,
    terminal,
    actionable,
    priority: actionable ? "ACTIONABLE" : terminal ? "TERMINAL" : card.priority || "ACTIVE",
    levelLine: tradeCardLevelSummary(card),
    orderPlan: tradeCardOrderPlan(card),
    rLine,
    reasonLine,
    expirationLine,
    freshnessLine,
    lifecycleLine,
    timeline: buildFocusTradeTimeline(card, asOf),
    card,
    searchText: [
      card.instrument, card.side, card.strategyName, card.setup,
      card.signalId, card.orderIntentId, card.humanGateId, card.terminalReason,
      card.denialReasons.join(" "),
      card.reasonCodes.join(" "),
    ].join(" ").toLowerCase(),
  };
}

function observedSignalFlowItem(opportunity: LiveFocusView["observedOpportunities"][number], asOf: string): FocusSignalFlowItem {
  const terminal = focusOpportunityTerminal(opportunity);
  const expirationLine = focusExpirationLabel(opportunity.expiresAt, asOf, terminal);
  const orderPlan = observedOpportunityOrderPlan(opportunity);
  const gate = observedOpportunityGate(opportunity, terminal);
  const reasonLine = opportunity.reasonCodes.length
    ? opportunity.reasonCodes.slice(0, 2).map((reason) => operatorReason(reason)).join(" · ")
    : "Signal diagnostique uniquement";
  return {
    key: `observed:${opportunity.opportunityId}`,
    instrument: opportunity.instrument,
    side: opportunity.side,
    title: operatorCopy(opportunity.strategyName),
    status: terminal ? "Signal archivé" : focusOpportunityStatus(opportunity),
    statusTone: gate.tone,
    gateLabel: gate.label,
    blockerLine: gate.blockerLine,
    createdAt: opportunity.createdAt,
    expiresAt: opportunity.expiresAt,
    signalId: opportunity.signalId,
    route: opportunity.route,
    source: opportunity.source,
    asOf: opportunity.asOf,
    terminal,
    reasonLine,
    expirationLine,
    freshnessLine: focusFreshnessLabel(opportunity.asOf, asOf),
    searchText: [
      opportunity.instrument,
      opportunity.side,
      opportunity.strategyName,
      opportunity.status,
      opportunity.signalId,
      opportunity.opportunityId,
      gate.label,
      gate.blockerLine,
      orderPlan?.orderType,
      opportunity.reasonCodes.join(" "),
    ].join(" ").toLowerCase(),
  };
}

export function filterFocusQueueItems(items: FocusQueueItem[], filter: FocusQueueFilter, instrument: string, query: string): FocusQueueItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    const kindMatch =
      filter === "ALL"
      || (filter === "ACTIONABLE" && item.actionable)
      || (filter === "QUALIFIED" && item.kind === "trade" && !item.actionable && !item.terminal)
      || (filter === "EXPIRED" && item.terminal);
    const instrumentMatch = instrument === "ALL" || item.instrument === instrument;
    const queryMatch = !needle || item.searchText.includes(needle);
    return kindMatch && instrumentMatch && queryMatch;
  }).sort(sortFocusQueueItems);
}

function sortFocusQueueItems(a: FocusQueueItem, b: FocusQueueItem): number {
  const rank = (item: FocusQueueItem) => item.actionable ? 0 : item.kind === "trade" && !item.terminal ? 1 : 3;
  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;
  return (timeValue(b.createdAt) ?? 0) - (timeValue(a.createdAt) ?? 0);
}

export function buildFocusTradeTimeline(card: LiveFocusView["tradeCards"][number], asOf: string): FocusQueueTimelineStep[] {
  const terminal = focusCardTerminal(card);
  return [
    { label: "Signal", value: displayTime(card.createdAt), tone: "done" },
    { label: "Risque", value: card.riskDecisionId ? "Autorisé" : "Non publié", tone: card.riskDecisionId ? "done" : "muted" },
    { label: "Human Gate", value: focusCardActionable(card) ? "À décider" : presentBackendStatus(card.operatorState).label, tone: focusCardActionable(card) ? "active" : terminal ? "blocked" : "muted" },
    { label: "Fenêtre", value: focusExpirationLabel(card.expiresAt, asOf, terminal), tone: terminal ? "blocked" : "active" },
  ];
}

function observedOpportunityGate(opportunity: LiveFocusView["observedOpportunities"][number], terminal: boolean): { label: string; blockerLine: string; tone: FocusSignalFlowTone } {
  const status = String(opportunity.status ?? "").toUpperCase();
  const reasons = opportunity.reasonCodes.map((reason) => String(reason).toUpperCase());
  if (status.includes("EXPIRED") || reasons.some((reason) => reason.includes("EXPIRED"))) {
    return { label: "Fenêtre expirée", blockerLine: "Le signal est archivé : sa fenêtre est fermée et aucun ticket opérateur ne doit être posé.", tone: "warning" };
  }
  if (status.includes("CANCEL")) {
    return { label: "Signal annulé", blockerLine: "Le backend a annulé ce signal avant publication d’un ticket opérateur.", tone: "warning" };
  }
  if (status.includes("REJECT") || reasons.some((reason) => reason.includes("REJECT"))) {
    return { label: "Gate de rejet", blockerLine: "Le signal est rejeté avant le Human Gate. Il reste consultable pour audit.", tone: "warning" };
  }
  if (reasons.some((reason) => reason.includes("CONTEXT"))) {
    const waiting = reasons.some((reason) => reason.includes("WAIT"));
    return { label: "Context Gate", blockerLine: waiting ? "Le contexte marché demande d’attendre avant toute qualification." : "Le contexte marché ne valide pas ce signal.", tone: waiting ? "info" : "warning" };
  }
  if (reasons.some((reason) => reason.includes("PORTFOLIO"))) {
    return { label: "Portfolio", blockerLine: "Le signal n’a pas été sélectionné par l’arbitrage portefeuille.", tone: "warning" };
  }
  if (reasons.some((reason) => reason.includes("RISK"))) {
    return { label: "Global Risk", blockerLine: "Le contrôle du risque n’a pas publié de position cible exploitable.", tone: "danger" };
  }
  if (terminal) {
    return { label: "Signal terminé", blockerLine: "Signal conservé pour audit uniquement, sans action opérateur.", tone: "warning" };
  }
  return { label: "Pré-qualification", blockerLine: "Pas de dossier Position cible → Ordre proposé → Human Gate publié.", tone: "neutral" };
}

export function focusExpirationLabel(expiresAt: string | null, asOf: string, terminal: boolean): string {
  if (!expiresAt) return "Non publiée";
  const expiry = timeValue(expiresAt);
  const now = timeValue(asOf);
  if (expiry === null || now === null) return displayTime(expiresAt);
  const diff = expiry - now;
  if (diff <= 0) return `Expiré depuis ${durationLabel(Math.abs(diff))}`;
  return terminal ? `Fermé · échéance ${displayTime(expiresAt)}` : `Reste ${durationLabel(diff)}`;
}

function focusFreshnessLabel(sourceAsOf: string | null, asOf: string): string {
  const source = timeValue(sourceAsOf);
  const now = timeValue(asOf);
  if (source === null || now === null) return "Non publiée";
  const age = Math.max(0, now - source);
  if (age < 1_000) return "À jour";
  return `Âge ${durationLabel(age)}`;
}

function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function timeValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function recordRows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : []; }
function recordValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
