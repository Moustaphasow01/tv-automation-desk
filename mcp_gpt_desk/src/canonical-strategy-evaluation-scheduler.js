import { randomUUID } from "node:crypto";
import {
  canonicalJson,
  canonicalSha256,
  compileStrategyVersionToDeterministicPlanV1,
} from "@tv-automation/desk-domain";
import { runCanonicalSimulationV1 } from "@tv-automation/desk-replay-engine";
import { toParisIso } from "@tv-automation/desk-time";
import { buildDataDrivenLiveRuntimeBindings } from "./research/data-driven-live-runtime-bindings.js";

const DEFAULT_CADENCE_SECONDS = 300;
const STRATEGY_SIGNAL_TTL_MS = 30 * 60_000;
const SYMBOL_BY_INSTRUMENT = Object.freeze({ MNQ: "MNQ1!", MES: "MES1!" });

export class CanonicalStrategyEvaluationScheduler {
  constructor({ store } = {}) {
    if (!store?.persistence?.pool || !store?.strategyKernel || !store?.strategyEvaluations) {
      throw coded("STRATEGY_EVALUATION_SCHEDULER_DEPENDENCY_MISSING", "Canonical Strategy Evaluation Scheduler requires PostgreSQL, Strategy Kernel and evaluation persistence.");
    }
    this.store = store;
    this.pool = store.persistence.pool;
    this.clock = store.clock;
  }

  async runCycle(input = {}) {
    const nowUtc = iso(input.now_utc || input.nowUtc || this.#now());
    const sourceClass = normalizeSourceClass(input.source_class || input.sourceClass || "LIVE");
    const certificationRunId = sourceClass === "CERTIFICATION_REPLAY"
      ? String(input.certification_run_id || input.certificationRunId || `strategy-scheduler:${nowUtc}`)
      : null;
    const instances = await this.store.strategyKernel.listInstances({ limit: bounded(input.limit, 500) });
    const recent = await this.store.strategyEvaluations.listRecent({ limit: 500 });
    const scopedEvaluations = sourceClass === "CERTIFICATION_REPLAY"
      ? recent.filter((item) => item.certification_run_id === certificationRunId)
      : recent.filter((item) => item.source_class !== "CERTIFICATION_REPLAY");
    const latestByInstance = latestEvaluationByInstance(scopedEvaluations);
    const planned = await this.store.strategyKernel.planInstanceSchedulerCycle({
      instances,
      now_utc: nowUtc,
      last_scheduled_at_by_instance: Object.fromEntries([...latestByInstance].map(([id, item]) => [id, schedulerContinuityAnchorUtc(item)])),
      default_cadence_seconds: bounded(input.cadence_seconds, DEFAULT_CADENCE_SECONDS),
      default_max_lag_seconds: bounded(input.max_lag_seconds, DEFAULT_CADENCE_SECONDS * 2),
      audit: input.audit !== false,
    }, { actor: input.actor || "strategy-evaluation-scheduler", idempotency_key: `strategy-scheduler:${nowUtc.slice(0, 16)}` });
    const outcomes = [];
    for (const due of planned.plan.due) {
      outcomes.push(await this.#evaluateDue(due, latestByInstance.get(due.strategy_instance_id) || null, nowUtc, sourceClass, certificationRunId));
    }
    return {
      status: outcomes.some((item) => item.status === "FAILED") ? "DEGRADED" : outcomes.length ? "EVALUATED" : "HEALTHY_IDLE",
      generatedAt: nowUtc,
      plan: planned.plan,
      outcomes,
    };
  }

  async #evaluateDue(due, previous, nowUtc, sourceClass, certificationRunId) {
    due = {
      ...due,
      scheduler_run_key: scopedSchedulerRunKey(due.scheduler_run_key, {
        sourceClass,
        certificationRunId,
      }),
    };
    const startedAt = this.#now();
    const correlationId = `strategy-eval:${due.strategy_instance_id}:${due.scheduler_run_key}`;
    try {
      const instance = await this.store.strategyKernel.getInstance(due.strategy_instance_id);
      const version = await this.store.strategyKernel.getVersion(due.strategy_version_id);
      const definition = await this.store.strategyKernel.getDefinition(version.strategy_definition_id);
      const instrument = String(instance.instrument_scope?.[0] || definition.default_instruments?.[0] || "MNQ").toUpperCase();
      const timeframe = templateTimeframe(version.metadata?.dsl_source) || "5";
      const market = await loadMarketDay(this.pool, { instrument, timeframe, cutoffUtc: nowUtc });
      if (!market.rows.length) {
        return this.#record({ due, version, correlationId, nowUtc, startedAt, instrument, timeframe, sourceClass, certificationRunId, status: "FAILED", reasonCodes: ["MARKET_DATA_UNAVAILABLE"], payload: { availability: "UNAVAILABLE" } });
      }
      if (Date.parse(nowUtc) - Date.parse(market.cutoffUtc) > freshnessThresholdMs(timeframe)) {
        return this.#record({ due, version, correlationId, nowUtc, startedAt, instrument, timeframe, sourceClass, certificationRunId, status: "FAILED", reasonCodes: ["MARKET_DATA_STALE"], payload: { availability: "STALE", marketCutoff: market.cutoffUtc } });
      }
      const compilation = compileRuntimeArtifact({ definition, version, instance, market, instrument, timeframe });
      if (!compilation.ok) {
        return this.#record({ due, version, correlationId, nowUtc, startedAt, instrument, timeframe, sourceClass, certificationRunId, status: "FAILED", reasonCodes: ["STRATEGY_RUNTIME_COMPILATION_FAILED", ...compilation.reasons], payload: { availability: "DEGRADED", compilationIssues: compilation.reasons } });
      }
      const simulation = runCanonicalSimulationV1({
        run_id: `runtime:${due.scheduler_run_key}`,
        strategy_version_id: version.strategy_version_id,
        compiled_artifact: compilation.compiled_artifact,
        dataset: market.dataset,
        rows: market.rows,
        parameters: runtimeSimulationParameters(),
        reproducibility_seed: `runtime:${version.strategy_version_id}`,
        cutoff_utc: market.cutoffUtc,
        cutoff_paris: toParisIso(Date.parse(market.cutoffUtc)),
        run_started_at_utc: market.rows[0].timestamp_utc,
      });
      if (simulation.status !== "COMPLETED") {
        return this.#record({ due, version, correlationId, nowUtc, startedAt, instrument, timeframe, sourceClass, certificationRunId, status: "FAILED", reasonCodes: ["STRATEGY_RUNTIME_EVALUATION_REJECTED", ...array(simulation.reasons)], payload: { availability: "DEGRADED", simulationStatus: simulation.status } });
      }
      const selection = selectLatestNewPosition(simulation.positions, previous, market.cutoffUtc);
      const candidate = selection.candidate;
      if (!candidate) {
        return this.#record({ due, version, correlationId, nowUtc, startedAt, instrument, timeframe, sourceClass, certificationRunId, status: "NO_SIGNAL", reasonCodes: ["NO_STRATEGY_SIGNAL_AT_CUTOFF", selection.diagnostics.reason], payload: { availability: "KNOWN", evaluatedRows: market.rows.length, simulationRunId: simulation.run_id, marketCutoff: market.cutoffUtc, selection: selection.diagnostics } });
      }
      const signalId = randomUUID();
      const evaluation = await this.#record({ due, version, correlationId, nowUtc, startedAt, instrument, timeframe, sourceClass, certificationRunId, status: "SIGNAL_CREATED", signalId, reasonCodes: ["CANONICAL_STRATEGY_CONDITIONS_SATISFIED"], payload: { availability: "KNOWN", evaluatedRows: market.rows.length, simulationRunId: simulation.run_id, positionId: candidate.position_id, marketCutoff: market.cutoffUtc } });
      const published = await this.store.publishStrategyV2Signal({
        input: strategySignalFromRuntimePosition({ signalId, correlationId, definition, version, instance, candidate, market, timeframe, evaluationId: evaluation.evaluation.strategy_evaluation_id, sourceClass, certificationRunId }),
        actor: { kind: "strategy-evaluation-scheduler" },
      });
      return { ...evaluation, publishedSignalId: published.signal?.signal_id || signalId };
    } catch (error) {
      return this.#record({ due, version: { strategy_version_id: due.strategy_version_id }, correlationId, nowUtc, startedAt, instrument: "MNQ", timeframe: "5", sourceClass, certificationRunId, status: "FAILED", reasonCodes: [error.code || "STRATEGY_RUNTIME_EVALUATION_FAILED"], payload: { availability: "DEGRADED", errorCode: error.code || "STRATEGY_RUNTIME_EVALUATION_FAILED", errorMessage: error.message || null } });
    }
  }

  async #record({ due, version, correlationId, nowUtc, startedAt, instrument, timeframe, sourceClass, certificationRunId, status, signalId = null, reasonCodes, payload }) {
    const cadenceSeconds = Number(due.cadence_seconds || DEFAULT_CADENCE_SECONDS);
    const evaluation = await this.store.strategyEvaluations.record({
      strategy_instance_id: due.strategy_instance_id,
      strategy_version_id: version.strategy_version_id || due.strategy_version_id,
      source_class: sourceClass,
      certification_run_id: certificationRunId,
      status,
      scheduler_run_key: due.scheduler_run_key,
      correlation_id: correlationId,
      causation_id: null,
      artifact_version: version.compiled_artifact_hash || version.runtime_contract_bundle_version || null,
      instrument,
      timeframe,
      source_data_cutoff_utc: payload?.marketCutoff || nowUtc,
      started_at_utc: startedAt,
      completed_at_utc: this.#now(),
      next_evaluation_at_utc: new Date(Date.parse(nowUtc) + cadenceSeconds * 1000).toISOString(),
      signal_id: signalId,
      reason_codes: reasonCodes,
      payload,
    });
    return { status, strategyInstanceId: due.strategy_instance_id, schedulerRunKey: due.scheduler_run_key, reasonCodes, evaluation };
  }

  #now() {
    const value = this.clock?.now?.();
    if (!value) throw coded("STRATEGY_EVALUATION_CLOCK_REQUIRED", "Strategy evaluation scheduler requires an injected clock.");
    return iso(value.utc || value);
  }
}

export function scopedSchedulerRunKey(baseKey, { sourceClass, certificationRunId } = {}) {
  const normalized = String(baseKey || "");
  if (sourceClass !== "CERTIFICATION_REPLAY") return normalized;
  const certification = String(certificationRunId || "").trim();
  if (!certification) throw coded("CERTIFICATION_RUN_ID_REQUIRED", "Certification replay scheduler requires certification_run_id.");
  return `${normalized}:cert:${canonicalSha256(certification).slice(0, 16)}`;
}

export function schedulerContinuityAnchorUtc(evaluation = {}) {
  const status = String(evaluation.status || "").toUpperCase();
  const availability = String(evaluation.payload?.availability || "").toUpperCase();
  if (status === "FAILED" || availability === "STALE" || availability === "UNAVAILABLE") {
    return evaluation.completed_at_utc || evaluation.source_data_cutoff_utc || null;
  }
  const scheduledTick = schedulerTickFromRunKey(evaluation.scheduler_run_key);
  if (scheduledTick) return scheduledTick;
  return evaluation.source_data_cutoff_utc || evaluation.completed_at_utc || null;
}

async function loadMarketDay(pool, { instrument, timeframe, cutoffUtc }) {
  const symbol = SYMBOL_BY_INSTRUMENT[instrument] || `${instrument}1!`;
  const latest = await pool.query(`SELECT trading_date, timestamp_utc FROM market_candles
    WHERE symbol_code=$1 AND timeframe=$2 AND is_closed=true AND timestamp_utc <= $3::timestamptz
    ORDER BY timestamp_utc DESC LIMIT 1`, [symbol, timeframe, cutoffUtc]);
  if (!latest.rows[0]) return { rows: [], cutoffUtc: null, dataset: null };
  const result = await pool.query(`SELECT timestamp_utc,timestamp_paris,trading_date,open,high,low,close,volume,is_closed
    FROM market_candles WHERE symbol_code=$1 AND timeframe=$2 AND trading_date=$3 AND is_closed=true AND timestamp_utc <= $4::timestamptz
    ORDER BY timestamp_utc`, [symbol, timeframe, latest.rows[0].trading_date, cutoffUtc]);
  const context = await pool.query(`SELECT timestamp_utc,timestamp_paris,trading_date,open,high,low,close,volume,is_closed
    FROM market_candles
    WHERE symbol_code=$1
      AND timeframe=$2
      AND trading_date::date >= $3::date - INTERVAL '10 days'
      AND trading_date::date <= $3::date
      AND is_closed=true
      AND timestamp_utc <= $4::timestamptz
    ORDER BY timestamp_utc`, [symbol, timeframe, latest.rows[0].trading_date, cutoffUtc]);
  const rows = result.rows.map((row) => marketRow(row, { instrument, symbol, timeframe }));
  const contextRows = context.rows.map((row) => marketRow(row, { instrument, symbol, timeframe }));
  const actualCutoff = iso(latest.rows[0].timestamp_utc);
  const identity = { symbol, timeframe, tradingDate: latest.rows[0].trading_date, cutoffUtc: actualCutoff, rows: rows.length };
  const datasetId = `runtime_dataset_${canonicalSha256(identity).slice(0, 24)}`;
  return {
    rows,
    cutoffUtc: actualCutoff,
    dataset: {
      dataset_id: datasetId,
      dataset_hash: `sha256:${canonicalSha256({ identity, first: rows[0], last: rows.at(-1) })}`,
      sealed: true,
      sealed_at_utc: actualCutoff,
      cutoff_utc: actualCutoff,
      cutoff_paris: toParisIso(Date.parse(actualCutoff)),
      time_range: { from_utc: rows[0]?.timestamp_utc, to_utc: actualCutoff, to_paris: toParisIso(Date.parse(actualCutoff)) },
      rows,
    },
    contextRows,
    tradingDate: latest.rows[0].trading_date,
  };
}

function compileRuntimeArtifact({ definition, version, instance, market, instrument, timeframe }) {
  const dsl = version.metadata?.dsl_source;
  const sample = market.rows.slice(0, Math.min(36, market.rows.length));
  if (!dsl || !sample.length) return { ok: false, reasons: ["STRATEGY_DSL_OR_OPENING_RANGE_MISSING"] };
  const dataDrivenBindings = buildDataDrivenLiveRuntimeBindings({ version, dsl, instance, market, instrument });
  if (looksDataDriven(dsl, version) && !dataDrivenBindings.ok) {
    return { ok: false, reasons: ["DATA_DRIVEN_RUNTIME_BINDING_FAILED", ...array(dataDrivenBindings.reasons)] };
  }
  const bindings = dataDrivenBindings.ok
    ? dataDrivenBindings.runtime_bindings
    : genericRuntimeBindings({ dsl, instance, market, instrument, sample });
  return compileStrategyVersionToDeterministicPlanV1({
    strategy_definition: definition,
    strategy_version: { ...version, dsl_source: canonicalJson(dsl) },
    dsl_source: dsl,
    runtime_bindings: bindings,
    scope: {
      trading_date: market.rows[0].trading_date,
      session: "canonical_strategy_runtime",
      cutoff_utc: market.cutoffUtc,
      cutoff_paris: toParisIso(Date.parse(market.cutoffUtc)),
      strategy_id: definition.external_key,
      pack_id: market.dataset.dataset_id,
      pack_build_id: market.dataset.dataset_hash,
    },
    source_mode: String(instance.execution_mode || "SHADOW").toUpperCase(),
  });
}

function marketRow(row, { instrument, symbol, timeframe }) {
  return {
    instrument,
    symbol,
    timeframe: `M${timeframe}`,
    trading_date: row.trading_date,
    time: row.timestamp_paris || toParisIso(Date.parse(row.timestamp_utc)),
    timestamp_utc: iso(row.timestamp_utc),
    timestamp_paris: row.timestamp_paris || toParisIso(Date.parse(row.timestamp_utc)),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume || 0),
    is_closed: true,
  };
}

function genericRuntimeBindings({ dsl, instance, market, instrument, sample }) {
  const high = quarter(Math.max(...sample.map((row) => row.high)));
  const low = quarter(Math.min(...sample.map((row) => row.low)));
  const setups = array(dsl.setup_templates).map((template) => runtimeBinding(template, { instrument, high, low }));
  const first = market.rows[0];
  return {
    valid_from_paris: first.timestamp_paris,
    expires_at_paris: toParisIso(Date.parse(market.cutoffUtc) + 24 * 60 * 60_000),
    cutoff_paris: toParisIso(Date.parse(market.cutoffUtc)),
    pack_id: market.dataset.dataset_id,
    pack_build_id: market.dataset.dataset_hash,
    plan_id: `runtime_plan_${instance.strategy_instance_id}_${market.rows[0].trading_date}`,
    session: "canonical_strategy_runtime",
    trading_date: market.rows[0].trading_date,
    setup_id_prefix: `runtime_${instance.strategy_instance_id}`,
    setups,
  };
}

function looksDataDriven(dsl = {}, version = {}) {
  const metadata = { ...(version.metadata || {}), ...(dsl.metadata || {}) };
  return String(metadata.generator || "").includes("data_driven")
    || String(metadata.family_id || "").length > 0
    || String(metadata.anchor_kind || "").length > 0;
}

function runtimeBinding(template, { instrument, high, low }) {
  const direction = String(template.direction || "long").toLowerCase();
  const rr = Number(template.rr_minimum || 2);
  const tolerance = Number(template.tolerance_points || 4);
  const isLong = direction === "long";
  const level = isLong ? high : low;
  const entry = quarter(level + (isLong ? tolerance / 2 : -tolerance / 2));
  const stop = quarter(level + (isLong ? -20 : 20));
  const risk = Math.abs(entry - stop);
  return {
    template_id: template.template_id,
    instrument,
    break_level: level,
    retest_level: level,
    entry_zone: { lower: quarter(level - tolerance / 2), upper: quarter(level + tolerance / 2) },
    stop_loss: stop,
    take_profit_1: quarter(entry + (isLong ? 1 : -1) * risk * rr),
    invalidation_level: quarter(isLong ? low - tolerance : high + tolerance),
  };
}

export function strategySignalFromRuntimePosition({ signalId, correlationId, definition, version, instance, candidate, market, timeframe, evaluationId, sourceClass, certificationRunId }) {
  const direction = String(candidate.direction || candidate.side || "").toUpperCase();
  const entry = nullable(candidate.entry_order?.limit_price ?? candidate.entry_raw_price ?? candidate.entry_price);
  const stop = nullable(candidate.stop_loss ?? candidate.stop_price ?? candidate.protection?.stop_price);
  const target = nullable(candidate.take_profit_1 ?? candidate.target_price ?? candidate.protection?.target_price);
  const generatedAt = signalPublicationUtc({ candidate, market });
  const simulatedEntryAt = isoOrNull(candidate.entry_row?.timestamp_utc || candidate.entry_time);
  const riskPoints = entry === null || stop === null ? null : Math.abs(entry - stop);
  const rewardPoints = entry === null || target === null ? null : Math.abs(target - entry);
  return {
    signal_id: signalId,
    strategy_definition_id: definition.strategy_definition_id,
    strategy_instance_id: instance.strategy_instance_id,
    strategy_version_id: version.strategy_version_id,
    instrument: candidate.instrument || instance.instrument_scope?.[0] || "MNQ",
    direction,
    confidence: 0.7,
    timeframe,
    session: "canonical_strategy_runtime",
    source_data_cutoff_utc: market.cutoffUtc,
    execution_mode_origin: String(instance.execution_mode || "SHADOW").toUpperCase(),
    generated_at_utc: generatedAt,
    expires_at_utc: new Date(Date.parse(generatedAt) + STRATEGY_SIGNAL_TTL_MS).toISOString(),
    correlation_id: correlationId,
    source_class: sourceClass,
    certification_run_id: certificationRunId,
    proposed_size: Number(candidate.quantity || 1),
    setup: { setup_id: candidate.setup_id, pattern: "BREAKOUT_RETEST" },
    predicates: [{ code: "CANONICAL_STRATEGY_CONDITIONS_SATISFIED", state: "SATISFIED" }],
    evidence: [{ kind: "STRATEGY_EVALUATION", ref: `strategy-evaluation://${evaluationId}` }],
    reason_codes: ["CANONICAL_STRATEGY_CONDITIONS_SATISFIED"],
    signal_quality: {
      temporal_alignment: "PUBLICATION_CUTOFF",
      publication_cutoff_utc: generatedAt,
      simulated_entry_time_utc: simulatedEntryAt,
    },
    proposed_trade_plan: {
      order_type: candidate.entry_order?.order_type || "LIMIT",
      instrument: candidate.instrument || instance.instrument_scope?.[0] || "MNQ",
      direction,
      entry_price: entry,
      stop_price: stop,
      targets: target === null ? [] : [target],
      source_data_cutoff_utc: market.cutoffUtc,
    },
    trade_plan_economics: {
      risk_points: riskPoints,
      reward_points: rewardPoints,
      rr: riskPoints && rewardPoints ? Math.round((rewardPoints / riskPoints) * 10_000) / 10_000 : null,
    },
  };
}

function signalPublicationUtc({ candidate = {}, market = {} } = {}) {
  return iso(
    market.cutoffUtc
    || market.cutoff_utc
    || market.dataset?.cutoff_utc
    || candidate.signal_publication_utc
    || candidate.entry_row?.timestamp_utc
    || candidate.entry_time,
  );
}

export function selectLatestNewPosition(positions, previous, cutoff) {
  const previousCutoff = typeof previous === "string" ? previous : previous?.source_data_cutoff_utc || null;
  const previousStatus = previous && typeof previous === "object" ? String(previous.status || "").toUpperCase() : "";
  const cutoffMs = Date.parse(cutoff);
  if (previousStatus === "SIGNAL_CREATED") {
    return {
      candidate: null,
      diagnostics: {
        reason: "PREVIOUS_CUTOFF_ALREADY_PUBLISHED",
        previous_cutoff_utc: previousCutoff,
        cutoff_utc: cutoff,
        total_positions: array(positions).length,
      },
    };
  }
  let expiredCount = 0;
  let outsideWindowCount = 0;
  const candidates = array(positions).filter((position) => {
    const at = Date.parse(position.entry_row?.timestamp_utc || position.entry_time || "");
    const previousMs = Date.parse(previousCutoff || "");
    const afterPrevious = !Number.isFinite(previousMs)
      || (previousStatus === "NO_SIGNAL" ? at >= previousMs : at > previousMs);
    if (!Number.isFinite(at) || !Number.isFinite(cutoffMs)) return false;
    if (at > cutoffMs || !afterPrevious) {
      outsideWindowCount += 1;
      return false;
    }
    if (at + STRATEGY_SIGNAL_TTL_MS <= cutoffMs) {
      expiredCount += 1;
      return false;
    }
    return true;
  }).sort((left, right) => Date.parse(right.entry_row?.timestamp_utc || right.entry_time) - Date.parse(left.entry_row?.timestamp_utc || left.entry_time));
  return {
    candidate: candidates[0] || null,
    diagnostics: candidates[0]
      ? {
        reason: "NEW_SIMULATED_POSITION_SELECTED",
        previous_cutoff_utc: previousCutoff,
        cutoff_utc: cutoff,
        total_positions: array(positions).length,
        candidate_count: candidates.length,
        candidate_position_id: candidates[0].position_id || null,
        expired_position_count: expiredCount,
        outside_publication_window_count: outsideWindowCount,
      }
      : {
        reason: array(positions).length && expiredCount
          ? "NO_UNEXPIRED_SIMULATED_POSITION_IN_PUBLICATION_WINDOW"
          : array(positions).length
            ? "NO_NEW_SIMULATED_POSITION_IN_PUBLICATION_WINDOW"
            : "NO_SIMULATED_POSITION",
        previous_cutoff_utc: previousCutoff,
        cutoff_utc: cutoff,
        total_positions: array(positions).length,
        candidate_count: 0,
        expired_position_count: expiredCount,
        outside_publication_window_count: outsideWindowCount,
      },
  };
}

export function latestNewPosition(positions, previousOrCutoff, cutoff) {
  return selectLatestNewPosition(positions, previousOrCutoff, cutoff).candidate;
}

function latestEvaluationByInstance(items) {
  const map = new Map();
  for (const item of array(items)) if (!map.has(item.strategy_instance_id)) map.set(item.strategy_instance_id, item);
  return map;
}
export function strategyRuntimeSimulationParameters() { return { simulation_policy: { position_at_cutoff: "MARK_TO_MARKET_CLOSE" }, order_simulation_policy: { ambiguous_intrabar_policy: "CONSERVATIVE_STOP", spread_points: 0.25, slippage_points: 0.25, commission_r_per_contract: 0.01 }, validation_scope: "canonical_live_shadow_runtime" }; }
function runtimeSimulationParameters() { return strategyRuntimeSimulationParameters(); }
function schedulerTickFromRunKey(value) {
  const textValue = String(value || "");
  const match = textValue.match(/(\d{4}-\d{2}-\d{2}T\d{2}[_:]\d{2}[_:]\d{2}[_:]\d{3}Z)$/);
  if (!match) return null;
  const normalized = match[1]
    .replace(/T(\d{2})_(\d{2})_(\d{2})_(\d{3})Z$/, "T$1:$2:$3.$4Z");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function templateTimeframe(dsl) { const value = String(array(dsl?.setup_templates)[0]?.timeframe || "M5").toUpperCase(); return value.replace(/^M/, ""); }
function freshnessThresholdMs(timeframe) { return Math.max(2, Number(timeframe) || 5) * 60_000 * 3; }
function bounded(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(1, Math.min(86_400, Math.trunc(parsed))) : fallback; }
function array(value) { return Array.isArray(value) ? value : []; }
function nullable(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function quarter(value) { return Math.round(Number(value) * 4) / 4; }
function normalizeSourceClass(value) { const normalized = String(value || "LIVE").toUpperCase(); if (["LIVE", "SHADOW", "CERTIFICATION_REPLAY"].includes(normalized)) return normalized; throw coded("STRATEGY_EVALUATION_SOURCE_CLASS_INVALID", "Strategy evaluation source class is invalid."); }
function iso(value) { const parsed = Date.parse(value || ""); if (!Number.isFinite(parsed)) throw coded("STRATEGY_EVALUATION_TIMESTAMP_INVALID", "Strategy evaluation timestamp is invalid."); return new Date(parsed).toISOString(); }
function isoOrNull(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function coded(code, message) { return Object.assign(new Error(message || code), { code, retryable: false }); }
