import { canonicalSha256 } from "./execution-scope.js";
import { currency, hasMonetaryLossCaps, moneyAdd, monetaryLossChecks, monetaryLossUsageAvailable, normalizeMonetaryLossUsage, normalizeMonetaryRiskScope, PORTFOLIO_MONETARY_RISK_SCOPES_V1 } from "./portfolio-monetary-risk-v1.js";
export { PORTFOLIO_MONETARY_RISK_SCOPES_V1 } from "./portfolio-monetary-risk-v1.js";
export const PORTFOLIO_RISK_BUDGET_SCHEMA_VERSION_V1 = "portfolio_risk_budget_v1";
export const PORTFOLIO_RISK_BUDGET_EVALUATION_SCHEMA_VERSION_V1 = "portfolio_risk_budget_evaluation_v1";
export const PORTFOLIO_RISK_BUDGET_STATUSES_V1 = Object.freeze(["PASS", "REDUCE", "BLOCK", "CONFIG_MISSING"]);
export const PORTFOLIO_RISK_SIZING_MODES_V1 = Object.freeze(["REQUESTED_QUANTITY_CAP", "MONETARY_RISK_BUDGET"]);
export const DEFAULT_PORTFOLIO_CORRELATION_GROUPS_V1 = Object.freeze({
  equity_index: Object.freeze(["MES", "ES", "MNQ", "NQ", "MYM", "YM", "M2K", "RTY"]),
  energy_crude: Object.freeze(["MCL", "CL"]),
  metals: Object.freeze(["MGC", "GC", "SIL", "SI"]),
  grains: Object.freeze(["ZC", "ZW", "ZS", "KE"]),
});
export function normalizePortfolioRiskBudgetV1(input = {}) {
  const contractLimits = normalizeContractLimits(input);
  const dailyLoss = nonNegativeLimit(firstDefined(input.max_daily_loss_r, input.maxDailyLossR));
  const weeklyLoss = nonNegativeLimit(firstDefined(input.max_weekly_loss_r, input.maxWeeklyLossR));
  const monetaryRisk = nonNegativeLimit(firstDefined(input.max_monetary_risk, input.maxMonetaryRisk, input.monetary_risk_budget, input.monetaryRiskBudget));
  const dailyMonetaryLoss = nonNegativeLimit(firstDefined(input.max_daily_loss_monetary, input.maxDailyLossMonetary));
  const weeklyMonetaryLoss = nonNegativeLimit(firstDefined(input.max_weekly_loss_monetary, input.maxWeeklyLossMonetary));
  const budget = {
    schema_version: PORTFOLIO_RISK_BUDGET_SCHEMA_VERSION_V1,
    budget_id: text(firstDefined(input.budget_id, input.id, "portfolio-risk-budget")),
    max_portfolio_abs_size: contractLimits.portfolio.value,
    max_daily_loss_r: dailyLoss.value,
    max_weekly_loss_r: weeklyLoss.value,
    max_monetary_risk: monetaryRisk.value,
    max_monetary_risk_currency: currency(firstDefined(input.max_monetary_risk_currency, input.maxMonetaryRiskCurrency, input.monetary_risk_currency, input.monetaryRiskCurrency)),
    max_daily_loss_monetary: dailyMonetaryLoss.value,
    max_weekly_loss_monetary: weeklyMonetaryLoss.value,
    loss_currency: currency(firstDefined(input.loss_currency, input.lossCurrency)),
    monetary_risk_scope: normalizeMonetaryRiskScope(firstDefined(input.monetary_risk_scope, input.monetaryRiskScope)),
    sizing_mode: normalizeSizingMode(firstDefined(input.sizing_mode, input.sizingMode)),
    max_account_abs_size: contractLimits.accounts.values,
    max_instrument_abs_size: contractLimits.instruments.values,
    max_strategy_abs_size: contractLimits.strategies.values,
    max_correlation_group_abs_size: contractLimits.correlationGroups.values,
    correlation_groups: normalizeCorrelationGroups(input.correlation_groups),
    metadata: record(input.metadata) || {},
    configuration_issues: [
      ...contractLimits.issues,
      ...(dailyLoss.invalid ? ["MAX_DAILY_LOSS_R_INVALID"] : []),
      ...(weeklyLoss.invalid ? ["MAX_WEEKLY_LOSS_R_INVALID"] : []),
      ...(monetaryRisk.invalid ? ["MAX_MONETARY_RISK_INVALID"] : []),
      ...(dailyMonetaryLoss.invalid ? ["MAX_DAILY_LOSS_MONETARY_INVALID"] : []),
      ...(weeklyMonetaryLoss.invalid ? ["MAX_WEEKLY_LOSS_MONETARY_INVALID"] : []),
    ],
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
  const usage = buildUsageSnapshot({ portfolio, allocations, groups: budget.correlation_groups, accountId, lossUsage: input.loss_usage || input.lossUsage });
  const evaluations = evaluateAllocationsSequentially({ allocations, budget, initialUsage: usage, accountId, context: { accountCapitalReference, portfolioAvailable } });
  const missing = budgetConfigurationMissing(budget);
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
function evaluateAllocationsSequentially({ allocations, budget, initialUsage, accountId, context }) {
  let usage = cloneUsage(initialUsage);
  return allocations.slice().sort(allocationOrder).map((allocation) => {
    const evaluation = evaluateAllocation(allocation, budget, usage, accountId, context);
    usage = reserveApprovedAllocation({ usage, allocation, approvedSize: evaluation.approved_size, approvedMonetaryRisk: evaluation.sizing.authorized_monetary_risk, groups: budget.correlation_groups, defaultAccountId: accountId });
    return evaluation;
  });
}
function reserveApprovedAllocation({ usage, allocation, approvedSize, approvedMonetaryRisk, groups, defaultAccountId }) {
  const approved = Number(approvedSize || 0);
  if (!(approved > 0)) return usage;
  const accountId = text(firstDefined(allocation.account_id, allocation.accountId, defaultAccountId));
  const instrument = upper(allocation.instrument);
  const next = cloneUsage(usage);
  next.portfolio.open_abs_size = round(next.portfolio.open_abs_size + approved);
  next.accounts[accountId] = round((next.accounts[accountId] || 0) + approved);
  next.instruments[instrument] = round((next.instruments[instrument] || 0) + approved);
  const group = correlationGroup(instrument, groups);
  next.correlation_groups[group] = round((next.correlation_groups[group] || 0) + approved);
  for (const id of new Set(array(allocation.contributing_signals)
    .map((signal) => text(signal.strategy_instance_id)).filter(Boolean))) {
    if (id) next.strategies[id] = round((next.strategies[id] || 0) + approved);
  }
  if (finite(approvedMonetaryRisk) > 0) next.portfolio.reserved_monetary_risk = moneyAdd(next.portfolio.reserved_monetary_risk, approvedMonetaryRisk);
  return next;
}
function cloneUsage(usage) {
  return {
    portfolio: { ...usage.portfolio }, accounts: { ...usage.accounts }, instruments: { ...usage.instruments },
    strategies: { ...usage.strategies }, correlation_groups: { ...usage.correlation_groups },
  };
}
function allocationOrder(left, right) {
  return `${text(left.account_id)}:${upper(left.instrument)}:${text(left.id)}`
    .localeCompare(`${text(right.account_id)}:${upper(right.instrument)}:${text(right.id)}`);
}
function evaluateAllocation(allocation, budget, usage, accountId, context = {}) {
  const instrument = upper(allocation.instrument);
  const allocationAccountId = text(firstDefined(allocation.account_id, allocation.accountId, accountId));
  const requested = requestedQuantity(allocation.proposed_size);
  let sizing = authorizedSizing(allocation, budget, requested, usage);
  const proposed = sizing.quantity;
  const group = correlationGroup(instrument, budget.correlation_groups);
  let checks = [
    limitCheck("PORTFOLIO_ABS_SIZE", usage.portfolio.open_abs_size, proposed, budget.max_portfolio_abs_size, "portfolio"),
    limitCheck("ACCOUNT_ABS_SIZE", usage.accounts[allocationAccountId] || 0, proposed, budget.max_account_abs_size[allocationAccountId], allocationAccountId),
    limitCheck("INSTRUMENT_ABS_SIZE", usage.instruments[instrument] || 0, proposed, budget.max_instrument_abs_size[instrument], instrument),
    limitCheck("CORRELATION_GROUP_ABS_SIZE", usage.correlation_groups[group] || 0, proposed, budget.max_correlation_group_abs_size[group], group),
    ...strategyChecks(allocation, usage, budget),
    lossCheck("DAILY_LOSS_R", usage.portfolio.total_r, budget.max_daily_loss_r),
    lossCheck("WEEKLY_LOSS_R", usage.portfolio.weekly_r, budget.max_weekly_loss_r),
    ...monetaryLossChecks(budget, usage, sizing.authorized_monetary_risk),
  ].filter(Boolean);
  const approval = finalizeAllocationApproval({ budget, usage, proposed, checks, sizing });
  checks = approval.checks;
  sizing = approval.sizing;
  const finalApprovedSize = approval.approved_size;
  const status = approval.status;
  const insufficientCapacity = approval.insufficient_capacity;
  const base = {
    candidate_allocation_id: allocation.id || "",
    account_id: allocationAccountId,
    instrument,
    requested_size: requested.raw,
    sized_size: proposed,
    approved_size: round(finalApprovedSize),
    status,
    decision: riskDecision(status),
    reason_codes: [...checks.filter((item) => item.breached).map((item) => item.code), ...(sizing.reason_code ? [sizing.reason_code] : []), ...(insufficientCapacity ? ["INSUFFICIENT_WHOLE_CONTRACT_CAPACITY"] : [])],
    limit_checks: checks,
    limits_applied: checks.filter((item) => item.breached).map((item) => item.code),
    sizing,
  };
  const economics = buildRiskEconomics({
    allocation,
    base,
    approvedSize: finalApprovedSize,
    checks,
    usage,
    accountCapitalReference: context.accountCapitalReference,
    portfolioAvailable: context.portfolioAvailable,
    group,
  });
  return { risk_decision_id: `portfoliorisk:${canonicalSha256({ ...base, risk_economics: economics }).slice(0, 24)}`, ...base, ...economics };
}
function finalizeAllocationApproval({ budget, usage, proposed, checks, sizing }) {
  const limitStatus = allocationStatus(checks);
  const initialStatus = sizing.reason_code || limitStatus === "BLOCK" ? "BLOCK" : sizing.reduced ? "REDUCE" : limitStatus;
  const approvedSize = initialStatus === "BLOCK" ? 0 : Math.min(proposed, availableSize(checks, proposed));
  const insufficientCapacity = initialStatus !== "BLOCK" && proposed > 0 && approvedSize < 1;
  const status = insufficientCapacity ? "BLOCK" : initialStatus;
  const finalApprovedSize = status === "BLOCK" ? 0 : approvedSize;
  const finalSizing = sizing.mode === "MONETARY_RISK_BUDGET" && sizing.risk_per_contract !== null
    ? { ...sizing, authorized_monetary_risk: moneyMultiply(sizing.risk_per_contract, finalApprovedSize) }
    : sizing;
  return {
    checks: [...checks.filter((item) => !item.code.includes("LOSS_MONETARY")), ...monetaryLossChecks(budget, usage, finalSizing.authorized_monetary_risk)],
    sizing: finalSizing, approved_size: finalApprovedSize, status, insufficient_capacity: insufficientCapacity,
  };
}
function authorizedSizing(allocation, budget, requested, usage) {
  if (!requested.valid) return unavailableSizing(requested.quantity, "REQUESTED_QUANTITY_INVALID");
  if (requested.quantity === 0) return requestedSizing(requested.quantity);
  if (budget.sizing_mode !== "MONETARY_RISK_BUDGET") {
    return requestedSizing(requested.quantity);
  }
  if (allocationSizingMode(allocation) !== "MONETARY_RISK_BUDGET")
    return unavailableSizing(requested.quantity, "ALLOCATION_SIZING_MODE_MISMATCH");
  const tradeRisk = allocationTradeRisk(allocation, 1);
  const multiplier = allocationMultiplier(allocation);
  if (budget.max_monetary_risk === null) return unavailableSizing(requested.quantity, "MONETARY_RISK_BUDGET_UNAVAILABLE");
  if (tradeRisk.availability !== "KNOWN" || !(tradeRisk.risk_per_contract > 0)) return unavailableSizing(requested.quantity, "MONETARY_RISK_PER_CONTRACT_UNAVAILABLE");
  if (tradeRisk.currency !== budget.max_monetary_risk_currency) return unavailableSizing(requested.quantity, "MONETARY_RISK_CURRENCY_MISMATCH");
  if (multiplier === null) return unavailableSizing(requested.quantity, "CONTEXT_RISK_MULTIPLIER_UNAVAILABLE");
  const monetaryUsage = monetaryLossUsageAvailable(budget, usage);
  if (!monetaryUsage.available) return unavailableSizing(requested.quantity, monetaryUsage.reason_code);
  const effectiveBudget = Math.min(budget.max_monetary_risk * multiplier, ...monetaryUsage.remaining);
  const quantity = Math.min(requested.quantity, Math.floor(effectiveBudget / tradeRisk.risk_per_contract));
  if (quantity < 1) return { mode: "MONETARY_RISK_BUDGET", quantity: 0, requested_quantity: requested.quantity, reduced: true, reason_code: monetaryUsage.limit_reason_code || "INSUFFICIENT_MIN_CONTRACT", risk_per_contract: tradeRisk.risk_per_contract, context_risk_multiplier: multiplier, effective_monetary_risk_budget: effectiveBudget, authorized_monetary_risk: 0, currency: tradeRisk.currency };
  return { mode: "MONETARY_RISK_BUDGET", quantity, requested_quantity: requested.quantity, reduced: quantity < requested.quantity, reason_code: null, risk_per_contract: tradeRisk.risk_per_contract, context_risk_multiplier: multiplier, effective_monetary_risk_budget: effectiveBudget, authorized_monetary_risk: moneyMultiply(tradeRisk.risk_per_contract, quantity), currency: tradeRisk.currency };
}
function requestedSizing(quantity) {
  return { mode: "REQUESTED_QUANTITY_CAP", quantity, requested_quantity: quantity, reduced: false, reason_code: null, authorized_monetary_risk: null };
}
function unavailableSizing(requested, reasonCode) {
  return { mode: "MONETARY_RISK_BUDGET", quantity: 0, requested_quantity: requested, reduced: true, reason_code: reasonCode, risk_per_contract: null, context_risk_multiplier: null, effective_monetary_risk_budget: null, authorized_monetary_risk: null, currency: "UNAVAILABLE" };
}
function allocationMultiplier(allocation) {
  const values = array(allocation.contributing_signals).map((signal) => finite(signal.context_risk_multiplier));
  if (!values.length || values.some((value) => value === null || value < 0 || value > 1)) return null;
  return Math.min(...values);
}
function strategyChecks(allocation, usage, budget) {
  const proposedByStrategy = {};
  for (const signal of array(allocation.contributing_signals)) {
    const id = text(signal.strategy_instance_id);
    if (id) proposedByStrategy[id] = (proposedByStrategy[id] || 0) + Math.abs(Number(signal.proposed_size || 0));
  }
  return Object.entries(proposedByStrategy)
    .map(([id, proposed]) => limitCheck("STRATEGY_ABS_SIZE", usage.strategies[id] || 0, proposed, budget.max_strategy_abs_size[id], id))
    .filter(Boolean);
}
function buildUsageSnapshot({ portfolio, allocations, groups, accountId, lossUsage }) {
  const rows = array(portfolio.by_strategy_instance);
  const positions = array(portfolio.positions);
  const monetaryLoss = normalizeMonetaryLossUsage(lossUsage);
  return {
    portfolio: {
      open_abs_size: numberAt(portfolio, ["totals", "open_abs_size"]),
      total_r: lossValue(lossUsage, "daily_realized_r", numberAt(portfolio, ["totals", "total_r"])),
      weekly_r: lossValue(lossUsage, "weekly_realized_r", numberAt(portfolio, ["totals", "weekly_r"])),
      daily_loss_monetary: monetaryLoss.daily_loss_monetary,
      weekly_loss_monetary: monetaryLoss.weekly_loss_monetary,
      reserved_monetary_risk: monetaryLoss.reserved_monetary_risk,
      monetary_availability: monetaryLoss.availability,
      monetary_currency: monetaryLoss.currency,
    },
    accounts: accountExposure(positions, allocations, accountId, portfolio),
    instruments: instrumentExposure(positions, allocations),
    strategies: Object.fromEntries(rows.map((row) => [text(row.strategy_instance_id), Math.abs(Number(row.open_signed_size || 0))])),
    correlation_groups: correlationExposure(positions, allocations, groups),
  };
}
function lossValue(lossUsage, key, fallback) {
  if (record(lossUsage)?.availability !== "KNOWN") return fallback;
  const value = finite(lossUsage[key]);
  return value === null ? fallback : value;
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
      daily_loss_monetary: monetaryMetric(usage, "daily_loss_monetary"),
      weekly_loss_monetary: monetaryMetric(usage, "weekly_loss_monetary"),
      reserved_monetary_risk: monetaryMetric(usage, "reserved_monetary_risk"),
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
    availability: signals.length === 1 && known.length === 1 && tradeRisks.length === 1 ? "KNOWN" : "PARTIAL",
    reason_codes: array(selected.reason_codes),
    entry_price: finite(selected.entry_price),
    stop_price: finite(selected.stop_price),
    stop_distance_points: finite(selected.stop_distance_points),
    stop_distance_ticks: finite(selected.stop_distance_ticks),
    tick_size: finite(selected.tick_size),
    tick_value: finite(selected.tick_value),
    currency: currency(selected.currency) || "UNAVAILABLE",
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
    unit: check.unit || (check.code.includes("LOSS_R") ? "R" : "CONTRACTS"),
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
function monetaryMetric(usage, key) {
  const availability = usage.portfolio.monetary_availability;
  return availability === "KNOWN"
    ? metricNode(usage.portfolio[key], usage.portfolio.monetary_currency, availability)
    : unavailableMetric(key);
}

function unavailableMetric(kind) {
  return { availability: "UNAVAILABLE", value: null, unit: "UNAVAILABLE", reason_code: `${kind.toUpperCase()}_UNAVAILABLE` };
}

function moneyMultiply(unitValue, quantity) {
  return unitValue === null || unitValue === undefined ? null : Number(unitValue) * Number(quantity || 0);
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
  const values = checks.filter((item) => item.limit !== null && item.proposed > 0 && !item.code.includes("LOSS")).map((item) => item.available);
  if (!values.length) return fallback;
  return Math.max(0, Math.floor(Math.min(...values)));
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

function budgetConfigurationMissing(budget) {
  if (!PORTFOLIO_RISK_SIZING_MODES_V1.includes(budget.sizing_mode)) return true;
  if (budget.configuration_issues.length) return true;
  if (hasMonetaryConstraints(budget) && budget.sizing_mode !== "MONETARY_RISK_BUDGET") return true;
  if (budget.sizing_mode === "MONETARY_RISK_BUDGET" && (
    budget.max_monetary_risk === null
    || budget.max_monetary_risk_currency === null
    || budget.monetary_risk_scope !== "PER_ALLOCATION"
    || (hasMonetaryLossCaps(budget) && (
      budget.loss_currency === null
      || budget.loss_currency !== budget.max_monetary_risk_currency
    ))
  )) return true;
  return [
    budget.max_portfolio_abs_size,
    budget.max_daily_loss_r,
    budget.max_weekly_loss_r,
    budget.max_monetary_risk,
    budget.max_daily_loss_monetary,
    budget.max_weekly_loss_monetary,
    ...Object.values(budget.max_account_abs_size),
    ...Object.values(budget.max_instrument_abs_size),
    ...Object.values(budget.max_strategy_abs_size),
    ...Object.values(budget.max_correlation_group_abs_size),
  ].every((value) => value === null || value === undefined);
}
function hasMonetaryConstraints(budget) {
  return budget.max_monetary_risk !== null || hasMonetaryLossCaps(budget);
}
function normalizeSizingMode(value) {
  if (value === null || value === undefined || value === "") return "REQUESTED_QUANTITY_CAP";
  const mode = upper(value);
  return PORTFOLIO_RISK_SIZING_MODES_V1.includes(mode) ? mode : "INVALID";
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

function normalizeContractLimits(input) {
  const portfolio = contractLimit(firstDefined(input.max_portfolio_abs_size, input.maxPortfolioAbsSize));
  const accounts = contractLimitMap(input.max_account_abs_size);
  const instruments = contractLimitMap(input.max_instrument_abs_size, upper);
  const strategies = contractLimitMap(input.max_strategy_abs_size);
  const correlationGroups = contractLimitMap(input.max_correlation_group_abs_size);
  return {
    portfolio, accounts, instruments, strategies, correlationGroups,
    issues: [
      ...(portfolio.invalid ? ["MAX_PORTFOLIO_ABS_SIZE_INVALID"] : []),
      ...(accounts.invalid ? ["MAX_ACCOUNT_ABS_SIZE_INVALID"] : []),
      ...(instruments.invalid ? ["MAX_INSTRUMENT_ABS_SIZE_INVALID"] : []),
      ...(strategies.invalid ? ["MAX_STRATEGY_ABS_SIZE_INVALID"] : []),
      ...(correlationGroups.invalid ? ["MAX_CORRELATION_GROUP_ABS_SIZE_INVALID"] : []),
    ],
  };
}

function contractLimitMap(value, keyMapper = text) {
  const source = record(value) || {};
  const entries = Object.entries(source).map(([key, item]) => [keyMapper(key), contractLimit(item)]);
  return {
    values: Object.fromEntries(entries.filter(([, item]) => item.value !== null).map(([key, item]) => [key, item.value])),
    invalid: entries.some(([, item]) => item.invalid),
  };
}

function addExposure(target, key, value) { target[key] = round((target[key] || 0) + Number(value || 0)); }
function numberAt(source, path) { return path.reduce((value, key) => record(value)?.[key], source) ?? 0; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function contractLimit(value) {
  if (value === null || value === undefined || value === "") return { value: null, invalid: false };
  const parsed = finite(value);
  return Number.isInteger(parsed) && parsed >= 0 ? { value: parsed, invalid: false } : { value: null, invalid: true };
}
function nonNegativeLimit(value) {
  if (value === null || value === undefined || value === "") return { value: null, invalid: false };
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? { value: parsed, invalid: false } : { value: null, invalid: true };
}
function requestedQuantity(value) {
  const parsed = finite(value);
  if (parsed === 0) return { raw: 0, quantity: 0, valid: true };
  return Number.isInteger(parsed) && parsed > 0
    ? { raw: parsed, quantity: parsed, valid: true }
    : { raw: parsed, quantity: 0, valid: false };
}
function allocationSizingMode(allocation) { return normalizeSizingMode(firstDefined(allocation.sizing_mode, allocation.sizingMode)); }
function finite(value) { if (value === null || value === undefined || value === "" || typeof value === "boolean" || typeof value === "object") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
