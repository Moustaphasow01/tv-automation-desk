import { describe, expect, it } from "vitest";
import { canonicalViewDataset, eventsAuditView, liveSignalDetailView, liveTradingView, portfolioView, strategyDetailView } from "@/mocks/canonicalDataset";
import { isLiveSignalDetailView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildLiveSignalCommand } from "@/pages/LiveSignalDetailPage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("live signal detail front contract", () => {
  it("accepts the canonical Live Signal Detail view envelope", () => {
    const envelope = assertViewEnvelope(liveSignalDetailView, isLiveSignalDetailView);

    expect(envelope.data.identity.signalId).toBe("sig_vnext_demo_mnq_0940");
    expect(envelope.data.predicates.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.featureSnapshot.pointInTime).toBe(true);
    expect(envelope.data.commandActions.map((action) => action.decision)).toEqual(["TAKE", "TAKE_REDUCED", "WAIT", "REJECT"]);
  });

  it("keeps ids reconciled with live, strategy, portfolio and events projections", () => {
    const detail = liveSignalDetailView.data;
    const liveSignal = liveTradingView.data.signals.find((signal) => signal.signalId === detail.identity.signalId);
    const liveOrder = liveTradingView.data.orders.find((order) => order.signalId === detail.identity.signalId);
    const liveArbitration = liveTradingView.data.arbitrations.find((arbitration) => arbitration.signalId === detail.identity.signalId);
    const liveRisk = liveTradingView.data.riskChecks.find((risk) => risk.signalId === detail.identity.signalId);
    const strategySignal = strategyDetailView.data.signals.find((signal) => signal.signalId === detail.identity.signalId);
    const portfolioInstanceIds = new Set(portfolioView.data.virtualAllocations.map((allocation) => allocation.strategyInstanceId));
    const eventIds = new Set(eventsAuditView.data.events.map((event) => event.eventId));

    expect(liveSignal?.strategyInstanceId).toBe(detail.identity.strategyInstanceId);
    expect(liveSignal?.featureSnapshotId).toBe(detail.identity.featureSnapshotId);
    expect(liveOrder?.orderId).toBe(detail.linkedOrders[0]?.orderId);
    expect(liveArbitration?.arbitrationId).toBe(detail.arbitration.arbitrationId);
    expect(liveRisk?.riskCheckId).toBe(detail.riskCheck.riskCheckId);
    expect(strategySignal?.signalId).toBe(detail.identity.signalId);
    expect(portfolioInstanceIds.has(detail.identity.strategyInstanceId)).toBe(true);
    expect(detail.auditTrail.every((event) => eventIds.has(event.eventId))).toBe(true);
    expect(canonicalViewDataset["live-signal-detail"]).toBe(liveSignalDetailView);
  });

  it("keeps AI advisory separate from the authoritative order path", () => {
    const detail = liveSignalDetailView.data;
    const advisory = detail.auditTrail.filter((event) => event.lane === "ADVISORY");
    const authoritative = detail.auditTrail.filter((event) => event.lane === "AUTHORITATIVE");

    expect(detail.aiAdvisory.mode).toBe("SHADOW");
    expect(detail.aiAdvisory.authority).toBe("NONE");
    expect(advisory).toHaveLength(1);
    expect(authoritative.map((event) => event.domain)).toEqual(expect.arrayContaining(["STRATEGY", "PORTFOLIO", "RISK", "EXECUTION"]));
  });

  it("submits manual signal decisions through Command Runtime with reason and expected version", () => {
    const action = liveSignalDetailView.data.commandActions.find((candidate) => candidate.decision === "TAKE");
    expect(action).toBeTruthy();

    const input = buildLiveSignalCommand(action!, liveSignalDetailView.data, "Operator confirms deterministic risk check.");
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T16:10:00.000Z"),
      randomId: (() => {
        const ids = ["signal-one", "signal-two"];
        return () => ids.shift() ?? "signal-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(liveSignalDetailView.data.identity.expectedVersion);
    expect(headers["If-Match"]).toBe(liveSignalDetailView.data.identity.expectedVersion);
    expect(input.reason).toContain("Operator confirms");
    expect(input.payload).toMatchObject({
      signalId: liveSignalDetailView.data.identity.signalId,
      strategyVersionId: liveSignalDetailView.data.identity.strategyVersionId,
      strategyInstanceId: liveSignalDetailView.data.identity.strategyInstanceId,
      featureSnapshotId: liveSignalDetailView.data.identity.featureSnapshotId,
      decision: "TAKE",
      targetQuantity: 2
    });
  });

  it("rejects empty manual reasons before submitting a command", () => {
    const action = liveSignalDetailView.data.commandActions[0];

    expect(() => buildLiveSignalCommand(action, liveSignalDetailView.data, "   ")).toThrow("LIVE_SIGNAL_REASON_REQUIRED");
  });
});
