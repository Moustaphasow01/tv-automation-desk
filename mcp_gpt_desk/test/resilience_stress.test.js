import assert from "node:assert/strict";
import test from "node:test";
import { calculateTradeOutcome } from "@tv-automation/desk-domain";
import {
  claimReplayWorkItem,
  completeReplayWorkItem,
  failReplayWorkItem,
  heartbeatReplayWorkItem,
  isClaimableWorkItem,
} from "../src/replay-agent-work.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";
import { ingestTradingViewWebhook } from "../src/tradingview-webhook.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

test("stress: canonical R engine remains deterministic across 2,000 long/short outcomes", () => {
  for (let index = 1; index <= 2_000; index += 1) {
    const long = index % 2 === 0;
    const entry = 20_000 + index / 10;
    const stop = long ? entry - 20 : entry + 20;
    const exit = long ? entry + 30 : entry - 30;
    const input = {
      side: long ? "long" : "short",
      entryPrice: entry,
      initialStopPrice: stop,
      initialQuantity: 2,
      pointValue: 2,
      exitFills: [{ price: exit, quantity: 2 }],
      commissionPerContractSide: 1,
      calculatedAt: "2026-07-27T10:00:00.000Z",
    };
    const first = calculateTradeOutcome(input);
    const second = calculateTradeOutcome(input);
    assert.equal(first.status, "final");
    assert.equal(first.initial_risk_amount, 80);
    assert.equal(first.net_realized_pnl, 116);
    assert.equal(first.result_r, 1.45);
    assert.equal(first.evidence_hash, second.evidence_hash);
  }
});

test("stress: leases are bounded, exclusive and retry backoff prevents a hot loop", () => {
  const baseMs = Date.parse("2026-07-27T10:00:00.000Z");
  for (let index = 0; index < 1_000; index += 1) {
    const ready = workItem(index);
    const claimed = claimReplayWorkItem(ready, { worker_id: `worker-${index}`, lease_seconds: 99_999 }, tick(baseMs));
    assert.equal(claimed.status, "CLAIMED");
    assert.equal(isClaimableWorkItem(claimed, tick(baseMs)), false);
    assert.equal(Date.parse(claimed.lease_expires_at_utc) - baseMs, 20 * 60_000);

    const heartbeat = heartbeatReplayWorkItem(
      claimed,
      { worker_id: claimed.claimed_by, lease_token: claimed.lease_token, lease_seconds: 1_200 },
      tick(baseMs + 60_000),
    );
    assert.ok(Date.parse(heartbeat.lease_expires_at_utc) <= Date.parse(claimed.lease_deadline_at_utc));

    if (index % 2 === 0) {
      const completed = completeReplayWorkItem(
        heartbeat,
        { worker_id: heartbeat.claimed_by, lease_token: heartbeat.lease_token },
        tick(baseMs + 120_000),
      );
      assert.equal(completed.status, "COMPLETED");
      assert.equal(completed.lease_token, null);
    } else {
      const failed = failReplayWorkItem(
        heartbeat,
        {
          worker_id: heartbeat.claimed_by,
          lease_token: heartbeat.lease_token,
          error_code: "TRANSIENT",
          error_message: "temporary",
          retryable: true,
        },
        tick(baseMs + 120_000),
      );
      assert.equal(failed.status, "READY");
      assert.equal(isClaimableWorkItem(failed, tick(baseMs + 120_001)), false);
      assert.ok(Date.parse(failed.retry_after_utc) > baseMs + 120_000);
    }
  }

  const historical = {
    ...workItem("historical"),
    autopilot_version: "5.0.0",
    replay_execution_policy_version: "4.0.0",
  };
  assert.equal(isClaimableWorkItem(historical, tick(baseMs)), false);
  assert.throws(
    () => claimReplayWorkItem(historical, { worker_id: "historical-worker" }, tick(baseMs)),
    (error) => error?.code === "WORK_NOT_CLAIMABLE",
  );
});

test("stress: TradingView batch ingestion is idempotent and rejects stale candles without poisoning fresh data", async () => {
  const persistence = new InMemoryDeskPersistence();
  const now = new Date("2026-07-27T10:00:00.000Z");
  const candles = Array.from({ length: 40 }, (_, index) => ({
    alert_id: `alert-${index}`,
    symbol: index % 2 ? "MES1!" : "MNQ1!",
    timeframe: "5",
    timestamp_utc: new Date(now.getTime() - index * 5 * 60_000).toISOString(),
    open: 20_000 + index,
    high: 20_005 + index,
    low: 19_995 + index,
    close: 20_001 + index,
    volume: 100 + index,
    confirmed: true,
  }));
  candles.push({
    ...candles[0],
    alert_id: "stale",
    timestamp_utc: "2026-07-20T10:00:00.000Z",
  });
  const input = { token: "resilience-secret", candles };

  const first = await ingestTradingViewWebhook({
    persistence,
    body: input,
    secret: "resilience-secret",
    now,
    maxAgeSeconds: 4 * 60 * 60,
  });
  const second = await ingestTradingViewWebhook({
    persistence,
    body: input,
    secret: "resilience-secret",
    now,
    maxAgeSeconds: 4 * 60 * 60,
  });
  assert.equal(first.statusCode, 202);
  assert.equal(first.body.accepted, 40);
  assert.equal(first.body.rejected, 1);
  assert.equal(second.body.accepted, 40);
  assert.equal(
    persistence.count("tradingview_webhook_events"),
    40,
    "event hashes must make webhook retries idempotent",
  );
});

function workItem(index) {
  const workflow = Number(index) % 2 ? "REPLAY_MONITOR" : "REPLAY_MASTER";
  const master = workflow === "REPLAY_MASTER";
  return {
    strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
    autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    work_item_id: `work-${index}`,
    automation_scope: "replay",
    workflow,
    contract_context: {
      contract_name: master
        ? "DeskMasterAnalysisContract"
        : "DeskHourlyThesisMonitorContract",
      schema_version: master
        ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
        : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      contract_hash: `stress-contract-${workflow}`,
      execution_policy: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy },
      execution_plan: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan },
      monitor_command: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command },
      condition_catalog: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog },
    },
    save_target: {
      contract_name: master
        ? "DeskMasterAnalysisContract"
        : "DeskHourlyThesisMonitorContract",
      schema_version: master
        ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
        : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
      execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
      monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
      condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
      deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
      condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    },
    status: "READY",
    attempt_count: 0,
    max_attempts: 3,
    priority: 100,
    created_at_utc: "2026-07-27T09:00:00.000Z",
  };
}

function tick(epochMs) {
  const utc = new Date(epochMs).toISOString();
  return { epochMs, utc, paris: utc };
}
