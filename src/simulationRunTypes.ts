export interface SimulationRunSummary {
  id: string;
  simulationRunId: string;
  sourceRunId: string | null;
  status: string;
  rawStatus: string;
  strategyVersionId: string | null;
  datasetId: string | null;
  parametersHash: string | null;
  reproducibilitySeed: string | null;
  simulationEngine: string | null;
  simulationEngineVersion: string | null;
  resultSchemaVersion: string | null;
  cutoff: string | null;
  datasetHash: string | null;
  compiledArtifactHash: string | null;
  resultHash: string | null;
  metricsHash: string | null;
  resultRef: string | null;
  metricsRef: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  failure: { code: string | null; message: string | null } | null;
  metadata: Record<string, unknown>;
}

export interface SimulationRunArtifact {
  id: string;
  simulationRunId: string;
  artifactKind: string;
  schemaVersion: string;
  contentHash: string;
  storageRef: string;
  createdAt: string | null;
  payloadSummary: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface SimulationReproducibilityProof {
  schema_version: "simulation_reproducibility_proof_v1";
  checked_at_utc: string | null;
  ok: boolean;
  reasons: string[];
  baseline_run_id: string | null;
  candidate_run_id: string | null;
  reproducibility_key_hash: string | null;
  metrics_hash_match: boolean;
  result_hash_match: boolean;
  dataset_hash_match: boolean;
  engine_version_match: boolean;
}

export interface SimulationReplayEvidence {
  available: boolean;
  count: number;
  primarySimulationRunId: string | null;
  runs: SimulationRunSummary[];
  artifacts: SimulationRunArtifact[];
}

export interface SimulationRunList {
  contract: "DeskSimulationRunList";
  schemaVersion: string;
  generatedAt: string;
  available: boolean;
  reason?: string;
  count: number;
  items: SimulationRunSummary[];
}

export interface SimulationRunDetail {
  contract: "DeskSimulationRunDetail";
  schemaVersion: string;
  run: SimulationRunSummary;
  artifactCount: number;
  artifacts: SimulationRunArtifact[];
}

export interface SimulationRunArtifactList {
  contract: "DeskSimulationRunArtifactList";
  schemaVersion: string;
  simulationRunId: string;
  count: number;
  items: SimulationRunArtifact[];
}

export interface SimulationRunComparisonItem {
  id: string;
  baseline: boolean;
  run: SimulationRunSummary;
  proof: SimulationReproducibilityProof | null;
  reproducible: boolean;
  reasons: string[];
  artifactCount: number;
  artifactKinds: string[];
  artifacts: SimulationRunArtifact[];
}

export interface SimulationRunComparison {
  contract: "DeskSimulationRunComparison";
  schemaVersion: string;
  ids: string[];
  baselineRunId: string | null;
  summary: {
    count: number;
    baselineRunId: string | null;
    reproducible: number;
    nonReproducible: number;
    artifactCount: number;
    reasons: string[];
  };
  dimensions: string[];
  items: SimulationRunComparisonItem[];
}
