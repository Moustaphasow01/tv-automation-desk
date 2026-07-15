import { createHash } from "node:crypto";

export function replaySetupOutcome({ setup = {}, candles = [], cutoff, meta = {}, clock } = {}) {
  const tick = normalizeTick(clock);
  const pricingMode = normalizePricingMode(meta.pricing_mode || setup.pricing_mode || setup.strict_pricing_mode);
  const base = {
    ok: true,
    replay_id: meta.replay_id || `${setup.setup_record_id || setup.setup_id || "setup"}_${tick.utc.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    setup_record_id: setup.setup_record_id || null,
    setup_id: setup.setup_id || null,
    analysis_id: setup.analysis_id || null,
    pack_id: setup.pack_id || null,
    instrument: setup.instrument || setup.symbol || null,
    direction: setup.direction || setup.side || null,
    replayed_at: tick.utc,
    replayed_at_utc: tick.utc,
    replayed_at_paris: tick.paris,
    replay_source: meta.source || null,
    pricing_mode: pricingMode,
    raw_ref: meta.raw_ref || null,
    replay_window: meta.replay_window || null,
    replay_engine: "desk-replay-engine",
    replay_engine_version: "1.0.0",
    candle_count: Array.isArray(candles) ? candles.length : 0,
  };

  if (!isExecutableSetup(setup)) {
    return withHash({
      ...base,
      replay_status: "wait",
      outcome: "not_executable",
      outcome_status: "not_executable",
      reason: "setup_is_not_executable_or_wait",
      r_result: 0,
      max_favorable_r: 0,
      finalized: true,
    });
  }

  const plan = normalizeReplayPlan(setup, pricingMode);
  if (!plan.ok) {
    return withHash({
      ...base,
      replay_status: "not_replayable",
      outcome: "missing_trade_plan",
      outcome_status: "not_replayable",
      reason: plan.reason,
      r_result: null,
      max_favorable_r: null,
      finalized: false,
    });
  }

  const normalized = normalizeCandles(candles);
  if (!normalized.length) {
    return withHash({
      ...base,
      replay_status: "no_data",
      outcome: "no_candles",
      outcome_status: "no_outcome",
      reason: "no_candles_in_replay_window",
      plan,
      r_result: null,
      max_favorable_r: null,
      finalized: true,
    });
  }

  const entry = findEntryFill(plan, normalized);
  if (!entry) {
    return withHash({
      ...base,
      replay_status: "no_fill",
      outcome: "entry_not_touched",
      outcome_status: "no_outcome",
      plan,
      r_result: 0,
      max_favorable_r: 0,
      first_candle_time: normalized[0]?.time || null,
      last_candle_time: normalized.at(-1)?.time || null,
      finalized: true,
    });
  }

  const replayCutoff = cutoff || meta.replay_window?.to || normalized.at(-1)?.time || null;
  const maxFavorableR = maxFavorableFor(plan, normalized.slice(entry.index));
  const firstTarget = plan.take_profits[0] || null;
  const path = evaluateReplayPath(plan, normalized.slice(entry.index), replayCutoff);
  const evidence = path.evidence || {};

  if (path.status === "rejected") {
    return withHash({
      ...base,
      replay_status: "rejected",
      outcome: path.reasons?.includes("replay_lookahead") ? "replay_lookahead" : "rejected",
      outcome_status: path.reasons?.includes("replay_lookahead") ? "lookahead_rejected" : "rejected",
      reason: (path.reasons || []).join(",") || "outcome_replay_rejected",
      reasons: path.reasons || [],
      flags: path.flags || [],
      plan,
      entry,
      evidence,
      r_result: null,
      max_favorable_r: round2(maxFavorableR),
      finalized: false,
    });
  }

  if (path.status === "review_required") {
    return withHash({
      ...base,
      replay_status: "review_required",
      outcome: "ambiguous_candle_path",
      outcome_status: "ambiguous",
      reason: (path.reasons || []).join(",") || "ambiguous_candle_path",
      reasons: path.reasons || [],
      flags: path.flags || [],
      plan,
      entry,
      evidence,
      r_result: null,
      max_favorable_r: round2(maxFavorableR),
      finalized: false,
    });
  }

  if (evidence.outcome === "SL") {
    return withHash({
      ...base,
      replay_status: "loss",
      outcome: "stop_loss",
      outcome_status: "sl_touched",
      plan,
      entry,
      exit: { time: evidence.exit_timestamp, price: plan.stop_loss, reason: "stop_loss" },
      evidence,
      r_result: -1,
      max_favorable_r: round2(maxFavorableR),
      finalized: true,
    });
  }

  if (evidence.outcome && evidence.outcome.startsWith("TP")) {
    const target = evidence.best_target_hit || firstTarget;
    return withHash({
      ...base,
      replay_status: "win",
      outcome: `${String(target?.name || evidence.outcome || "TP1").toLowerCase()}_hit`,
      outcome_status: "tp_touched",
      plan,
      entry,
      exit: { time: evidence.exit_timestamp, price: target?.price ?? evidence.exit_price, reason: target?.name || evidence.outcome || "TP1" },
      best_target_hit: target ? { ...target, hit_time: evidence.exit_timestamp } : null,
      evidence,
      r_result: round2(evidence.r_multiple),
      max_favorable_r: round2(Math.max(maxFavorableR, Number(evidence.r_multiple || 0))),
      finalized: true,
    });
  }

  return withHash({
    ...base,
    replay_status: "open_or_expired",
    outcome: "no_terminal_exit",
    outcome_status: "no_outcome",
    plan,
    entry,
    evidence,
    r_result: round2(evidence.r_multiple),
    max_favorable_r: round2(maxFavorableR),
    finalized: true,
  });
}

function evaluateReplayPath(plan, candles, cutoff) {
  const lookahead = replayLookaheadCandles(candles, cutoff);
  if (lookahead.length) {
    return {
      status: "rejected",
      reasons: ["replay_lookahead"],
      flags: ["OUTCOME_REPLAY_LOOKAHEAD"],
      evidence: {
        outcome: null,
        r_multiple: null,
        replay_lookahead: lookahead,
        candle_count: Array.isArray(candles) ? candles.length : 0,
      },
    };
  }

  const targetsHit = [];
  const targetKeys = new Set();
  for (const candle of candles) {
    const newTargets = plan.take_profits.filter((target) => !targetKeys.has(target.name) && targetTouched(plan, candle, target));
    const stopHit = stopTouched(plan, candle);
    if (stopHit && newTargets.length) {
      return {
        status: "review_required",
        reasons: ["ambiguous_candle_path"],
        flags: ["OUTCOME_AMBIGUOUS_CANDLE_PATH"],
        evidence: {
          outcome: null,
          r_multiple: null,
          ambiguous_candle: candle,
          targets_touched_same_candle: newTargets,
          candle_count: candles.length,
        },
      };
    }
    if (stopHit) {
      const bestPriorTarget = targetsHit.at(-1) || null;
      if (bestPriorTarget) {
        return targetOutcome(bestPriorTarget, candle, targetsHit, candles.length, "target_hit_before_stop");
      }
      return {
        status: "accepted",
        flags: ["OUTCOME_STOP_TOUCHED"],
        evidence: {
          outcome: "SL",
          exit_price: plan.stop_loss,
          exit_timestamp: candle.time,
          r_multiple: -1,
          targets_hit: targetsHit,
          candle_count: candles.length,
        },
      };
    }
    if (newTargets.length) {
      for (const target of newTargets) {
        targetKeys.add(target.name);
        targetsHit.push({ ...target, hit_time: candle.time });
      }
      if (targetKeys.size >= plan.take_profits.length) {
        return targetOutcome(targetsHit.at(-1), candle, targetsHit, candles.length, "final_target_hit");
      }
    }
  }

  if (targetsHit.length) {
    const last = candles.at(-1) || {};
    return targetOutcome(targetsHit.at(-1), last, targetsHit, candles.length, "best_target_hit");
  }

  const last = candles.at(-1) || {};
  const exitPrice = Number.isFinite(last.close) ? last.close : plan.entry_price;
  return {
    status: "accepted",
    flags: [],
    evidence: {
      outcome: "OPEN",
      exit_price: exitPrice,
      exit_timestamp: last.time || null,
      r_multiple: round2(priceToR(plan, exitPrice)),
      targets_hit: [],
      candle_count: candles.length,
    },
  };
}

function targetOutcome(target, candle, targetsHit, candleCount, terminalReason) {
  return {
    status: "accepted",
    flags: ["OUTCOME_TARGET_TOUCHED"],
    evidence: {
      outcome: target?.name || "TP1",
      exit_price: target?.price ?? null,
      exit_timestamp: target?.hit_time || candle?.time || null,
      r_multiple: target?.r_multiple ?? null,
      best_target_hit: target || null,
      targets_hit: targetsHit,
      terminal_reason: terminalReason,
      candle_count: candleCount,
    },
  };
}

function replayLookaheadCandles(candles, cutoff) {
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(cutoffMs)) return [];
  return (candles || [])
    .filter((candle) => {
      const timestampMs = Date.parse(candle.time);
      return Number.isFinite(timestampMs) && timestampMs > cutoffMs;
    })
    .map((candle) => candle.time);
}

function targetTouched(plan, candle, target) {
  return plan.direction === "long"
    ? candle.high >= target.price
    : candle.low <= target.price;
}

function stopTouched(plan, candle) {
  return plan.direction === "long"
    ? candle.low <= plan.stop_loss
    : candle.high >= plan.stop_loss;
}

export function buildReplayOutcomeRecord({
  outcome_id,
  simulation_id,
  step_id,
  setup = {},
  candles = [],
  cutoff,
  feed = null,
  meta = {},
  existing = null,
  correction_audit_id = null,
  clock,
} = {}) {
  assertReplayOutcomeWritable(existing, { correction_audit_id });
  const replay = replaySetupOutcome({ setup, candles, cutoff, meta, clock });
  const tick = normalizeTick(clock);
  const setupId = setup.setup_id || setup.setup_record_id || null;
  const revision = existing && correction_audit_id ? Number(existing.revision || 1) + 1 : 1;
  const record = {
    schema_version: "replay_outcome_v2",
    outcome_id: outcome_id || stableId("replay_outcome", [simulation_id, step_id, setupId, correction_audit_id || "v1"]),
    simulation_id: simulation_id || null,
    step_id: step_id || null,
    setup_id: setupId,
    replay_engine: "desk-replay-engine",
    replay_engine_version: "1.0.0",
    outcome_status: replay.outcome_status,
    outcome: replay.outcome,
    status: applicationStatusFromReplay(replay),
    replay_status: replay.replay_status,
    reasons: replay.reasons || (replay.reason ? [replay.reason] : []),
    flags: replay.flags || [],
    r_result: replay.r_result,
    r_multiple: replay.r_result,
    exit_price: replay.exit?.price ?? replay.evidence?.exit_price ?? null,
    exit_timestamp: replay.exit?.time ?? replay.evidence?.exit_timestamp ?? null,
    replay,
    evidence: replay.evidence || {},
    feed,
    data_cutoff_paris: cutoff || null,
    finalized: replay.finalized === true,
    immutable: replay.finalized === true,
    revision,
    correction_of_outcome_id: existing && correction_audit_id ? existing.outcome_id || outcome_id || null : null,
    correction_audit_id: correction_audit_id || null,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  return withHash(record);
}

export function assertReplayOutcomeWritable(existing, { correction_audit_id = null } = {}) {
  if (existing?.finalized && !correction_audit_id) {
    throw new Error("simulation_outcome_immutable");
  }
}

function normalizeReplayPlan(setup, pricingMode = "conservative") {
  const direction = String(setup.direction || setup.side || setup.order_type || "").toLowerCase();
  const normalizedDirection = direction.includes("buy") ? "long" : direction.includes("sell") ? "short" : direction;
  if (!["long", "short"].includes(normalizedDirection)) {
    return { ok: false, reason: "direction_must_be_long_or_short" };
  }
  const entryZone = normalizeRange(setup.entry_zone || setup.entryZone);
  const triggerLevel = numeric(setup.entry_trigger?.level ?? setup.entry_trigger ?? setup.entry ?? setup.entry_price);
  const stopLoss = numeric(setup.stop_loss ?? setup.stop ?? setup.sl_price ?? setup.sl ?? setup.invalidation?.level);
  if (!entryZone && !Number.isFinite(triggerLevel)) {
    return { ok: false, reason: "entry_zone_or_entry_trigger_level_required" };
  }
  const mode = normalizePricingMode(pricingMode);
  const entryPrice = entryZone
    ? priceFromRange(entryZone, normalizedDirection, mode, "entry")
    : triggerLevel;
  if (!Number.isFinite(stopLoss) || !Number.isFinite(entryPrice) || stopLoss === entryPrice) {
    return { ok: false, reason: "valid_stop_loss_and_entry_required" };
  }
  const risk = Math.abs(stopLoss - entryPrice);
  const takeProfits = normalizeTakeProfits(setup.take_profits || setup.take_profit_1 || setup.tp1 || setup.target, normalizedDirection, entryPrice, risk, mode);
  if (!takeProfits.length) {
    return { ok: false, reason: "at_least_one_take_profit_required" };
  }
  return {
    ok: true,
    pricing_mode: mode,
    direction: normalizedDirection,
    order_type: setup.order_type || setup.setup_type || null,
    entry_zone: entryZone,
    trigger_level: Number.isFinite(triggerLevel) ? triggerLevel : null,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    risk,
    take_profits: takeProfits,
  };
}

function normalizeTakeProfits(takeProfits, direction, entryPrice, risk, pricingMode = "conservative") {
  const items = Array.isArray(takeProfits)
    ? takeProfits
    : takeProfits && typeof takeProfits === "object" && !("from" in takeProfits) && !("to" in takeProfits)
      ? Object.entries(takeProfits).map(([name, target]) => ({ name, target }))
      : [{ name: "TP1", target: takeProfits }];
  return items
    .map((item, index) => {
      const range = normalizeRange(item.target ?? item);
      const price = range ? priceFromRange(range, direction, pricingMode, "target") : numeric(item.price ?? item.level ?? item.target ?? item);
      if (!Number.isFinite(price)) return null;
      return {
        index: index + 1,
        name: item.name || `TP${index + 1}`,
        price,
        range,
        r_multiple: round2(Math.abs(price - entryPrice) / risk),
      };
    })
    .filter(Boolean)
    .filter((target) => target.r_multiple > 0)
    .sort((left, right) => left.index - right.index);
}

function priceFromRange(range, direction, pricingMode, role) {
  const mode = normalizePricingMode(pricingMode);
  if (mode === "middle") return round2((range.from + range.to) / 2);
  if (role === "entry") {
    if (mode === "optimistic") return direction === "long" ? range.from : range.to;
    return direction === "long" ? range.to : range.from;
  }
  if (mode === "optimistic") return direction === "long" ? range.to : range.from;
  return direction === "long" ? range.from : range.to;
}

function normalizePricingMode(value) {
  const text = String(value || "conservative").trim().toLowerCase();
  if (["middle", "mid", "midpoint"].includes(text)) return "middle";
  if (["optimistic", "best", "best_case"].includes(text)) return "optimistic";
  return "conservative";
}

function findEntryFill(plan, candles) {
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const touched = plan.entry_zone
      ? candle.high >= plan.entry_zone.from && candle.low <= plan.entry_zone.to
      : (plan.direction === "long" ? candle.high >= plan.trigger_level : candle.low <= plan.trigger_level);
    if (touched) {
      return {
        index,
        time: candle.time,
        price: plan.entry_price,
        rule: plan.entry_zone ? "entry_zone_touched" : "trigger_level_touched",
      };
    }
  }
  return null;
}

function maxFavorableFor(plan, candles) {
  return candles.reduce((max, candle) => {
    const favorablePrice = plan.direction === "long" ? candle.high : candle.low;
    return Math.max(max, priceToR(plan, favorablePrice));
  }, 0);
}

function normalizeCandles(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const close = numeric(row.close);
      return {
        time: row.timestamp_paris || row.timestamp_utc || row.timestamp || row.time || row.date || null,
        open: Number.isFinite(numeric(row.open)) ? numeric(row.open) : close,
        high: numeric(row.high),
        low: numeric(row.low),
        close,
      };
    })
    .filter((row) => row.time && [row.high, row.low, row.close].every(Number.isFinite))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function isExecutableSetup(setup) {
  const decision = String(setup.decision || setup.final_decision || "").toLowerCase();
  const direction = String(setup.direction || setup.side || "").toLowerCase();
  return setup.executable !== false && !["wait", "neutral"].includes(direction) && decision !== "wait";
}

function priceToR(plan, price) {
  if (!Number.isFinite(price) || !plan.risk) return 0;
  return plan.direction === "long"
    ? (price - plan.entry_price) / plan.risk
    : (plan.entry_price - price) / plan.risk;
}

function normalizeRange(value) {
  if (!value || typeof value !== "object") return null;
  const from = numeric(value.from ?? value.low ?? value.min);
  const to = numeric(value.to ?? value.high ?? value.max);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

function numeric(value) {
  if (value == null || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function stableId(prefix, parts) {
  const raw = [prefix, ...parts.map((part) => String(part || "none"))].join(":");
  return `${prefix}_${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

function applicationStatusFromReplay(replay) {
  if (replay.replay_status === "review_required") return "review_required";
  if (["rejected", "not_replayable"].includes(replay.replay_status)) return "rejected";
  return "accepted";
}

function withHash(record) {
  const withoutHash = { ...record };
  delete withoutHash.content_hash;
  return {
    ...record,
    content_hash: createHash("sha256").update(stableJson(withoutHash)).digest("hex"),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeTick(clock) {
  if (clock?.now) return clock.now();
  const now = new Date();
  return {
    utc: now.toISOString(),
    paris: now.toISOString(),
    epochMs: now.getTime(),
  };
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
