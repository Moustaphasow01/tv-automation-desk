import {
  THEORETICAL_EXECUTION_ENGINE_VERSION,
  THEORETICAL_ORDER_POLICY,
  evaluateTheoreticalEntryIntent,
  evaluateTheoreticalTradeExit,
} from "./theoretical-execution-engine.js";

export const US_GRAINS_THEORETICAL_REPLAY_VERSION =
  "us_grains_theoretical_replay_v1";

// Session close caps observed M1 evidence. It intentionally does not invent a forced exit.

export function simulateGrainSignalTheoreticalOutcome({
  signal = {},
  executionRows = [],
  asOfUtc,
  sessionCloseUtc,
  policy = THEORETICAL_ORDER_POLICY,
} = {}) {
  const plan = grainTradePlan(signal);
  const evaluation = replayEvaluationWindow({ asOfUtc, sessionCloseUtc });
  if (!plan || !evaluation || !validSignalTiming(signal))
    return unknownOutcome({
      signal,
      reason: "THEORETICAL_REPLAY_INPUT_INVALID",
    });
  const rows = closedM1Rows({
    executionRows,
    generatedAtUtc: signal.generated_at_utc,
    evaluation,
  });
  const entry = simulateCausalEntry({ signal, plan, rows, evaluation, policy });
  if (!entry.fill) return entryOutcomeProjection({ signal, plan, entry });
  return simulateCausalExit({ signal, plan, rows, entry, evaluation, policy });
}

function simulateCausalEntry({ signal, plan, rows, evaluation, policy }) {
  const intent = theoreticalIntent(signal, plan);
  const entryRows = rows.filter((item) => item.closeMs <= intent.expiresAtMs);
  const complete = entryWindowComplete({ rows: entryRows, signal, evaluation });
  const firstOpenMs = firstEligibleOpenMs(signal.generated_at_utc);
  let expectedOpenMs = firstOpenMs;
  let last = null;
  let lastCandle = null;
  for (const row of entryRows) {
    if (row.openMs !== expectedOpenMs)
      return { fill: null, result: null, complete: false, indeterminate: true };
    last = evaluateTheoreticalEntryIntent({
      intent: intent.value,
      decision: theoreticalDecision(signal, plan),
      contract: theoreticalContract(plan),
      candle: { ...row, theoretical_window_complete: false },
      now: evaluation.cutoffUtc,
      policy,
    });
    lastCandle = row;
    if (last.action === "fill_entry")
      return { fill: last, candle: row, complete };
    expectedOpenMs += 60_000;
  }
  if (evaluation.cutoffMs >= intent.expiresAtMs && complete) {
    const result = evaluateTheoreticalEntryIntent({
      intent: intent.value,
      decision: theoreticalDecision(signal, plan),
      contract: theoreticalContract(plan),
      candle: { ...lastCandle, theoretical_window_complete: true },
      now: evaluation.cutoffUtc,
      policy,
    });
    return { fill: null, result, complete };
  }
  return { fill: null, result: last, complete };
}

function entryOutcomeProjection({ signal, plan, entry }) {
  if (entry.indeterminate)
    return unknownOutcome({
      signal,
      plan,
      reason: "ENTRY_WINDOW_DATA_INCOMPLETE",
    });
  if (entry.result?.action === "expire_entry")
    return baseOutcome(signal, plan, {
      status: "EXPIRED_NO_FILL",
      reason: entry.result.reason,
      entrySimulatorOutcome: entry.result.simulator_outcome,
    });
  const reason = entry.complete
    ? entry.result?.reason || "ENTRY_NOT_FILLED"
    : "ENTRY_WINDOW_DATA_INCOMPLETE";
  return unknownOutcome({
    signal,
    plan,
    reason,
    entrySimulatorOutcome: entry.result?.simulator_outcome || null,
  });
}

function simulateCausalExit({ signal, plan, rows, entry, evaluation, policy }) {
  const trade = theoreticalTrade({ signal, plan, entry });
  const followingRows = rows.filter(
    (row) =>
      row.openMs > entry.candle.openMs && row.closeMs <= evaluation.cutoffMs,
  );
  const requiredLastOpenMs = lastClosedM1OpenMs(evaluation.cutoffMs);
  let expectedOpenMs = entry.candle.openMs + 60_000;
  for (const row of followingRows) {
    if (row.openMs !== expectedOpenMs)
      return unknownOutcome({
        signal,
        plan,
        reason: "EXIT_WINDOW_DATA_INCOMPLETE",
        entrySimulatorOutcome: entry.fill.simulator_outcome,
        entry: entry.fill,
      });
    const result = evaluateTheoreticalTradeExit({ trade, candle: row, policy });
    if (result.action === "review_exit")
      return unknownOutcome({
        signal,
        plan,
        reason: result.reason,
        entrySimulatorOutcome: entry.fill.simulator_outcome,
        exitSimulatorOutcome: result.simulator_outcome,
        entry: entry.fill,
      });
    if (result.action === "fill_exit")
      return closedOutcome({ signal, plan, entry: entry.fill, exit: result });
    expectedOpenMs += 60_000;
  }
  if (requiredLastOpenMs >= expectedOpenMs)
    return unknownOutcome({
      signal,
      plan,
      reason: "EXIT_WINDOW_DATA_INCOMPLETE",
      entrySimulatorOutcome: entry.fill.simulator_outcome,
      entry: entry.fill,
    });
  return baseOutcome(signal, plan, {
    status: "OPEN",
    reason: "EXIT_NOT_TOUCHED_BY_EVALUATION_CUTOFF",
    filledAtUtc: entry.fill.event_at_utc,
    entryPrice: entry.fill.price,
    entrySimulatorOutcome: entry.fill.simulator_outcome,
  });
}

function closedOutcome({ signal, plan, entry, exit }) {
  const status = exit.exit_reason === "target" ? "TARGET_HIT" : "STOP_HIT";
  return baseOutcome(signal, plan, {
    status,
    reason: exit.reason,
    filledAtUtc: entry.event_at_utc,
    closedAtUtc: exit.event_at_utc,
    entryPrice: entry.price,
    exitPrice: exit.price,
    rResult: realizedR({
      direction: plan.direction,
      entryPrice: entry.price,
      exitPrice: exit.price,
      stopPrice: plan.stopPrice,
      entry,
      exit,
    }),
    entrySimulatorOutcome: entry.simulator_outcome,
    exitSimulatorOutcome: exit.simulator_outcome,
  });
}

function baseOutcome(signal, plan, values = {}) {
  return {
    schema_version: US_GRAINS_THEORETICAL_REPLAY_VERSION,
    theoretical_engine_version: THEORETICAL_EXECUTION_ENGINE_VERSION,
    signal_id: signal.signal_id || null,
    instrument: plan.instrument || signal.instrument || null,
    direction: plan.direction || null,
    generated_at_utc: iso(signal.generated_at_utc),
    expires_at_utc: iso(signal.expires_at_utc),
    ...executionOutcomeFields(plan, values),
  };
}

function executionOutcomeFields(plan, values) {
  return {
    filled_at_utc: values.filledAtUtc || null,
    closed_at_utc: values.closedAtUtc || null,
    entry_price: values.entryPrice ?? plan.entryPrice ?? null,
    stop_loss: plan.stopPrice ?? null,
    target_price: plan.targetPrice ?? null,
    exit_price: values.exitPrice ?? null,
    status: values.status || "UNKNOWN",
    reason: values.reason || "THEORETICAL_OUTCOME_UNKNOWN",
    ...executionResultFields(values),
  };
}

function executionResultFields(values) {
  return {
    r_result: values.rResult ?? null,
    entry_simulator_outcome: values.entrySimulatorOutcome || null,
    exit_simulator_outcome: values.exitSimulatorOutcome || null,
  };
}

function unknownOutcome({
  signal,
  reason,
  plan = grainTradePlan(signal) || {},
  entrySimulatorOutcome = null,
  exitSimulatorOutcome = null,
  entry = null,
} = {}) {
  return baseOutcome(signal, plan, {
    status: "UNKNOWN",
    reason,
    filledAtUtc: entry?.event_at_utc || null,
    entryPrice: entry?.price ?? null,
    entrySimulatorOutcome,
    exitSimulatorOutcome,
  });
}

function closedM1Rows({ executionRows, generatedAtUtc, evaluation }) {
  const generatedMs = Date.parse(generatedAtUtc || "");
  if (!Number.isFinite(generatedMs)) return [];
  return (Array.isArray(executionRows) ? executionRows : [])
    .map(normalizeClosedM1Row)
    .filter(Boolean)
    .filter(
      (row) => row.openMs >= generatedMs && row.closeMs <= evaluation.cutoffMs,
    )
    .sort((left, right) => left.openMs - right.openMs);
}

function normalizeClosedM1Row(row = {}) {
  const openMs = Date.parse(row.timestamp_utc || row.time || "");
  const prices = [row.open, row.high, row.low, row.close].map(finite);
  if (!closedM1RowShapeIsValid({ row, openMs, prices })) return null;
  const ohlc = normalizedOhlc(prices);
  if (!ohlc) return null;
  return {
    ...row,
    time: new Date(openMs).toISOString(),
    timestamp_utc: new Date(openMs).toISOString(),
    ...ohlc,
    openMs,
    closeMs: openMs + 60_000,
  };
}

function closedM1RowShapeIsValid({ row, openMs, prices }) {
  if (row.is_closed === false || !Number.isFinite(openMs)) return false;
  if (prices.some((value) => value === null)) return false;
  return isM1Timeframe(row.timeframe);
}

function isM1Timeframe(timeframe) {
  return !timeframe || ["1", "M1"].includes(String(timeframe).toUpperCase());
}

function normalizedOhlc([open, high, low, close]) {
  if (!positiveOhlc([open, high, low, close])) return null;
  if (!geometricallyValidOhlc({ open, high, low, close })) return null;
  return { open, high, low, close };
}

function positiveOhlc(values) {
  return values.every((value) => value > 0);
}

function geometricallyValidOhlc({ open, high, low, close }) {
  return (
    high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low
  );
}

function replayEvaluationWindow({ asOfUtc, sessionCloseUtc }) {
  const asOfMs = Date.parse(asOfUtc || "");
  const sessionCloseMs = Date.parse(sessionCloseUtc || "");
  if (!Number.isFinite(asOfMs) || !Number.isFinite(sessionCloseMs)) return null;
  const cutoffMs = Math.min(asOfMs, sessionCloseMs);
  return { cutoffMs, cutoffUtc: new Date(cutoffMs).toISOString() };
}

function entryWindowComplete({ rows, signal, evaluation }) {
  const window = completeEntryWindow({ signal, evaluation });
  if (!window) return false;
  const windowRows = rows.filter(
    (row) => row.openMs >= window.startMs && row.closeMs <= window.expiresAtMs,
  );
  return contiguousWindowRows(windowRows, window);
}

function completeEntryWindow({ signal, evaluation }) {
  const generatedMs = Date.parse(signal.generated_at_utc || "");
  const expiresAtMs = Date.parse(signal.expires_at_utc || "");
  if (
    !validEntryWindowTiming({
      generatedMs,
      expiresAtMs,
      cutoffMs: evaluation.cutoffMs,
    })
  )
    return null;
  const startMs = Math.ceil(generatedMs / 60_000) * 60_000;
  const expectedCount = (expiresAtMs - startMs) / 60_000;
  return Number.isInteger(expectedCount) && expectedCount > 0
    ? { startMs, expiresAtMs, expectedCount }
    : null;
}

function validEntryWindowTiming({ generatedMs, expiresAtMs, cutoffMs }) {
  return (
    Number.isFinite(generatedMs) &&
    Number.isFinite(expiresAtMs) &&
    cutoffMs >= expiresAtMs &&
    expiresAtMs % 60_000 === 0
  );
}

function contiguousWindowRows(rows, window) {
  return (
    rows.length === window.expectedCount &&
    rows.every((row, index) => row.openMs === window.startMs + index * 60_000)
  );
}

function validSignalTiming(signal = {}) {
  const generatedMs = Date.parse(signal.generated_at_utc || "");
  const expiresAtMs = Date.parse(signal.expires_at_utc || "");
  return (
    Number.isFinite(generatedMs) &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > generatedMs
  );
}

function firstEligibleOpenMs(generatedAtUtc) {
  return Math.ceil(Date.parse(generatedAtUtc) / 60_000) * 60_000;
}

function lastClosedM1OpenMs(cutoffMs) {
  return Math.floor(cutoffMs / 60_000) * 60_000 - 60_000;
}

function theoreticalIntent(signal, plan) {
  const expiresAtMs = Date.parse(signal.expires_at_utc || "");
  return {
    expiresAtMs,
    value: {
      order_intent_id: signal.signal_id || null,
      side: plan.direction === "SHORT" ? "sell" : "buy",
      order_type: plan.orderType,
      quantity: plan.quantity,
      limit_price: plan.entryPrice,
      stop_price: plan.orderType === "stop_market" ? plan.entryPrice : null,
      requested_at: signal.generated_at_utc,
      expires_at: signal.expires_at_utc,
      payload: {
        instrument: plan.instrument,
        entry_price: plan.entryPrice,
        limit_price: plan.entryPrice,
      },
    },
  };
}

function theoreticalDecision(signal, plan) {
  return {
    trade_decision_id: signal.signal_id || null,
    instrument_code: plan.instrument,
    entry_plan: { entry_price: plan.entryPrice },
  };
}

function theoreticalContract(plan) {
  return { instrument_code: plan.instrument };
}

function theoreticalTrade({ signal, plan, entry }) {
  return {
    trade_id: signal.signal_id || null,
    order_intent_id: signal.signal_id || null,
    side: plan.direction === "SHORT" ? "short" : "long",
    quantity_open: entry.fill.quantity,
    initial_stop_price: plan.stopPrice,
    current_stop_price: plan.stopPrice,
    current_target_price: plan.targetPrice,
  };
}

function grainTradePlan(signal = {}) {
  const plan = signal.proposed_trade_plan || {};
  const direction = String(
    plan.direction || signal.direction || "",
  ).toUpperCase();
  const orderType = orderTypeForSimulator(
    plan.order_type || signal.setup?.order_type,
  );
  const prices = grainPlanPrices(plan);
  if (
    !["LONG", "SHORT"].includes(direction) ||
    !orderType ||
    Object.values(prices).includes(null)
  )
    return null;
  return {
    instrument: plan.instrument || signal.instrument || null,
    direction,
    orderType,
    ...prices,
    quantity: positive(plan.quantity ?? signal.proposed_size, 1),
  };
}

function grainPlanPrices(plan) {
  const entryPrice = finite(
    firstDefined([
      plan.entry?.calculation_price,
      plan.entry?.price,
      plan.entry_price,
      plan.limit_price,
    ]),
  );
  const stopPrice = finite(
    firstDefined([plan.stop?.price, plan.stop_price, plan.stop_loss]),
  );
  const targetPrice = finite(
    Array.isArray(plan.targets) ? plan.targets[0]?.price : null,
  );
  return { entryPrice, stopPrice, targetPrice };
}

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null);
}

function orderTypeForSimulator(value) {
  return (
    {
      market: "market",
      limit: "limit",
      stop: "stop_market",
      stop_market: "stop_market",
      stop_limit: "stop_limit",
    }[String(value || "").toLowerCase()] || null
  );
}

function realizedR({
  direction,
  entryPrice,
  exitPrice,
  stopPrice,
  entry,
  exit,
}) {
  const risk =
    direction === "LONG" ? entryPrice - stopPrice : stopPrice - entryPrice;
  if (!(risk > 0)) return null;
  const gross =
    direction === "LONG"
      ? (exitPrice - entryPrice) / risk
      : (entryPrice - exitPrice) / risk;
  const commissions =
    Number(entry.simulator_outcome?.fill?.commission_r || 0) +
    Number(exit.simulator_outcome?.fill?.commission_r || 0);
  return round(gross - commissions);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
