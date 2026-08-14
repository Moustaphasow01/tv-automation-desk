import { describe, expect, it } from "vitest";
import { buildAiContextViewModel } from "@/features/ai-context/viewModel";
import type { AiContextOverview } from "@/features/ai-context/types";

describe("AI Context view model", () => {
  it("projette les décisions, fallbacks, coûts et contrôles en lecture opérateur", () => {
    const view = buildAiContextViewModel(overview());

    expect(view.health.label).toBe("Dégradé");
    expect(view.metrics.find((metric) => metric.label === "Décisions")?.value).toBe(1);
    expect(view.metrics.find((metric) => metric.label === "Fallbacks")?.tone).toBe("warning");
    expect(view.decisionRows[0].recommendation).toBe("WAIT");
    expect(view.decisionRows[0].binding).toBe("DEFER");
    expect(view.decisionRows[0].fallback).toBe("MODEL_TIMEOUT");
    expect(view.metricRows[0].model).toBe("codex · ultra");
    expect(view.metricRows[0].cost).toBe("$0.0042");
    expect(view.warnings.some((warning) => warning.includes("Fallback"))).toBe(true);
  });

  it("conserve l’état vide réel sans fabriquer de décision", () => {
    const view = buildAiContextViewModel(overview({
      source: { status: "ready", reads: [{ source: "agent_tasks", status: "ok", count: 0, error_code: null, error_message: null }] },
      summary: { status: "NO_CONTEXT_DECISIONS", total_decisions: 0, shadow_count: 0, enforced_count: 0, fallback_count: 0, open_dead_letters: 0, recent_runs: 0, latest_decision_at_utc: null },
      decisions: [],
      metrics: [],
      dead_letters: [],
      controls: [{ code: "AI_CONTEXT_NO_DECISION", severity: "info", label: "Aucune décision AI Context", detail: "Aucune tâche visible." }],
    }));

    expect(view.health.label).toBe("Aucune décision");
    expect(view.decisionRows).toEqual([]);
    expect(view.metricRows).toEqual([]);
    expect(view.warnings).toContain("Aucune décision AI Context réelle visible pour l’instant.");
  });
});

function overview(overrides: Partial<AiContextOverview> = {}): AiContextOverview {
  return {
    contract: "DeskAiContextOverview",
    schemaVersion: "ai_context_front_v1",
    generatedAt: "2026-08-10T08:00:00.000Z",
    source: { status: "ready", reads: [{ source: "agent_tasks", status: "ok", count: 1, error_code: null, error_message: null }] },
    summary: {
      status: "DEGRADED",
      total_decisions: 1,
      shadow_count: 0,
      enforced_count: 1,
      fallback_count: 1,
      open_dead_letters: 1,
      recent_runs: 1,
      latest_decision_at_utc: "2026-08-10T08:01:00.000Z",
    },
    decisions: [{
      decision_id: "decision-context-1",
      task_id: "task-context-1",
      mission_key: "LIVE_CONTEXT_DECISION",
      task_type: "LIVE_CONTEXT_DECISION_MONITOR",
      lane: "live",
      status: "ENFORCED_BLOCKED",
      mode: "ENFORCED",
      recommendation: "WAIT",
      recommendation_effect: "FALLBACK_WAIT",
      binding_action: "DEFER",
      fallback_applied: true,
      fallback_reason: "MODEL_TIMEOUT",
      rationale: "Fallback WAIT après dépassement de délai.",
      model: "codex",
      reasoning_effort: "ultra",
      latency_ms: 12_000,
      tokens: 3_400,
      updated_at_utc: "2026-08-10T08:01:00.000Z",
    }],
    metrics: [{
      metric_id: "metric-context-1",
      task_id: "task-context-1",
      task_type: "LIVE_CONTEXT_DECISION_MONITOR",
      lane: "live",
      worker_id: "agent-context-01",
      model: "codex",
      reasoning_effort: "ultra",
      outcome: "COMPLETED",
      total_latency_ms: 12_000,
      total_tokens: 3_400,
      cost_micros_usd: 4_200,
      finished_at_utc: "2026-08-10T08:01:00.000Z",
    }],
    dead_letters: [{
      dead_letter_id: "dlq-context-1",
      task_id: "task-context-1",
      task_type: "LIVE_CONTEXT_DECISION_MONITOR",
      lane: "live",
      status: "OPEN",
      error_code: "MODEL_TIMEOUT",
      error_message: "timeout",
      created_at_utc: "2026-08-10T08:02:00.000Z",
    }],
    controls: [{ code: "AI_CONTEXT_FALLBACK", severity: "warning", label: "Fallback MODEL_TIMEOUT", detail: "LIVE_CONTEXT_DECISION_MONITOR · Fallback WAIT après dépassement de délai." }],
    ...overrides,
  };
}
