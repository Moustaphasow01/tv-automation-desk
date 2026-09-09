import type { LiveFocusView, StrategyCenterView } from "@/domains/front-api/viewModels";
import type { LiveTradingModel } from "../model";
import type { FocusQueueItem } from "../focusJournalModel";
import { workspaceCopy } from "./workspaceModel";
import { operatorReason } from "@/design-system/operatorVocabulary";

export function publishedText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || /^(NOT_AVAILABLE|UNAVAILABLE|UNKNOWN|NONE|N\/A|NOT_REPORTED)$/i.test(value)) return null;
  return value.trim();
}

export function manualExecutionLabel(value: unknown): string {
  const status = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (status === "NOT_REPORTED") return "Non déclarée";
  if (["UNAVAILABLE", "NOT_AVAILABLE"].includes(status)) return "Déclaration indisponible";
  return publishedText(value) ? workspaceCopy(String(value)) : "Statut de déclaration non publié";
}

export function manualStopLabel(value: unknown): string {
  if (!value || typeof value !== "object") return "Statut du stop non publié";
  const stop = value as { placed?: unknown; source?: unknown };
  const source = typeof stop.source === "string" ? stop.source.toUpperCase() : "";
  if (["UNAVAILABLE", "NOT_AVAILABLE"].includes(source)) return "Déclaration du stop indisponible";
  if (source === "NOT_REPORTED") return "Placement du stop non déclaré";
  if (!publishedText(stop.source)) return "Statut du stop non publié";
  if (stop.placed === true) return "Stop déclaré posé par l’opérateur";
  return stop.placed === false ? "Stop déclaré non posé" : "Statut du stop non publié";
}

export function strategyTitle(item: FocusQueueItem, registry: LiveTradingModel["strategyInstances"], catalog: StrategyCenterView["strategies"] = []): string {
  const card = item.card;
  const matching = registry.filter((entry) => Boolean(card?.strategyInstanceId) && entry.strategyInstanceId === card?.strategyInstanceId);
  const definitions = catalog.filter((entry) => Boolean(card?.strategyDefinitionId && card.strategyVersionId)
    && entry.strategyDefinitionId === card?.strategyDefinitionId && entry.strategyVersionId === card?.strategyVersionId);
  const names = [...new Set(definitions.flatMap((entry) => publishedText(entry.name) ? [entry.name] : []))];
  const name = publishedText(matching.length === 1 ? matching[0].name : null) ?? (names.length === 1 ? names[0] : null) ?? publishedText(card?.strategyName);
  return name && !/[_:]|^strategy\b/i.test(name) ? workspaceCopy(name) : "Nom de stratégie non publié";
}

export function ticketExplanation(item: FocusQueueItem) {
  const evidence = item.card?.whyThisTrade;
  const explain = (value: unknown) => {
    const text = publishedText(value);
    return text ? workspaceCopy(operatorReason(text)) : "Non publié";
  };
  const explainList = (value: unknown) => Array.isArray(value) ? value.flatMap((item) => publishedText(item) ? [explain(item)] : []) : [];
  return {
    direction: explain(evidence?.whyDirection), setup: explain(evidence?.whySetup ?? item.card?.setup),
    now: explain(evidence?.whyNow), invalidations: explainList(evidence?.whatInvalidates),
    watch: explainList(evidence?.whatToWatch), context: explainList(evidence?.whyContextAccepted),
  };
}

export function publishedCalendar(focus: LiveFocusView) {
  return (focus.marketDeskBrief.nextExpectedEvents ?? []).flatMap((event, index) => {
    const at = publishedText(event.eventTimestamp ?? event.event_timestamp_utc ?? event.at);
    const title = publishedText(event.title ?? event.eventName ?? event.label ?? event.name);
    if (!at || !Number.isFinite(Date.parse(at)) || !title) return [];
    return [{ id: publishedText(event.eventId ?? event.event_id) ?? at + ":" + index, at, title: workspaceCopy(title) }];
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function canonicalEvidence(model: LiveTradingModel, intentId: string | null | undefined) {
  const matches = (row: Record<string, unknown>) => Boolean(intentId) && row.sourceClass === "CANONICAL_RUNTIME" && row.portfolioOrderIntentId === intentId;
  return {
    orders: (model.source.canonicalOrders ?? []).filter(matches),
    fills: (model.source.canonicalFills ?? []).filter(matches),
    positions: (model.source.canonicalPositions ?? []).filter(matches),
  };
}
