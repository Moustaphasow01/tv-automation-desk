import { DomainEventOutboxRepository } from "./domain-event-outbox-repository.js";
import { MarketContextRepository } from "./market-context-repository.js";
import { StrategySignalBusService } from "./strategy-signal-bus-service.js";
import { PostgresStrategySignalBusRepository } from "./strategy-signal-bus-repository.js";
import { createStrategySignalDecisionPipelineService } from "./strategy-signal-decision-pipeline-service.js";
import { createBrokerExecutionRepository } from "./broker-execution-repository.js";
import { BrokerExecutionService } from "./broker-execution-service.js";
import { loadGrainsReplayLedger } from "./persistence/postgres-grains-replay-ledger.js";

// Application orchestration only: no second Risk, fill engine or provider client.
export async function runGrainsCausalPostgresReplay(input) {
  const { database, pool, persistence, candles, signals, asOfUtc } = input;
  if (!/^desk_grains_replay_[a-f0-9]+$/.test(database || "")) throw new Error("ISOLATED_REPLAY_DATABASE_REQUIRED");
  const ledgerBefore = await loadGrainsReplayLedger(pool);
  if (ledgerBefore.signals.length || ledgerBefore.intents.length) throw new Error("EMPTY_REPLAY_LEDGER_REQUIRED");
  const clockState = { current: null };
  const services = replayServices(persistence, clockState);
  const grouped = groupSignals(signals);
  const boundaries = decisionBoundaries(signals, asOfUtc);
  const ticks = replayCutoffs({ candles, signals, asOfUtc });
  const batches = [];
  let hasTheoreticalWork = false;
  for (const cutoff of ticks) {
    clockState.current = cutoff;
    if (hasTheoreticalWork) await services.broker.processTheoreticalExecution({ nowUtc: cutoff });
    const atTime = grouped.get(cutoff) || [];
    for (const signal of atTime) await publishSignal(services.bus, signal);
    if (!boundaries.has(cutoff)) continue;
    const result = await services.pipeline.runOnce(replayCommand(input, cutoff));
    hasTheoreticalWork ||= result.order_intent_count > 0;
    batches.push({ cutoff_utc: cutoff, published_signal_ids: atTime.map((s) => s.signal_id), result });
    input.onProgress?.({ cutoff, published: atTime.length, status: result.status });
  }
  const ledger = await loadGrainsReplayLedger(pool);
  if (ledger.provider_commands !== ledgerBefore.provider_commands) throw new Error("PROVIDER_COMMANDS_CREATED");
  if (ledger.signals.length !== signals.length) throw new Error("REPLAY_PUBLICATION_COUNT_MISMATCH");
  return {
    schema_version: "us_grains_causal_postgres_replay_v1",
    replay_mode: "MODE_CAUSAL_PRECOMPUTED", database, as_of_utc: asOfUtc,
    authority: "CANONICAL_LOCAL_SHADOW_THEORY_NOT_BROKER_PNL",
    physical_execution: false, provider_commands: ledger.provider_commands,
    signal_count: signals.length, minute_cutoff_count: ticks.length, batches, ledger,
  };
}

function replayServices(persistence, state) {
  const clock = { now: () => {
    if (!state.current) throw new Error("REPLAY_CLOCK_NOT_STARTED");
    return { utc: state.current, epochMs: Date.parse(state.current) };
  } };
  const store = { persistence, clock, domainEvents: new DomainEventOutboxRepository(persistence),
    marketContext: new MarketContextRepository(persistence, { clock }) };
  return {
    bus: new StrategySignalBusService({ repository: new PostgresStrategySignalBusRepository(persistence), clock }),
    pipeline: createStrategySignalDecisionPipelineService({ store }),
    broker: new BrokerExecutionService({ repository: createBrokerExecutionRepository(persistence), persistence, clock,
      environment: { manualTelegramExecutionEnabled: true, executionEnabled: false, killSwitch: true,
        allowLiveAccount: false, legacyPositionExecutionEnabled: false } }),
  };
}

export function replayCutoffs({ candles, signals, asOfUtc }) {
  const end = Date.parse(asOfUtc);
  if (!Number.isFinite(end)) throw new Error("REPLAY_CUTOFF_REQUIRED");
  const first = signals.length ? Math.min(...signals.map((s) => Date.parse(s.generated_at_utc))) : end;
  const times = new Set([end]);
  for (const row of candles) {
    if (!String(row.feed_id || "").endsWith("__1")) continue;
    const close = Date.parse(row.timestamp_utc) + 60_000;
    if (Number.isFinite(close) && close >= first && close <= end) times.add(close);
  }
  for (const signal of signals) {
    const generated = Date.parse(signal.generated_at_utc);
    if (!Number.isFinite(generated) || generated > end) throw new Error("SIGNAL_AFTER_REPLAY_CUTOFF");
    times.add(generated);
    const expiry = Date.parse(signal.expires_at_utc);
    if (Number.isFinite(expiry) && expiry <= end && expiry >= generated) times.add(expiry);
  }
  return [...times].sort((a, b) => a - b).map((at) => new Date(at).toISOString());
}

function groupSignals(signals) {
  const result = new Map();
  for (const signal of signals) {
    const at = new Date(signal.generated_at_utc).toISOString();
    const group = result.get(at) || [];
    group.push(signal);
    result.set(at, group);
  }
  for (const group of result.values()) group.sort((a, b) => String(a.signal_id).localeCompare(String(b.signal_id)));
  return result;
}

function decisionBoundaries(signals, asOfUtc) {
  return new Set([new Date(asOfUtc).toISOString(), ...signals.flatMap((signal) =>
    [signal.generated_at_utc, signal.expires_at_utc].map((at) => new Date(at).toISOString()))]);
}

async function publishSignal(bus, signal) {
  const result = await bus.publishSignal({ ...signal, source_class: "SHADOW", execution_mode_origin: "SHADOW" },
    { idempotency_key: `causal-replay:${signal.signal_id}` }, { requireRunningInstance: true });
  if (result.status !== "PUBLISHED" || !result.outbox?.signal_outbox_id) throw new Error("REPLAY_SIGNAL_NOT_PUBLISHED");
}

function replayCommand(input, cutoff) {
  return {
    ...(input.pipelinePolicy || {}),
    now_utc: cutoff, account_id: input.accountId || "causal-replay-shadow",
    portfolio_scope: input.accountId || "causal-replay-shadow",
    source_classes: ["SHADOW"], execution_modes: ["SHADOW"],
    prefer_embedded_context_gate_decision: true,
  };
}
