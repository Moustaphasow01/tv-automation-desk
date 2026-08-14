import {
  buildResearchCandidateEvaluationSummaryV1,
  canonicalSha256,
  researchCandidateHashV1,
  researchEvaluationReportHashV1,
  researchExperimentHashV1,
  researchHypothesisHashV1,
  validateResearchCandidateV1,
  validateResearchEvaluationReportV1,
  validateResearchExperimentV1,
  validateResearchHypothesisV1,
} from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";
import { createResearchExperimentRegistryRepository } from "./research-experiment-registry-repository.js";

export function createResearchExperimentRegistryService({ persistence, clock } = {}) {
  return new ResearchExperimentRegistryService({
    repository: createResearchExperimentRegistryRepository(persistence),
    clock,
  });
}

export class ResearchExperimentRegistryService {
  constructor({ repository, clock } = {}) {
    this.repository = repository;
    this.clock = clock || new SystemClock();
  }

  async registerExperiment(input = {}, command = {}) {
    const now = input.created_at_utc || this.#nowUtc();
    const experiment = assertValid(validateResearchExperimentV1(withTimestamps(input, now)));
    return this.#registerAggregate({
      lockKey: `research-experiment:${experiment.research_experiment_id}`,
      find: (repo) => repo.findExperiment(experiment.research_experiment_id),
      save: (repo) => repo.upsertExperiment(experiment),
      hash: researchExperimentHashV1,
      aggregateType: "research_experiment",
      aggregateId: experiment.research_experiment_id,
      eventType: "RESEARCH_EXPERIMENT_REGISTERED",
      entity: experiment,
      command,
      now,
    });
  }

  async registerHypothesis(input = {}, command = {}) {
    const now = input.created_at_utc || this.#nowUtc();
    const hypothesis = assertValid(validateResearchHypothesisV1(withTimestamps(input, now)));
    await this.getExperiment(hypothesis.research_experiment_id);
    return this.#registerAggregate({
      lockKey: `research-hypothesis:${hypothesis.research_hypothesis_id}`,
      find: (repo) => repo.findHypothesis(hypothesis.research_hypothesis_id),
      save: (repo) => repo.upsertHypothesis(hypothesis),
      hash: researchHypothesisHashV1,
      aggregateType: "research_hypothesis",
      aggregateId: hypothesis.research_hypothesis_id,
      eventType: "RESEARCH_HYPOTHESIS_REGISTERED",
      entity: hypothesis,
      command,
      now,
    });
  }

  async registerCandidate(input = {}, command = {}) {
    const now = input.created_at_utc || this.#nowUtc();
    const candidate = assertValid(validateResearchCandidateV1(withTimestamps(input, now)));
    await this.getHypothesis(candidate.research_hypothesis_id);
    return this.#registerAggregate({
      lockKey: `research-candidate:${candidate.research_candidate_id}`,
      find: (repo) => repo.findCandidate(candidate.research_candidate_id),
      save: (repo) => repo.upsertCandidate(candidate),
      hash: researchCandidateHashV1,
      aggregateType: "research_candidate",
      aggregateId: candidate.research_candidate_id,
      eventType: "RESEARCH_CANDIDATE_REGISTERED",
      entity: candidate,
      command,
      now,
    });
  }

  async recordEvaluationReport(input = {}, command = {}) {
    const now = input.created_at_utc || this.#nowUtc();
    const report = assertValid(validateResearchEvaluationReportV1({ ...input, created_at_utc: now }));
    return this.#transaction(`research-evaluation:${report.research_evaluation_report_id}`, async (repo) => {
      const candidate = await this.#requiredCandidate(repo, report.research_candidate_id);
      const existing = await repo.findEvaluationReport(report.research_evaluation_report_id);
      const outcome = await this.#saveEvaluation(repo, existing, report, command, now);
      const reports = await repo.listEvaluationReports({ researchCandidateId: report.research_candidate_id, limit: 500 });
      const summary = buildResearchCandidateEvaluationSummaryV1({
        research_candidate_id: report.research_candidate_id,
        evaluation_reports: reports,
      });
      const updatedCandidate = await repo.upsertCandidate(applyEvaluationSummary(candidate, summary, now));
      await repo.upsertRunLink(runLinkFromReport(report, command, now));
      return { ...outcome, report: outcome.entity, candidate: updatedCandidate, summary };
    });
  }

  async listExperiments(filters = {}) {
    return this.repository.listExperiments(normalizeResearchFilters(filters));
  }

  async getExperiment(researchExperimentId) {
    const experiment = await this.repository.findExperiment(researchExperimentId);
    if (!experiment) throw serviceError("RESEARCH_EXPERIMENT_NOT_FOUND", `Research Experiment not found: ${researchExperimentId}.`, { research_experiment_id: researchExperimentId }, 404);
    return experiment;
  }

  async listHypotheses(filters = {}) {
    return this.repository.listHypotheses(normalizeResearchFilters(filters));
  }

  async getHypothesis(researchHypothesisId) {
    const hypothesis = await this.repository.findHypothesis(researchHypothesisId);
    if (!hypothesis) throw serviceError("RESEARCH_HYPOTHESIS_NOT_FOUND", `Research Hypothesis not found: ${researchHypothesisId}.`, { research_hypothesis_id: researchHypothesisId }, 404);
    return hypothesis;
  }

  async listCandidates(filters = {}) {
    return this.repository.listCandidates(normalizeResearchFilters(filters));
  }

  async getCandidate(researchCandidateId) {
    const candidate = await this.repository.findCandidate(researchCandidateId);
    if (!candidate) throw serviceError("RESEARCH_CANDIDATE_NOT_FOUND", `Research Candidate not found: ${researchCandidateId}.`, { research_candidate_id: researchCandidateId }, 404);
    return candidate;
  }

  async listEvaluationReports(filters = {}) {
    return this.repository.listEvaluationReports(normalizeResearchFilters(filters));
  }

  async #registerAggregate(options) {
    return this.#transaction(options.lockKey, async (repo) => {
      const existing = await options.find(repo);
      if (existing) return this.#existingAggregate(repo, existing, options);
      const saved = await options.save(repo);
      const audit = await repo.appendAuditEvent(auditEvent({ ...options, nextHash: options.hash(saved) }));
      return { status: "CREATED", entity: saved, audit };
    });
  }

  async #existingAggregate(repo, existing, options) {
    const existingHash = options.hash(existing);
    const nextHash = options.hash(options.entity);
    if (existingHash !== nextHash) throw serviceError("RESEARCH_AGGREGATE_CONFLICT", "Research aggregate already exists with different content.", { aggregate_id: options.aggregateId }, 409);
    const audit = await repo.appendAuditEvent(auditEvent({
      ...options,
      eventType: `${options.eventType}_IDEMPOTENT`,
      previousHash: existingHash,
      nextHash,
    }));
    return { status: "IDEMPOTENT", entity: existing, audit };
  }

  async #saveEvaluation(repo, existing, report, command, now) {
    const options = evaluationAuditOptions(report, command, now);
    if (existing) return this.#existingAggregate(repo, existing, { ...options, entity: report });
    const businessExisting = typeof repo.findEvaluationReportByBusinessKey === "function"
      ? await repo.findEvaluationReportByBusinessKey({
        researchCandidateId: report.research_candidate_id,
        reportKind: report.report_kind,
        simulationRunId: report.simulation_run_id,
      })
      : null;
    if (businessExisting) return this.#existingEvaluationByBusinessKey(repo, businessExisting, { ...options, entity: report });
    const saved = await repo.upsertEvaluationReport(report);
    const audit = await repo.appendAuditEvent(auditEvent({ ...options, entity: saved, nextHash: researchEvaluationReportHashV1(saved) }));
    return { status: "CREATED", entity: saved, audit };
  }

  async #existingEvaluationByBusinessKey(repo, existing, options) {
    if (!sameEvaluationSemantics(existing, options.entity)) {
      throw serviceError("RESEARCH_AGGREGATE_CONFLICT", "Research evaluation already exists for candidate/report kind/simulation with different content.", {
        aggregate_id: options.aggregateId,
        existing_report_id: existing.research_evaluation_report_id,
        research_candidate_id: options.entity.research_candidate_id,
        report_kind: options.entity.report_kind,
        simulation_run_id: options.entity.simulation_run_id,
      }, 409);
    }
    const existingHash = options.hash(existing);
    const audit = await repo.appendAuditEvent(auditEvent({
      ...options,
      eventType: `${options.eventType}_IDEMPOTENT_BUSINESS_KEY`,
      aggregateId: existing.research_evaluation_report_id,
      entity: existing,
      previousHash: existingHash,
      nextHash: existingHash,
    }));
    return { status: "IDEMPOTENT_BUSINESS_KEY", entity: existing, audit };
  }

  async #requiredCandidate(repo, researchCandidateId) {
    const candidate = await repo.findCandidate(researchCandidateId);
    if (!candidate) throw serviceError("RESEARCH_CANDIDATE_NOT_FOUND", `Research Candidate not found: ${researchCandidateId}.`, { research_candidate_id: researchCandidateId }, 404);
    return candidate;
  }

  #nowUtc() {
    const now = this.clock && typeof this.clock.now === "function" ? this.clock.now() : null;
    if (typeof now === "string") return new Date(now).toISOString();
    if (now && now.utc) return new Date(now.utc).toISOString();
    const fallback = new SystemClock();
    return fallback.now().utc;
  }

  async #transaction(lockKey, operation) {
    const repository = this.repository;
    if (!repository || typeof repository.transaction !== "function") return operation(repository);
    return repository.transaction(lockKey, operation);
  }
}

export class InMemoryResearchExperimentRegistryRepository {
  constructor(seed = {}) {
    this.experiments = mapBy(seed.experiments, "research_experiment_id");
    this.hypotheses = mapBy(seed.hypotheses, "research_hypothesis_id");
    this.candidates = mapBy(seed.candidates, "research_candidate_id");
    this.evaluationReports = mapBy(seed.evaluationReports, "research_evaluation_report_id");
    this.runLinks = mapBy(seed.runLinks, "research_experiment_run_link_id");
    this.auditEvents = seed.auditEvents || [];
    this.transactionCalls = [];
  }

  async transaction(lockKey, operation) {
    this.transactionCalls.push(lockKey);
    return operation(this);
  }

  async findExperiment(id) { return clone(this.experiments.get(id)); }
  async findHypothesis(id) { return clone(this.hypotheses.get(id)); }
  async findCandidate(id) { return clone(this.candidates.get(id)); }
  async findEvaluationReport(id) { return clone(this.evaluationReports.get(id)); }
  async findEvaluationReportByBusinessKey({ researchCandidateId, reportKind, simulationRunId } = {}) {
    return clone([...this.evaluationReports.values()].find((item) => item.research_candidate_id === researchCandidateId
      && item.report_kind === reportKind
      && item.simulation_run_id === simulationRunId));
  }
  async upsertExperiment(entity) { this.experiments.set(entity.research_experiment_id, clone(entity)); return clone(entity); }
  async upsertHypothesis(entity) { this.hypotheses.set(entity.research_hypothesis_id, clone(entity)); return clone(entity); }
  async upsertCandidate(entity) { this.candidates.set(entity.research_candidate_id, clone(entity)); return clone(entity); }
  async upsertEvaluationReport(entity) { this.evaluationReports.set(entity.research_evaluation_report_id, clone(entity)); return clone(entity); }
  async upsertRunLink(entity) { this.runLinks.set(entity.research_experiment_run_link_id, clone(entity)); return clone(entity); }
  async listExperiments(filters = {}) { return filtered(this.experiments, filters, { researchExperimentId: "research_experiment_id", status: "status", owner: "owner" }); }
  async listHypotheses(filters = {}) { return filtered(this.hypotheses, filters, { researchExperimentId: "research_experiment_id", status: "status" }); }
  async listCandidates(filters = {}) { return filtered(this.candidates, filters, { researchExperimentId: "research_experiment_id", researchHypothesisId: "research_hypothesis_id", researchCandidateId: "research_candidate_id", status: "status" }); }
  async listEvaluationReports(filters = {}) { return filtered(this.evaluationReports, filters, { researchExperimentId: "research_experiment_id", researchCandidateId: "research_candidate_id", verdict: "verdict", reportKind: "report_kind" }); }

  async appendAuditEvent(event) {
    const existing = event.idempotency_key
      ? this.auditEvents.find((item) => item.aggregate_type === event.aggregate_type && item.aggregate_id === event.aggregate_id && item.event_type === event.event_type && item.idempotency_key === event.idempotency_key)
      : null;
    if (existing) return clone(existing);
    const saved = { research_audit_event_id: `memory_research_audit_${this.auditEvents.length + 1}`, ...clone(event) };
    this.auditEvents.push(saved);
    return clone(saved);
  }
}

export function normalizeResearchFilters(filters = {}) {
  return {
    researchExperimentId: text(filters.researchExperimentId || filters.research_experiment_id || filters.experiment_id),
    researchHypothesisId: text(filters.researchHypothesisId || filters.research_hypothesis_id || filters.hypothesis_id),
    researchCandidateId: text(filters.researchCandidateId || filters.research_candidate_id || filters.candidate_id),
    status: upper(filters.status),
    verdict: upper(filters.verdict),
    reportKind: upper(filters.reportKind || filters.report_kind),
    owner: text(filters.owner),
    limit: bounded(filters.limit),
  };
}

function evaluationAuditOptions(report, command, now) {
  return {
    hash: researchEvaluationReportHashV1,
    aggregateType: "research_evaluation_report",
    aggregateId: report.research_evaluation_report_id,
    eventType: "RESEARCH_EVALUATION_RECORDED",
    command,
    now,
  };
}

function withTimestamps(input, now) {
  return { ...input, created_at_utc: input.created_at_utc || now, updated_at_utc: input.updated_at_utc || input.created_at_utc || now };
}

function applyEvaluationSummary(candidate, summary, now) {
  const promotionBlock = promotionBlockFromSummary(candidate, summary);
  return {
    ...candidate,
    status: candidate.status === "IDEA" ? "UNDER_REVIEW" : candidate.status,
    evaluation_score: summary.composite_score,
    last_evaluation_verdict: summary.verdict,
    promotion_blocked: promotionBlock.blocked,
    promotion_block_reason: promotionBlock.reason,
    updated_at_utc: now,
  };
}

function promotionBlockFromSummary(candidate = {}, summary = {}) {
  if (summary.verdict === "FAIL") return { blocked: true, reason: "EVALUATION_FAILED" };
  if (summary.verdict === "PASS") {
    const kindCounts = summary.kind_counts || {};
    if (kindCounts.ROBUSTNESS > 0 && kindCounts.OUT_OF_SAMPLE > 0 && kindCounts.CONTRADICTORY_REVIEW > 0) {
      return { blocked: true, reason: "OPERATOR_PROMOTION_REQUIRED" };
    }
    if (kindCounts.CONTRADICTORY_REVIEW > 0) return { blocked: true, reason: "ROBUSTNESS_REVIEW_REQUIRED" };
    return { blocked: true, reason: "CONTRADICTORY_REVIEW_REQUIRED" };
  }
  return {
    blocked: candidate.promotion_blocked === true,
    reason: candidate.promotion_block_reason || null,
  };
}

function runLinkFromReport(report, command, now) {
  return {
    research_experiment_run_link_id: text(command.run_link_id) || `${report.research_evaluation_report_id}`,
    research_experiment_id: report.research_experiment_id,
    research_candidate_id: report.research_candidate_id,
    simulation_run_id: report.simulation_run_id,
    role: report.report_kind,
    included_in_selection: report.report_kind !== "TRAIN",
    metadata: { source: "evaluation_report" },
    linked_at_utc: now,
  };
}

function auditEvent(options) {
  return {
    aggregate_type: options.aggregateType,
    aggregate_id: options.aggregateId,
    event_type: options.eventType,
    idempotency_key: text(options.command?.idempotency_key || options.command?.idempotencyKey),
    actor: options.command?.actor || "research_registry",
    reason: options.command?.reason || null,
    previous_status: null,
    next_status: options.entity?.status || options.entity?.verdict || null,
    previous_hash: options.previousHash || null,
    next_hash: options.nextHash || null,
    payload: sanitize(options.command),
    created_at_utc: options.now,
  };
}

function sameEvaluationSemantics(existing = {}, next = {}) {
  return canonicalSha256(evaluationSemanticShape(existing)) === canonicalSha256(evaluationSemanticShape(next));
}

function evaluationSemanticShape(report = {}) {
  return {
    research_experiment_id: report.research_experiment_id,
    research_candidate_id: report.research_candidate_id,
    simulation_run_id: report.simulation_run_id,
    report_kind: report.report_kind,
    verdict: report.verdict,
    score: Number(report.score),
    metric_snapshot: report.metric_snapshot || {},
    criteria_snapshot: report.criteria_snapshot || {},
    artifact_refs: report.artifact_refs || [],
    strategy_version_id: report.metadata?.strategy_version_id || null,
    dataset_id: report.metadata?.dataset_id || null,
    dataset_key: report.metadata?.dataset_key || null,
  };
}

function assertValid(validation) {
  if (!validation.ok) throw serviceError("RESEARCH_VALIDATION_FAILED", "Research Registry command rejected.", { reasons: validation.reasons, issues: validation.issues });
  return validation.normalized;
}

function mapBy(items = [], key) {
  return new Map(items.map((item) => [item[key], clone(item)]));
}

function filtered(map, filters, mapping) {
  return [...map.values()]
    .filter((item) => Object.entries(mapping).every(([filterKey, field]) => !filters[filterKey] || item[field] === filters[filterKey]))
    .slice(0, filters.limit || 100)
    .map(clone);
}

function sanitize(command = {}) {
  return Object.fromEntries(Object.entries(command).filter(([, value]) => value !== undefined));
}

function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}

function upper(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clone(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function serviceError(code, message, details = {}, statusCode = 422) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details;
  error.statusCode = statusCode;
  return error;
}
