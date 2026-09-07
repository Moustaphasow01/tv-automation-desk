const NASS_CALENDAR_ROOT =
  "https://www.nass.usda.gov/Publications/Calendar";
const WASDE_SCHEDULE_URL =
  "https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report";
const FAS_SCHEDULE_URL =
  "https://fas.usda.gov/data/scheduled-reports";

export function buildUsdaGrainsCalendarSources({
  asOfUtc,
  coverageStart,
  coverageEnd,
} = {}) {
  const asOf = requiredTimestamp(asOfUtc, "USDA_CALENDAR_AS_OF_REQUIRED");
  const start = requiredTimestamp(
    coverageStart,
    "USDA_CALENDAR_COVERAGE_START_REQUIRED",
  );
  const end = requiredTimestamp(
    coverageEnd,
    "USDA_CALENDAR_COVERAGE_END_REQUIRED",
  );
  if (Date.parse(start) > Date.parse(end))
    throw new Error("USDA_CALENDAR_COVERAGE_WINDOW_INVALID");
  const year = new Date(start).getUTCFullYear();
  if (new Date(end).getUTCFullYear() !== year)
    throw new Error("USDA_CALENDAR_CROSS_YEAR_WINDOW_UNSUPPORTED");
  if (new Date(asOf).getUTCFullYear() !== year)
    throw new Error("USDA_CALENDAR_AS_OF_YEAR_MISMATCH");
  return Object.freeze([
    source({
      sourceId: "usda_nass_release_calendar",
      sourceKind: "NASS_ICS",
      url: `${NASS_CALENDAR_ROOT}/${year}/NassReleases${year}.ics`,
      expectedYear: year,
      reportKind: "NASS_AGRICULTURAL_STATISTICS_BOARD_RELEASES",
    }),
    source({
      sourceId: "usda_wasde_release_schedule",
      sourceKind: "WASDE_HTML",
      url: WASDE_SCHEDULE_URL,
      expectedYear: year,
      reportKind: "WASDE_RELEASES",
    }),
    source({
      sourceId: "usda_fas_export_sales_schedule",
      sourceKind: "FAS_SCHEDULE_HTML",
      url: FAS_SCHEDULE_URL,
      expectedYear: year,
      reportKind: "WEEKLY_EXPORT_SALES_RELEASES",
    }),
  ]);
}

function source({ sourceId, sourceKind, url, expectedYear, reportKind }) {
  return Object.freeze({
    sourceId,
    sourceKind,
    url,
    timezone: "America/New_York",
    expectedYear,
    scope: Object.freeze({
      universe: "US_GRAINS_CBOT",
      instruments: Object.freeze(["ZC", "ZW"]),
      reportKind,
    }),
  });
}

function requiredTimestamp(value, code) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return new Date(parsed).toISOString();
}
