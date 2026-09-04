import type { LiveFocusView } from "@/domains/front-api/viewModels";
import { focusCardActionable, focusCardTerminal } from "./focusJournalModel";

export type LiveFocusDashboardPeriod = "TODAY" | "WEEK" | "MONTH" | "TOTAL";
export type LiveFocusDashboardTone = "neutral" | "info" | "warning" | "success" | "danger";

export type LiveFocusDashboardMetric = {
  id: string;
  label: string;
  value: string;
  helper: string;
  tone: LiveFocusDashboardTone;
};

export type LiveFocusDashboardSuggestion = {
  id: string;
  tone: LiveFocusDashboardTone;
  title: string;
  detail: string;
};

export type LiveFocusDashboard = {
  period: LiveFocusDashboardPeriod;
  periodLabel: string;
  windowLabel: string;
  sourceLabel: string;
  freshnessLabel: string;
  metrics: LiveFocusDashboardMetric[];
  suggestions: LiveFocusDashboardSuggestion[];
  counts: {
    rawSignals: number;
    tradableTickets: number;
    actionableTickets: number;
    terminalTickets: number;
    targetHits: number;
    stopHits: number;
    expiredNoFill: number;
    openOrWaiting: number;
  };
};

export const focusDashboardPeriodOptions = [
  { id: "TODAY", label: "Aujourd’hui" },
  { id: "WEEK", label: "Semaine" },
  { id: "MONTH", label: "Mois" },
  { id: "TOTAL", label: "Total" },
] as const satisfies readonly { id: LiveFocusDashboardPeriod; label: string }[];

export function normalizeFocusDashboardPeriod(value: string | null | undefined): LiveFocusDashboardPeriod {
  const normalized = String(value ?? "").trim().toUpperCase();
  return focusDashboardPeriodOptions.some((option) => option.id === normalized)
    ? normalized as LiveFocusDashboardPeriod
    : "TODAY";
}

type DashboardWindow = {
  start: number | null;
  end: number | null;
};

type OutcomeCounts = {
  targetHits: number;
  stopHits: number;
  expiredNoFill: number;
  openOrWaiting: number;
};

export function buildFocusDashboard(focus: LiveFocusView, period: LiveFocusDashboardPeriod): LiveFocusDashboard {
  const window = resolveDashboardWindow(focus.asOf, period);
  const tradeCards = focus.tradeCards.filter((card) => isInDashboardWindow(card.createdAt, window));
  const observedOpportunities = focus.observedOpportunities.filter((item) => isInDashboardWindow(item.createdAt ?? item.asOf, window));
  const rawSignals = tradeCards.length + observedOpportunities.length;
  const actionableTickets = tradeCards.filter(focusCardActionable).length;
  const terminalTickets = tradeCards.filter(focusCardTerminal).length;
  const outcomes = countTradeOutcomes(tradeCards);
  const realizedR = sumPublishedR(tradeCards);
  const expectedR = sumExpectedR(tradeCards);
  const contextStatus = String(focus.marketContext.status ?? "UNKNOWN").toUpperCase();
  const qualificationRate = rawSignals > 0 ? tradeCards.length / rawSignals : null;
  const resolvedHitRate = outcomes.targetHits + outcomes.stopHits > 0 ? outcomes.targetHits / (outcomes.targetHits + outcomes.stopHits) : null;
  const fillRate = tradeCards.length > 0 ? (outcomes.targetHits + outcomes.stopHits + outcomes.openOrWaiting) / tradeCards.length : null;
  const sourceLabel = "Source projection Live Focus";
  const freshnessLabel = `données arrêtées à ${formatDashboardTime(focus.technical.sourceDataCutoff || focus.asOf)}`;

  return {
    period,
    periodLabel: focusDashboardPeriodOptions.find((item) => item.id === period)?.label ?? "Période",
    windowLabel: dashboardWindowLabel(focus, period),
    sourceLabel,
    freshnessLabel,
    counts: {
      rawSignals,
      tradableTickets: tradeCards.length,
      actionableTickets,
      terminalTickets,
      ...outcomes,
    },
    metrics: [
      {
        id: "actionable",
        label: "Prêts à poser",
        value: formatDashboardNumber(actionableTickets),
        helper: "Dossiers dont la confirmation est autorisée par le desk.",
        tone: actionableTickets > 0 ? "success" : "neutral",
      },
      {
        id: "tradable",
        label: "Tickets qualifiés",
        value: formatDashboardNumber(tradeCards.length),
        helper: "Validés jusqu’au ticket opérateur.",
        tone: tradeCards.length > 0 ? "info" : "neutral",
      },
      {
        id: "signals",
        label: "Signaux moteurs",
        value: formatDashboardNumber(rawSignals),
        helper: "Tickets qualifiés + signaux filtrés exposés.",
        tone: rawSignals > 0 ? "info" : "neutral",
      },
      {
        id: "qualification",
        label: "Taux de qualification",
        value: qualificationRate === null ? "Non calculable" : formatDashboardPercent(qualificationRate),
        helper: "Part des signaux exposés devenus tickets.",
        tone: qualificationRate === null ? "neutral" : qualificationRate > 0.25 ? "success" : "warning",
      },
      {
        id: "realized-r",
        label: "R clôturé",
        value: realizedR === null ? "Non publié" : formatDashboardR(realizedR),
        helper: "Somme des résultats théoriques publiés.",
        tone: realizedR === null ? "neutral" : realizedR > 0 ? "success" : realizedR < 0 ? "danger" : "info",
      },
      {
        id: "expected-r",
        label: "R prévu",
        value: expectedR === null ? "Non publié" : formatDashboardR(expectedR),
        helper: "Somme des R attendus publiés avant résultat.",
        tone: expectedR === null ? "neutral" : expectedR > 0 ? "info" : "warning",
      },
      {
        id: "tp-sl",
        label: "TP / SL",
        value: `${outcomes.targetHits} / ${outcomes.stopHits}`,
        helper: resolvedHitRate === null ? "Aucun résultat TP/SL publié." : `${formatDashboardPercent(resolvedHitRate)} de TP parmi les TP/SL.`,
        tone: resolvedHitRate === null ? "neutral" : resolvedHitRate >= 0.5 ? "success" : "warning",
      },
      {
        id: "expired",
        label: "Expirés sans fill",
        value: formatDashboardNumber(outcomes.expiredNoFill),
        helper: "Tickets dont la fenêtre d’entrée est fermée.",
        tone: outcomes.expiredNoFill > 0 ? "warning" : "neutral",
      },
      {
        id: "fill-rate",
        label: "Suivi théorique",
        value: fillRate === null ? "Non calculable" : formatDashboardPercent(fillRate),
        helper: "Tickets avec entrée détectée, ouverte ou clôturée.",
        tone: fillRate === null ? "neutral" : fillRate >= 0.7 ? "success" : "warning",
      },
      {
        id: "context",
        label: "Contexte marché",
        value: dashboardStatusLabel(contextStatus),
        helper: `Marché ${dashboardStatusLabel(focus.session.marketState)} · ${focus.session.marketSession}`,
        tone: contextStatusTone(contextStatus),
      },
    ],
    suggestions: buildDashboardSuggestions(focus, {
      rawSignals,
      tradableTickets: tradeCards.length,
      actionableTickets,
      terminalTickets,
      realizedR,
      contextStatus,
      outcomes,
    }),
  };
}

function resolveDashboardWindow(asOf: string, period: LiveFocusDashboardPeriod): DashboardWindow {
  const end = parseTime(asOf);
  if (period === "TOTAL" || end === null) return { start: null, end };
  if (period === "WEEK") return { start: end - 7 * 24 * 60 * 60 * 1000, end };
  if (period === "MONTH") return { start: end - 30 * 24 * 60 * 60 * 1000, end };
  const startDate = new Date(end);
  startDate.setHours(0, 0, 0, 0);
  return { start: startDate.getTime(), end };
}

function isInDashboardWindow(value: string | null | undefined, window: DashboardWindow): boolean {
  if (window.start === null && window.end === null) return true;
  const time = parseTime(value);
  if (time === null) return false;
  if (window.start !== null && time < window.start) return false;
  return window.end === null || time <= window.end;
}

function countTradeOutcomes(cards: readonly LiveFocusView["tradeCards"][number][]): OutcomeCounts {
  return cards.reduce<OutcomeCounts>((counts, card) => {
    const status = outcomeStatusText(card);
    if (status.includes("TARGET_HIT") || status.includes("TAKE_PROFIT")) counts.targetHits += 1;
    else if (status.includes("STOP_HIT") || status.includes("STOP_LOSS")) counts.stopHits += 1;
    else if (status.includes("ENTRY_EXPIRED") || status.includes("EXPIRED_NO_FILL")) counts.expiredNoFill += 1;
    else if (!focusCardTerminal(card)) counts.openOrWaiting += 1;
    return counts;
  }, { targetHits: 0, stopHits: 0, expiredNoFill: 0, openOrWaiting: 0 });
}

function outcomeStatusText(card: LiveFocusView["tradeCards"][number]): string {
  return [
    card.theoreticalState,
    card.temporalState,
    card.terminalReason,
    card.closeReason,
    card.theoreticalResult?.status,
    card.theoreticalResult?.closeReason,
  ].map((value) => String(value ?? "").toUpperCase()).join(" ");
}

function sumPublishedR(cards: readonly LiveFocusView["tradeCards"][number][]): number | null {
  const values = cards.map((card) => card.realizedR).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function sumExpectedR(cards: readonly LiveFocusView["tradeCards"][number][]): number | null {
  const values = cards.map((card) => card.expectedR).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function buildDashboardSuggestions(
  focus: LiveFocusView,
  summary: {
    rawSignals: number;
    tradableTickets: number;
    actionableTickets: number;
    terminalTickets: number;
    realizedR: number | null;
    contextStatus: string;
    outcomes: OutcomeCounts;
  },
): LiveFocusDashboardSuggestion[] {
  const suggestions: LiveFocusDashboardSuggestion[] = [];
  if (summary.actionableTickets > 0) {
    suggestions.push({
      id: "operator-action",
      tone: "success",
      title: "Action opérateur disponible",
      detail: `${summary.actionableTickets} ticket(s) ont une confirmation backend ouverte. Vérifier les niveaux puis décider.`,
    });
  } else if (summary.tradableTickets > 0 && summary.terminalTickets === summary.tradableTickets) {
    suggestions.push({
      id: "historical-only",
      tone: "neutral",
      title: "Tous les tickets visibles sont historiques",
      detail: "Ne rien poser depuis ces dossiers : ils restent uniquement consultables pour audit.",
    });
  } else if (summary.rawSignals > 0 && summary.tradableTickets === 0) {
    suggestions.push({
      id: "filtered-signals",
      tone: "info",
      title: "Signaux présents, aucun ordre prêt",
      detail: "Les moteurs publient des opportunités, mais aucune n’a franchi tout le parcours jusqu’au ticket opérateur.",
    });
  } else {
    suggestions.push({
      id: "watching",
      tone: "neutral",
      title: "Surveillance active",
      detail: "Aucun signal exploitable n’est publié sur la période sélectionnée.",
    });
  }

  if (summary.outcomes.stopHits > summary.outcomes.targetHits && summary.outcomes.stopHits >= 2) {
    suggestions.push({
      id: "loss-skew",
      tone: "warning",
      title: "Ratio TP/SL défavorable",
      detail: "Le suivi théorique publié montre davantage de stops que de targets sur cette fenêtre.",
    });
  }

  if (summary.outcomes.expiredNoFill > 0 && summary.outcomes.expiredNoFill >= Math.ceil(Math.max(1, summary.tradableTickets) * 0.35)) {
    suggestions.push({
      id: "expiry-pressure",
      tone: "warning",
      title: "Beaucoup d’entrées expirées",
      detail: "Surveiller la distance d’entrée et la durée de validité des limites : plusieurs tickets n’ont pas été exécutés.",
    });
  }

  if (["UNAVAILABLE", "STALE", "INVALIDATED", "PARTIAL"].includes(summary.contextStatus)) {
    suggestions.push({
      id: "context-quality",
      tone: summary.contextStatus === "UNAVAILABLE" ? "danger" : "warning",
      title: "Contexte marché à vérifier",
      detail: `État publié : ${dashboardStatusLabel(summary.contextStatus)}. Le Focus doit être lu avec sa fraîcheur visible.`,
    });
  }

  if (String(focus.session.marketState).toUpperCase() !== "OPEN") {
    suggestions.push({
      id: "market-closed",
      tone: "neutral",
      title: "Marché hors session",
      detail: focus.session.nextEligibleAt ? `Prochaine fenêtre publiée : ${formatDashboardTime(focus.session.nextEligibleAt)}.` : "Aucune prochaine fenêtre publiée par le backend.",
    });
  }

  return suggestions.slice(0, 4);
}

function dashboardWindowLabel(focus: LiveFocusView, period: LiveFocusDashboardPeriod): string {
  if (period === "TODAY") return `Journée ${focus.session.marketDate || formatDashboardDate(focus.asOf)}`;
  if (period === "WEEK") return "7 derniers jours disponibles dans la projection";
  if (period === "MONTH") return "30 derniers jours disponibles dans la projection";
  return "Tout l’historique disponible dans la projection";
}

function contextStatusTone(status: string): LiveFocusDashboardTone {
  if (["AVAILABLE", "OPEN", "READY", "FRESH"].includes(status)) return "success";
  if (["PARTIAL", "STALE", "INVALIDATED"].includes(status)) return "warning";
  if (["UNAVAILABLE", "DOWN", "ERROR", "DISCONNECTED"].includes(status)) return "danger";
  return "neutral";
}

function dashboardStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    AVAILABLE: "Disponible",
    CLOSED: "Fermé",
    DISABLED_BY_POLICY: "Désactivé",
    DISCONNECTED: "Déconnecté",
    ERROR: "Erreur",
    FRESH: "À jour",
    INVALIDATED: "Invalidé",
    OPEN: "Ouvert",
    PARTIAL: "Partiel",
    READY: "Prêt",
    STALE: "Périmé",
    UNAVAILABLE: "Indisponible",
    UNKNOWN: "Inconnu",
  };
  return labels[status] ?? status.replace(/_/g, " ").toLowerCase();
}

function formatDashboardNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
}

function formatDashboardPercent(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function formatDashboardR(value: number): string {
  const formatted = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return `${value > 0 ? "+" : ""}${formatted} R`;
}

function formatDashboardDate(value: string): string {
  const time = parseTime(value);
  if (time === null) return "non publiée";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(time));
}

function formatDashboardTime(value: string): string {
  const time = parseTime(value);
  if (time === null) return "non publié";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(time));
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
