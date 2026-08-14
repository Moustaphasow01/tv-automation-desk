import { describe, expect, it } from "vitest";
import { researchDataCatalogView, researchExperimentDetailView, researchLabView, researchRunDetailView } from "@/mocks/canonicalDataset";
import { prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { isResearchDataCatalogView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("research data catalog front contract", () => {
  it("accepts the canonical Research Data Catalog view envelope", () => {
    const envelope = assertViewEnvelope(researchDataCatalogView, isResearchDataCatalogView);

    expect(envelope.data.summary.datasets).toBe(3);
    expect(envelope.data.datasets.length).toBe(envelope.data.summary.datasets);
    expect(envelope.data.instruments.length).toBeGreaterThanOrEqual(10);
    expect(envelope.data.features.length).toBe(envelope.data.summary.features);
    expect(envelope.data.lineage.length).toBe(envelope.data.summary.lineageEdges);
  });

  it("uses the same dataset identifiers as Research Lab, Experiment and Run", () => {
    const catalogDatasetIds = new Set(researchDataCatalogView.data.datasets.map((dataset) => dataset.datasetId));
    const labDatasetIds = new Set(researchLabView.data.datasets.map((dataset) => dataset.datasetId));
    const experimentDatasetIds = new Set(researchExperimentDetailView.data.datasets.map((dataset) => dataset.datasetId));

    expect(catalogDatasetIds).toEqual(labDatasetIds);
    expect([...experimentDatasetIds].every((datasetId) => catalogDatasetIds.has(datasetId))).toBe(true);
    expect(catalogDatasetIds.has(researchRunDetailView.data.run.datasetId)).toBe(true);
  });

  it("keeps instruments, features, lineage and incidents linked to existing datasets", () => {
    const datasetIds = new Set(researchDataCatalogView.data.datasets.map((dataset) => dataset.datasetId));
    const featureIds = new Set(researchDataCatalogView.data.features.map((feature) => feature.featureId));

    expect(researchDataCatalogView.data.instruments.every((instrument) => datasetIds.has(instrument.primaryDatasetId))).toBe(true);
    expect(researchDataCatalogView.data.features.every((feature) => datasetIds.has(feature.datasetId))).toBe(true);
    expect(researchDataCatalogView.data.features.every((feature) => feature.dependsOn.every((datasetId) => datasetIds.has(datasetId)))).toBe(true);
    expect(researchDataCatalogView.data.incidents.every((incident) => datasetIds.has(incident.datasetId))).toBe(true);
    expect(researchDataCatalogView.data.lineage.some((edge) => featureIds.has(edge.to) || featureIds.has(edge.from))).toBe(true);
  });

  it("exposes point-in-time and anti-lookahead status for every dataset and feature", () => {
    expect(researchDataCatalogView.data.datasets.every((dataset) => dataset.pointInTime)).toBe(true);
    expect(researchDataCatalogView.data.datasets.every((dataset) => dataset.lookaheadStatus !== "FAIL")).toBe(true);
    expect(researchDataCatalogView.data.features.every((feature) => feature.lookaheadStatus !== "FAIL")).toBe(true);
    expect(researchDataCatalogView.data.datasets.every((dataset) => dataset.provenance.length > 8 && dataset.version.length > 4)).toBe(true);
  });

  it("turns data actions into Command Runtime requests", () => {
    const allowedActions = researchDataCatalogView.data.commandActions.filter((item) => item.permission === "ALLOWED");

    expect(allowedActions.length).toBeGreaterThanOrEqual(3);
    for (const action of allowedActions) {
      const prepared = prepareDeskCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Research data action confirmed: ${action.label}`,
        payload: action.payload
      });

      expect(action.commandType).toMatch(/^research\.data\./);
      expect(prepared.status).toBe("REQUESTED");
      expect(prepared.expectedVersion).toBe(action.actionId);
    }
  });
});
