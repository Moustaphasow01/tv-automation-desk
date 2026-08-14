import { canonicalSha256 } from "./execution-scope.js";

export const PORTFOLIO_RISK_BUDGET_SCHEMA_VERSION_V1 = "portfolio_risk_budget_v1";
export const PORTFOLIO_RISK_BUDGET_EVALUATION_SCHEMA_VERSION_V1 = "portfolio_risk_budget_evaluation_v1";
export const PORTFOLIO_RISK_BUDGET_STATUSES_V1 = Object.freeze(["PASS", "REDUCE", "BLOCK", "CONFIG_MISSING"]);
export const DEFAULT_PORTFOLIO_CORRELATION_GROUPS_V1 = Object.freeze({
  equity_index: Object.freeze(["MES", "ES", "MNQ", "NQ", "MYM", "YM", "M2K", "RTY"]),
  energy_crude: Object.freeze(["MCL", "CL"]),
  metals: Object.freeze(["MGC", "GC", "SIL", "SI"]),
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
  const accountId = text(firstDefined(input.account_id, input.accountId, "default"));
  const usage = buildUsageSnapshot(portfolio, allocations, budget.correlation_groups, accountId);
  const evaluations = allocations.map((allocation) => evaluateAllocation(allocation, budget, usage, accountId));
  const missing = budgetHasNoLimits(budget);
  const base = {
    schema_version: PORTFOLIO_RISK_BUDGET_EVALUATION_SCHEMA_VERSION_V1,
    status: missing ? "CONFIG_MISSING" : aggregateStatus(evaluations),
    as_of_utc: asOf,
    account_id: accountId,
    budget,
    usage,
    allocation_evaluations: missing ? [] : evaluations,
    gate: gateSummary(missing, evaluations),
  };
  return { ...base, evaluation_hash: hash(base) };
}

function evaluateAllocation(allocation, budget, usage, accountId) {
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
  return { risk_decision_id: `portfoliorisk:${canonicalSha256(base).slice(0, 24)}`, ...base };
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
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
