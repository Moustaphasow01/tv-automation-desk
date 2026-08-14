import { describe, expect, it } from "vitest";
import { canonicalViewDataset, researchExperimentDetailView, researchLabView } from "@/mocks/canonicalDataset";
import { prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { isResearchExperimentDetailView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("research experiment detail front contract", () => {
  it("accepts the canonical Research Experiment Detail view envelope", () => {
    const envelope = assertViewEnvelope(researchExperimentDetailView, isResearchExperimentDetailView);

    expect(envelope.data.experiment.experimentId).toBe("exp_breakout_retest_mnq_oos_vnext");
    expect(envelope.data.datasets.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.segmentedMetrics.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(3);
  });

  it("stays coherent with the Research Lab global projection", () => {
    const detail = researchExperimentDetailView.data;
    const globalExperiment = researchLabView.data.experiments.find((experiment) => experiment.experimentId === detail.experiment.experimentId);
    const globalAgent = researchLabView.data.agents.find((agent) => agent.agentId === detail.ownership.ownerAgentId);
    const globalDatasetIds = new Set(researchLabView.data.datasets.map((dataset) => dataset.datasetId));

    expect(globalExperiment).toBeDefined();
    expect(globalExperiment?.missionId).toBe(detail.experiment.missionId);
    expect(globalExperiment?.runId).toBe(detail.experiment.runId);
    expect(globalAgent?.missionId).toBe(detail.experiment.missionId);
    expect(detail.datasets.every((dataset) => globalDatasetIds.has(dataset.datasetId))).toBe(true);
  });

  it("keeps versions, journal, knowledge and actions linked to the selected experiment", () => {
    const detail = researchExperimentDetailView.data;
    const versionIds = new Set(detail.versions.map((version) => version.versionId));

    expect(versionIds.has(detail.strategySpec.strategyVersionId)).toBe(true);
    expect(detail.versions.every((version) => !version.parentVersionId || versionIds.has(version.parentVersionId))).toBe(true);
    expect(detail.agentJournal.every((entry) => entry.journalId.startsWith("journal_"))).toBe(true);
    expect(detail.knowledgeCreated.every((knowledge) => knowledge.route.startsWith("/research") || knowledge.route.startsWith("/strategies"))).toBe(true);
    expect(detail.commandActions.every((action) => action.payload.experimentId === detail.experiment.experimentId)).toBe(true);
  });

  it("does not expose human-assignment workflow copy or fields", () => {
    const serialized = JSON.stringify(researchExperimentDetailView.data);
    const forbiddenKeyPattern = /assignee|assignedTo|ownerUser|humanOwner|operatorOwner/i;
    const forbiddenCopyPattern = /assigné|assigned to|à traiter par|owner humain/i;

    expect(flattenKeys(researchExperimentDetailView.data).some((key) => forbiddenKeyPattern.test(key))).toBe(false);
    expect(serialized).not.toMatch(forbiddenCopyPattern);
  });

  it("turns experiment actions into Command Runtime requests", () => {
    const action = researchExperimentDetailView.data.commandActions.find((item) => item.permission === "ALLOWED");
    expect(action).toBeDefined();

    const prepared = prepareDeskCommand({
      commandType: action!.commandType,
      environment: "MOCK",
      expectedVersion: action!.actionId,
      reason: `Research experiment action confirmed: ${action!.label}`,
      payload: action!.payload
    });

    expect(action!.commandType).toMatch(/^research\.experiment\./);
    expect(prepared.status).toBe("REQUESTED");
    expect(prepared.expectedVersion).toBe(action!.actionId);
    expect(canonicalViewDataset["research-experiment-detail"].data.experiment.experimentId).toBe(researchExperimentDetailView.data.experiment.experimentId);
  });
});

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenKeys(item, `${prefix}[${index}]`));
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...flattenKeys(item, path)];
    });
  }

  return [];
}
