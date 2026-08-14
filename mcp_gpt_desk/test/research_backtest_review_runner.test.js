import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessBacktestMetrics,
  buildResearchBacktestReview,
  buildResearchBacktestReviewRunnerOutput,
  runResearchBacktestReviewTask,
} from "../src/research/research-backtest-review-runner.js";

describe("research backtest review runner", () => {
  it("requires strategy iteration when the one-month backtest produced no trades", () => {
    const assessment = assessBacktestMetrics({
      trade_count: 0,
      total_r: 0,
      max_drawdown_r: 0,
    });

    assert.equal(assessment.decision, "ITERATE_REQUIRED");
    assert.equal(assessment.verdict, "NEEDS_REVIEW");
    assert.equal(assessment.next_task_type, "RESEARCH_STRATEGY_ITERATION");
    assert.ok(assessment.reasons.includes("INSUFFICIENT_TRADE_SAMPLE"));
  });

  it("builds an idempotent contradictory review report for the claimed research task", () => {
    const review = buildResearchBacktestReview({
      task: taskFixture(),
      payload: taskFixture().payload,
      candidate: candidateFixture(),
      actor: "agent-runtime-research-01",
      nowUtc: "2026-08-12T20:30:00.000Z",
    });

    assert.equal(review.report.report_kind, "CONTRADICTORY_REVIEW");
    assert.equal(review.report.research_candidate_id, "88450ab3-3f90-4878-9659-8b4e968413ee");
    assert.equal(review.report.simulation_run_id, "0df112b0-745e-4cdb-af78-8ad7b2c77473");
    assert.equal(review.report.created_at_utc, "2026-07-01T00:00:00.000Z");
    assert.match(review.command.idempotency_key, /^idem_research_backtest_review_/);
    assert.ok(review.report.artifact_refs.includes("simulation-run://0df112b0-745e-4cdb-af78-8ad7b2c77473"));
  });

  it("keeps the contradictory review report stable across recovered agent tasks", () => {
    const original = buildResearchBacktestReview({
      task: taskFixture(),
      payload: taskFixture().payload,
      candidate: candidateFixture(),
      actor: "agent-runtime-research-01",
      nowUtc: "2026-08-12T20:30:00.000Z",
    });
    const recovered = buildResearchBacktestReview({
      task: {
        ...taskFixture(),
        task_id: "bbbd9d72-b7bc-419c-a2e2-44b8ca12d03e",
        task_key: `${taskFixture().task_key}.recovery.4436caf9-5df5-4fa6-a2bc-7ce8f461b921`,
      },
      payload: {
        ...taskFixture().payload,
        recovered_from_task_id: taskFixture().task_id,
        dead_letter_id: "4436caf9-5df5-4fa6-a2bc-7ce8f461b921",
      },
      candidate: candidateFixture(),
      actor: "agent-runtime-research-01",
      nowUtc: "2026-08-12T21:30:00.000Z",
    });

    assert.equal(recovered.report.research_evaluation_report_id, original.report.research_evaluation_report_id);
    assert.equal(recovered.command.idempotency_key, original.command.idempotency_key);
    assert.equal(recovered.report.metadata.task_id, "bbbd9d72-b7bc-419c-a2e2-44b8ca12d03e");
  });

  it("normalizes raw PostgreSQL task rows that expose agent_task_id instead of task_id", async () => {
    const registry = new FakeResearchRegistry();
    const { task_id, ...rawTask } = taskFixture();
    const result = await runResearchBacktestReviewTask({
      store: { researchRegistry: registry },
      runnerInput: {
        task: { ...rawTask, agent_task_id: task_id },
        lease: { worker_id: "agent-runtime-research-01" },
      },
      nowUtc: "2026-08-12T20:30:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(registry.reports[0].report.metadata.task_id, task_id);
  });

  it("records the review through the Research Registry and returns a supervisor-compatible output", async () => {
    const registry = new FakeResearchRegistry();
    const result = await runResearchBacktestReviewTask({
      store: { researchRegistry: registry },
      runnerInput: { task: taskFixture(), lease: { worker_id: "agent-runtime-research-01" } },
      nowUtc: "2026-08-12T20:30:00.000Z",
    });

    assert.equal(registry.reports.length, 1);
    assert.equal(result.ok, true);
    assert.equal(result.status, "ITERATE_REQUIRED");
    assert.equal(result.usage.total_tokens, 0);
    assert.ok(result.output_ref.startsWith("research-evaluation-report://"));
  });

  it("enqueues a deterministic strategy iteration task when review requires iteration", async () => {
    const registry = new FakeResearchRegistry();
    const queue = new FakeResearchTaskQueuePool();
    const result = await runResearchBacktestReviewTask({
      store: { researchRegistry: registry, persistence: { pool: queue } },
      runnerInput: { task: taskFixture(), lease: { worker_id: "agent-runtime-research-01" } },
      nowUtc: "2026-08-12T20:30:00.000Z",
    });

    assert.equal(result.status, "ITERATE_REQUIRED");
    assert.equal(result.enqueued_next_task.task_type, "RESEARCH_STRATEGY_ITERATION");
    assert.equal(queue.tasks.length, 1);
    assert.equal(queue.tasks[0].task_type, "RESEARCH_STRATEGY_ITERATION");
    assert.equal(queue.tasks[0].payload.iteration_index, 1);
    assert.equal(queue.tasks[0].payload.dataset_key, taskFixture().payload.dataset_key);
  });

  it("completes superseded generator reviews without enqueueing obsolete iterations", async () => {
    const registry = new FakeResearchRegistry();
    const queue = new FakeResearchTaskQueuePool();
    const result = await runResearchBacktestReviewTask({
      store: { researchRegistry: registry, persistence: { pool: queue } },
      runnerInput: {
        task: {
          ...taskFixture(),
          payload: {
            ...taskFixture().payload,
            iteration_index: 2,
            generator_version: "research_strategy_iteration_generator_v2_1",
          },
        },
        lease: { worker_id: "agent-runtime-research-01" },
      },
      nowUtc: "2026-08-12T20:30:00.000Z",
    });

    assert.equal(result.status, "SUPERSEDED_GENERATOR_REVIEW");
    assert.equal(result.ok, true);
    assert.equal(result.next_recommended_task_type, null);
    assert.equal(registry.reports.length, 0);
    assert.equal(queue.tasks.length, 0);
    assert.equal(result.telemetry.superseded.payload_generator_version, "research_strategy_iteration_generator_v2_1");
  });

  it("reuses an existing business review when a recovered task hits an aggregate conflict", async () => {
    const existing = {
      ...buildResearchBacktestReview({
        task: taskFixture(),
        payload: taskFixture().payload,
        candidate: candidateFixture(),
      }).report,
      research_evaluation_report_id: "c3bde021-8cfc-41c8-b71b-635eb0adb85f",
      reviewer_ref: "previous-agent-runtime-research-01",
    };
    const registry = new FakeResearchRegistry({ existingReports: [existing], conflictOnRecord: true });

    const result = await runResearchBacktestReviewTask({
      store: { researchRegistry: registry },
      runnerInput: {
        task: {
          ...taskFixture(),
          task_id: "bbbd9d72-b7bc-419c-a2e2-44b8ca12d03e",
          task_key: `${taskFixture().task_key}.recovery.4436caf9-5df5-4fa6-a2bc-7ce8f461b921`,
        },
        lease: { worker_id: "agent-runtime-research-01" },
      },
      nowUtc: "2026-08-12T21:30:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.research_evaluation_report_id, existing.research_evaluation_report_id);
    assert.equal(result.output_ref, `research-evaluation-report://${existing.research_evaluation_report_id}`);
    assert.equal(registry.recordAttempts, 1);
  });

  it("returns pass when a baseline has enough positive evidence", () => {
    const review = buildResearchBacktestReviewRunnerOutput({
      review: buildResearchBacktestReview({
        task: {
          ...taskFixture(),
          payload: {
            ...taskFixture().payload,
            metrics: { trade_count: 8, total_r: 4.2, max_drawdown_r: -1.1 },
          },
        },
        payload: {
          ...taskFixture().payload,
          metrics: { trade_count: 8, total_r: 4.2, max_drawdown_r: -1.1 },
        },
        candidate: candidateFixture(),
      }),
      runnerInput: { task: taskFixture() },
    });

    assert.equal(review.status, "READY_FOR_ROBUSTNESS_REVIEW");
    assert.equal(review.verdict, "PASS");
    assert.equal(review.next_recommended_task_type, "RESEARCH_ROBUSTNESS_REVIEW");
  });

  it("enqueues a robustness task instead of promoting directly when the review passes", async () => {
    const registry = new FakeResearchRegistry();
    const queue = new FakeResearchTaskQueuePool();
    const task = {
      ...taskFixture(),
      payload: {
        ...taskFixture().payload,
        metrics: { trade_count: 8, total_r: 4.2, max_drawdown_r: -1.1 },
      },
    };

    const result = await runResearchBacktestReviewTask({
      store: { researchRegistry: registry, persistence: { pool: queue } },
      runnerInput: { task, lease: { worker_id: "agent-runtime-research-01" } },
      nowUtc: "2026-08-12T20:30:00.000Z",
    });

    assert.equal(result.status, "READY_FOR_ROBUSTNESS_REVIEW");
    assert.equal(result.enqueued_next_task.task_type, "RESEARCH_ROBUSTNESS_REVIEW");
    assert.equal(queue.tasks.length, 1);
    assert.equal(queue.tasks[0].task_type, "RESEARCH_ROBUSTNESS_REVIEW");
    assert.equal(queue.tasks[0].priority, 32);
    assert.equal(queue.tasks[0].payload.required_decision, "RUN_ROBUSTNESS_AND_OOS_GATES");
  });
});

class FakeResearchRegistry {
  constructor({ existingReports = [], conflictOnRecord = false } = {}) {
    this.reports = [];
    this.existingReports = existingReports;
    this.conflictOnRecord = conflictOnRecord;
    this.recordAttempts = 0;
  }

  async getCandidate() {
    return candidateFixture();
  }

  async recordEvaluationReport(report, command) {
    this.recordAttempts += 1;
    if (this.conflictOnRecord) {
      throw Object.assign(new Error("Research evaluation already exists for candidate/report kind/simulation with different content."), {
        code: "RESEARCH_AGGREGATE_CONFLICT",
        statusCode: 409,
      });
    }
    this.reports.push({ report, command });
    return { status: "CREATED", report };
  }

  async listEvaluationReports(filters = {}) {
    return this.existingReports.filter((report) =>
      (!filters.researchCandidateId || report.research_candidate_id === filters.researchCandidateId)
      && (!filters.reportKind || report.report_kind === filters.reportKind));
  }
}

class FakeResearchTaskQueuePool {
  constructor() {
    this.missions = [];
    this.tasks = [];
  }

  async connect() {
    return {
      query: async (sql, params = []) => this.query(sql, params),
      release: () => undefined,
    };
  }

  async query(sql, params = []) {
    if (/^BEGIN|^COMMIT|^ROLLBACK/.test(String(sql).trim())) return { rows: [] };
    if (String(sql).includes("INSERT INTO agent_missions")) {
      this.missions.push({ agent_mission_id: params[0], mission_key: params[1], mission_type: params[2] });
      return { rows: [] };
    }
    if (String(sql).includes("INSERT INTO agent_tasks")) {
      this.tasks.push({
        agent_task_id: params[0],
        agent_mission_id: params[1],
        task_key: params[2],
        task_type: params[3],
        priority: params[7],
        payload: JSON.parse(params[8]),
      });
      return { rows: [{ inserted: true }] };
    }
    return { rows: [] };
  }
}

function taskFixture() {
  return {
    task_id: "33f2c5f1-9f1e-4ad3-a25c-9c98a54ba541",
    task_key: "research-review-demo-paper.mnq.m5.2026-06-01_2026-07-01",
    task_type: "RESEARCH_BACKTEST_REVIEW",
    lane: "research",
    input_ref: "simulation-run://0df112b0-745e-4cdb-af78-8ad7b2c77473",
    status: "READY",
    priority: 40,
    correlation_id: "corr_demo_paper",
    created_at_utc: "2026-07-01T00:00:00.000Z",
    payload: {
      dataset_id: "df0770d1-9143-40e1-98fc-67583258ba74",
      dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01",
      required_decision: "REVIEW_OR_ITERATE",
      simulation_run_id: "0df112b0-745e-4cdb-af78-8ad7b2c77473",
      strategy_version_id: "b631d428-9a89-44a4-8c8b-c9ea3b775d6d",
      research_candidate_id: "88450ab3-3f90-4878-9659-8b4e968413ee",
      metrics: {
        total_r: 0,
        trade_count: 0,
        max_drawdown_r: 0,
      },
    },
  };
}

function candidateFixture() {
  return {
    research_experiment_id: "b81f380c-eaad-4def-91b3-e576c55a38c6",
    research_candidate_id: "88450ab3-3f90-4878-9659-8b4e968413ee",
    strategy_version_id: "b631d428-9a89-44a4-8c8b-c9ea3b775d6d",
  };
}
