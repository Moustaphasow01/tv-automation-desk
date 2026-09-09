import { describe, expect, it } from "vitest";
import { journeyHref, journeyOrigin, journeyReturnLabel, safeJourneyOrigin } from "./journeyRoutes";
import { positionNumber, positionR } from "./positionPresentation";

describe("Trading journey URL continuity", () => {
  const focus = "/live?focus=1&instrument=ZW&timeframe=15&panel=tickets&ticketId=trade%3Aintent-a&ticketSection=history&ticketSearch=bl%C3%A9";
  it("preserves market, timeframe, selected ticket and list context through dossiers", () => {
    const order = journeyHref("/execution/orders/intent-a", focus);
    const origin = journeyOrigin({ pathname: "/execution/orders/intent-a", search: order.slice(order.indexOf("?")) });
    expect(origin).toBe(focus);
    expect(new URLSearchParams(journeyHref("/execution/portfolio/positions/position-a", origin).split("?")[1]).get("returnTo")).toBe(focus);
    expect(journeyReturnLabel(origin!)).toBe("Retour à Focus");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/live#evil", "/live\n", "/auth", "/live/signals/arbitrary", "/%2flive", null])("rejects unsafe or unsupported return context %s", (input) => {
    expect(safeJourneyOrigin(input)).toBeNull();
  });
  it("removes secrets, nested return paths and unknown query parameters", () => {
    expect(safeJourneyOrigin("/live?instrument=ZC&token=secret&returnTo=%2Flive%3Ffocus%3D1&unexpected=1")).toBe("/live?instrument=ZC");
  });
  it("does not create recursive context and preserves the destination identifier", () => {
    expect(journeyHref("/orders?returnTo=unsafe", "/live?instrument=ZC")).toBe("/orders?returnTo=%2Flive%3Finstrument%3DZC");
    expect(journeyHref("/live", "/live")).toBe("/live");
    expect(journeyHref("javascript:alert(1)", "/live")).toBe("/live");
  });
  it("has readable fallbacks for direct access and preserves home context", () => {
    expect(journeyOrigin({ pathname: "/execution/orders/a", search: "" })).toBeNull();
    expect(journeyReturnLabel("/command-center")).toBe("Retour à l’accueil");
    expect(journeyReturnLabel("/portfolio")).toBe("Retour aux positions");
  });
});

describe("Position publication formatting", () => {
  it("keeps zero, missing, invalid and sub-cent prices distinct", () => {
    expect(positionNumber(0)).toBe("0");
    expect(positionR(0)).toBe("+0,00 R");
    expect(positionNumber(0.0891751)).toBe("0,0891751");
    for (const value of [null, undefined, NaN, Infinity]) {
      expect(positionNumber(value)).toBe("Non publié");
      expect(positionR(value)).toBe("Non publié");
    }
  });
});
