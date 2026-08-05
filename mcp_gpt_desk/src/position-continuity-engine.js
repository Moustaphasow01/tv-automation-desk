import {
  normalizeContractOrderTypeV1,
  normalizeEntryModeV1,
  validateEntryOrderSemanticsV1,
} from "@tv-automation/desk-domain";

const OPEN_POSITION_STATUSES = new Set(["OPEN", "PROTECTED", "PARTIAL_TAKEN", "PENDING", "RUNNING"]);
const TERMINAL_POSITION_STATUSES = new Set(["CLOSED", "STOPPED", "CANCELLED", "CANCELED", "EXPIRED", "REVIEW_REQUIRED"]);
export const POSITION_CONTINUITY_ENGINE_VERSION = "3.0.0";
export const POSITION_TARGET_ENGINE_VERSION = "1.0.0";
export const DEFAULT_V4_BREAK_EVEN_AT_R = 0.7;

export function selectOpenPosition(positions = []) {
  return (positions || []).find(isOpenPosition) || null;
}

export function isOpenPosition(position = {}) {
  if (!position) return false;
  const status = String(position.status || "").toUpperCase();
  if (TERMINAL_POSITION_STATUSES.has(status)) return false;
  if (position.closed_at || position.closed_at_utc || position.closed_at_paris || position.exit_reason || (position.exit_price !== undefined && position.exit_price !== null)) {
    return false;
  }
  return OPEN_POSITION_STATUSES.has(status);
}

export function evaluatePositionOnRows(position, rows = [], { tick } = {}) {
  if (!position || !rows.length) return { changed: false, position, reason: position ? "NO_ROWS" : "NO_POSITION" };
  const status = String(position.status || "").toUpperCase();
  if (!OPEN_POSITION_STATUSES.has(status)) return { changed: false, position, reason: "POSITION_NOT_OPEN" };
  const direction = normalizeDirection(position.direction);
  let current = updatePositionExcursions(position, []);
  let stop = numberOrNull(current.stop_loss ?? current.stop);
  const targetPlan = canonicalPositionTargetPlan(position);
  if (targetPlan.invalid) {
    return {
      changed: true,
      position: {
        ...current,
        status: "REVIEW_REQUIRED",
        outcome_status: "TARGET_PLAN_INVALID",
        target_execution_error: {
          code: "TARGET_PLAN_INVALID",
          violations: targetPlan.violations,
        },
        position_target_engine_version: POSITION_TARGET_ENGINE_VERSION,
        updated_at: tick?.utc || current.updated_at,
        updated_at_utc: tick?.utc || current.updated_at_utc,
        updated_at_paris: tick?.paris || current.updated_at_paris,
      },
      reason: "TARGET_PLAN_INVALID",
    };
  }
  let target = nextExecutableTarget(targetPlan, current)?.price
    ?? numberOrNull(position.take_profit_1 ?? position.tp1 ?? position.target_1);
  if (direction !== "long" && direction !== "short") return { changed: false, position, reason: "POSITION_DIRECTION_UNKNOWN" };
  let managementChanged = false;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);
    const stopHit = stop !== null && (direction === "long" ? low !== null && low <= stop : high !== null && high >= stop);
    const activeTarget = nextExecutableTarget(targetPlan, current);
    target = activeTarget?.price
      ?? (targetPlan.structured ? null : numberOrNull(current.take_profit_1 ?? current.tp1 ?? current.target_1));
    const tpHit = target !== null && (direction === "long" ? high !== null && high >= target : low !== null && low <= target);
    current = updatePositionExcursions(current, [row]);
    if (stopHit && tpHit) {
      return {
        changed: true,
        ambiguous: true,
        position: {
          ...current,
          status: "REVIEW_REQUIRED",
          outcome_status: "AMBIGUOUS_INTRABAR",
          outcome_error: {
            code: "AMBIGUOUS_INTRABAR_PATH",
            message: "The same closed candle touched both stop and target; OHLC data cannot prove the execution order.",
          },
          ambiguity_evidence: {
            stop_price: stop,
            target_price: target,
            candle_timestamp: rowTimestamp(row),
            candle_high: high,
            candle_low: low,
          },
          position_engine_version: POSITION_CONTINUITY_ENGINE_VERSION,
          updated_at: tick?.utc || current.updated_at,
          updated_at_utc: tick?.utc || current.updated_at_utc,
          updated_at_paris: tick?.paris || current.updated_at_paris,
        },
        reason: "AMBIGUOUS_INTRABAR_PATH",
        row,
      };
    }
    if (stopHit || tpHit) {
      if (tpHit && !stopHit && targetPlan.structured) {
        const applied = applyStructuredTarget(current, activeTarget, { row, tick });
        if (applied?.closed) {
          return {
            changed: true,
            position: applied.position,
            reason: applied.reason,
            row,
          };
        }
        if (applied?.changed) {
          current = applied.position;
          stop = numberOrNull(current.stop_loss ?? current.stop);
          managementChanged = true;
          continue;
        }
      }
      if (tpHit && !stopHit && !targetPlan.structured) {
        const partial = takePartialAtTarget(current, {
          targetPrice: target,
          row,
          tick,
        });
        if (partial) {
          current = partial;
          stop = numberOrNull(partial.stop_loss ?? partial.stop);
          target = numberOrNull(partial.take_profit_1 ?? partial.tp1 ?? partial.target_1);
          managementChanged = true;
          continue;
        }
      }
      const exitReason = stopHit ? "STOP_LOSS_HIT" : "TAKE_PROFIT_1_HIT";
      const exitPrice = stopHit ? stop : target;
      const outcome = positionOutcome(current, {
        exitPrice,
        rows: rows.slice(0, rowIndex + 1),
        calculatedAt: row.timestamp_utc || tick?.utc,
      });
      return {
        changed: true,
        position: {
          ...current,
          ...outcome,
          status: "CLOSED",
          exit_reason: exitReason,
          exit_price: exitPrice,
          closed_at_paris: rowTimestamp(row) || tick?.paris || null,
          closed_at_utc: row.timestamp_utc || tick?.utc || null,
          updated_at: tick?.utc || position.updated_at,
          updated_at_utc: tick?.utc || position.updated_at_utc,
          updated_at_paris: tick?.paris || position.updated_at_paris,
          position_engine_version: POSITION_CONTINUITY_ENGINE_VERSION,
        },
        reason: exitReason,
        row,
      };
    }
    const breakEven = targetPlan.structured ? null : breakEvenThresholdPrice(current);
    const breakEvenReached = breakEven !== null
      && (direction === "long" ? high !== null && high >= breakEven : low !== null && low <= breakEven);
    const entry = numberOrNull(current.entry_price ?? current.avg_entry_price);
    const stopNeedsProtection = entry !== null
      && stop !== null
      && (direction === "long" ? stop < entry : stop > entry);
    if (breakEvenReached && stopNeedsProtection) {
      stop = entry;
      managementChanged = true;
      current = {
        ...current,
        status: current.status === "PARTIAL_TAKEN" ? "PARTIAL_TAKEN" : "PROTECTED",
        stop_loss: entry,
        stop: entry,
        break_even_armed: true,
        break_even_activated_at_paris: rowTimestamp(row) || tick?.paris || null,
        break_even_activated_at_utc: row.timestamp_utc || tick?.utc || null,
        last_management_action: "MOVE_STOP_BREAK_EVEN",
        position_engine_version: POSITION_CONTINUITY_ENGINE_VERSION,
      };
    }
    const trailed = applyTrailingStopAfterClosedRow(current, row, { tick });
    if (trailed !== current) {
      current = trailed;
      stop = numberOrNull(current.stop_loss ?? current.stop);
      managementChanged = true;
    }
  }
  return {
    changed: managementChanged,
    updated: current !== position,
    position: current,
    reason: managementChanged
      ? current.tp1_taken === true
        ? "TAKE_PROFIT_1_PARTIAL_AND_BREAK_EVEN"
        : "STOP_MOVED_TO_BREAK_EVEN"
      : "UNCHANGED",
  };
}

function canonicalPositionTargetPlan(position = {}) {
  const values = canonicalTargets(position);
  const structuredCandidate = values.some((target) => (
    target && typeof target === "object" && !Array.isArray(target)
      && (target.target_id !== undefined || target.action !== undefined)
  ));
  if (!structuredCandidate) return { structured: false, targets: values, invalid: false, violations: [] };

  const violations = [];
  const targets = values.map((target, index) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      violations.push({ code: "TARGET_PLAN_MIXED_FORMAT", ordinal: index });
      return null;
    }
    const targetId = String(target.target_id || "").trim();
    const price = numberOrNull(target.price);
    const action = String(target.action || "").trim().toUpperCase();
    const rawFraction = target.close_fraction;
    const closeFraction = rawFraction === null || rawFraction === undefined || rawFraction === ""
      ? 0
      : numberOrNull(rawFraction);
    if (!targetId) violations.push({ code: "TARGET_ID_REQUIRED", ordinal: index });
    if (price === null) violations.push({ code: "TARGET_PRICE_INVALID", ordinal: index, target_id: targetId || null });
    if (!["PARTIAL_CLOSE", "MOVE_STOP_BE", "TRAIL", "FULL_CLOSE", "RUNNER"].includes(action)) {
      violations.push({ code: "TARGET_ACTION_INVALID", ordinal: index, target_id: targetId || null, action: action || null });
    }
    if (closeFraction === null || closeFraction < 0 || closeFraction > 1) {
      violations.push({ code: "TARGET_CLOSE_FRACTION_INVALID", ordinal: index, target_id: targetId || null });
    } else if (action === "PARTIAL_CLOSE" && !(closeFraction > 0 && closeFraction < 1)) {
      violations.push({ code: "TARGET_PARTIAL_FRACTION_REQUIRED", ordinal: index, target_id: targetId || null });
    } else if (action === "FULL_CLOSE" && closeFraction !== 1) {
      violations.push({ code: "TARGET_FULL_CLOSE_FRACTION_REQUIRED", ordinal: index, target_id: targetId || null });
    }
    return {
      target_id: targetId,
      price,
      action,
      close_fraction: closeFraction,
      ordinal: index,
    };
  }).filter(Boolean);

  const identifiers = new Set();
  for (const target of targets) {
    if (identifiers.has(target.target_id)) {
      violations.push({ code: "TARGET_ID_DUPLICATE", ordinal: target.ordinal, target_id: target.target_id });
    }
    identifiers.add(target.target_id);
  }
  const direction = normalizeDirection(position.direction);
  for (let index = 1; index < targets.length; index += 1) {
    const previous = targets[index - 1];
    const current = targets[index];
    if (previous.price === null || current.price === null) continue;
    const causal = direction === "short" ? current.price <= previous.price : current.price >= previous.price;
    if (!causal) {
      violations.push({
        code: "TARGET_PRICE_ORDER_INVALID",
        ordinal: current.ordinal,
        target_id: current.target_id,
        direction,
      });
    }
  }
  return {
    structured: true,
    targets,
    invalid: violations.length > 0,
    violations,
  };
}

function nextExecutableTarget(plan, position = {}) {
  if (!plan?.structured) return null;
  const completed = new Set([
    ...(position.executed_target_ids || []),
    ...(position.target_executions || []).map((execution) => execution?.target_id),
  ].filter(Boolean));
  return plan.targets.find((target) => !completed.has(target.target_id)) || null;
}

function applyStructuredTarget(position, target, { row, tick } = {}) {
  if (!target) return null;
  const executedAtUtc = row?.timestamp_utc || tick?.utc || null;
  const executedAtParis = rowTimestamp(row || {}) || tick?.paris || null;
  const execution = {
    target_id: target.target_id,
    price: target.price,
    action: target.action,
    close_fraction: target.close_fraction,
    executed_at_utc: executedAtUtc,
    executed_at_paris: executedAtParis,
    engine_version: POSITION_TARGET_ENGINE_VERSION,
  };
  const executedBase = (value) => ({
    ...value,
    target_executions: [...(position.target_executions || []), execution],
    executed_target_ids: [...new Set([...(position.executed_target_ids || []), target.target_id])],
    last_executed_target_id: target.target_id,
    target_execution_error: null,
    position_target_engine_version: POSITION_TARGET_ENGINE_VERSION,
  });
  const failClosed = (code) => ({
    changed: true,
    position: {
      ...position,
      status: "REVIEW_REQUIRED",
      outcome_status: "TARGET_PLAN_INVALID",
      target_execution_error: { code, target_id: target.target_id },
      target_execution_attempts: [
        ...(position.target_execution_attempts || []),
        { ...execution, status: "REJECTED", error_code: code },
      ],
      position_target_engine_version: POSITION_TARGET_ENGINE_VERSION,
    },
    reason: code,
  });
  if (target.action === "PARTIAL_CLOSE") {
    const partial = takePartialAtTarget(position, {
      targetPrice: target.price,
      row,
      tick,
      reduceFraction: target.close_fraction,
      managementAction: "TARGET_PARTIAL_CLOSE",
      targetId: target.target_id,
      allowRepeatedTargetPartial: true,
    });
    if (!partial) return failClosed("TARGET_PARTIAL_CLOSE_NOT_EXECUTABLE");
    return {
      changed: true,
      position: advanceStructuredTarget(executedBase(partial)),
      reason: "TARGET_PARTIAL_CLOSE_EXECUTED",
    };
  }
  if (target.action === "MOVE_STOP_BE") {
    const entry = numberOrNull(position.entry_price ?? position.avg_entry_price);
    if (entry === null) return failClosed("TARGET_MOVE_STOP_BE_ENTRY_MISSING");
    return {
      changed: true,
      position: advanceStructuredTarget(executedBase({
        ...position,
        status: position.status === "PARTIAL_TAKEN" ? "PARTIAL_TAKEN" : "PROTECTED",
        stop_loss: entry,
        stop: entry,
        break_even_armed: true,
        break_even_activated_at_utc: executedAtUtc,
        break_even_activated_at_paris: executedAtParis,
        last_management_action: "MOVE_STOP_BREAK_EVEN",
      })),
      reason: "TARGET_MOVE_STOP_BE_EXECUTED",
    };
  }
  if (target.action === "TRAIL") {
    const trailRule = explicitTrailRule(position);
    if (!trailRule) return failClosed("TARGET_TRAIL_RULE_REQUIRED");
    return {
      changed: true,
      position: advanceStructuredTarget(executedBase({
        ...position,
        trailing_stop: {
          active: true,
          rule: trailRule,
          activated_at_utc: executedAtUtc,
          activated_at_paris: executedAtParis,
          activated_by_target_id: target.target_id,
        },
        last_management_action: "TRAIL_ACTIVATED",
      })),
      reason: "TARGET_TRAIL_ACTIVATED",
    };
  }
  if (target.action === "RUNNER") {
    return {
      changed: true,
      position: advanceStructuredTarget(executedBase({
        ...position,
        runner_active: true,
        runner_quantity: numberOrNull(position.remaining_quantity ?? position.quantity) ?? 0,
        runner_activated_at_utc: executedAtUtc,
        runner_activated_at_paris: executedAtParis,
        last_management_action: "RUNNER_RETAINED",
      })),
      reason: "TARGET_RUNNER_RETAINED",
    };
  }
  if (target.action === "FULL_CLOSE") {
    const finalized = finalizePositionAtPrice(executedBase(position), {
      exitPrice: target.price,
      exitReason: `TARGET_FULL_CLOSE:${target.target_id}`,
      rows: row ? [row] : [],
      closedAtParis: executedAtParis,
      closedAtUtc: executedAtUtc,
      tick,
    });
    return {
      changed: finalized.changed,
      closed: finalized.changed,
      position: {
        ...finalized.position,
        last_management_action: "TARGET_FULL_CLOSE",
        position_target_engine_version: POSITION_TARGET_ENGINE_VERSION,
      },
      reason: finalized.changed ? "TARGET_FULL_CLOSE_EXECUTED" : finalized.reason,
    };
  }
  return null;
}

function applyTrailingStopAfterClosedRow(position, row, { tick } = {}) {
  const trailing = position.trailing_stop;
  const rule = trailing?.active === true ? explicitTrailRule({ trail_rule: trailing.rule }) : null;
  const close = numberOrNull(row?.close);
  const currentStop = numberOrNull(position.stop_loss ?? position.stop);
  const direction = normalizeDirection(position.direction);
  if (!rule || close === null || currentStop === null || !["long", "short"].includes(direction)) return position;
  const candidate = direction === "long"
    ? close - rule.distance_points
    : close + rule.distance_points;
  const tightened = direction === "long"
    ? Math.max(currentStop, candidate)
    : Math.min(currentStop, candidate);
  if (tightened === currentStop) return position;
  return {
    ...position,
    status: position.status === "PARTIAL_TAKEN" ? "PARTIAL_TAKEN" : "PROTECTED",
    stop_loss: tightened,
    stop: tightened,
    trailing_stop: {
      ...trailing,
      last_price: close,
      last_stop: tightened,
      updated_at_utc: row?.timestamp_utc || tick?.utc || null,
      updated_at_paris: rowTimestamp(row || {}) || tick?.paris || null,
    },
    last_management_action: "TRAIL_STOP_TIGHTENED",
    position_target_engine_version: POSITION_TARGET_ENGINE_VERSION,
  };
}

function advanceStructuredTarget(position) {
  const plan = canonicalPositionTargetPlan(position);
  const next = nextExecutableTarget(plan, position);
  return { ...position, take_profit_1: next?.price ?? null, next_target_id: next?.target_id ?? null };
}

function explicitTrailRule(position = {}) {
  const source = position.management_policy?.trail_rule
    || position.management_policy?.trailing_rule
    || position.trail_rule
    || null;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const distancePoints = numberOrNull(source.distance_points ?? source.offset_points);
  if (!(distancePoints > 0)) return null;
  const priceSource = String(source.price_source || "CLOSED_BAR_CLOSE").trim().toUpperCase();
  if (priceSource !== "CLOSED_BAR_CLOSE") return null;
  return { type: "FIXED_DISTANCE_POINTS", distance_points: distancePoints, price_source: priceSource };
}

export function finalizePositionAtPrice(position, {
  exitPrice,
  exitReason = "MANUAL_EXIT",
  rows = [],
  closedAtParis = null,
  closedAtUtc = null,
  tick,
} = {}) {
  if (!position) return { changed: false, position, reason: "NO_POSITION" };
  if (!isOpenPosition(position)) return { changed: false, position, reason: "POSITION_NOT_OPEN" };
  const normalizedExitPrice = numberOrNull(exitPrice);
  if (normalizedExitPrice === null) {
    return { changed: false, position, reason: "EXIT_PRICE_REQUIRED" };
  }
  const finalRow = rows.at(-1) || null;
  const outcome = positionOutcome(position, {
    exitPrice: normalizedExitPrice,
    rows,
    calculatedAt: closedAtUtc || finalRow?.timestamp_utc || tick?.utc,
  });
  return {
    changed: true,
    position: {
      ...position,
      ...outcome,
      status: "CLOSED",
      exit_reason: exitReason,
      exit_price: normalizedExitPrice,
      closed_at_paris: closedAtParis || rowTimestamp(finalRow || {}) || tick?.paris || null,
      closed_at_utc: closedAtUtc || finalRow?.timestamp_utc || tick?.utc || null,
      updated_at: tick?.utc || position.updated_at,
      updated_at_utc: tick?.utc || position.updated_at_utc,
      updated_at_paris: tick?.paris || position.updated_at_paris,
    },
    reason: exitReason,
  };
}

export function applyPartialExitAtPrice(position, {
  fillPrice,
  filledAtParis = null,
  filledAtUtc = null,
  reduceFraction = null,
  managementAction = "TAKE_PARTIAL",
  tick,
} = {}) {
  if (!position) return { changed: false, position, reason: "NO_POSITION" };
  if (!isOpenPosition(position)) return { changed: false, position, reason: "POSITION_NOT_OPEN" };
  const normalizedFillPrice = numberOrNull(fillPrice);
  if (normalizedFillPrice === null) {
    return { changed: false, position, reason: "PARTIAL_FILL_PRICE_REQUIRED" };
  }
  const row = {
    timestamp_paris: filledAtParis || tick?.paris || null,
    timestamp_utc: filledAtUtc || tick?.utc || null,
    open: normalizedFillPrice,
    high: normalizedFillPrice,
    low: normalizedFillPrice,
    close: normalizedFillPrice,
  };
  const partial = takePartialAtTarget(position, {
    targetPrice: normalizedFillPrice,
    row,
    tick,
    reduceFraction,
    managementAction,
  });
  if (!partial) {
    return {
      changed: false,
      position,
      reason: "PARTIAL_REQUIRES_AT_LEAST_TWO_REMAINING_CONTRACTS",
    };
  }
  return {
    changed: true,
    position: partial,
    reason: managementAction === "REDUCE_RISK"
      ? "RISK_REDUCTION_FILLED_AT_DETERMINISTIC_MARK"
      : "PARTIAL_FILLED_AT_DETERMINISTIC_MARK",
  };
}
export function markPositionAtPrice(position, price, { tick } = {}) {
  if (!position || !isOpenPosition(position)) return position;
  const markPrice = numberOrNull(price);
  const entry = numberOrNull(position.entry_price ?? position.avg_entry_price);
  const initialStop = numberOrNull(
    position.initial_stop_loss
      ?? position.initial_stop
      ?? position.stop_loss_at_entry
      ?? position.stop_loss
      ?? position.stop,
  );
  const direction = normalizeDirection(position.direction);
  const riskPoints = entry !== null && initialStop !== null ? Math.abs(entry - initialStop) : null;
  const unrealizedR = markPrice !== null && entry !== null && riskPoints
    ? (direction === "short" ? entry - markPrice : markPrice - entry) / riskPoints
    : null;
  return {
    ...position,
    mark_price: markPrice,
    current_price: markPrice,
    unrealized_r: unrealizedR,
    unrealized_R: unrealizedR,
    marked_at_utc: tick?.utc || null,
    marked_at_paris: tick?.paris || null,
    updated_at: tick?.utc || position.updated_at,
    updated_at_utc: tick?.utc || position.updated_at_utc,
    updated_at_paris: tick?.paris || position.updated_at_paris,
  };
}

function positionOutcome(position, { exitPrice, rows, calculatedAt }) {
  try {
    const instrument = String(position.instrument || "").toUpperCase().replace(/1!$/, "");
    const pointValue = numberOrNull(position.point_value) ?? ({ MNQ: 2, MES: 5, NQ: 20, ES: 50 })[instrument] ?? 1;
    const quantity = numberOrNull(position.initial_quantity ?? position.quantity_planned ?? position.quantity) ?? 1;
    const priorExitFills = Array.isArray(position.exit_fills) ? position.exit_fills : [];
    const exitedQuantity = priorExitFills.reduce(
      (sum, fill) => sum + (numberOrNull(fill.quantity) ?? 0),
      0,
    );
    const remainingQuantity = numberOrNull(position.remaining_quantity)
      ?? Math.max(0, quantity - exitedQuantity);
    const exitFills = priorExitFills.length
      ? [
        ...priorExitFills,
        {
          price: exitPrice,
          quantity: remainingQuantity,
          filled_at: calculatedAt,
          fill_ref: `deterministic_final_${position.position_id || "position"}`,
        },
      ]
      : undefined;
    const outcome = calculateTradeOutcome({
      side: position.direction || position.side,
      entryPrice: position.entry_price ?? position.avg_entry_price,
      initialStopPrice: position.initial_stop_loss ?? position.initial_stop ?? position.stop_loss ?? position.stop,
      initialQuantity: quantity,
      pointValue,
      exitPrice,
      exitFills,
      totalFees: position.total_fees,
      commissionPerContractSide: position.commission_per_contract_side,
      candles: rows,
      calculatedAt,
      finalized: true,
    });
    const cumulativeMfe = maxFinite(position.mfe_r, outcome.mfe_r);
    const cumulativeMae = minFinite(position.mae_r, outcome.mae_r);
    return {
      outcome,
      outcome_schema_version: outcome.schema_version,
      outcome_engine_version: outcome.engine_version,
      outcome_evidence_hash: outcome.evidence_hash,
      initial_risk_amount: outcome.initial_risk_amount,
      gross_realized_pnl: outcome.gross_realized_pnl,
      total_fees: outcome.total_fees,
      net_realized_pnl: outcome.net_realized_pnl,
      result_r: outcome.result_r,
      result_R: outcome.result_r,
      realized_R: outcome.result_r,
      mfe_r: cumulativeMfe,
      mae_r: cumulativeMae,
    };
  } catch (error) {
    return {
      outcome_error: {
        code: error?.code || "TRADE_OUTCOME_CALCULATION_FAILED",
        message: error?.message || String(error),
      },
    };
  }
}

export function buildPositionFromTriggeredSetup({ setup, run, step, monitor, trigger, tick, makePositionId }) {
  const direction = normalizeDirection(setup.direction);
  const stopLoss = numberOrNull(setup.stop_loss ?? setup.stop);
  const entry = setupEntryTrigger(setup);
  const triggerPrice = numberOrNull(trigger?.trigger_price ?? entry.price);
  const orderType = normalizeContractOrderTypeV1(setup.order_type);
  const entryMode = normalizeEntryModeV1(setup.entry_mode);
  const entryOrder = validateEntryOrderSemanticsV1({
    entryMode,
    orderType,
    limitPrice: setup.order_limit_price ?? (orderType === "LIMIT" ? triggerPrice : null),
    stopPrice: setup.order_stop_price ?? (orderType === "STOP" ? triggerPrice : null),
    requireExecutablePrices: true,
  });
  if (!entryOrder.valid) {
    const error = new Error(`Triggered setup ${setup.setup_id || setup.setup_record_id || "UNKNOWN"} has invalid entry-order semantics.`);
    error.code = "POSITION_ENTRY_ORDER_INVALID";
    error.details = { errors: entryOrder.errors };
    throw error;
  }
  const triggeredAtParis = trigger?.trigger_row ? rowTimestamp(trigger.trigger_row) : null;
  const triggeredAtUtc = trigger?.trigger_row?.timestamp_utc || null;
  if (!triggeredAtParis && !triggeredAtUtc) {
    const error = new Error("A canonical trigger timestamp is required to create a position.");
    error.code = "POSITION_TRIGGER_TIMESTAMP_REQUIRED";
    throw error;
  }
  return {
    position_id: makePositionId(setup.setup_id || setup.setup_record_id || step.step_id),
    setup_record_id: setup.setup_record_id || null,
    setup_id: setup.setup_id || null,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    monitor_id: monitor?.monitor_id || setup.monitor_id || null,
    mode: "replay",
    status: "OPEN",
    instrument: setup.instrument || null,
    direction,
    order_type: entryOrder.order_type,
    entry_mode: entryOrder.entry_mode,
    order_limit_price: entryOrder.limit_price,
    order_stop_price: entryOrder.stop_price,
    entry_price: triggerPrice,
    stop_loss: stopLoss,
    initial_stop_loss: stopLoss,
    take_profit_1: setupTakeProfit1(setup),
    targets: canonicalTargets(setup),
    initial_quantity: numberOrNull(setup.initial_quantity ?? setup.quantity_planned ?? setup.quantity) ?? 1,
    remaining_quantity: numberOrNull(setup.initial_quantity ?? setup.quantity_planned ?? setup.quantity) ?? 1,
    management_policy: canonicalManagementPolicy(setup),
    position_engine_version: POSITION_CONTINUITY_ENGINE_VERSION,
    triggered_at_paris: triggeredAtParis,
    triggered_at_utc: triggeredAtUtc,
    opened_at_paris: triggeredAtParis,
    opened_at_utc: triggeredAtUtc,
    anti_lookahead_compliant: true,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function canonicalManagementPolicy(setup = {}) {
  const source = setup.management_policy || setup.position_management || setup.trade_management || {};
  const explicit = numberOrNull(
    source.break_even_at_r
      ?? source.move_stop_to_break_even_at_r
      ?? setup.break_even_at_r
      ?? setup.move_stop_to_break_even_at_r,
  );
  return {
    ...source,
    break_even_at_r: explicit ?? DEFAULT_V4_BREAK_EVEN_AT_R,
    break_even_source: explicit === null ? "AUTOPILOT_V4_CONTRACT_DEFAULT" : "SETUP_EXPLICIT",
    tp1_close_fraction: boundedFraction(source.tp1_close_fraction, 0.5),
    evaluate_on_closed_candles: true,
  };
}

function takePartialAtTarget(position, {
  targetPrice,
  row,
  tick,
  reduceFraction = null,
  managementAction = "TAKE_PARTIAL",
  targetId = null,
  allowRepeatedTargetPartial = false,
}) {
  const riskReduction = String(managementAction || "").toUpperCase() === "REDUCE_RISK";
  const structuredTargetPartial = String(managementAction || "").toUpperCase() === "TARGET_PARTIAL_CLOSE";
  if (!riskReduction && !allowRepeatedTargetPartial && position.tp1_taken === true) return null;
  const initialQuantity = Math.max(1, Math.trunc(
    numberOrNull(position.initial_quantity ?? position.quantity_planned ?? position.quantity) ?? 1,
  ));
  const priorExitFills = Array.isArray(position.exit_fills) ? position.exit_fills : [];
  const alreadyExited = priorExitFills.reduce(
    (sum, fill) => sum + (numberOrNull(fill.quantity) ?? 0),
    0,
  );
  const remainingQuantity = Math.max(0, Math.trunc(
    numberOrNull(position.remaining_quantity) ?? initialQuantity - alreadyExited,
  ));
  if (remainingQuantity <= 1) return null;
  const fraction = boundedFraction(
    reduceFraction,
    boundedFraction(position.management_policy?.tp1_close_fraction, 0.5),
  );
  const closeQuantity = Math.max(1, Math.min(
    remainingQuantity - 1,
    Math.ceil(remainingQuantity * fraction),
  ));
  if (!(closeQuantity > 0) || closeQuantity >= remainingQuantity) return null;
  const entry = numberOrNull(position.entry_price ?? position.avg_entry_price);
  const nextTarget = riskReduction
    ? numberOrNull(position.take_profit_1 ?? position.tp1 ?? position.target_1)
    : canonicalTargets(position)
      .map((target) => numberOrNull(target?.price ?? target?.target ?? target))
      .filter((target) => target !== null && target !== targetPrice)
      .at(0) ?? null;
  const fillOrdinal = priorExitFills.length + 1;
  const exitFills = [
    ...priorExitFills,
    {
      price: targetPrice,
      quantity: closeQuantity,
      filled_at: row.timestamp_utc || tick?.utc || null,
      fill_ref: `deterministic_${riskReduction ? "reduce_risk" : structuredTargetPartial ? `target_${targetId || fillOrdinal}` : "tp1"}_${position.position_id || "position"}_${fillOrdinal}`,
    },
  ];
  const partialOutcome = calculateTradeOutcome({
    side: position.direction || position.side,
    entryPrice: position.entry_price ?? position.avg_entry_price,
    initialStopPrice: position.initial_stop_loss ?? position.initial_stop ?? position.stop_loss ?? position.stop,
    initialQuantity,
    pointValue: position.point_value ?? instrumentPointValue(position.instrument),
    exitFills,
    commissionPerContractSide: position.commission_per_contract_side,
    candles: [row],
    calculatedAt: row.timestamp_utc || tick?.utc,
    finalized: false,
  });
  return {
    ...position,
    status: "PARTIAL_TAKEN",
    stop_loss: riskReduction || structuredTargetPartial ? position.stop_loss : entry,
    stop: riskReduction || structuredTargetPartial ? position.stop : entry,
    take_profit_1: nextTarget,
    remaining_quantity: remainingQuantity - closeQuantity,
    exited_quantity: alreadyExited + closeQuantity,
    exit_fills: exitFills,
    ...(riskReduction ? {
      risk_reduction_count: Number(position.risk_reduction_count || 0) + 1,
      risk_reduced_at_paris: rowTimestamp(row) || tick?.paris || null,
      risk_reduced_at_utc: row.timestamp_utc || tick?.utc || null,
      last_management_action: "REDUCE_RISK",
    } : structuredTargetPartial ? {
      target_partial_count: Number(position.target_partial_count || 0) + 1,
      target_partial_taken_at_paris: rowTimestamp(row) || tick?.paris || null,
      target_partial_taken_at_utc: row.timestamp_utc || tick?.utc || null,
      last_management_action: "TARGET_PARTIAL_CLOSE",
    } : {
      tp1_taken: true,
      tp1_price: targetPrice,
      tp1_taken_at_paris: rowTimestamp(row) || tick?.paris || null,
      tp1_taken_at_utc: row.timestamp_utc || tick?.utc || null,
      break_even_armed: true,
      break_even_activated_at_paris: rowTimestamp(row) || tick?.paris || null,
      break_even_activated_at_utc: row.timestamp_utc || tick?.utc || null,
      last_management_action: "TAKE_PARTIAL_AND_MOVE_STOP_BREAK_EVEN",
    }),
    outcome: partialOutcome,
    outcome_schema_version: partialOutcome.schema_version,
    outcome_engine_version: partialOutcome.engine_version,
    outcome_evidence_hash: partialOutcome.evidence_hash,
    initial_risk_amount: partialOutcome.initial_risk_amount,
    gross_realized_pnl: partialOutcome.gross_realized_pnl,
    total_fees: partialOutcome.total_fees,
    net_realized_pnl: partialOutcome.net_realized_pnl,
    realized_r_partial: partialOutcome.result_r,
    position_engine_version: POSITION_CONTINUITY_ENGINE_VERSION,
    updated_at: tick?.utc || position.updated_at,
    updated_at_utc: tick?.utc || position.updated_at_utc,
    updated_at_paris: tick?.paris || position.updated_at_paris,
  };
}
function canonicalTargets(setup = {}) {
  const source = setup.targets || setup.take_profits || [];
  if (Array.isArray(source)) return source;
  return source && typeof source === "object" ? Object.values(source) : [];
}

function boundedFraction(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
}

function instrumentPointValue(value) {
  const instrument = String(value || "").toUpperCase().replace(/1!$/, "");
  return ({ MNQ: 2, MES: 5, NQ: 20, ES: 50 })[instrument] ?? 1;
}

function breakEvenThresholdPrice(position = {}) {
  if (position.management_policy?.disable_auto_break_even === true) return null;
  const thresholdR = numberOrNull(
    position.management_policy?.break_even_at_r
      ?? position.break_even_at_r,
  );
  const entry = numberOrNull(position.entry_price ?? position.avg_entry_price);
  const initialStop = numberOrNull(
    position.initial_stop_loss
      ?? position.initial_stop
      ?? position.stop_loss_at_entry
      ?? position.stop_loss
      ?? position.stop,
  );
  const direction = normalizeDirection(position.direction);
  if (!(thresholdR > 0) || entry === null || initialStop === null) return null;
  const riskPoints = Math.abs(entry - initialStop);
  return direction === "short"
    ? entry - thresholdR * riskPoints
    : entry + thresholdR * riskPoints;
}

function updatePositionExcursions(position, rows = []) {
  const entry = numberOrNull(position.entry_price ?? position.avg_entry_price);
  const initialStop = numberOrNull(
    position.initial_stop_loss
      ?? position.initial_stop
      ?? position.stop_loss_at_entry
      ?? position.stop_loss
      ?? position.stop,
  );
  const direction = normalizeDirection(position.direction);
  const riskPoints = entry !== null && initialStop !== null ? Math.abs(entry - initialStop) : null;
  if (!riskPoints || !["long", "short"].includes(direction)) return position;
  let mfe = numberOrNull(position.mfe_r) ?? 0;
  let mae = numberOrNull(position.mae_r) ?? 0;
  let favorablePrice = numberOrNull(position.max_favorable_price) ?? entry;
  let adversePrice = numberOrNull(position.max_adverse_price) ?? entry;
  for (const row of rows || []) {
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);
    if (high === null || low === null) continue;
    if (direction === "long") {
      favorablePrice = Math.max(favorablePrice, high);
      adversePrice = Math.min(adversePrice, low);
      mfe = Math.max(mfe, (high - entry) / riskPoints);
      mae = Math.min(mae, (low - entry) / riskPoints);
    } else {
      favorablePrice = Math.min(favorablePrice, low);
      adversePrice = Math.max(adversePrice, high);
      mfe = Math.max(mfe, (entry - low) / riskPoints);
      mae = Math.min(mae, (entry - high) / riskPoints);
    }
  }
  return {
    ...position,
    mfe_r: roundMetric(mfe),
    mae_r: roundMetric(mae),
    max_favorable_price: favorablePrice,
    max_adverse_price: adversePrice,
    position_engine_version: POSITION_CONTINUITY_ENGINE_VERSION,
  };
}

function maxFinite(left, right) {
  const values = [left, right].map(numberOrNull).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

function minFinite(left, right) {
  const values = [left, right].map(numberOrNull).filter((value) => value !== null);
  return values.length ? Math.min(...values) : null;
}

function roundMetric(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100_000_000) / 100_000_000;
}

function setupEntryTrigger(setup = {}) {
  const zone = setup.entry_zone && typeof setup.entry_zone === "object" ? setup.entry_zone : null;
  const from = numberOrNull(zone?.lower ?? zone?.from ?? zone?.low ?? zone?.min);
  const to = numberOrNull(zone?.upper ?? zone?.to ?? zone?.high ?? zone?.max);
  const direct = numberOrNull(setup.entry_price ?? setup.entry ?? setup.trigger_price ?? setup.trigger_policy?.entry_price);
  if (direct !== null) return { price: direct, from, to };
  if (from !== null && to !== null) {
    const direction = normalizeDirection(setup.direction);
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    return { price: direction === "short" ? low : high, from: low, to: high };
  }
  return { price: null, from, to };
}

function setupTakeProfit1(setup = {}) {
  const direct = numberOrNull(setup.take_profit_1 ?? setup.tp1 ?? setup.target_1);
  if (direct !== null) return direct;
  const takeProfits = setup.take_profits ?? setup.targets;
  if (Array.isArray(takeProfits)) {
    const first = takeProfits[0];
    return numberOrNull(first?.price ?? first?.level ?? first?.target ?? first);
  }
  if (takeProfits && typeof takeProfits === "object") {
    return numberOrNull(takeProfits.tp1 ?? takeProfits.target_1 ?? takeProfits.first ?? takeProfits.price ?? takeProfits.level);
  }
  return numberOrNull(setup.target ?? setup.take_profit ?? setup.tp);
}

function rowTimestamp(row = {}) { return row.timestamp_paris || row.timestamp_utc || row.timestamp || row.time || null; }
function normalizeDirection(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["buy", "bull", "bullish", "up", "long"].includes(raw)) return "long";
  if (["sell", "bear", "bearish", "down", "short"].includes(raw)) return "short";
  if (raw === "wait") return "wait";
  return raw || null;
}
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
import { calculateTradeOutcome } from "@tv-automation/desk-domain";
