import { describe, expect, it } from "vitest";
import { researchExperimentDetailView, researchLabView, researchRunDetailView } from "@/mocks/canonicalDataset";
import { prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { isResearchRunDetailView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("research run detail front contract", () => {
  it("accepts the canonical Research Run Detail view envelope", () => {
    const envelope = assertViewEnvelope(researchRunDetailView, isResearchRunDetailView);

    expect(envelope.data.run.runId).toBe("run_research_mnq_oos_fold_18_24");
    expect(envelope.data.parameters.length).toBeGreaterThanOrEqual(6);
    expect(envelope.data.trades.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.equityCurve.length).toBeGreaterThanOrEqual(10);
  });

  it("links to the same experiment, dataset and strategy version as the experiment dossier", () => {
    const run = researchRunDetailView.data.run;
    const experiment = researchExperimentDetailView.data;
    const labRun = researchLabView.data.experiments.find((item) => item.runId === run.runId);
    const experimentDatasetIds = new Set(experiment.datasets.map((dataset) => dataset.datasetId));

    expect(run.experimentId).toBe(experiment.experiment.experimentId);
    expect(run.missionId).toBe(experiment.experiment.missionId);
    expect(run.strategyVersionId).toBe(experiment.strategySpec.strategyVersionId);
    expect(experimentDatasetIds.has(run.datasetId)).toBe(true);
    expect(labRun?.experimentId).toBe(run.experimentId);
  });

  it("exposes reproducibility fields required to replay the exact run", () => {
    const { run, parameters } = researchRunDetailView.data;

    expect(run.reproducibility).toBe("LOCKED");
    expect(run.datasetHash).toMatch(/^sha256:/);
    expect(run.engineVersion).toContain("research-engine");
    expect(run.runtimeVersion).toContain("deterministic-runtime");
    expect(typeof run.seed).toBe("number");
    expect(parameters.some((param) => param.key === "riskPctNetCapital")).toBe(true);
  });

  it("keeps performance sections and trade list internally consistent", () => {
    const { summary, distribution, regimePerformance, hourlyPerformance, trades, ambiguity } = researchRunDetailView.data;
    const distributionTrades = distribution.reduce((sum, bucket) => sum + bucket.count, 0);
    const regimeTrades = regimePerformance.reduce((sum, regime) => sum + regime.trades, 0);
    const hourlyTrades = hourlyPerformance.reduce((sum, hour) => sum + hour.trades, 0);

    expect(summary.trades).toBe(distributionTrades);
    expect(summary.trades).toBe(regimeTrades);
    expect(summary.trades).toBe(hourlyTrades);
    expect(trades.every((trade) => trade.maeR <= 0 && trade.mfeR >= 0)).toBe(true);
    expect(ambiguity.every((item) => item.ambiguityId.startsWith("amb_"))).toBe(true);
  });

  it("turns run actions into Command Runtime requests", () => {
    const action = researchRunDetailView.data.commandActions.find((item) => item.permission === "ALLOWED");
    expect(action).toBeDefined();

    const prepared = prepareDeskCommand({
      commandType: action!.commandType,
      environment: "MOCK",
      expectedVersion: action!.actionId,
      reason: `Research run action confirmed: ${action!.label}`,
      payload: action!.payload
    });

    expect(action!.commandType).toMatch(/^research\.run\./);
    expect(prepared.status).toBe("REQUESTED");
    expect(prepared.expectedVersion).toBe(action!.actionId);
  });
});
