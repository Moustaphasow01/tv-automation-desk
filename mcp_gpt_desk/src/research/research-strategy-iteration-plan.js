import {
  RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
  RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION,
  boundedInteger,
  canonicalTaskId,
  percentile,
  requiredText,
  researchStrategyIterationGeneratorSlug,
  roundPrice,
  stableUuid,
  text,
} from "./research-strategy-iteration-common.js";

export function buildResearchStrategyIterationPlan({ task = {}, payload = {}, sourceCandidate = {}, context = {}, nowUtc } = {}) {
  const iterationIndex = boundedInteger(payload.iteration_index ?? payload.iterationIndex, nextIterationIndex(payload), 1, 20);
  const maxVariants = boundedInteger(payload.max_variants ?? payload.maxVariants, 4, 1, 5);
  const generatedAtUtc = stableGeneratedAtUtc({ task, payload, context, nowUtc: requiredText(nowUtc, "nowUtc") });
  const range = adaptiveRange(context.rows || []);
  const variants = candidateVariantSeeds({
    scope: context.scope,
    rows: context.rows || [],
    range,
    iterationIndex,
    maxVariants,
    sourceCandidate,
    payload,
    nowUtc: generatedAtUtc,
  });
  return {
    schema_version: RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION,
    task_id: canonicalTaskId(task),
    source_research_candidate_id: requiredText(payload.research_candidate_id, "research_candidate_id"),
    source_simulation_run_id: text(payload.simulation_run_id, null),
    dataset_id: requiredText(context.dataset?.dataset_id || payload.dataset_id, "dataset_id"),
    dataset_key: requiredText(context.dataset?.dataset_key || payload.dataset_key, "dataset_key"),
    iteration_index: iterationIndex,
    max_variants: maxVariants,
    generated_at_utc: generatedAtUtc,
    variants,
  };
}

function stableGeneratedAtUtc({ task, payload, context, nowUtc }) {
  return text(
    task.created_at_utc
      || task.created_at
      || task.not_before_utc
      || payload.created_at_utc
      || payload.not_before_utc
      || context.dataset?.cutoff_utc,
    nowUtc,
  );
}

export function variantIds({ variantKey, iterationIndex, index, sourceStrategyDefinitionId = null }) {
  const definitionId = text(sourceStrategyDefinitionId, null)
    || stableUuid({ kind: "strategy_definition", variantKey });
  const identityKey = `${definitionId}:${variantKey}`;
  return {
    definitionId,
    versionId: stableUuid({ kind: "strategy_version", identityKey, version: `${iterationIndex}.${index + 1}.0` }),
    instanceId: stableUuid({ kind: "strategy_instance", identityKey, mode: "shadow" }),
    simulationRunId: stableUuid({ kind: "simulation_run", identityKey }),
    candidateId: stableUuid({ kind: "research_candidate", identityKey }),
    reportId: stableUuid({ kind: "research_evaluation_report", identityKey, report_kind: "VALIDATION" }),
  };
}

function candidateVariantSeeds({ scope, rows, range, iterationIndex, maxVariants, sourceCandidate, payload, nowUtc }) {
  return variantCatalog().slice(0, maxVariants).map((item, index) => variantSeed({
    item,
    index,
    scope,
    rows,
    range,
    iterationIndex,
    sourceCandidate,
    payload,
    nowUtc,
  }));
}

function variantCatalog() {
  return [
    { label: "balanced", tolerance: 5, maxBars: 72, risk: 18, targetRr: 2.2, orderType: "LIMIT", offset: 0, openingBars: 6, session: "ny_open" },
    { label: "wide-retest", tolerance: 9, maxBars: 96, risk: 24, targetRr: 2.35, orderType: "LIMIT", offset: 0, openingBars: 6, session: "ny_open" },
    { label: "quick-retest", tolerance: 6, maxBars: 36, risk: 14, targetRr: 2.15, orderType: "LIMIT", offset: 2, openingBars: 4, session: "ny_open" },
    { label: "deep-retest", tolerance: 10, maxBars: 120, risk: 28, targetRr: 2.4, orderType: "LIMIT", offset: -2, openingBars: 12, session: "ny_open" },
    { label: "permissive-momentum", tolerance: 10, maxBars: 144, risk: 22, targetRr: 2.05, orderType: "MARKET", offset: 2, openingBars: 4, session: "asia_open" },
  ];
}

function variantSeed({ item, index, scope, rows, range, iterationIndex, sourceCandidate, payload, nowUtc }) {
  const sourceStrategyDefinitionId = text(
    sourceCandidate.strategy_definition_id || payload.strategy_definition_id || payload.strategyDefinitionId,
    null,
  );
  const variantKey = [
    "demo-paper",
    scope.instrument.toLowerCase(),
    "m5",
    sourceStrategyDefinitionId ? "catalog-preserving" : "standalone",
    "iteration",
    iterationIndex,
    researchStrategyIterationGeneratorSlug(),
    item.label,
    scope.dataset_key,
  ].join(".");
  const ids = variantIds({ variantKey, iterationIndex, index, sourceStrategyDefinitionId });
  return {
    variant_id: variantKey,
    variant_label: item.label,
    strategy_definition_id: ids.definitionId,
    strategy_version_id: ids.versionId,
    strategy_instance_id: ids.instanceId,
    simulation_run_id: ids.simulationRunId,
    research_candidate_id: ids.candidateId,
    research_evaluation_report_id: ids.reportId,
    research_experiment_id: requiredText(sourceCandidate.research_experiment_id, "research_experiment_id"),
    research_hypothesis_id: requiredText(sourceCandidate.research_hypothesis_id, "research_hypothesis_id"),
    source_research_candidate_id: requiredText(sourceCandidate.research_candidate_id, "research_candidate_id"),
    dataset_key: scope.dataset_key,
    iteration_index: iterationIndex,
    created_at_utc: nowUtc,
    parameters: parameters(item),
    levels: directionalPair(range, item),
    runtime_setups: dailyRuntimeSetups({ rows, scope, item, variantLabel: item.label }),
    primary_change_summary: `Itération ${iterationIndex} ${item.label}: tolérance ${item.tolerance} pts, attente retest ${item.maxBars} bougies, risque ${item.risk} pts.`,
    metadata: {
      schema_version: RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION,
      generator_version: RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
      generated_at_utc: nowUtc,
      parent_research_candidate_id: sourceCandidate.research_candidate_id,
      parent_simulation_run_id: payload.simulation_run_id || null,
      source_strategy_definition_id: sourceStrategyDefinitionId,
      variant_key: variantKey,
    },
  };
}

function directionalPair(range, item) {
  return {
    long: directionalLevels({ direction: "long", level: roundPrice(range.high + item.offset), range, item }),
    short: directionalLevels({ direction: "short", level: roundPrice(range.low - item.offset), range, item }),
  };
}

function directionalLevels({ direction, level, range, item }) {
  const tolerance = item.tolerance;
  if (direction === "long") {
    const entryBoundary = roundPrice(level + Math.max(1, tolerance / 2));
    const stopLoss = roundPrice(level - item.risk);
    const riskPoints = Math.abs(entryBoundary - stopLoss);
    return {
      direction,
      break_level: level,
      retest_level: level,
      entry_zone: { lower: roundPrice(level - tolerance), upper: entryBoundary },
      stop_loss: stopLoss,
      take_profit_1: roundPrice(entryBoundary + riskPoints * item.targetRr),
      invalidation_level: roundPrice(range.low - Math.max(8, tolerance)),
      tolerance_points: tolerance,
      max_bars: item.maxBars,
      rr_minimum: 2,
      order_type: item.orderType,
    };
  }
  const entryBoundary = roundPrice(level - Math.max(1, tolerance / 2));
  const stopLoss = roundPrice(level + item.risk);
  const riskPoints = Math.abs(stopLoss - entryBoundary);
  return {
    direction,
    break_level: level,
    retest_level: level,
    entry_zone: { lower: entryBoundary, upper: roundPrice(level + tolerance) },
    stop_loss: stopLoss,
    take_profit_1: roundPrice(entryBoundary - riskPoints * item.targetRr),
    invalidation_level: roundPrice(range.high + Math.max(8, tolerance)),
    tolerance_points: tolerance,
    max_bars: item.maxBars,
    rr_minimum: 2,
    order_type: item.orderType,
  };
}

function parameters(item) {
  return {
    tolerance_points: item.tolerance,
    max_bars: item.maxBars,
    risk_points: item.risk,
    target_rr: item.targetRr,
    rr_minimum: 2,
    order_type: item.orderType,
    break_offset_points: item.offset,
    opening_range_bars: item.openingBars,
    research_session: item.session,
  };
}

function adaptiveRange(rows) {
  const dayRanges = groupedDayRanges(rows);
  const firstRows = rows.slice(0, 36);
  return {
    high: roundPrice(percentile(dayRanges.map((item) => item.high), 0.55) ?? Math.max(...firstRows.map((row) => row.high))),
    low: roundPrice(percentile(dayRanges.map((item) => item.low), 0.45) ?? Math.min(...firstRows.map((row) => row.low))),
  };
}

function groupedDayRanges(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.trading_date || row.time?.slice(0, 10) || "unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.values()]
    .map((items) => items.slice(0, 36))
    .filter((items) => items.length >= 6)
    .map((items) => ({ high: Math.max(...items.map((row) => row.high)), low: Math.min(...items.map((row) => row.low)) }));
}

function dailyRuntimeSetups({ rows, scope, item, variantLabel }) {
  const sessions = groupedDayRows(rows).slice(0, 32);
  const setups = [];
  sessions.forEach(({ tradingDate, rows: dayRows }, dayIndex) => {
    const sessionRows = rowsForResearchSession(dayRows, item.session);
    const openingRows = sessionRows.slice(0, Math.max(4, item.openingBars || 6));
    if (openingRows.length < 4) return;
    const range = {
      high: roundPrice(Math.max(...openingRows.map((row) => row.high))),
      low: roundPrice(Math.min(...openingRows.map((row) => row.low))),
    };
    const validFrom = sessionRows[Math.min(openingRows.length, sessionRows.length - 1)]?.time || sessionRows[0]?.time;
    const expiresAt = sessionRows.at(-1)?.time || validFrom;
    setups.push(runtimeSetup({
      templateId: `${variantLabel}_long_retest`,
      setupId: `${safeId(variantLabel)}_${tradingDate}_long_retest`,
      rank: dayIndex * 2 + 1,
      instrument: scope.instrument,
      tradingDate,
      session: item.session,
      validFrom,
      expiresAt,
      levels: directionalLevels({ direction: "long", level: roundPrice(range.high + item.offset), range, item }),
    }));
    setups.push(runtimeSetup({
      templateId: `${variantLabel}_short_retest`,
      setupId: `${safeId(variantLabel)}_${tradingDate}_short_retest`,
      rank: dayIndex * 2 + 2,
      instrument: scope.instrument,
      tradingDate,
      session: item.session,
      validFrom,
      expiresAt,
      levels: directionalLevels({ direction: "short", level: roundPrice(range.low - item.offset), range, item }),
    }));
  });
  return setups;
}

function rowsForResearchSession(dayRows, session) {
  const window = sessionWindow(session);
  const sessionRows = dayRows.filter((row) => rowInParisWindow(row, window));
  return sessionRows.length >= 12 ? sessionRows : dayRows;
}

function sessionWindow(session) {
  if (session === "asia_open") return { start: "09:15", end: "14:45" };
  return { start: "15:30", end: "22:55" };
}

function rowInParisWindow(row, window) {
  const minute = parisMinuteOfDay(row);
  return minute >= minuteOfDay(window.start) && minute <= minuteOfDay(window.end);
}

function parisMinuteOfDay(row) {
  const source = text(row.timestamp_paris || row.time);
  const match = source.match(/T(\d{2}):(\d{2})/);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteOfDay(value) {
  const [hours, minutes] = String(value).split(":").map((item) => Number(item));
  return hours * 60 + minutes;
}

function groupedDayRows(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const tradingDate = row.trading_date || row.time?.slice(0, 10);
    if (!tradingDate || !Number.isFinite(row.high) || !Number.isFinite(row.low)) continue;
    if (!grouped.has(tradingDate)) grouped.set(tradingDate, []);
    grouped.get(tradingDate).push(row);
  }
  return [...grouped.entries()]
    .map(([tradingDate, dayRows]) => ({
      tradingDate,
      rows: [...dayRows].sort((left, right) => String(left.time || "").localeCompare(String(right.time || ""))),
    }))
    .filter((item) => item.rows.length >= 12)
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate));
}

function runtimeSetup({ templateId, setupId, rank, instrument, tradingDate, session, validFrom, expiresAt, levels }) {
  return {
    template_id: templateId,
    setup_id: setupId,
    rank,
    instrument,
    trading_date: tradingDate,
    trading_session: session,
    valid_from_paris: validFrom,
    expires_at_paris: expiresAt,
    ...levels,
  };
}

function safeId(value) {
  return String(value || "variant").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "variant";
}

function nextIterationIndex(payload) {
  return boundedInteger(payload.parent_iteration_index ?? payload.iteration_index, 0, 0, 20) + 1;
}
