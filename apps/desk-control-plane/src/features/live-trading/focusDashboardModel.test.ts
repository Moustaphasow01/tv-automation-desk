import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { LiveFocusView } from "@/domains/front-api/viewModels";
import { isFocusDashboardContract, type FocusDashboardContract } from "@/domains/front-api/focusDashboardContract";
import { buildFocusDashboard, normalizeFocusDashboardPeriod } from "./focusDashboardModel";
import { FocusDashboard } from "./FocusDashboard";

const period = {
  startDate: "2026-08-31", endDate: "2026-09-05", qualifiedTickets: 10, rawSignals: 12,
  results: { count: 7, realizedR: -1.82857143, missingR: 0, undated: 0,
    breakdown: [{ kind: "TARGET_HIT", count: 2, realizedR: 3.17142857 }, { kind: "STOP_HIT", count: 4, realizedR: -4 }, { kind: "OTHER_CLOSED", count: 1, realizedR: -1 }],
    contributors: [
      ...[1.6, 1.57142857].map((realizedR, index) => ({ orderIntentId: `tp-${index}`, instrument: "ZW", closedAt: "2026-09-04T15:00:00Z", kind: "TARGET_HIT" as const, realizedR, route: `/execution/orders/tp-${index}` })),
      ...[0, 1, 2, 3].map((index) => ({ orderIntentId: `sl-${index}`, instrument: "ZW", closedAt: "2026-09-04T15:00:00Z", kind: "STOP_HIT" as const, realizedR: -1, route: `/execution/orders/sl-${index}` })),
      { orderIntentId: "other", instrument: "ZW", closedAt: "2026-09-04T15:00:00Z", kind: "OTHER_CLOSED", realizedR: -1, route: "/execution/orders/other" },
    ],
  },
  expectedR: null, expectedSample: 0, expiredWithoutFill: 1, unclassifiedExpiry: 0,
} satisfies FocusDashboardContract["periods"]["WEEK"];
function fixture(): FocusDashboardContract {
  return structuredClone({ schemaVersion: "live_focus_dashboard_v1", source: "THEORETICAL_BACKEND", coverage: "EXPOSED_HISTORY_ONLY", timezone: "Europe/Paris",
    scope: { universe: "US_GRAINS_CBOT", instruments: ["ZW", "ZC"], excludedTickets: 29, excludedInstruments: ["MNQ", "MES"] },
    asOf: "2026-09-05T00:00:00Z", dateBasis: { activity: "CREATED_AT", results: "CLOSED_AT" }, current: { actionable: 0, open: 1, awaitingEntry: 2 },
    periods: { TODAY: period, WEEK: period, MONTH: { ...period, startDate: "2026-09-01" }, TOTAL: { ...period, startDate: null } },
  });
}
const focus = (dashboard?: FocusDashboardContract) => ({ dashboard } as LiveFocusView);

describe("Focus dashboard reporting", () => {
  it("formats backend results without summing cards or confusing other exits with stops", () => {
    const dashboard = buildFocusDashboard(focus(fixture()), "WEEK");
    expect(dashboard.metrics.find((item) => item.id === "realized-r")?.value).toBe("-1,83 R");
    expect(dashboard.metrics.find((item) => item.id === "tp-sl")).toMatchObject({ value: "2 / 4", helper: "1 autre(s) clôture(s), incluses dans les R." });
    expect(dashboard.metrics.find((item) => item.id === "tracking")?.value).toBe("1");
    expect(dashboard.coverageLabel).toContain("29 dossier(s) hors grains exclu(s) (MNQ, MES)");
  });
  it("preserves null versus an observed zero R", () => {
    const data = fixture();
    data.periods.WEEK.results.realizedR = null;
    expect(buildFocusDashboard(focus(data), "WEEK").metrics.find((item) => item.id === "realized-r")?.value).toBe("Non publié");
    data.periods.WEEK.results.realizedR = 0;
    expect(buildFocusDashboard(focus(data), "WEEK").metrics.find((item) => item.id === "realized-r")?.value).toBe("0,00 R");
    Object.assign(data.periods.WEEK.results, { count: 0, contributors: [], realizedR: null });
    expect(buildFocusDashboard(focus(data), "WEEK").metrics.find((item) => item.id === "realized-r")?.value).toBe("Aucune clôture");
  });
  it("an old or invalid backend only degrades dashboard, without inventing KPI", () => {
    expect(buildFocusDashboard(focus(), "WEEK")).toMatchObject({ available: false, metrics: [] });
    const data = fixture();
    data.periods.WEEK.results.realizedR = NaN;
    expect(isFocusDashboardContract(data)).toBe(false);
    expect(buildFocusDashboard(focus(data), "WEEK").available).toBe(false);
  });
  it("rejects unsafe links and unknown result kinds", () => {
    const data = fixture();
    data.periods.TOTAL.results.contributors[0].route = "https://external.invalid";
    expect(isFocusDashboardContract(data)).toBe(false);
    const unknown = fixture();
    Object.assign(unknown.periods.TOTAL.results.contributors[0], { kind: "NEW_STATUS" });
    expect(isFocusDashboardContract(unknown)).toBe(false);
  });
  it("exposes a compact strip and accessible collapsed result breakdown with canonical links", () => {
    const dashboard = buildFocusDashboard(focus(fixture()), "WEEK");
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FocusDashboard, { dashboard, period: "WEEK", onPeriodChange() {} })));
    expect(markup).toContain('class="live-focus__dashboard-details"');
    expect(markup).not.toContain('<details open');
    expect(markup).toContain("Autre clôture / motif non publié");
    expect(markup).toContain('href="/execution/orders/other"');
    expect(markup).toContain("date de clôture");
  });
  it("honors calendar dates published by the backend and preserves current actions", () => {
    const data = fixture();
    data.current.actionable = 3;
    expect(buildFocusDashboard(focus(data), "MONTH").windowLabel).toContain("01/09/2026");
    expect(buildFocusDashboard(focus(data), "TOTAL").metrics[0].value).toBe("3");
    expect(normalizeFocusDashboardPeriod("week")).toBe("WEEK");
    expect(normalizeFocusDashboardPeriod("bogus")).toBe("TODAY");
  });
});
