// Configuration composition at the application boundary. Sizing and validation
// of the resulting budget remain exclusively in the portfolio-risk domain.
export function resolveStrategySignalRiskBudget({ input = {}, environment = {}, accountId }) {
  const supplied = Object.hasOwn(input, "risk_budget") ? input.risk_budget : input.riskBudget;
  if (Object.hasOwn(input, "risk_budget") || Object.hasOwn(input, "riskBudget")) {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied))
      throw configurationError("RISK_BUDGET_OBJECT_REQUIRED");
    return structuredClone(supplied);
  }
  const mode = configuredMode(environment);
  const budget = baseQuantityBudget(input, environment, accountId);
  const daily = positiveSetting(environment.DESK_SHADOW_RISK_MAX_DAILY_LOSS_R, "RISK_DAILY_LOSS_INVALID", null);
  const weekly = positiveSetting(environment.DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_R, "RISK_WEEKLY_LOSS_INVALID", null);
  if (daily !== null) budget.max_daily_loss_r = daily;
  if (weekly !== null) budget.max_weekly_loss_r = weekly;
  if (!mode) return budget; // Existing count-only mode; no implicit cutover.
  budget.sizing_mode = mode;
  budget.metadata.policy_version = "shadow-risk-policy-v2";
  if (mode === "MONETARY_RISK_BUDGET") Object.assign(budget, monetaryConfiguration(environment));
  return budget;
}

function configuredMode(environment) {
  const mode = environment.DESK_SHADOW_RISK_SIZING_MODE?.trim().toUpperCase();
  if (!mode && hasMonetaryConfiguration(environment)) throw configurationError("RISK_SIZING_MODE_REQUIRED");
  if (mode && mode !== "MONETARY_RISK_BUDGET" && hasMonetaryConfiguration(environment))
    throw configurationError("RISK_MONETARY_CONFIGURATION_MODE_MISMATCH");
  return mode;
}

function baseQuantityBudget(input, environment, accountId) {
  const maxAbs = positiveSetting(input.max_abs_size ?? input.maxAbsSize ?? environment.DESK_SHADOW_RISK_MAX_ABS_SIZE,
    "RISK_MAX_ABS_SIZE_INVALID", 20);
  if (!Number.isInteger(maxAbs)) throw configurationError("RISK_MAX_ABS_SIZE_MUST_BE_INTEGER");
  return {
    budget_id: "shadow-live-risk-budget-v1", max_portfolio_abs_size: maxAbs,
    max_account_abs_size: { [accountId]: maxAbs },
    max_instrument_abs_size: { MNQ: maxAbs, MES: maxAbs, ZC: maxAbs, ZW: maxAbs },
    max_correlation_group_abs_size: { equity_index: maxAbs, grains: maxAbs },
    metadata: { execution_mode: "SHADOW", source: "strategy-signal-decision-pipeline" },
  };
}

function monetaryConfiguration(environment) {
  return {
    // Explicit scope: this amount is per candidate position, NOT a portfolio-wide monetary cap.
    monetary_risk_scope: "PER_ALLOCATION",
    max_monetary_risk: positiveSetting(environment.DESK_SHADOW_RISK_MAX_MONETARY_RISK, "RISK_MONETARY_LIMIT_INVALID", null),
    max_monetary_risk_currency: environment.DESK_SHADOW_RISK_CURRENCY?.trim().toUpperCase() || null,
    loss_currency: environment.DESK_SHADOW_RISK_CURRENCY?.trim().toUpperCase() || null,
    max_daily_loss_monetary: positiveSetting(environment.DESK_SHADOW_RISK_MAX_DAILY_LOSS_MONETARY, "RISK_DAILY_MONETARY_LOSS_INVALID", null),
    max_weekly_loss_monetary: positiveSetting(environment.DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_MONETARY, "RISK_WEEKLY_MONETARY_LOSS_INVALID", null),
  };
}
function hasMonetaryConfiguration(environment) {
  return [environment.DESK_SHADOW_RISK_MAX_MONETARY_RISK, environment.DESK_SHADOW_RISK_CURRENCY,
    environment.DESK_SHADOW_RISK_MAX_DAILY_LOSS_MONETARY, environment.DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_MONETARY]
    .some(value => value !== undefined && value !== "");
}
function positiveSetting(value, code, absent) {
  if (value === undefined || value === null || value === "") return absent;
  const number = typeof value === "boolean" ? NaN : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw configurationError(code);
  return number;
}
function configurationError(code) { const error = new Error(code); error.code = code; error.statusCode = 503; return error; }
