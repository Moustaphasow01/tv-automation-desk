import assert from "node:assert/strict";
import { test } from "node:test";

import {
  demoPaperLaunchGate,
  launchGatePipelineStatus,
} from "../src/front-control-plane-demo-paper.js";

test("demo paper front gate accepts manual Telegram execution without NinjaTrader AddOn", () => {
  const gate = demoPaperLaunchGate({
    nowIso: "2026-08-13T00:00:00.000Z",
    health: healthFixture(),
    execution: { safety: {} },
    rows,
  });

  assert.equal(gate.status, "READY");
  assert.equal(gate.finalDecision, "OPEN_DEMO_PAPER_AGENTS_ALLOWED");
  assert.equal(gate.checksById["execution.manual_telegram_ready"].ok, true);
  assert.equal(gate.checksById["broker.sim101_addon_ready"], undefined);
  assert.equal(launchGatePipelineStatus("BROKER", gate), null);
});

test("demo paper front gate blocks manual Telegram execution when trading channel is not ready", () => {
  const health = healthFixture();
  health.operations.services.find((service) => service.service_kind === "telegram_alerting").healthy = false;
  health.operations.services.find((service) => service.service_kind === "telegram_alerting").details.deliveries = [{ status: "disabled" }];

  const gate = demoPaperLaunchGate({
    nowIso: "2026-08-13T00:00:00.000Z",
    health,
    execution: { safety: {} },
    rows,
  });

  assert.equal(gate.status, "BLOCKED");
  assert.equal(gate.checksById["execution.manual_telegram_ready"].ok, false);
  assert.equal(launchGatePipelineStatus("BROKER", gate), "BLOCKED");
});

function rows(value) {
  return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
}

function healthFixture() {
  return {
    ready: true,
    ok: true,
    mode: "postgres",
    data_readiness: {
      ok: true,
      state: "ready",
      market_closed: false,
      effective_market_date: "2026-08-13",
      source_health: { durable: true },
      core_age_seconds: 42,
      core_feeds: [
        coreFeed("MNQ", "1"),
        coreFeed("MNQ", "5"),
        coreFeed("MES", "1"),
        coreFeed("MES", "5"),
      ],
    },
    operations: {
      services: [
        {
          service_kind: "live_runtime_scheduler",
          status: "healthy",
          healthy: true,
          details: { data_state: "ready" },
        },
        {
          service_kind: "broker_management",
          status: "healthy",
          healthy: true,
          details: {
            result: {
              paper_safety: {
                manual_telegram_execution_enabled: true,
                max_contracts: 1,
                execution_authority_mode: "auto",
                entry_operator_approval_required: false,
                submission_possible: false,
                live_account_allowed: false,
                account_name: "Sim101",
              },
            },
          },
        },
        {
          service_kind: "telegram_alerting",
          service_id: "telegram_alert_worker",
          status: "healthy",
          healthy: true,
          details: {
            environment: {
              workerEnabled: true,
              tradingConfigured: true,
            },
            deliveries: [{ status: "enabled" }],
          },
        },
      ],
    },
  };
}

function coreFeed(instrument, timeframe) {
  return {
    instrument,
    timeframe,
    provenance: {
      durable: true,
      source: "tradingview_alert_webhook",
    },
  };
}
