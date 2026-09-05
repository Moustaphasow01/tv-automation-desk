export type FocusDashboardPeriod = "TODAY" | "WEEK" | "MONTH" | "TOTAL";
export type FocusResultKind = "TARGET_HIT" | "STOP_HIT" | "OTHER_CLOSED";
export type FocusResultContributor = {
  orderIntentId: string;
  instrument: string;
  closedAt: string | null;
  kind: FocusResultKind;
  realizedR: number;
  route: string;
};
export type FocusDashboardPeriodData = {
  startDate: string | null;
  endDate: string;
  qualifiedTickets: number;
  rawSignals: number;
  results: {
    count: number;
    realizedR: number | null;
    missingR: number;
    undated: number;
    breakdown: { kind: FocusResultKind; count: number; realizedR: number | null }[];
    contributors: FocusResultContributor[];
  };
  expectedR: number | null;
  expectedSample: number;
  expiredWithoutFill: number;
  unclassifiedExpiry: number;
};
export type FocusDashboardContract = {
  schemaVersion: "live_focus_dashboard_v1";
  source: "THEORETICAL_BACKEND";
  coverage: "EXPOSED_HISTORY_ONLY";
  scope: { universe: "US_GRAINS_CBOT"; instruments: string[]; excludedTickets: number; excludedInstruments: string[] };
  timezone: "Europe/Paris";
  asOf: string;
  dateBasis: { activity: "CREATED_AT"; results: "CLOSED_AT" };
  current: { actionable: number; open: number; awaitingEntry: number };
  periods: Record<FocusDashboardPeriod, FocusDashboardPeriodData>;
};

export function isFocusDashboardContract(value: unknown): value is FocusDashboardContract {
  const item = value as FocusDashboardContract | undefined;
  return Boolean(item?.schemaVersion === "live_focus_dashboard_v1" && item.source === "THEORETICAL_BACKEND"
    && item.coverage === "EXPOSED_HISTORY_ONLY" && item.timezone === "Europe/Paris"
    && item.scope?.universe === "US_GRAINS_CBOT" && Array.isArray(item.scope.instruments) && item.scope.instruments.length > 0
    && item.scope.instruments.every((symbol) => typeof symbol === "string" && symbol.length > 0)
    && count(item.scope.excludedTickets) && Array.isArray(item.scope.excludedInstruments) && item.scope.excludedInstruments.every((symbol) => typeof symbol === "string")
    && timestamp(item.asOf) && item.dateBasis?.activity === "CREATED_AT" && item.dateBasis.results === "CLOSED_AT"
    && item.current && [item.current.actionable, item.current.open, item.current.awaitingEntry].every(count)
    && ["TODAY", "WEEK", "MONTH", "TOTAL"].every((key) => validPeriod(item.periods?.[key as FocusDashboardPeriod])));
}

function validPeriod(item: FocusDashboardPeriodData | undefined): boolean {
  if (!item || !(item.startDate === null || date(item.startDate)) || !date(item.endDate)) return false;
  const results = item.results;
  return Boolean(results && [item.qualifiedTickets, item.rawSignals, item.expectedSample, item.expiredWithoutFill,
    item.unclassifiedExpiry, results.count, results.missingR, results.undated].every(count)
    && numberOrNull(item.expectedR) && numberOrNull(results.realizedR)
    && Array.isArray(results.breakdown) && results.breakdown.length === 3
    && ["TARGET_HIT", "STOP_HIT", "OTHER_CLOSED"].every((kind) => results.breakdown.some((row) => row?.kind === kind && count(row.count) && numberOrNull(row.realizedR)))
    && Array.isArray(results.contributors) && results.count === results.contributors.length && results.contributors.every(validContributor));
}

function validContributor(item: FocusResultContributor): boolean {
  return Boolean(item && typeof item.orderIntentId === "string" && item.orderIntentId.length && typeof item.instrument === "string"
    && (item.closedAt === null || timestamp(item.closedAt)) && Number.isFinite(item.realizedR)
    && ["TARGET_HIT", "STOP_HIT", "OTHER_CLOSED"].includes(item.kind)
    && typeof item.route === "string" && item.route.startsWith("/execution/orders/") && !item.route.includes("\\"));
}

function count(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function numberOrNull(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function timestamp(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function date(value: unknown): boolean { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }
