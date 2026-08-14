import { describe, expect, it } from "vitest";
import {
  buildStrategyV2DetailViewModel,
  buildStrategyV2OverviewViewModel,
} from "@/features/strategy-v2/viewModel";
import type { StrategyList, StrategyV2Overview, StrategyV2SignalPollResult } from "@/operationsTypes";

describe("Strategy v2 ViewModel", () => {
  it("projette le Strategy Kernel v2 comme source canonique opérateur", () => {
    const view = buildStrategyV2OverviewViewModel(overviewFixture(), legacyFixture());

    expect(view.empty).toBe(false);
    expect(view.sourceLabel).toBe("STRATEGY KERNEL V2");
    expect(view.metrics.find(metric => metric.label === "Instances")?.detail).toContain("1 shadow");
    expect(view.rows[0].name).toBe("Breakout Retest MNQ");
    expect(view.rows[0].versionLabel).toBe("1.0.0");
    expect(view.rows[0].statusLabel).toBe("PAPER");
    expect(view.rows[0].performanceR).toBe("+12.50 R");
    expect(view.rows[0].recommendedNextStep).toBe("Évaluer promotion PAPER → LIVE");
  });

  it("ne fabrique aucune stratégie quand le registry v2 est vide", () => {
    const view = buildStrategyV2OverviewViewModel({
      ...overviewFixture(),
      count: 0,
      strategies: [],
      definitions: [],
      versions: [],
      instances: [],
      summary: {
        definitions: 0,
        versions: 0,
        instances: 0,
        published_versions: 0,
        live_instances: 0,
        paper_instances: 0,
        shadow_instances: 0,
        version_statuses: {},
        runtime_states: {},
        execution_modes: {},
      },
    });

    expect(view.empty).toBe(true);
    expect(view.rows).toEqual([]);
    expect(view.metrics.find(metric => metric.label === "Définitions")?.value).toBe(0);
  });

  it("projette les instances runtime et le signal bus réel sans mock", () => {
    const view = buildStrategyV2OverviewViewModel(overviewFixture(), null, signalsFixture());

    expect(view.instanceRows).toHaveLength(2);
    expect(view.instanceRows[0].strategyName).toBe("Breakout Retest MNQ");
    expect(view.instanceRows[0].driftStatus).toBe("Drift watch");
    expect(view.instanceRows[0].driftDetail).toContain("ΔR -2.70 R");
    expect(view.instanceRows[1].driftStatus).toBe("Observation insuff.");
    expect(view.signalSummary.pending).toBe(1);
    expect(view.signalSummary.paper).toBe(1);
    expect(view.signalRows[0].instrument).toBe("MNQ");
    expect(view.signalRows[0].direction).toBe("Long");
    expect(view.signalRows[0].confidence).toBe("68%");
    expect(view.signalRows[0].canConsume).toBe(true);
    expect(view.metrics.find(metric => metric.label === "Signaux pending")?.value).toBe(1);
  });

  it("projette le détail versions instances et audit sans dépendre du catalogue legacy", () => {
    const detail = buildStrategyV2DetailViewModel(overviewFixture(), "def-1");

    expect(detail?.title).toBe("Breakout Retest MNQ");
    expect(detail?.versions[0].status).toBe("Publiée");
    expect(detail?.instances.map(instance => instance.executionMode)).toEqual(["Paper", "Shadow"]);
    expect(detail?.audit[0].eventType).toBe("STRATEGY_VERSION_PUBLISHED");
    expect(detail?.metrics.find(metric => metric.label === "Performance legacy")?.value).toBe("—");
  });
});

function overviewFixture(): StrategyV2Overview {
  return {
    contract: "DeskStrategyV2Overview",
    schemaVersion: "strategy_registry_rest_v2",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    summary: {
      definitions: 1,
      versions: 1,
      instances: 2,
      published_versions: 1,
      live_instances: 0,
      paper_instances: 1,
      shadow_instances: 1,
      version_statuses: { PUBLISHED: 1 },
      runtime_states: { RUNNING: 1, CREATED: 1 },
      execution_modes: { PAPER: 1, SHADOW: 1 },
    },
    count: 1,
    definitions: [{
      strategy_definition_id: "def-1",
      external_key: "breakout-retest-mnq",
      name: "Breakout Retest MNQ",
      owner: "research-lab",
    }],
    versions: [{
      strategy_version_id: "ver-1",
      strategy_definition_id: "def-1",
      version_label: "1.0.0",
      status: "PUBLISHED",
      compiled_artifact_ref: "artifact://strategy/breakout-retest/1.0.0",
      validated_metrics_ref: "metrics://replay/june",
      updated_at_utc: "2026-08-09T08:05:00.000Z",
      metadata: {
        performance_baseline: {
          trade_count: 45,
          total_r: 12.5,
          expectancy_r: 0.42,
          win_rate: 0.58,
          profit_factor: 2.1,
          max_drawdown_r: -2,
        },
      },
    }],
    instances: [{
      strategy_instance_id: "inst-paper",
      strategy_version_id: "ver-1",
      runtime_state: "RUNNING",
      execution_mode: "PAPER",
      instrument_scope: ["MNQ"],
      session_scope: ["ny_open"],
      account_scope: "ninjatrader_sim101",
      metadata: {
        paper_metrics: {
          trade_count: 30,
          total_r: 9.8,
          expectancy_r: 0.14,
          win_rate: 0.46,
          profit_factor: 1.2,
          max_drawdown_r: -3.2,
        },
      },
    }, {
      strategy_instance_id: "inst-shadow",
      strategy_version_id: "ver-1",
      runtime_state: "CREATED",
      execution_mode: "SHADOW",
      instrument_scope: ["MES"],
      session_scope: ["asia_open"],
    }],
    audit: [{
      audit_event_id: "audit-1",
      aggregate_type: "strategy_version",
      aggregate_id: "ver-1",
      event_type: "STRATEGY_VERSION_PUBLISHED",
      actor: "operator",
      reason: "validated",
      created_at_utc: "2026-08-09T08:10:00.000Z",
    }],
    strategies: [{
      strategy_definition_id: "def-1",
      external_key: "breakout-retest-mnq",
      name: "Breakout Retest MNQ",
      owner: "research-lab",
      latest_version: {
        strategy_version_id: "ver-1",
        strategy_definition_id: "def-1",
        version_label: "1.0.0",
        status: "PUBLISHED",
      },
      published_version: {
        strategy_version_id: "ver-1",
        strategy_definition_id: "def-1",
        version_label: "1.0.0",
        status: "PUBLISHED",
      },
      live_instance: null,
      paper_instance: {
        strategy_instance_id: "inst-paper",
        strategy_version_id: "ver-1",
        runtime_state: "RUNNING",
        execution_mode: "PAPER",
      },
      version_count: 1,
      instance_count: 2,
      audit_count: 1,
      versions: [{
        strategy_version_id: "ver-1",
        strategy_definition_id: "def-1",
        version_label: "1.0.0",
        status: "PUBLISHED",
        compiled_artifact_ref: "artifact://strategy/breakout-retest/1.0.0",
        validated_metrics_ref: "metrics://replay/june",
      }],
      instances: [{
        strategy_instance_id: "inst-paper",
        strategy_version_id: "ver-1",
        runtime_state: "RUNNING",
        execution_mode: "PAPER",
        instrument_scope: ["MNQ"],
        session_scope: ["ny_open"],
        account_scope: "ninjatrader_sim101",
      }, {
        strategy_instance_id: "inst-shadow",
        strategy_version_id: "ver-1",
        runtime_state: "CREATED",
        execution_mode: "SHADOW",
        instrument_scope: ["MES"],
        session_scope: ["asia_open"],
      }],
      recent_audit: [{
        audit_event_id: "audit-1",
        aggregate_type: "strategy_version",
        aggregate_id: "ver-1",
        event_type: "STRATEGY_VERSION_PUBLISHED",
        actor: "operator",
        reason: "validated",
        created_at_utc: "2026-08-09T08:10:00.000Z",
      }],
      operator_state: {
        has_definition: true,
        has_published_version: true,
        has_runtime_instance: true,
        has_live_instance: false,
        recommended_next_step: "EVALUATE_PAPER_PROMOTION",
      },
    }],
    source: {
      canonical: "strategy_kernel_v2",
      legacy_strategy_endpoint: "/api/v1/strategies",
      note: "Legacy strategy endpoint remains available only for historical performance comparison while Strategy v2 owns governance.",
    },
  };
}

function legacyFixture(): StrategyList {
  return {
    contract: "DeskStrategyList",
    schemaVersion: "1.0.0",
    count: 1,
    items: [{
      id: "breakout-retest-mnq",
      catalog: null,
      config: null,
      runtime: null,
      stats: null,
      performance: {
        totalR: 12.5,
        trades: 42,
        wins: 24,
        losses: 18,
        flats: 0,
        winRate: 0.57,
        expectancyR: 0.29,
        grossProfitR: 20.2,
        grossLossR: -7.7,
        profitFactor: 2.62,
        maxDrawdownR: -2.1,
        currentDrawdownR: -0.4,
        bestTradeR: 2.8,
        worstTradeR: -1,
        bestDayR: 5.2,
        worstDayR: -1.6,
        activeDays: 8,
        winningDays: 5,
        losingDays: 3,
      },
      replayCount: 9,
      versions: [],
      activeContracts: [],
    }],
  };
}

function signalsFixture(): StrategyV2SignalPollResult {
  return {
    contract: "DeskStrategySignalPollResultV2",
    schemaVersion: "strategy_registry_rest_v2",
    status: "OK",
    count: 1,
    items: [{
      signal_outbox_id: "outbox-1",
      signal_id: "signal-1",
      strategy_instance_id: "inst-paper",
      strategy_version_id: "ver-1",
      signal_type: "signal.emitted",
      instrument: "MNQ",
      direction: "LONG",
      confidence: 0.68,
      execution_mode_origin: "PAPER",
      generated_at_utc: "2026-08-09T08:15:00.000Z",
      expires_at_utc: "2026-08-09T08:30:00.000Z",
      correlation_id: "corr-1",
      payload: { signal: { setup_id: "setup-breakout", decision: "ARM_LONG" } },
      payload_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      dedupe_key: "dedupe-1",
      status: "PENDING",
      notify_attempt_count: 0,
      published_at_utc: null,
      consumed_at_utc: null,
      consumer_id: null,
      last_error: null,
      created_at_utc: "2026-08-09T08:15:00.000Z",
      updated_at_utc: "2026-08-09T08:15:00.000Z",
    }],
  };
}
