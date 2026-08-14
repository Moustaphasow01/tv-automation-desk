import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateDemoPaperGate, parseDemoPaperGateArgs } from "./check_demo_paper_gate.mjs";

describe("demo paper launch gate", () => {
  it("passes when API, operations, live data and broker PAPER path are ready", () => {
    const gate = evaluateDemoPaperGate(readyStatus(), { profile: "demo-paper" });
    assert.equal(gate.ok, true);
    assert.deepEqual(gate.blockers, []);
  });

  it("blocks demo-paper activation on stale core market data", () => {
    const status = readyStatus();
    status.data_readiness.ok = false;
    status.data_readiness.state = "stale";
    status.data_readiness.effective_market_date = "2026-07-17";
    status.operations.services.find((service) => service.service_kind === "live_runtime_scheduler").details.data_blocker = "LOCAL_PACK_CORE_DATASET_MISSING";

    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });

    assert.equal(gate.ok, false);
    assert.ok(gate.blockers.some((blocker) => blocker.id === "data.live_fresh"));
    assert.ok(gate.blockers.some((blocker) => blocker.id === "live_runtime.no_data_blocker"));
  });

  it("blocks demo-paper activation when broker management is only skipped", () => {
    const status = readyStatus();
    const broker = status.operations.services.find((service) => service.service_kind === "broker_management");
    broker.details.result = { ok: true, status: "SKIPPED", reason: "ENVIRONMENT_NOT_ARMED" };

    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });

    assert.equal(gate.ok, false);
    assert.ok(gate.blockers.some((blocker) => blocker.id === "broker.paper_armed"));
  });

  it("blocks demo-paper activation when PAPER env is armed but Sim101 AddOn is not ready", () => {
    const status = readyStatus();
    const broker = status.operations.services.find((service) => service.service_kind === "broker_management");
    broker.details.result.paper_safety.addon_heartbeat_fresh = false;
    broker.details.result.paper_safety.command_enabled = false;

    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });

    assert.equal(gate.ok, false);
    assert.ok(gate.blockers.some((blocker) => blocker.id === "broker.sim101_addon_ready"));
  });

  it("uses Telegram trading readiness instead of Sim101 AddOn readiness in manual execution mode", () => {
    const status = readyStatus();
    const broker = status.operations.services.find((service) => service.service_kind === "broker_management");
    broker.details.result.paper_safety.manual_telegram_execution_enabled = true;
    broker.details.result.paper_safety.submission_possible = false;
    broker.details.result.paper_safety.addon_heartbeat_fresh = false;
    broker.details.result.paper_safety.command_enabled = false;
    status.operations.services.push(readyTelegramService());

    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });

    assert.equal(gate.ok, true, JSON.stringify(gate.blockers));
    assert.ok(gate.checks.some((check) => check.id === "execution.manual_telegram_ready" && check.ok === true));
    assert.equal(gate.checks.some((check) => check.id === "broker.sim101_addon_ready"), false);
  });

  it("blocks manual execution mode when the Telegram trading channel is not ready", () => {
    const status = readyStatus();
    const broker = status.operations.services.find((service) => service.service_kind === "broker_management");
    broker.details.result.paper_safety.manual_telegram_execution_enabled = true;
    broker.details.result.paper_safety.submission_possible = false;

    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });

    assert.equal(gate.ok, false);
    assert.ok(gate.blockers.some((blocker) => blocker.id === "execution.manual_telegram_ready"));
  });

  it("blocks demo-paper activation when fresh market data comes from a rescue path", () => {
    const status = readyStatus();
    status.data_readiness.source_health.durable = false;
    status.data_readiness.source_health.durable_count = 0;
    status.data_readiness.source_health.non_durable_feeds = status.data_readiness.core_feeds.map((feed) => ({
      instrument: feed.instrument,
      timeframe: feed.timeframe,
      classification: "rescue",
      source: "tradingview_desktop_recent_ohlcv_rescue",
      source_service: "local_tradingview_webhook",
      received_at_utc: "2026-08-11T15:59:10.000Z",
      alert_id: null,
    }));
    for (const feed of status.data_readiness.core_feeds) {
      feed.provenance = { classification: "rescue", durable: false };
    }

    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });

    assert.equal(gate.ok, false);
    assert.ok(gate.blockers.some((blocker) => blocker.id === "data.source_durable"));
  });


  it("blocks demo-paper activation when execution authority is still auto", () => {
    const status = readyStatus();
    const broker = status.operations.services.find((service) => service.service_kind === "broker_management");
    broker.details.result.paper_safety.execution_authority_mode = "auto";
    broker.details.result.paper_safety.entry_operator_approval_required = false;

    const gate = evaluateDemoPaperGate(status, { profile: "demo-paper" });

    assert.equal(gate.ok, false);
    assert.ok(gate.blockers.some((blocker) => blocker.id === "broker.paper_environment_safe"));
  });

  it("keeps stale data as a warning for the stack profile", () => {
    const status = readyStatus();
    status.data_readiness.ok = false;
    status.data_readiness.state = "stale";
    const live = status.operations.services.find((service) => service.service_kind === "live_runtime_scheduler");
    live.status = "degraded";
    live.healthy = false;
    live.consecutive_failures = 0;
    live.details.data_state = "data_not_ready";
    live.details.data_blocker = "LOCAL_PACK_CORE_DATASET_MISSING";

    const gate = evaluateDemoPaperGate(status, { profile: "stack" });

    assert.equal(gate.ok, true);
    assert.ok(gate.warnings.some((warning) => warning.id === "data.live_fresh.stack_profile"));
  });

  it("parses profile and output flags", () => {
    const options = parseDemoPaperGateArgs(["--profile=stack", "--json", "--status-url=http://desk/status"]);
    assert.deepEqual(options, {
      statusUrl: "http://desk/status",
      profile: "stack",
      output: "json",
    });
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
      market_closed: false,
      requested_trading_date: "2026-08-11",
      effective_market_date: "2026-08-11",
      core_feeds: [
        durableFeed("MNQ", "1", "2026-08-11T15:59:00.000Z"),
        durableFeed("MNQ", "5", "2026-08-11T15:55:00.000Z"),
        durableFeed("MES", "1", "2026-08-11T15:59:00.000Z"),
        durableFeed("MES", "5", "2026-08-11T15:55:00.000Z"),
      ],
      source_health: { required: true, durable: true, durable_count: 4, total_count: 4, non_durable_feeds: [] },
      scheduler: { status: "healthy", data_state: "ready", data_blocker: null },
    },
    operations: {
      ok: true,
      missing_services: [],
      services: [
        {
          service_id: "broker_management",
          service_kind: "broker_management",
          status: "healthy",
          healthy: true,
          details: {
            result: {
              ok: true,
              status: "READY",
              reason: null,
              count: 0,
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
        {
          service_id: "live_runtime_scheduler",
          service_kind: "live_runtime_scheduler",
          status: "healthy",
          healthy: true,
          details: { data_state: "ready", data_blocker: null, trading_date: "2026-08-11" },
        },
        {
          service_id: "replay_preparation_worker",
          service_kind: "replay_preparation",
          status: "healthy",
          healthy: true,
          details: { last_status: "NO_PREPARATION_WORK" },
        },
      ],
    },
  };
}

function readyTelegramService() {
  return {
    service_id: "telegram_alert_worker",
    service_kind: "telegram_alerting",
    status: "healthy",
    healthy: true,
    details: {
      environment: {
        workerEnabled: true,
        tradingConfigured: true,
      },
      deliveries: [{ status: "idle" }],
    },
  };
}

function durableFeed(instrument, timeframe, latest) {
  return {
    instrument,
    timeframe,
    feed_id: `prod__tradingview__${instrument}1!__${timeframe}`,
    latest_timestamp_utc: latest,
    latest_received_at_utc: "2026-08-11T15:59:10.000Z",
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
