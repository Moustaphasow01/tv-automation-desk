import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryResearchExperimentRegistryRepository,
  ResearchExperimentRegistryService,
  normalizeResearchFilters,
} from "../src/research-experiment-registry-service.js";

const NOW = "2026-08-09T08:00:00.000Z";
const experimentId = "11111111-1111-4111-8111-111111111111";
const hypothesisId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const simulationRunId = "44444444-4444-4444-8444-444444444444";

test("Research Experiment Registry registers experiment, hypothesis, candidate and evaluation", async () => {
  const repository = new InMemoryResearchExperimentRegistryRepository();
  const service = serviceFor(repository);

  const experimentResult = await service.registerExperiment(experiment(), command("experiment"));
  const hypothesisResult = await service.registerHypothesis(hypothesis(), command("hypothesis"));
  const candidateResult = await service.registerCandidate(candidate(), command("candidate"));
  const evaluation = await service.recordEvaluationReport(evaluationReport(), command("evaluation"));

  assert.equal(experimentResult.status, "CREATED");
  assert.equal(hypothesisResult.entity.research_experiment_id, experimentId);
  assert.equal(candidateResult.entity.status, "IN_SIMULATION");
  assert.equal(evaluation.status, "CREATED");
  assert.equal(evaluation.summary.verdict, "PASS");
  assert.equal(evaluation.candidate.evaluation_score, 0.82);
  assert.equal(evaluation.candidate.last_evaluation_verdict, "PASS");
  assert.equal(evaluation.candidate.promotion_blocked, true);
  assert.equal(evaluation.candidate.promotion_block_reason, "CONTRADICTORY_REVIEW_REQUIRED");
  assert.equal(repository.runLinks.size, 1);
  assert.deepEqual(repository.transactionCalls, [
    `research-experiment:${experimentId}`,
    `research-hypothesis:${hypothesisId}`,
    `research-candidate:${candidateId}`,
    `research-evaluation:${evaluationReport().research_evaluation_report_id}`,
  ]);
});

test("Research Experiment Registry keeps registration idempotent", async () => {
  const repository = new InMemoryResearchExperimentRegistryRepository();
  const service = serviceFor(repository);
  const input = experiment();

  await service.registerExperiment(input, command("repeat"));
  const replayed = await service.registerExperiment(input, command("repeat"));

  assert.equal(replayed.status, "IDEMPOTENT");
  assert.equal(repository.auditEvents.length, 2);
  assert.equal(repository.auditEvents[1].event_type, "RESEARCH_EXPERIMENT_REGISTERED_IDEMPOTENT");
});

test("Research Experiment Registry keeps evaluation reports idempotent by business key", async () => {
  const repository = new InMemoryResearchExperimentRegistryRepository();
  const service = serviceFor(repository);
  await seedResearch(service);

  const replayed = await service.recordEvaluationReport(evaluationReport({
    research_evaluation_report_id: "77777777-7777-4777-8777-777777777777",
  }), command("evaluation-business-key-replay"));

  assert.equal(replayed.status, "IDEMPOTENT_BUSINESS_KEY");
  assert.equal(replayed.report.research_evaluation_report_id, "55555555-5555-4555-8555-555555555555");
  assert.equal(repository.evaluationReports.size, 1);
  assert.equal(repository.auditEvents.at(-1).event_type, "RESEARCH_EVALUATION_RECORDED_IDEMPOTENT_BUSINESS_KEY");
});

test("Research Experiment Registry rejects divergent evaluation report business key rewrites", async () => {
  const repository = new InMemoryResearchExperimentRegistryRepository();
  const service = serviceFor(repository);
  await seedResearch(service);

  await assert.rejects(
    () => service.recordEvaluationReport(evaluationReport({
      research_evaluation_report_id: "88888888-8888-4888-8888-888888888888",
      score: 0.2,
      verdict: "FAIL",
    }), command("evaluation-business-key-conflict")),
    (error) => error.code === "RESEARCH_AGGREGATE_CONFLICT" && error.statusCode === 409,
  );
});

test("Research Experiment Registry rejects divergent aggregate rewrites", async () => {
  const repository = new InMemoryResearchExperimentRegistryRepository();
  const service = serviceFor(repository);

  await service.registerExperiment(experiment(), command("conflict"));

  await assert.rejects(
    () => service.registerExperiment(experiment({ objective: "Different falsifiable objective." }), command("conflict-2")),
    (error) => error.code === "RESEARCH_AGGREGATE_CONFLICT" && error.statusCode === 409,
  );
});

test("Research Experiment Registry filters candidates and reports", async () => {
  const repository = new InMemoryResearchExperimentRegistryRepository();
  const service = serviceFor(repository);
  await seedResearch(service);

  const candidates = await service.listCandidates({ research_experiment_id: experimentId, status: "in_simulation" });
  const reports = await service.listEvaluationReports({ candidate_id: candidateId, verdict: "pass" });

  assert.equal(candidates.length, 1);
  assert.equal(reports.length, 1);
  assert.equal(normalizeResearchFilters({ limit: 10000 }).limit, 500);
});

test("Research Experiment Registry marks failed evaluations without promotion", async () => {
  const repository = new InMemoryResearchExperimentRegistryRepository();
  const service = serviceFor(repository);
  await seedResearch(service);

  const failed = await service.recordEvaluationReport(evaluationReport({
    research_evaluation_report_id: "66666666-6666-4666-8666-666666666666",
    report_kind: "OUT_OF_SAMPLE",
    verdict: "FAIL",
    score: 0.2,
  }), command("failed-eval"));

  assert.equal(failed.summary.verdict, "FAIL");
  assert.equal(failed.candidate.promotion_blocked, true);
  assert.equal(failed.candidate.promotion_block_reason, "EVALUATION_FAILED");
});

test("Research Experiment Registry requires operator promotion after validation robustness and OOS pass", async () => {
  const repository = new InMemoryResearchExperimentRegistryRepository();
  const service = serviceFor(repository);
  await seedResearch(service);

  await service.recordEvaluationReport(evaluationReport({
    research_evaluation_report_id: "66666666-6666-4666-8666-666666666666",
    report_kind: "CONTRADICTORY_REVIEW",
    score: 0.8,
  }), command("contradictory"));
  await service.recordEvaluationReport(evaluationReport({
    research_evaluation_report_id: "77777777-7777-4777-8777-777777777777",
    report_kind: "ROBUSTNESS",
    score: 0.77,
  }), command("robustness"));
  const oos = await service.recordEvaluationReport(evaluationReport({
    research_evaluation_report_id: "88888888-8888-4888-8888-888888888888",
    report_kind: "OUT_OF_SAMPLE",
    score: 0.74,
  }), command("oos"));

  assert.equal(oos.summary.verdict, "PASS");
  assert.equal(oos.summary.kind_counts.ROBUSTNESS, 1);
  assert.equal(oos.summary.kind_counts.OUT_OF_SAMPLE, 1);
  assert.equal(oos.summary.kind_counts.CONTRADICTORY_REVIEW, 1);
  assert.equal(oos.candidate.promotion_blocked, true);
  assert.equal(oos.candidate.promotion_block_reason, "OPERATOR_PROMOTION_REQUIRED");
});

async function seedResearch(service) {
  await service.registerExperiment(experiment(), command("seed-exp"));
  await service.registerHypothesis(hypothesis(), command("seed-hyp"));
  await service.registerCandidate(candidate(), command("seed-candidate"));
  await service.recordEvaluationReport(evaluationReport(), command("seed-report"));
}

function serviceFor(repository) {
  return new ResearchExperimentRegistryService({
    repository,
    clock: { now: () => ({ utc: NOW }) },
  });
}

function command(suffix) {
  return { idempotency_key: `td2-500-${suffix}`, actor: "codex", reason: "TD2-500 test" };
}

function experiment(overrides = {}) {
  return {
    research_experiment_id: experimentId,
    experiment_key: "mnq.breakout.validation",
    name: "MNQ breakout validation",
    objective: "Validate a falsifiable breakout hypothesis on frozen data.",
    owner: "research",
    status: "ACTIVE",
    comparison_metric: "composite_score",
    created_at_utc: NOW,
    ...overrides,
  };
}

function hypothesis(overrides = {}) {
  return {
    research_hypothesis_id: hypothesisId,
    research_experiment_id: experimentId,
    statement: "MNQ breakouts after compressed overnight ranges continue more often.",
    falsifiable_question: "Does the continuation beat the baseline after costs?",
    instrument_scope: ["MNQ"],
    timeframe_scope: ["M15"],
    expected_outcome: "Positive validation composite score.",
    invalidation_criteria: "Fails validation or out-of-sample robustness.",
    created_at_utc: NOW,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    research_candidate_id: candidateId,
    research_experiment_id: experimentId,
    research_hypothesis_id: hypothesisId,
    candidate_key: "mnq.breakout.validation.v1",
    source_type: "AI_GENERATED",
    status: "IN_SIMULATION",
    primary_change_summary: "Require range compression before breakout retest.",
    novelty_score: 0.62,
    created_at_utc: NOW,
    ...overrides,
  };
}

function evaluationReport(overrides = {}) {
  return {
    research_evaluation_report_id: "55555555-5555-4555-8555-555555555555",
    research_experiment_id: experimentId,
    research_candidate_id: candidateId,
    simulation_run_id: simulationRunId,
    report_kind: "VALIDATION",
    verdict: "PASS",
    score: 0.82,
    metric_snapshot: { total_r: 4.2, max_drawdown_r: -1.1 },
    criteria_snapshot: { min_score: 0.7 },
    artifact_refs: ["simulation://artifact/metrics"],
    created_at_utc: NOW,
    ...overrides,
  };
}
