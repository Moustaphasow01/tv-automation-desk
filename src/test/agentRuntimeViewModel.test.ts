import { describe, expect, it } from "vitest";
import {
  agentRuntimeStatusTone,
  buildAgentRuntimeViewModel,
  readableTaskType,
  shortAgentRuntimeId,
} from "@/features/agent-runtime/viewModel";
import type {
  AgentRuntimeDeadLetterList,
  AgentRuntimeMetricList,
  AgentRuntimeOverview,
  AgentRuntimePoolOverview,
  AgentRuntimeSchedulerPlan,
  AgentRuntimeTaskList,
} from "@/features/agent-runtime/types";

describe("Agent Runtime view model", () => {
  it("projette pools, tâches, scheduler et DLQ en lecture opérateur", () => {
    const view = buildAgentRuntimeViewModel({
      overview: overview(),
      pools: poolOverview(),
      scheduler: schedulerPlan(),
      tasks: taskList(),
      deadLetters: deadLetters(),
      metrics: metrics(),
    });

    expect(view.health.label).toBe("Action requise");
    expect(view.metrics.find(metric => metric.label === "DLQ ouverte")?.value).toBe(1);
    expect(view.metrics.find(metric => metric.label === "Coût fenêtre")?.value).toBe("$0.0042");
    expect(view.poolRows[0].label).toBe("Décisions LIVE");
    expect(view.poolRows[0].responsibilities).toContain("Live Master");
    expect(view.taskRows[0].label).toBe("Monitor LIVE");
    expect(view.taskRows[0].payload).toBe("Scope Key, Execution Policy");
    expect(view.schedulerRows.map(row => row.bucket)).toEqual(["selected", "deferred", "rejected"]);
    expect(view.deadLetterRows[0].tone).toBe("critical");
    expect(view.metricRows[0].model).toBe("codex · ultra");
  });

  it("conserve les états vides réels sans fabriquer de tâches", () => {
    const view = buildAgentRuntimeViewModel({});

    expect(view.metrics.find(metric => metric.label === "Prêtes")?.value).toBe(0);
    expect(view.poolRows).toEqual([]);
    expect(view.taskRows).toEqual([]);
    expect(view.warnings).toContain("Aucun pool agent-runtime visible depuis l’API.");
  });

  it("normalise les libellés essentiels", () => {
    expect(readableTaskType("REPLAY_MASTER")).toBe("Master Replay");
    expect(agentRuntimeStatusTone("OPEN")).toBe("critical");
    expect(shortAgentRuntimeId("44444444-4444-4444-8444-444444444444")).toBe("44444444…4444");
  });
});

function overview(): AgentRuntimeOverview {
  return {
    ok: true,
    schema: "agent_runtime_admin_overview_v1",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    summary: {
      task_status: [
        { lane: "live", status: "READY", count: 2 },
        { lane: "live", status: "RUNNING", count: 1 },
        { lane: "replay", status: "ERROR", count: 1 },
      ],
      dead_letter_status: [{ status: "OPEN", count: 1 }],
    },
    recent_tasks: taskList().items,
    open_dead_letters: deadLetters().items,
    recent_metrics: metrics().items,
  };
}

function taskList(): AgentRuntimeTaskList {
  return {
    ok: true,
    count: 1,
    items: [{
      task_id: "44444444-4444-4444-8444-444444444444",
      mission_id: "22222222-2222-4222-8222-222222222222",
      mission_key: "mission.live",
      mission_type: "live_monitor",
      task_key: "task.live.001",
      task_type: "LIVE_M15_MONITOR",
      lane: "live",
      status: "READY",
      priority: 10,
      assigned_worker_id: null,
      lease_active: false,
      attempt_count: 1,
      max_attempts: 3,
      payload_keys: ["scope_key", "execution_policy"],
      updated_at_utc: "2026-08-09T08:05:00.000Z",
    }],
  };
}

function poolOverview(): AgentRuntimePoolOverview {
  return {
    ok: true,
    schema_version: "agent_worker_pool_overview_v1",
    policy_version: "1.0.0",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    metrics_window_minutes: 60,
    pools: [{
      pool_id: "live",
      label: "Live decisions",
      lane: "live",
      scheduler_lane: "live",
      enabled: true,
      rank: 0,
      max_concurrent_workers: 4,
      responsibilities: ["LIVE_MASTER", "LIVE_MONITOR"],
      task_status: { READY: 2, RUNNING: 1 },
      task_count: 3,
      active_count: 1,
      failed_count: 0,
      metrics: { run_count: 1, completed_count: 1, failed_count: 0, total_tokens: 1500, cost_micros_usd: 4200 },
    }],
    policy_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    overview_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
}

function schedulerPlan(): AgentRuntimeSchedulerPlan {
  return {
    ok: true,
    status: "PLANNED",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    window_start_utc: "2026-08-09T07:45:00.000Z",
    policy: {},
    plan: {
      selected_tasks: [{ task_id: "task-selected", task_key: "live.001", task_type: "LIVE_MASTER", lane: "live", status: "READY", priority: 1, reason: "SELECTED" }],
      deferred_tasks: [{ task_id: "task-deferred", task_key: "replay.001", task_type: "REPLAY_MONITOR", lane: "replay", status: "READY", priority: 20, reason: "HIGHER_PRIORITY_LANE_SELECTED" }],
      rejected_tasks: [{ task_id: "task-rejected", task_key: "validation.001", task_type: "VALIDATION_RUN", lane: "validation", status: "DONE", priority: 50, reason: "TASK_STATUS_NOT_CLAIMABLE" }],
      quota_state: {},
      summary: { selected_count: 1, deferred_count: 1, rejected_count: 1, live_ready: true },
      plan_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  };
}

function deadLetters(): AgentRuntimeDeadLetterList {
  return {
    ok: true,
    count: 1,
    items: [{
      dead_letter_id: "66666666-6666-4666-8666-666666666666",
      task_id: "44444444-4444-4444-8444-444444444444",
      mission_id: "22222222-2222-4222-8222-222222222222",
      task_type: "LIVE_M15_MONITOR",
      lane: "live",
      status: "OPEN",
      error_code: "MODEL_TIMEOUT",
      error_message: "timeout",
      retryable: true,
      attempt_count: 3,
      created_at_utc: "2026-08-09T08:10:00.000Z",
    }],
  };
}

function metrics(): AgentRuntimeMetricList {
  return {
    ok: true,
    count: 1,
    items: [{
      metric_id: "88888888-8888-4888-8888-888888888888",
      task_id: "44444444-4444-4444-8444-444444444444",
      mission_id: "22222222-2222-4222-8222-222222222222",
      worker_id: "agent-runtime-live-01",
      lane: "live",
      task_type: "LIVE_M15_MONITOR",
      model: "codex",
      reasoning_effort: "ultra",
      outcome: "COMPLETED",
      total_latency_ms: 3000,
      total_tokens: 1500,
      cost_micros_usd: 4200,
      finished_at_utc: "2026-08-09T08:12:00.000Z",
    }],
  };
}
