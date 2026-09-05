import type { LiveFocusView } from "@/domains/front-api/viewModels";
import { isFocusDashboardContract, type FocusDashboardPeriod, type FocusDashboardPeriodData, type FocusResultKind } from "@/domains/front-api/focusDashboardContract";

export type LiveFocusDashboardPeriod = FocusDashboardPeriod;
export type LiveFocusDashboardTone = "neutral" | "info" | "warning" | "success" | "danger";
export type LiveFocusDashboardMetric = { id: string; label: string; value: string; helper: string; tone: LiveFocusDashboardTone };
export type LiveFocusDashboard = {
  available: boolean;
  period: LiveFocusDashboardPeriod;
  windowLabel: string;
  freshnessLabel: string;
  metrics: LiveFocusDashboardMetric[];
  data: FocusDashboardPeriodData | null;
  coverageLabel: string;
  scopeLabel: string;
};

export const focusDashboardPeriodOptions = [
  { id: "TODAY", label: "Aujourd’hui" },
  { id: "WEEK", label: "Semaine" },
  { id: "MONTH", label: "Mois" },
  { id: "TOTAL", label: "Total" },
] as const satisfies readonly { id: LiveFocusDashboardPeriod; label: string }[];

export function normalizeFocusDashboardPeriod(value: string | null | undefined): LiveFocusDashboardPeriod {
  const normalized = String(value ?? "").trim().toUpperCase();
  return focusDashboardPeriodOptions.some((option) => option.id === normalized) ? normalized as LiveFocusDashboardPeriod : "TODAY";
}

export function buildFocusDashboard(focus: LiveFocusView, period: LiveFocusDashboardPeriod): LiveFocusDashboard {
  const published = focus.dashboard;
  if (!isFocusDashboardContract(published)) return {
    available: false, period, windowLabel: "Chiffres consolidés non publiés", freshnessLabel: "",
    metrics: [], data: null, scopeLabel: "Périmètre non publié", coverageLabel: "Le tableau de bord attend une synthèse valide du desk. Les dossiers restent accessibles ci-dessous.",
  };
  const data = published.periods[period];
  const target = data.results.breakdown.find((item) => item.kind === "TARGET_HIT")!;
  const stop = data.results.breakdown.find((item) => item.kind === "STOP_HIT")!;
  const other = data.results.breakdown.find((item) => item.kind === "OTHER_CLOSED")!;
  const r = data.results.realizedR;
  const noClosures = data.results.count === 0 && data.results.missingR === 0;
  return {
    available: true, period, data,
    windowLabel: `${data.startDate ? `${formatDate(data.startDate)} → ` : "Historique exposé → "}${formatDate(data.endDate)} · Paris`,
    freshnessLabel: `Synthèse actualisée le ${formatFocusResultTime(published.asOf)}`,
    scopeLabel: `Grains ${published.scope.instruments.join(" / ")} · historique partiel`,
    coverageLabel: `Suivi théorique grains · historique exposé par le desk, potentiellement partiel. ${published.scope.excludedTickets} dossier(s) hors grains exclu(s)${published.scope.excludedInstruments.length ? ` (${published.scope.excludedInstruments.join(", ")})` : ""}. Les résultats suivent la date de clôture ; les tickets et signaux, leur date de création. Les compteurs « maintenant » restent indépendants de la période.`,
    metrics: [
      { id: "actionable", label: "Prêts maintenant", value: String(published.current.actionable), helper: "Confirmations actuellement autorisées.", tone: published.current.actionable ? "success" : "neutral" },
      { id: "tradable", label: "Tickets qualifiés", value: String(data.qualifiedTickets), helper: "Créés sur la période choisie.", tone: "info" },
      { id: "realized-r", label: "R clôturé théorique", value: r === null ? noClosures ? "Aucune clôture" : "Non publié" : formatFocusDashboardR(r), helper: `${data.results.count} clôture(s) avec résultat.`, tone: r === null ? "neutral" : r < 0 ? "danger" : r > 0 ? "success" : "neutral" },
      { id: "tp-sl", label: "Objectifs / stops", value: `${target.count} / ${stop.count}`, helper: `${other.count} autre(s) clôture(s), incluses dans les R.`, tone: "neutral" },
      { id: "tracking", label: "Positions ouvertes", value: String(published.current.open), helper: `Maintenant · ${published.current.awaitingEntry} entrée(s) en attente.`, tone: "info" },
    ],
  };
}

export function focusResultKindLabel(kind: FocusResultKind): string {
  return { TARGET_HIT: "Objectif touché", STOP_HIT: "Stop touché", OTHER_CLOSED: "Autre clôture / motif non publié" }[kind];
}

export function formatFocusDashboardR(value: number): string {
  const formatted = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return `${value > 0 ? "+" : ""}${formatted} R`;
}

export function formatFocusResultTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date non publiée";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value: string): string { return value.split("-").reverse().join("/"); }
