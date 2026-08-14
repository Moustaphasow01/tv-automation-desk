import { describe, expect, it } from "vitest";
import { strategyCompareView, strategyDetailView } from "@/mocks/canonicalDataset";
import { isStrategyCompareView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildStrategyCompareCommand } from "@/pages/StrategyComparePage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("strategy compare front contract", () => {
  it("accepts the canonical Strategy Compare view envelope", () => {
    const envelope = assertViewEnvelope(strategyCompareView, isStrategyCompareView);

    expect(envelope.data.summary.strategyId).toBe("str_breakout_retest");
    expect(envelope.data.versions).toHaveLength(2);
    expect(envelope.data.specDiffs.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.metricComparison.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.divergentTrades.length).toBeGreaterThanOrEqual(3);
  });

  it("compares versions belonging to the strategy detail without confusing runtime bundles", () => {
    const detailVersionIds = new Set(strategyDetailView.data.versions.map((version) => version.strategyVersionId));
    const detailRuntimeIds = new Set(strategyDetailView.data.instances.map((instance) => instance.runtimeBundleId));

    for (const version of strategyCompareView.data.versions) {
      expect(detailVersionIds.has(version.strategyVersionId)).toBe(true);
      expect(version.strategyVersionId).toMatch(/^strver_/);
      expect(version.runtimeBundleId).toMatch(/^rtbundle_/);
      expect(version.strategyVersionId).not.toBe(version.runtimeBundleId);
    }

    expect(detailRuntimeIds.has(strategyCompareView.data.versions.find((version) => version.role === "CANDIDATE")?.runtimeBundleId ?? "")).toBe(true);
  });

  it("renders deterministic diff data rather than asking the UI to infer promotion metrics", () => {
    expect(strategyCompareView.data.summary.verdict).toBe("PROMOTE");
    expect(strategyCompareView.data.metricComparison.every((metric) => typeof metric.delta === "number")).toBe(true);
    expect(strategyCompareView.data.regimeComparison.every((regime) => typeof regime.deltaR === "number")).toBe(true);
    expect(strategyCompareView.data.costs.every((cost) => ["BETTER", "WORSE", "FLAT"].includes(cost.verdict))).toBe(true);
    expect(strategyCompareView.data.parity.some((parity) => parity.status === "BLOCK")).toBe(true);
  });

  it("keeps deep links resolvable to runs, strategy and experiment routes", () => {
    expect(strategyCompareView.data.deepLinks.map((link) => link.kind)).toEqual(
      expect.arrayContaining(["RUN", "STRATEGY", "EXPERIMENT"])
    );
    expect(strategyCompareView.data.deepLinks.every((link) => link.route.startsWith("/research") || link.route.startsWith("/strategies"))).toBe(true);
  });

  it("submits compare actions through Command Runtime with candidate version If-Match", () => {
    const action = strategyCompareView.data.commandActions.find((candidate) => candidate.permission === "ALLOWED");
    expect(action).toBeTruthy();

    const input = buildStrategyCompareCommand(action!, strategyCompareView.data);
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T16:00:00.000Z"),
      randomId: (() => {
        const ids = ["compare-one", "compare-two"];
        return () => ids.shift() ?? "compare-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(strategyCompareView.data.summary.candidateVersionId);
    expect(headers["If-Match"]).toBe(strategyCompareView.data.summary.candidateVersionId);
    expect(input.payload).toMatchObject({
      strategyId: strategyCompareView.data.strategy.strategyId,
      strategyDefinitionId: strategyCompareView.data.strategy.strategyDefinitionId,
      baseVersionId: strategyCompareView.data.summary.baseVersionId,
      candidateVersionId: strategyCompareView.data.summary.candidateVersionId,
      actionId: action!.actionId
    });
  });
});
