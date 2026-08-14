import {
  buildSimulationReproducibilityProofV1,
  buildSimulationRunRegistrationV1,
  simulationRunArtifactsHashV1,
  simulationRunRegistryHashV1,
} from "@tv-automation/desk-replay-engine";
import { SystemClock } from "@tv-automation/desk-time";
import { createSimulationRunRegistryRepository } from "./simulation-run-registry-repository.js";

export function createSimulationRunRegistryService({ persistence, clock } = {}) {
  return new SimulationRunRegistryService({
    repository: createSimulationRunRegistryRepository(persistence),
    clock,
  });
}

export class SimulationRunRegistryService {
  constructor({ repository, clock } = {}) {
    this.repository = repository;
    this.clock = clock || new SystemClock();
  }

  async recordSimulationResult(input = {}, command = {}) {
    const now = input.created_at_utc || this.#nowUtc();
    const registration = buildSimulationRunRegistrationV1({ ...input, created_at_utc: now });
    if (!registration.ok) throw serviceError("SIMULATION_RUN_REGISTRATION_REJECTED", "Simulation result cannot be registered.", { reasons: registration.reasons });
    return this.#transaction(`simulation-run:${registration.run.simulation_run_id}`, async (repo) => {
      const existing = await repo.findRun(registration.run.simulation_run_id);
      if (existing) return this.#handleExistingRun(repo, existing, registration, command);
      const run = { ...registration.run, idempotency_key: idempotencyKey(command) };
      const saved = await repo.upsertRun(run);
      const artifacts = await repo.upsertArtifacts(registration.artifacts);
      const audit = await repo.appendAuditEvent(runAuditEvent({
        eventType: "SIMULATION_RUN_REGISTERED",
        run: saved,
        command,
        now,
        nextHash: simulationRunRegistryHashV1(saved),
        artifactHash: simulationRunArtifactsHashV1(artifacts),
      }));
      return { status: "CREATED", run: saved, artifacts, audit };
    });
  }

  async listRuns(filters = {}) {
    return this.repository.listRuns(normalizeFilters(filters));
  }

  async getRun(simulationRunId) {
    const run = await this.repository.findRun(simulationRunId);
    if (!run) throw serviceError("SIMULATION_RUN_NOT_FOUND", `Simulation Run not found: ${simulationRunId}.`, { simulation_run_id: simulationRunId }, 404);
    return run;
  }

  async listArtifacts(filters = {}) {
    return this.repository.listArtifacts(normalizeFilters(filters));
  }

  async compareRunReproducibility(input = {}) {
    const baselineRunId = text(input.baselineRunId || input.baseline_run_id);
    const candidateRunId = text(input.candidateRunId || input.candidate_run_id);
    if (!baselineRunId || !candidateRunId) {
      throw serviceError("SIMULATION_REPRODUCIBILITY_RUNS_REQUIRED", "Baseline and candidate Simulation Run IDs are required.", {}, 422);
    }
    const [baseline, candidate] = await Promise.all([
      this.getRun(baselineRunId),
      this.getRun(candidateRunId),
    ]);
    return buildSimulationReproducibilityProofV1({
      baseline,
      candidate,
      checked_at_utc: this.#nowUtc(),
    });
  }

  async #handleExistingRun(repo, existing, registration, command) {
    if (!sameSealedRun(existing, registration.run)) {
      throw serviceError("SIMULATION_RUN_CONFLICT", "Simulation Run already exists with different sealed result.", {
        simulation_run_id: existing.simulation_run_id,
        existing_result_hash: existing.result_hash,
        next_result_hash: registration.run.result_hash,
      }, 409);
    }
    const artifacts = await repo.listArtifacts({ simulationRunId: existing.simulation_run_id });
    const audit = await repo.appendAuditEvent(runAuditEvent({
      eventType: "SIMULATION_RUN_REGISTERED_IDEMPOTENT",
      run: existing,
      command,
      now: this.#nowUtc(),
      previousHash: simulationRunRegistryHashV1(existing),
      nextHash: simulationRunRegistryHashV1(existing),
      artifactHash: simulationRunArtifactsHashV1(artifacts),
    }));
    return { status: "IDEMPOTENT", run: existing, artifacts, audit };
  }

  async #transaction(lockKey, operation) {
    if (!this.repository?.transaction) return operation(this.repository);
    return this.repository.transaction(lockKey, operation);
  }

  #nowUtc() {
    const now = this.clock?.now?.();
    if (typeof now === "string") return new Date(now).toISOString();
    if (now?.utc) return new Date(now.utc).toISOString();
    return new SystemClock().now().utc;
  }
}

export class InMemorySimulationRunRegistryRepository {
  constructor(seed = {}) {
    this.runs = new Map((seed.runs || []).map((run) => [run.simulation_run_id, clone(run)]));
    this.artifacts = seed.artifacts || [];
    this.auditEvents = seed.auditEvents || [];
    this.transactionCalls = [];
  }

  async transaction(lockKey, operation) {
    this.transactionCalls.push(lockKey);
    return operation(this);
  }

  async findRun(simulationRunId) {
    return clone(this.runs.get(simulationRunId));
  }

  async listRuns(filters = {}) {
    return filtered([...this.runs.values()], filters, {
      strategyVersionId: "strategy_version_id",
      datasetId: "dataset_id",
      status: "status",
    });
  }

  async upsertRun(run) {
    this.runs.set(run.simulation_run_id, clone(run));
    return clone(run);
  }

  async upsertArtifacts(artifacts) {
    for (const artifact of artifacts) this.#upsertArtifact(artifact);
    return clone(artifacts);
  }

  async listArtifacts(filters = {}) {
    return filtered(this.artifacts, filters, {
      simulationRunId: "simulation_run_id",
      artifactKind: "artifact_kind",
    });
  }

  async appendAuditEvent(event) {
    const existing = event.idempotency_key
      ? this.auditEvents.find((item) => item.simulation_run_id === event.simulation_run_id
        && item.event_type === event.event_type
        && item.idempotency_key === event.idempotency_key)
      : null;
    if (existing) return clone(existing);
    const saved = { simulation_run_audit_event_id: `memory_sim_audit_${this.auditEvents.length + 1}`, ...clone(event) };
    this.auditEvents.push(saved);
    return clone(saved);
  }

  #upsertArtifact(artifact) {
    const existing = this.artifacts.find((item) => item.simulation_run_artifact_id === artifact.simulation_run_artifact_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(artifact)) {
      throw serviceError("SIMULATION_RUN_ARTIFACT_CONFLICT", "Simulation Run artifact already exists with different content.", {
        simulation_run_artifact_id: artifact.simulation_run_artifact_id,
      }, 409);
    }
    if (!existing) this.artifacts.push(clone(artifact));
  }
}

export function normalizeFilters(filters = {}) {
  return {
    simulationRunId: text(filters.simulationRunId || filters.simulation_run_id),
    strategyVersionId: text(filters.strategyVersionId || filters.strategy_version_id),
    datasetId: text(filters.datasetId || filters.dataset_id),
    status: filters.status ? String(filters.status).toUpperCase() : null,
    artifactKind: filters.artifactKind ? String(filters.artifactKind).toUpperCase() : text(filters.artifact_kind),
    sort: normalizeSort(filters.sort || filters.orderBy || filters.order_by),
    limit: bounded(filters.limit),
  };
}

function runAuditEvent({ eventType, run, command = {}, now, previousHash = null, nextHash = null, artifactHash = null }) {
  return {
    simulation_run_id: run.simulation_run_id,
    event_type: eventType,
    idempotency_key: idempotencyKey(command),
    actor: command.actor || "simulation_run_registry",
    reason: command.reason || null,
    previous_status: null,
    next_status: run.status,
    previous_hash: previousHash,
    next_hash: nextHash,
    payload: {
      command: sanitize(command),
      artifact_manifest_hash: artifactHash,
      metrics_hash: run.metrics_hash,
      result_hash: run.result_hash,
    },
    created_at_utc: now,
  };
}

function sameSealedRun(existing, next) {
  return existing.result_hash === next.result_hash
    && existing.metrics_hash === next.metrics_hash
    && existing.parameters_hash === next.parameters_hash
    && existing.reproducibility_seed === next.reproducibility_seed;
}

function filtered(items, filters, mapping) {
  return sortItems(items, filters.sort)
    .filter((item) => Object.entries(mapping).every(([filterKey, field]) => !filters[filterKey] || item[field] === filters[filterKey]))
    .slice(0, filters.limit || 100)
    .map(clone);
}

function sortItems(items, sort) {
  const normalized = normalizeSort(sort);
  const copy = [...items];
  if (normalized === "performance_desc") {
    return copy.sort((left, right) => number(right.metadata?.metrics?.total_r) - number(left.metadata?.metrics?.total_r)
      || compareDesc(right.created_at_utc, left.created_at_utc)
      || String(left.simulation_run_id).localeCompare(String(right.simulation_run_id)));
  }
  if (normalized === "started_desc") {
    return copy.sort((left, right) => compareDesc(right.started_at_utc, left.started_at_utc)
      || compareDesc(right.created_at_utc, left.created_at_utc)
      || String(left.simulation_run_id).localeCompare(String(right.simulation_run_id)));
  }
  return copy.sort((left, right) => compareDesc(right.created_at_utc, left.created_at_utc)
    || compareDesc(right.updated_at_utc, left.updated_at_utc)
    || String(left.simulation_run_id).localeCompare(String(right.simulation_run_id)));
}

function normalizeSort(value) {
  const normalized = String(value || "created_desc").toLowerCase();
  return ["created_desc", "started_desc", "performance_desc"].includes(normalized) ? normalized : "created_desc";
}

function compareDesc(rightValue, leftValue) {
  return String(rightValue || "").localeCompare(String(leftValue || ""));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function idempotencyKey(command = {}) {
  return text(command.idempotency_key || command.idempotencyKey);
}

function sanitize(command = {}) {
  return Object.fromEntries(Object.entries(command).filter(([, value]) => value !== undefined));
}

function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function serviceError(code, message, details = {}, statusCode = 422) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function clone(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
