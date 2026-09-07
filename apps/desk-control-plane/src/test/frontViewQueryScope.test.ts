import { describe, expect, it } from "vitest";
import { frontViewQueryKey, matchesFrontViewQuery } from "@/domains/front-api/repositories";

describe("front view query scopes", () => {
  it("isolates the market-series cache from the live desk dossier", () => {
    const desk = frontViewQueryKey("live-trading");
    const chart = frontViewQueryKey("live-trading", [["instrument", "ZC"]], "market-series");

    expect(desk[0]).toBe("front-view");
    expect(chart.slice(0, 2)).toEqual(["front-view-scope", "market-series"]);
    expect(chart).not.toEqual(desk);
  });

  it("matches every parameterized Live Focus key without crossing into chart scope", () => {
    const focus = frontViewQueryKey("live-focus", [["period", "week"]], "live-focus");
    const chart = frontViewQueryKey("live-trading", [["instrument", "ZW"]], "market-series");

    expect(matchesFrontViewQuery(focus, ["live-focus"])).toBe(true);
    expect(matchesFrontViewQuery(chart, ["live-trading"])).toBe(false);
    expect(matchesFrontViewQuery(chart, ["live-trading"], "INCLUDING_MARKET_SERIES")).toBe(true);
  });
});
