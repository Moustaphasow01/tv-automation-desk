import { describe, expect, it } from "vitest";
import { frontViewQueryKey } from "@/domains/front-api/repositories";

describe("front view query scopes", () => {
  it("isolates the market-series cache from the live desk dossier", () => {
    const desk = frontViewQueryKey("live-trading");
    const chart = frontViewQueryKey("live-trading", [["instrument", "ZC"]], "market-series");

    expect(desk[0]).toBe("front-view");
    expect(chart.slice(0, 2)).toEqual(["front-view-scope", "market-series"]);
    expect(chart).not.toEqual(desk);
  });
});
