import { describe, expect, it } from "vitest";
import { canonicalViewDataset, strategyCenterView, strategyDetailView } from "@/mocks/canonicalDataset";
import { isStrategyDetailView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildStrategyDetailCommand } from "@/pages/StrategyDetailPage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("strategy detail front contract", () => {
  it("accepts the canonical Strategy Detail view envelope", () => {
    const envelope = assertViewEnvelope(strategyDetailView, isStrategyDetailView);

    expect(envelope.data.identity.strategyId).toBe("str_breakout_retest");
    expect(envelope.data.strategySpec.rules.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.strategySpec.levels.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.performance.map((bucket) => bucket.scope)).toEqual(["BACKTEST", "PAPER", "LIVE"]);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(6);
  });

  it("stays reconciled with Strategy Center, Research, Live and Portfolio ids", () => {
    const identity = strategyDetailView.data.identity;
    const strategyCenterRow = strategyCenterView.data.strategies.find((strategy) => strategy.strategyId === identity.strategyId);
    const researchResult = canonicalViewDataset["research-lab"].data.results.find((result) => result.strategyId === identity.strategyId);
    const liveSignal = canonicalViewDataset["live-trading"].data.signals.find((signal) => signal.strategyInstanceId === identity.strategyInstanceId);
    const portfolioAllocation = canonicalViewDataset.portfolio.data.virtualAllocations.find(
      (allocation) => allocation.strategyInstanceId === identity.strategyInstanceId
    );

    expect(strategyCenterRow).toBeTruthy();
    expect(strategyCenterRow?.strategyDefinitionId).toBe(identity.strategyDefinitionId);
    expect(strategyCenterRow?.strategyVersionId).toBe(identity.strategyVersionId);
    expect(strategyCenterRow?.strategyInstanceId).toBe(identity.strategyInstanceId);
    expect(strategyCenterRow?.runtimeBundleId).toBe(identity.runtimeBundleId);
    expect(researchResult?.experimentId).toBe(strategyDetailView.data.definition.sourceExperimentId);
    expect(liveSignal?.signalId).toBe(strategyDetailView.data.signals[0].signalId);
    expect(portfolioAllocation?.strategyInstanceId).toBe(identity.strategyInstanceId);
  });

  it("separates Strategy Version from Runtime Bundle in every instance and action payload", () => {
    for (const instance of strategyDetailView.data.instances) {
      expect(instance.strategyVersionId).toMatch(/^strver_/);
      expect(instance.runtimeBundleId).toMatch(/^rtbundle_/);
      expect(instance.strategyVersionId).not.toBe(instance.runtimeBundleId);
    }

    for (const action of strategyDetailView.data.commandActions) {
      if ("runtimeBundleId" in action.payload) {
        expect(String(action.payload.runtimeBundleId)).toMatch(/^rtbundle_/);
      }
      if ("strategyVersionId" in action.payload) {
        expect(String(action.payload.strategyVersionId)).toMatch(/^strver_/);
      }
    }
  });

  it("does not expose LIVE as an invented UI capability", () => {
    const liveActions = strategyDetailView.data.commandActions.filter((action) => action.commandType.includes("live"));

    expect(liveActions.length).toBeGreaterThanOrEqual(1);
    expect(liveActions.every((action) => action.permission !== "ALLOWED")).toBe(true);
    expect(strategyDetailView.data.performance.find((bucket) => bucket.scope === "LIVE")?.trades).toBe(0);
  });

  it("submits Strategy Detail actions through Command Runtime with the current strategy version If-Match", () => {
    const identity = strategyDetailView.data.identity;
    const action = strategyDetailView.data.commandActions.find((candidate) => candidate.permission === "ALLOWED");
    expect(action).toBeTruthy();

    const input = buildStrategyDetailCommand(action!, identity);
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T15:00:00.000Z"),
      randomId: (() => {
        const ids = ["detail-one", "detail-two"];
        return () => ids.shift() ?? "detail-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(identity.strategyVersionId);
    expect(headers["If-Match"]).toBe(identity.strategyVersionId);
    expect(headers["Idempotency-Key"]).toBe(`idem_${action!.commandType.replaceAll(".", "_")}_detail-one`);
    expect(input.payload).toMatchObject({
      strategyId: identity.strategyId,
      strategyDefinitionId: identity.strategyDefinitionId,
      strategyVersionId: identity.strategyVersionId,
      strategyInstanceId: identity.strategyInstanceId,
      runtimeBundleId: identity.runtimeBundleId,
      actionId: action!.actionId
    });
  });
});
