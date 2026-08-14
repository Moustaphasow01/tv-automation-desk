import { describe, expect, it } from "vitest";
import { portfolioView } from "@/mocks/canonicalDataset";
import { assertViewEnvelope } from "@/shared/contracts";
import { isPortfolioView } from "@/domains/front-api/viewModels";

describe("front-api contracts", () => {
  it("accepts a valid canonical portfolio view envelope", () => {
    const envelope = assertViewEnvelope(portfolioView, isPortfolioView);

    expect(envelope.meta.correlationId).toBe("corr_vnext_demo_20260810_0940");
    expect(envelope.data.positions).toHaveLength(2);
  });

  it("rejects invalid BFF envelopes", () => {
    expect(() =>
      assertViewEnvelope(
        {
          meta: {},
          permissions: [],
          data: {}
        },
        isPortfolioView
      )
    ).toThrow(/ViewMeta/);
  });
});
