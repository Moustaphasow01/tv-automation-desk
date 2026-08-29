import { canonicalSha256 } from "./execution-scope.js";

export const PORTFOLIO_RISK_BUDGET_SCHEMA_VERSION_V1 = "portfolio_risk_budget_v1";
export const PORTFOLIO_RISK_BUDGET_EVALUATION_SCHEMA_VERSION_V1 = "portfolio_risk_budget_evaluation_v1";
export const PORTFOLIO_RISK_BUDGET_STATUSES_V1 = Object.freeze(["PASS", "REDUCE", "BLOCK", "CONFIG_MISSING"]);
export const DEFAULT_PORTFOLIO_CORRELATION_GROUPS_V1 = Object.freeze({
  equity_index: Object.freeze(["MES", "ES", "MNQ", "NQ", "MYM", "YM", "M2K", "RTY"]),
  energy_crude: Object.freeze(["MCL", "CL"]),
  metals: Object.freeze(["MGC", "GC", "SIL", "SI"]),
  grains: Object.freeze(["ZC", "ZW", "ZS", "KE"]),
});

export function normalizePortfolioRiskBudgetV1(input = {}) {
  const budget = {
    schema_version: PORTFOLIO_RISK_BUDGET_SCHEMA_VERSION_V1,
    budget_id: text(firstDefined(input.budget_id, input.id, "portfolio-risk-budget")),
    max_portfolio_abs_size: positiveOrNull(firstDefined(input.max_portfolio_abs_size, input.maxPortfolioAbsSize)),
    max_daily_loss_r: positiveOrNull(firstDefined(input.max_daily_loss_r, input.maxDailyLossR)),
    max_weekly_loss_r: positiveOrNull(firstDefined(input.max_weekly_loss_r, input.maxWeeklyLossR)),
    max_account_abs_size: numericMap(input.max_account_abs_size),
    max_instrument_abs_size: numericMap(input.max_instrument_abs_size, upper),
    max_strategy_abs_size: numericMap(input.max_strategy_abs_size),
    max_correlation_group_abs_size: numericMap(input.max_correlation_group_abs_size),
    correlation_groups: normalizeCorrelationGroups(input.correlation_groups),
    metadata: record(input.metadata) || {},
  };
  return { ...budget, budget_hash: hash(budget) };
}

export function evaluatePortfolioRiskBudgetV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const budget = normalizePortfolioRiskBudgetV1(firstDefined(input.budget, input.risk_budget, {}));
  const allocations = array(firstDefined(input.candidate_allocations, input.allocations));
  const portfolio = record(input.virtual_portfolio) || {};
  const portfolioAvailable = Boolean(record(input.virtual_portfolio));
  const accountCapitalReference = normalizeAccountCapitalReference(firstDefined(input.account_capital_reference, input.accountCapitalReference, budget.metadata?.account_capital_reference, budget.metadata?.accountCapitalReference));
  const accountId = text(firstDefined(input.account_id, input.accountId, "default"));
  const usage = buildUsageSnapshot(portfolio, allocations, budget.correlation_groups, accountId);
  const evaluations = allocations.map((allocation) => evaluateAllocation(allocation, budget, usage, accountId, { accountCapitalReference, portfolioAvailable }));
  const missing = budgetHasNoLimits(budget);
  const base = {
    schema_version: PORTFOLIO_RISK_BUDGET_EVALUATION_SCHEMA_VERSION_V1,
    status: missing ? "CONFIG_MISSING" : aggregateStatus(evaluations),
    as_of_utc: asOf,
    account_id: accountId,
    budget,
    usage,
    account_capital_reference: accountCapitalReference,
    allocation_evaluations: missing ? [] : evaluations,
    gate: gateSummary(missing, evaluations),
  };
  return { ...base, evaluation_hash: hash(base) };
}

function evaluateAllocation(allocation, budget, usage, accountId, context = {}) {
  const instrument = upper(allocation.instrument);
  const allocationAccountId = text(firstDefined(allocation.account_id, allocation.accountId, accountId));
  const proposed = positiveOrNull(allocation.proposed_size) || 0;
  const group = correlationGroup(instrument, budget.correlation_groups);
  const checks = [
    limitCheck("PORTFOLIO_ABS_SIZE", usage.portfolio.open_abs_size, proposed, budget.max_portfolio_abs_size, "portfolio"),
    limitCheck("ACCOUNT_ABS_SIZE", usage.accounts[allocationAccountId] || 0, proposed, budget.max_account_abs_size[allocationAccountId], allocationAccountId),
    limitCheck("INSTRUMENT_ABS_SIZE", usage.instruments[instrument] || 0, proposed, budget.max_instrument_abs_size[instrument], instrument),
    limitCheck("CORRELATION_GROUP_ABS_SIZE", usage.correlation_groups[group] || 0, proposed, budget.max_correlation_group_abs_size[group], group),
    ...strategyChecks(allocation, usage, budget),
    lossCheck("DAILY_LOSS_R", usage.portfolio.total_r, budget.max_daily_loss_r),
    lossCheck("WEEKLY_LOSS_R", usage.portfolio.weekly_r, budget.max_weekly_loss_r),
  ].filter(Boolean);
  const status = allocationStatus(checks);
  const approvedSize = status === "BLOCK" ? 0 : Math.min(proposed, availableSize(checks, proposed));
  const base = {
    candidate_allocation_id: allocation.id || "",
    account_id: allocationAccountId,
    instrument,
    requested_size: proposed,
    approved_size: round(approvedSize),
    status,
    decision: riskDecision(status),
    reason_codes: checks.filter((item) => item.breached).map((item) => item.code),
    limit_checks: checks,
    limits_applied: checks.filter((item) => item.breached).map((item) => item.code),
  };
  const economics = buildRiskEconomics({
    allocation,
    base,
    approvedSize,
    checks,
    usage,
    accountCapitalReference: context.accountCapitalReference,
    portfolioAvailable: context.portfolioAvailable,
    group,
  });
  return { risk_decision_id: `portfoliorisk:${canonicalSha256({ ...base, risk_economics: economics }).slice(0, 24)}`, ...base, ...economics };
}

function strategyChecks(allocation, usage, budget) {
  return array(allocation.contributing_signals).map((signal) => {
    const id = text(signal.strategy_instance_id);
    const current = usage.strategies[id] || 0;
    const proposed = Math.abs(Number(signal.proposed_size || 0));
    return limitCheck("STRATEGY_ABS_SIZE", current, proposed, budget.max_strategy_abs_size[id], id);
  }).filter(Boolean);
}

function buildUsageSnapshot(portfolio, allocations, groups, accountId) {
  const rows = array(portfolio.by_strategy_instance);
  const positions = array(portfolio.positions);
  return {
    portfolio: {
      open_abs_size: numberAt(portfolio, ["totals", "open_abs_size"]),
      total_r: numberAt(portfolio, ["totals", "total_r"]),
      weekly_r: numberAt(portfolio, ["totals", "weekly_r"]),
    },
    accounts: accountExposure(positions, allocations, accountId, portfolio),
    instruments: instrumentExposure(positions, allocations),
    strategies: Object.fromEntries(rows.map((row) => [text(row.strategy_instance_id), Math.abs(Number(row.open_signed_size || 0))])),
    correlation_groups: correlationExposure(positions, allocations, groups),
  };
}

function accountExposure(positions, allocations, defaultAccountId, portfolio) {
  const exposure = {};
  for (const position of positions) {
    addExposure(exposure, text(firstDefined(position.account_id, position.accountId, defaultAccountId)), Math.abs(Number(position.signed_size || position.open_signed_size || 0)));
  }
  for (const allocation of allocations) {
    const accountId = text(firstDefined(allocation.account_id, allocation.accountId, defaultAccountId));
    if (!(accountId in exposure)) exposure[accountId] = 0;
  }
  if (!Object.keys(exposure).length) exposure[text(defaultAccountId)] = numberAt(portfolio, ["totals", "open_abs_size"]);
  return exposure;
}

function instrumentExposure(positions, allocations) {
  const exposure = {};
  for (const position of positions) addExposure(exposure, upper(position.instrument), Math.abs(Number(position.signed_size || 0)));
  for (const allocation of allocations) addExposure(exposure, upper(allocation.instrument), 0);
  return exposure;
}

function correlationExposure(positions, allocations, groups) {
  const exposure = {};
  for (const position of positions) addExposure(exposure, correlationGroup(upper(position.instrument), groups), Math.abs(Number(position.signed_size || 0)));
  for (const allocation of allocations) addExposure(exposure, correlationGroup(upper(allocation.instrument), groups), 0);
  return exposure;
}

function limitCheck(code, current, proposed, limit, scope) {
  if (limit === null || limit === undefined) return null;
  const projected = round(Number(current || 0) + Number(proposed || 0));
  return {
    code,
    scope,
    current: round(current),
    proposed: round(proposed),
    projected,
    limit,
    available: round(limit - Number(current || 0)),
    breached: projected > limit,
  };
}

function lossCheck(code, currentR, maxLossR) {
  if (maxLossR === null || maxLossR === undefined) return null;
  const loss = Math.abs(Math.min(0, Number(currentR || 0)));
  return { code, scope: "portfolio", current: round(currentR), proposed: 0, projected: round(loss), limit: maxLossR, available: round(maxLossR - loss), breached: loss >= maxLossR };
}

function buildRiskEconomics({ allocation, base, approvedSize, checks, usage, accountCapitalReference, portfolioAvailable, group }) {
  const tradeRisk = allocationTradeRisk(allocation, approvedSize);
  const requestedRiskAmount = moneyMultiply(tradeRisk.risk_per_contract, base.requested_size);
  const authorizedRiskAmount = moneyMultiply(tradeRisk.risk_per_contract, approvedSize);
  const capitalValue = finite(accountCapitalReference?.value);
  const limits = checks.map(limitProjection);
  const nearestLimit = nearestLimitProjection(limits);
  const beforeOpenSize = numberAt(usage, ["portfolio", "open_abs_size"]);
  const beforeInstrumentSize = numberAt(usage, ["instruments", base.instrument]);
  const beforeGroupSize = numberAt(usage, ["correlation_groups", group]);
  const sourceState = portfolioAvailable ? "KNOWN" : "UNAVAILABLE";
  const riskEconomics = {
    schema_version: "global_risk_economics_v1",
    availability: tradeRisk.availability === "KNOWN" ? "KNOWN" : "PARTIAL",
    account_capital_reference: accountCapitalReference,
    requested: {
      quantity: base.requested_size,
      risk_pct: pctOf(requestedRiskAmount, capitalValue),
      risk_amount: requestedRiskAmount,
      currency: tradeRisk.currency,
      availability: tradeRisk.availability,
    },
    authorized: {
      quantity: round(approvedSize),
      risk_pct: pctOf(authorizedRiskAmount, capitalValue),
      risk_amount: authorizedRiskAmount,
      currency: tradeRisk.currency,
      availability: tradeRisk.availability,
    },
    trade_risk: tradeRisk,
    portfolio_before: {
      availability: sourceState,
      gross_exposure: metricNode(beforeOpenSize, "CONTRACTS", sourceState),
      net_exposure: metricNode(beforeOpenSize, "CONTRACTS", sourceState),
      instrument_exposure: metricNode(beforeInstrumentSize, "CONTRACTS", sourceState),
      correlation_group_exposure: metricNode(beforeGroupSize, "CONTRACTS", sourceState),
      open_risk: unavailableMetric("open_risk"),
      margin_used: unavailableMetric("margin_used"),
      daily_loss_used: metricNode(numberAt(usage, ["portfolio", "total_r"]), "R", sourceState),
      trailing_drawdown_used: unavailableMetric("trailing_drawdown_used"),
    },
    portfolio_after: {
      availability: sourceState,
      gross_exposure: metricNode(round(beforeOpenSize + round(approvedSize)), "CONTRACTS", sourceState),
      net_exposure: metricNode(round(beforeOpenSize + round(approvedSize)), "CONTRACTS", sourceState),
      instrument_exposure: metricNode(round(beforeInstrumentSize + round(approvedSize)), "CONTRACTS", sourceState),
      open_risk: authorizedRiskAmount === null ? unavailableMetric("open_risk") : { availability: "KNOWN", value: authorizedRiskAmount, unit: tradeRisk.currency },
      margin_used: unavailableMetric("margin_used"),
    },
    limits,
    nearest_limit: nearestLimit,
    breaches: limits.filter((item) => item.breached),
    reason_codes: base.reason_codes,
    risk_rule_set_version: text(firstDefined(allocation.risk_rule_set_version, allocation.policy_version)),
  };
  return {
    account_capital_reference: accountCapitalReference,
    requested: riskEconomics.requested,
    authorized: riskEconomics.authorized,
    trade_risk: tradeRisk,
    portfolio_before: riskEconomics.portfolio_before,
    portfolio_after: riskEconomics.portfolio_after,
    limits,
    nearest_limit: nearestLimit,
    breaches: riskEconomics.breaches,
    risk_economics: { ...riskEconomics, economics_hash: hash(riskEconomics) },
  };
}

function allocationTradeRisk(allocation, approvedSize) {
  const signals = array(allocation.contributing_signals);
  const tradeRisks = signals.map((item) => record(firstDefined(item.trade_plan_economics, item.tradePlanEconomics, item.proposed_trade_plan?.economics, item.proposedTradePlan?.economics))).filter(Boolean);
  const known = tradeRisks.filter((item) => item.availability === "KNOWN");
  const selected = known[0] || tradeRisks[0] || null;
  if (!selected) {
    return {
      availability: "UNAVAILABLE",
      reason_codes: ["TRADE_PLAN_ECONOMICS_UNAVAILABLE"],
      entry_price: null,
      stop_price: null,
      stop_distance_points: null,
      stop_distance_ticks: null,
      tick_size: null,
      tick_value: null,
      currency: "UNAVAILABLE",
      risk_per_contract: null,
      total_authorized_risk: null,
      expected_loss: null,
      signal_count: signals.length,
    };
  }
  const riskPerContract = finite(selected.risk_per_contract);
  const totalAuthorizedRisk = moneyMultiply(riskPerContract, approvedSize);
  return {
    availability: known.length === 1 && tradeRisks.length === 1 ? "KNOWN" : "PARTIAL",
    reason_codes: array(selected.reason_codes),
    entry_price: finite(selected.entry_price),
    stop_price: finite(selected.stop_price),
    stop_distance_points: finite(selected.stop_distance_points),
    stop_distance_ticks: finite(selected.stop_distance_ticks),
    tick_size: finite(selected.tick_size),
    tick_value: finite(selected.tick_value),
    currency: text(selected.currency || "UNAVAILABLE"),
    risk_per_contract: riskPerContract,
    total_authorized_risk: totalAuthorizedRisk,
    expected_loss: totalAuthorizedRisk,
    target_risks: array(selected.targets),
    signal_count: signals.length,
  };
}

function normalizeAccountCapitalReference(value) {
  const source = record(value) || {};
  const capital = finite(firstDefined(source.value, source.equity, source.capital, source.net_liquidation_value, source.netLiquidationValue));
  if (capital === null) {
    return {
      availability: "UNAVAILABLE",
      source: text(firstDefined(source.source, "ACCOUNT_CAPITAL_REFERENCE_UNAVAILABLE")),
      value: null,
      currency: text(firstDefined(source.currency, "UNAVAILABLE")),
      as_of_utc: iso(firstDefined(source.as_of_utc, source.asOfUtc, source.captured_at)),
    };
  }
  return {
    availability: "KNOWN",
    source: text(firstDefined(source.source, "ACCOUNT_SNAPSHOT")),
    value: capital,
    currency: text(firstDefined(source.currency, "USD")),
    as_of_utc: iso(firstDefined(source.as_of_utc, source.asOfUtc, source.captured_at)),
  };
}

function limitProjection(check) {
  const utilization = check.limit > 0 ? round(check.current / check.limit) : null;
  const resulting = check.limit > 0 ? round(check.projected / check.limit) : null;
  return {
    limit_id: `${check.code}:${check.scope}`,
    type: check.code,
    scope: check.scope,
    value: check.limit,
    unit: check.code.includes("LOSS_R") ? "R" : "CONTRACTS",
    current_utilization: utilization,
    resulting_utilization: resulting,
    remaining: round(check.available),
    breached: check.breached,
    severity: check.breached ? check.available <= 0 ? "BLOCK" : "REDUCE" : "INFO",
  };
}

function nearestLimitProjection(limits) {
  const ranked = limits.filter((item) => item.resulting_utilization !== null).sort((left, right) => right.resulting_utilization - left.resulting_utilization);
  const first = ranked[0];
  if (!first) return { availability: "UNAVAILABLE", reason_code: "NO_LIMIT_UTILIZATION_AVAILABLE" };
  return { availability: "KNOWN", type: first.type, utilization: first.resulting_utilization, remaining: first.remaining, severity: first.severity };
}

function metricNode(value, unit, availability = "KNOWN") {
  return availability === "KNOWN" ? { availability, value: round(value), unit } : { availability, value: null, unit, reason_code: "SOURCE_UNAVAILABLE" };
}

function unavailableMetric(kind) {
  return { availability: "UNAVAILABLE", value: null, unit: "UNAVAILABLE", reason_code: `${kind.toUpperCase()}_UNAVAILABLE` };
}

function moneyMultiply(unitValue, quantity) {
  return unitValue === null || unitValue === undefined ? null : Math.round(Number(unitValue) * Number(quantity || 0) * 100) / 100;
}

function pctOf(amount, capital) {
  if (amount === null || capital === null || capital <= 0) return null;
  return round((amount / capital) * 100);
}

function allocationStatus(checks) {
  if (checks.some((item) => item.breached && item.available <= 0)) return "BLOCK";
  if (checks.some((item) => item.breached)) return "REDUCE";
  return "PASS";
}

function availableSize(checks, fallback) {
  const values = checks.filter((item) => item.limit !== null && item.proposed > 0).map((item) => item.available);
  if (!values.length) return fallback;
  return Math.max(0, Math.min(...values));
}

function aggregateStatus(evaluations) {
  if (!evaluations.length) return "PASS";
  if (evaluations.some((item) => item.status === "BLOCK")) return "BLOCK";
  if (evaluations.some((item) => item.status === "REDUCE")) return "REDUCE";
  return "PASS";
}
function riskDecision(status) {
  if (status === "PASS") return "APPROVED";
  if (status === "REDUCE") return "REDUCED";
  return "REJECTED";
}

function gateSummary(missing, evaluations) {
  if (missing) return { pass: false, reason: "CONFIG_MISSING" };
  const status = aggregateStatus(evaluations);
  return { pass: status === "PASS", reason: status };
}

function budgetHasNoLimits(budget) {
  return [
    budget.max_portfolio_abs_size,
    budget.max_daily_loss_r,
    budget.max_weekly_loss_r,
    ...Object.values(budget.max_account_abs_size),
    ...Object.values(budget.max_instrument_abs_size),
    ...Object.values(budget.max_strategy_abs_size),
    ...Object.values(budget.max_correlation_group_abs_size),
  ].every((value) => value === null || value === undefined);
}

function normalizeCorrelationGroups(input) {
  const source = record(input) || DEFAULT_PORTFOLIO_CORRELATION_GROUPS_V1;
  return Object.fromEntries(Object.entries(source).map(([group, symbols]) => [group, array(symbols).map(upper)]));
}

function correlationGroup(instrument, groups) {
  const compact = upper(instrument).replace("CME_MINI:", "").replace("NYMEX:", "").replace("!", "");
  for (const [group, symbols] of Object.entries(groups)) {
    if (symbols.some((symbol) => compact.startsWith(symbol))) return group;
  }
  return "single_name";
}

function numericMap(value, keyMapper = text) {
  const source = record(value) || {};
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [keyMapper(key), positiveOrNull(item)]).filter((entry) => entry[1] !== null));
}

function addExposure(target, key, value) { target[key] = round((target[key] || 0) + Number(value || 0)); }
function numberAt(source, path) { return path.reduce((value, key) => record(value)?.[key], source) ?? 0; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function positiveOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
