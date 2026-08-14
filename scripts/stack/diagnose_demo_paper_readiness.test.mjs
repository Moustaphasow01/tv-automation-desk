import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDemoPaperDiagnosis, deriveExecutionOverviewUrl, parseDemoPaperDoctorArgs } from "./diagnose_demo_paper_readiness.mjs";
import { evaluateDemoPaperGate } from "./check_demo_paper_gate.mjs";

describe("demo paper readiness doctor", () => {
  it("derives execution overview URL from the status endpoint", () => {
    assert.equal(
      deriveExecutionOverviewUrl("http://desk.local:8787/status"),
      "http://desk.local:8787/api/v1/execution/overview",
    );
  });

  it("parses json and exit-zero options", () => {
    assert.deepEqual(parseDemoPaperDoctorArgs(["--json", "--exit-zero", "--status-url=http://desk/status"]), {
      statusUrl: "http://desk/status",
      executionOverviewUrl: "http://desk/api/v1/execution/overview",
      output: "json",
      exitZero: true,
    });
  });

  it("returns ready when the strict gate passes", () => {
    const status = readyStatus();
    const overview = readyOverview();
    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });
    const diagnosis = buildDemoPaperDiagnosis({ status, overview, gate });

    assert.equal(diagnosis.ok, true);
    assert.equal(diagnosis.status, "READY");
    assert.deepEqual(diagnosis.actions, []);
    assert.equal(diagnosis.final_check_command, "npm run --silent gate:demo-paper -- --json");
    assert.equal(diagnosis.release_check_command, "DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json");
  });

  it("turns stale NinjaTrader/AddOn state into concrete operator actions", () => {
    const status = readyStatus();
    const broker = status.operations.services.find((service) => service.service_kind === "broker_management");
    broker.details.result.paper_safety.addon_heartbeat_fresh = false;
    broker.details.result.paper_safety.addon_connected = false;
    broker.details.result.paper_safety.connection_ready = false;
    broker.details.result.paper_safety.command_enabled = false;
    broker.details.result.paper_safety.addon_bridge_status = "read_only";
    const overview = readyOverview();
    overview.ninjaTraderStartup.state = "login_required";
    overview.ninjaTraderStartup.loginRequired = true;
    overview.ninjaTraderStartup.connectionReady = false;
    overview.ninjaTraderStartup.addonHeartbeatFresh = false;
    overview.bridges[0].status = "read_only";
    overview.bridges[0].command_enabled = false;

    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });
    const diagnosis = buildDemoPaperDiagnosis({ status, overview, gate });

    assert.equal(diagnosis.ok, false);
    assert.ok(diagnosis.blockers.includes("broker.sim101_addon_ready"));
    assert.ok(diagnosis.actions.some((action) => action.id === "ninjatrader_login"));
    assert.ok(diagnosis.actions.some((action) => action.id === "addon_fresh_heartbeat"));
    assert.ok(diagnosis.actions.some((action) => action.id === "addon_command_enabled"));
  });

  it("turns manual Telegram mode without trading channel into a Telegram action", () => {
    const status = readyStatus();
    const broker = status.operations.services.find((service) => service.service_kind === "broker_management");
    broker.details.result.paper_safety.manual_telegram_execution_enabled = true;
    broker.details.result.paper_safety.submission_possible = false;
    broker.details.result.paper_safety.addon_heartbeat_fresh = false;
    broker.details.result.paper_safety.command_enabled = false;
    const overview = readyOverview();
    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });

    const diagnosis = buildDemoPaperDiagnosis({ status, overview, gate });

    assert.equal(diagnosis.ok, false);
    assert.ok(diagnosis.blockers.includes("execution.manual_telegram_ready"));
    assert.ok(diagnosis.actions.some((action) => action.id === "telegram_trading_channel_ready"));
    assert.equal(diagnosis.facts.manual_telegram_execution_enabled, true);
  });

  it("turns a fresh rescue feed into a durable TradingView alert action", () => {
    const status = readyStatus();
    status.data_readiness.source_health.durable = false;
    status.data_readiness.source_health.non_durable_feeds = [
      { instrument: "MNQ", timeframe: "1", classification: "rescue" },
    ];
    for (const feed of status.data_readiness.core_feeds) {
      feed.provenance = { classification: "rescue", durable: false };
    }
    const overview = readyOverview();
    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });
    const diagnosis = buildDemoPaperDiagnosis({ status, overview, gate });

    assert.equal(diagnosis.ok, false);
    assert.ok(diagnosis.blockers.includes("data.source_durable"));
    const action = diagnosis.actions.find((item) => item.id === "tradingview_source_durable");
    assert.equal(action?.command, "python3 scripts/tradingview/migrate_local_alert_webhooks.py");
  });
});

function readyStatus() {
  return {
    ready: true,
    ok: true,
    mode: "postgres",
    data_readiness: {
      ok: true,
      state: "ready",
      core_age_seconds: 120,
      source_health: { required: true, durable: true, durable_count: 4, total_count: 4, non_durable_feeds: [] },
      core_feeds: [
        durableFeed("MNQ", "1"),
        durableFeed("MNQ", "5"),
        durableFeed("MES", "1"),
        durableFeed("MES", "5"),
      ],
    },
    operations: {
      missing_services: [],
      services: [
        {
          service_id: "broker_management",
          service_kind: "broker_management",
          status: "healthy",
          healthy: true,
          details: {
            result: {
              status: "READY",
              paper_safety: {
                execution_enabled: true,
                bridge_mode: "sim101_addon_approved_only",
                kill_switch_released: true,
                max_contracts: 10,
                execution_authority_mode: "semi_auto",
                entry_operator_approval_required: true,
                submission_possible: true,
                live_account_allowed: false,
                addon_bridge_status: "armed",
                addon_heartbeat_fresh: true,
                addon_connected: true,
                connection_ready: true,
                command_enabled: true,
                account_name: "Sim101",
                sim101_account: true,
              },
            },
          },
        },
        { service_id: "live_runtime_scheduler", service_kind: "live_runtime_scheduler", status: "healthy", healthy: true, details: { data_blocker: null } },
        { service_id: "replay_preparation_worker", service_kind: "replay_preparation", status: "healthy", healthy: true, details: {} },
      ],
    },
  };
}

function durableFeed(instrument, timeframe) {
  return {
    instrument,
    timeframe,
    latest_timestamp_utc: "2026-08-11T15:59:00.000Z",
    provenance: {
      classification: "durable_alert",
      durable: true,
      source: "tradingview_alert_webhook",
      source_service: "local_tradingview_webhook",
      received_at_utc: "2026-08-11T15:59:10.000Z",
      alert_id: `${instrument}-${timeframe}-alert`,
    },
  };
}

function readyOverview() {
  return {
    safety: {
      executionAuthorityMode: "semi_auto",
      entryOperatorApprovalRequired: true,
    },
    ninjaTraderStartup: {
      state: "running",
      processWindowTitle: "NinjaTrader",
      loginRequired: false,
      connectionReady: true,
      connectionName: "Simulation",
      connectionProvider: "NinjaTrader",
      addonHeartbeatFresh: true,
      addonConnected: true,
    },
    bridges: [
      {
        adapter_kind: "addon",
        status: "armed",
        command_enabled: true,
        account_name: "Sim101",
        last_seen_at: "2026-08-11T22:44:00.000Z",
      },
    ],
  };
}
