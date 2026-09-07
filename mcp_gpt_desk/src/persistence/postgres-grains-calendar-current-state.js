import { loadGrainsCalendarVersionAt } from "./postgres-grains-calendar-ledger.js";

// Public market-data query used by both the analyst bundle and the operator projection.
// The mutable pre-ledger event table is deliberately not a fallback.
export async function loadCurrentGrainsCalendar(pool, asOfUtc) {
  const at = Date.parse(asOfUtc);
  if (!Number.isFinite(at)) throw new Error("CALENDAR_CUTOFF_REQUIRED");
  const calendar = await loadGrainsCalendarVersionAt(pool, {
    asOfUtc, startUtc: new Date(at - 7 * 86400000).toISOString(),
  });
  const coverage = calendar.agriCalendarCoverage[0] || {
    sourceId: "market_agri_events", sourceType: "AGRI_EVENT_CALENDAR",
    status: "UNKNOWN_COVERAGE", asOf: asOfUtc, coverageStart: null, coverageEnd: null,
    datasetVersion: null, sourceVersionHash: null, provider: null,
    reasonCodes: ["CALENDAR_VERSION_NOT_PUBLISHED"],
  };
  return {
    events: calendar.agriEvents,
    sourceState: {
      ...coverage, requiredFor: ["MARKET_CONTEXT_SNAPSHOT", "CONTEXT_PREFILTER", "LIVE_FOCUS"],
      dataCutoff: asOfUtc,
      lastSuccessfulAt: ["AVAILABLE", "STALE"].includes(coverage.status) && coverage.datasetVersion ? coverage.asOf : null,
      missingness: coverage.status === "AVAILABLE" ? 0 : null,
    },
  };
}
