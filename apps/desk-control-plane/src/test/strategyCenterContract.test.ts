import { describe, expect, it } from "vitest";
import { canonicalViewDataset, strategyCenterView } from "@/mocks/canonicalDataset";
import { isStrategyCenterView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildStrategyShadowTestCommand } from "@/pages/StrategyCenterPage";

const versionStatuses = new Set(["DRAFT", "VALIDATED", "REJECTED", "DEPRECATED", "RETIRED"]);
const runtimeStatuses = new Set(["STOPPED", "STARTING", "RUNNING", "PAUSED", "FAILED"]);
const executionModes = new Set(["SHADOW", "PAPER", "LIVE"]);

describe("strategy center front contract", () => {
  it("accepts the canonical Strategy Center view envelope", () => {
    const envelope = assertViewEnvelope(strategyCenterView, isStrategyCenterView);

    expect(envelope.data.summary.totalStrategies).toBeGreaterThanOrEqual(envelope.data.strategies.length);
    expect(envelope.data.strategies.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.lifecycleDistribution.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.selectedInspector.currentCommandEligibility).toBe("CAN_REQUEST_SHADOW");
  });

  it("keeps Definition, Version, Instance and Runtime Bundle as distinct ids", () => {
    for (const strategy of strategyCenterView.data.strategies) {
      expect(strategy.strategyDefinitionId).toMatch(/^strdef_/);
      expect(strategy.strategyVersionId).toMatch(/^strver_/);
      expect(strategy.strategyInstanceId).toMatch(/^strinst_/);
      expect(strategy.runtimeBundleId).toMatch(/^rtbundle_/);
      expect(new Set([
        strategy.strategyDefinitionId,
        strategy.strategyVersionId,
        strategy.strategyInstanceId,
        strategy.runtimeBundleId
      ]).size).toBe(4);
    }
  });

  it("keeps strict lifecycle enums and a reconciled selected inspector", () => {
    const strategiesById = new Map(strategyCenterView.data.strategies.map((strategy) => [strategy.strategyId, strategy]));
    const selected = strategyCenterView.data.selectedInspector;
    const listed = strategiesById.get(selected.strategyId);

    expect(listed).toBeTruthy();
    expect(listed?.strategyDefinitionId).toBe(selected.strategyDefinitionId);
    expect(listed?.strategyVersionId).toBe(selected.strategyVersionId);
    expect(listed?.strategyInstanceId).toBe(selected.strategyInstanceId);
    expect(listed?.runtimeBundleId).toBe(selected.runtimeBundleId);

    for (const strategy of strategyCenterView.data.strategies) {
      expect(versionStatuses.has(strategy.versionStatus)).toBe(true);
      expect(runtimeStatuses.has(strategy.runtimeStatus)).toBe(true);
      expect(executionModes.has(strategy.executionMode)).toBe(true);
      expect(strategy.runtimeBundleId).not.toBe(strategy.strategyVersionId);
    }

    const lifecycleTotal = strategyCenterView.data.lifecycleDistribution.reduce((sum, item) => sum + item.count, 0);
    expect(lifecycleTotal).toBe(strategyCenterView.data.summary.totalStrategies);
  });

  it("shares key strategy ids with Research, Live and Portfolio projections", () => {
    const researchStrategyIds = new Set(canonicalViewDataset["research-lab"].data.results.map((result) => result.strategyId));
    const liveStrategyInstanceId = canonicalViewDataset["live-trading"].data.signals[0].strategyInstanceId;
    const portfolioStrategyInstanceIds = new Set(
      canonicalViewDataset.portfolio.data.virtualAllocations.map((allocation) => allocation.strategyInstanceId)
    );

    expect(researchStrategyIds.has("str_breakout_retest")).toBe(true);
    expect(strategyCenterView.data.strategies.some((strategy) => strategy.strategyId === "str_breakout_retest")).toBe(true);
    expect(strategyCenterView.data.strategies.some((strategy) => strategy.strategyInstanceId === liveStrategyInstanceId)).toBe(true);
    expect(strategyCenterView.data.strategies.some((strategy) => portfolioStrategyInstanceIds.has(strategy.strategyInstanceId))).toBe(true);
  });

  it("submits lifecycle actions through Command Runtime with version If-Match and runtime bundle payload", () => {
    const selected = strategyCenterView.data.selectedInspector;
    const commandInput = buildStrategyShadowTestCommand(selected);
    const prepared = prepareDeskCommand(commandInput, {
      now: () => new Date("2026-08-10T14:00:00.000Z"),
      randomId: (() => {
        const ids = ["shadow-one", "shadow-two"];
        return () => ids.shift() ?? "shadow-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(commandInput.commandType).toBe("strategy.lifecycle.request_shadow_test");
    expect(commandInput.environment).toBe("MOCK");
    expect(commandInput.expectedVersion).toBe(selected.strategyVersionId);
    expect(headers["If-Match"]).toBe(selected.strategyVersionId);
    expect(headers["Idempotency-Key"]).toBe("idem_strategy_lifecycle_request_shadow_test_shadow-one");
    expect(headers["X-Correlation-ID"]).toBe("corr_strategy_lifecycle_request_shadow_test_shadow-two");
    expect(commandInput.payload).toEqual({
      strategyId: selected.strategyId,
      strategyDefinitionId: selected.strategyDefinitionId,
      strategyVersionId: selected.strategyVersionId,
      strategyInstanceId: selected.strategyInstanceId,
      runtimeBundleId: selected.runtimeBundleId
    });
  });
});
