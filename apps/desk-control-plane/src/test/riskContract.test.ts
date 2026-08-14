import { describe, expect, it } from "vitest";
import { eventsAuditView, liveSignalDetailView, liveTradingView, ordersView, portfolioView, riskView } from "@/mocks/canonicalDataset";
import { isRiskView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildRiskCommand } from "@/pages/RiskCenterPage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("risk front contract", () => {
  it("accepts the canonical Risk Center view envelope", () => {
    const envelope = assertViewEnvelope(riskView, isRiskView);

    expect(envelope.data.limits.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.exposures.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.stressTests.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(5);
  });

  it("reconciles risk ids with live, portfolio and orders projections", () => {
    const liveRiskCheckIds = new Set(liveTradingView.data.riskChecks.map((risk) => risk.riskCheckId));
    const liveSignalRiskCheckId = liveSignalDetailView.data.riskCheck.riskCheckId;
    const portfolioStrategyInstanceIds = new Set(portfolioView.data.virtualAllocations.map((allocation) => allocation.strategyInstanceId));
    const orderIds = new Set(ordersView.data.activeOrders.map((order) => order.orderId));
    const fillIds = new Set(ordersView.data.fills.map((fill) => fill.fillId));

    expect(riskView.data.limits.some((limit) => limit.officialSource === liveSignalRiskCheckId)).toBe(true);
    expect(riskView.data.limits.some((limit) => liveRiskCheckIds.has(limit.officialSource))).toBe(true);
    expect(riskView.data.limits.some((limit) => portfolioStrategyInstanceIds.has(limit.targetId))).toBe(true);
    expect(riskView.data.limits.some((limit) => limit.contributors.some((contributor) => orderIds.has(contributor.contributorId)))).toBe(true);
    expect(riskView.data.limits.some((limit) => limit.contributors.some((contributor) => fillIds.has(contributor.contributorId)))).toBe(true);
  });

  it("exposes official backend limit material instead of requiring local front calculations", () => {
    for (const limit of riskView.data.limits) {
      expect(limit.officialSource).toMatch(/^(risk|portfolio|prop)_/);
      expect(limit.changedBy).toBeTruthy();
      expect(limit.reasonCodes.length).toBeGreaterThan(0);
      expect(Number.isFinite(limit.usedPct)).toBe(true);
      expect(Number.isFinite(limit.headroomValue)).toBe(true);
      expect(limit.contributors.length).toBeGreaterThan(0);
    }
  });

  it("keeps breaches audit-resolvable by correlation id", () => {
    const eventCorrelationIds = new Set(eventsAuditView.data.events.map((event) => event.correlationId));

    expect(riskView.data.breaches.every((breach) => eventCorrelationIds.has(breach.correlationId))).toBe(true);
    expect(riskView.data.breaches.map((breach) => breach.status)).toEqual(expect.arrayContaining(["OPEN", "ACKED"]));
  });

  it("submits stress tests through Command Runtime with If-Match", () => {
    const action = riskView.data.commandActions.find((candidate) => candidate.commandType === "risk.stress_test.run");
    expect(action).toBeTruthy();

    const input = buildRiskCommand(action!, "Operator requests a deterministic stress test.");
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T16:20:00.000Z"),
      randomId: (() => {
        const ids = ["risk-one", "risk-two"];
        return () => ids.shift() ?? "risk-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(action!.expectedVersion);
    expect(headers["If-Match"]).toBe(action!.expectedVersion);
    expect(input.payload).toMatchObject({
      actionId: action!.actionId,
      scenarioSet: "LIVE_CORE"
    });
  });

  it("requires step-up before preparing emergency kill switch dry-run commands", () => {
    const action = riskView.data.commandActions.find((candidate) => candidate.commandType === "risk.emergency.kill_switch");
    expect(action).toBeTruthy();
    expect(action!.criticality).toBe("EMERGENCY");
    expect(action!.permission).toBe("STEP_UP_REQUIRED");

    expect(() => buildRiskCommand(action!, "Emergency dry-run validation", "bad-token")).toThrow("RISK_STEP_UP_REQUIRED");

    const input = buildRiskCommand(action!, "Emergency dry-run validation", action!.actionId);
    expect(input.environment).toBe("MOCK");
    expect(input.payload).toMatchObject({
      actionId: action!.actionId,
      dryRun: true,
      stepUpAccepted: true
    });
  });

  it("rejects empty command reasons and denied commands before submitting", () => {
    const action = riskView.data.commandActions[0];
    expect(() => buildRiskCommand(action, " ")).toThrow("RISK_REASON_REQUIRED");

    const denied = riskView.data.commandActions.find((candidate) => candidate.permission === "DENIED");
    expect(denied).toBeTruthy();
    expect(() => buildRiskCommand(denied!, "Operator tries denied action.")).toThrow("RISK_PERMISSION_DENIED");
  });
});
