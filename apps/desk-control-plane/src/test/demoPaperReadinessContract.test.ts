import { describe, expect, it } from "vitest";
import { demoPaperReadinessView, liveTradingView } from "@/mocks/canonicalDataset";
import { isDemoPaperReadinessView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("demo paper readiness front contract", () => {
  it("accepts the canonical readiness envelope", () => {
    const envelope = assertViewEnvelope(demoPaperReadinessView, isDemoPaperReadinessView);

    expect(envelope.data.summary.finalDecision).toBe("OPEN_DEMO_PAPER_AGENTS_ALLOWED");
    expect(envelope.data.summary.nextCheckCommand).toBe("DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json");
    expect(envelope.data.marketData.coreFeeds.map((feed) => `${feed.instrument}:${feed.timeframe}`)).toEqual([
      "MNQ:1",
      "MNQ:5",
      "MES:1",
      "MES:5"
    ]);
    expect(envelope.data.broker.accountName).toBe("Sim101");
  });

  it("stays aligned with the Live Trading launch gate projection", () => {
    const readiness = assertViewEnvelope(demoPaperReadinessView, isDemoPaperReadinessView).data;

    expect(readiness.launchGate.finalDecision).toBe(liveTradingView.data.launchGate.finalDecision);
    expect(readiness.components).toEqual(liveTradingView.data.launchGate.components);
    expect(readiness.commands.releaseGate).toBe(readiness.launchGate.releaseCheckCommand);
  });
});
