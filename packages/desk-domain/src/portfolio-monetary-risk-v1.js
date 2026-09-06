export const PORTFOLIO_MONETARY_RISK_SCOPES_V1 = Object.freeze(["PER_ALLOCATION"]);

export function normalizeMonetaryRiskScope(value) {
  const scope = upper(value);
  return PORTFOLIO_MONETARY_RISK_SCOPES_V1.includes(scope) ? scope : "INVALID";
}

export function currency(value) {
  const code = upper(value);
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function hasMonetaryLossCaps(budget) {
  return budget.max_daily_loss_monetary !== null || budget.max_weekly_loss_monetary !== null;
}

export function normalizeMonetaryLossUsage(value) {
  const source = record(value) || {};
  const availability = upper(firstDefined(source.monetary_availability, source.monetaryAvailability));
  const daily = finite(firstDefined(source.daily_loss_monetary, source.dailyLossMonetary));
  const weekly = finite(firstDefined(source.weekly_loss_monetary, source.weeklyLossMonetary));
  const reserved = finite(firstDefined(source.reserved_monetary_risk, source.reservedMonetaryRisk));
  const code = currency(source.currency);
  if (availability !== "KNOWN" || daily === null || daily < 0 || weekly === null || weekly < 0 || reserved === null || reserved < 0 || code === null) {
    return { availability: "UNAVAILABLE", daily_loss_monetary: null, weekly_loss_monetary: null, reserved_monetary_risk: null, currency: "UNAVAILABLE" };
  }
  return { availability: "KNOWN", daily_loss_monetary: daily, weekly_loss_monetary: weekly, reserved_monetary_risk: reserved, currency: code };
}

export function monetaryLossUsageAvailable(budget, usage) {
  if (!hasMonetaryLossCaps(budget)) return { available: true, remaining: [Infinity], limit_reason_code: null };
  if (usage.portfolio.monetary_availability !== "KNOWN") return { available: false, reason_code: "MONETARY_LOSS_USAGE_UNAVAILABLE" };
  if (usage.portfolio.monetary_currency !== budget.loss_currency) return { available: false, reason_code: "MONETARY_LOSS_CURRENCY_MISMATCH" };
  const reserved = usage.portfolio.reserved_monetary_risk;
  const dailyRemaining = budget.max_daily_loss_monetary === null ? Infinity : budget.max_daily_loss_monetary - usage.portfolio.daily_loss_monetary - reserved;
  const weeklyRemaining = budget.max_weekly_loss_monetary === null ? Infinity : budget.max_weekly_loss_monetary - usage.portfolio.weekly_loss_monetary - reserved;
  const limitReason = dailyRemaining <= 0 ? "DAILY_MONETARY_LOSS_LIMIT_REACHED" : weeklyRemaining <= 0 ? "WEEKLY_MONETARY_LOSS_LIMIT_REACHED" : null;
  return { available: true, remaining: [dailyRemaining, weeklyRemaining], limit_reason_code: limitReason };
}

export function monetaryLossChecks(budget, usage, proposedRisk) {
  if (budget.sizing_mode !== "MONETARY_RISK_BUDGET" || !hasMonetaryLossCaps(budget)) return [];
  return [
    monetaryLossCheck("DAILY_LOSS_MONETARY", moneyAdd(usage.portfolio.daily_loss_monetary, usage.portfolio.reserved_monetary_risk), proposedRisk, budget.max_daily_loss_monetary, budget.loss_currency),
    monetaryLossCheck("WEEKLY_LOSS_MONETARY", moneyAdd(usage.portfolio.weekly_loss_monetary, usage.portfolio.reserved_monetary_risk), proposedRisk, budget.max_weekly_loss_monetary, budget.loss_currency),
  ].filter(Boolean);
}

export function moneyAdd(left, right) { return Number(left || 0) + Number(right || 0); }

function monetaryLossCheck(code, current, proposed, limit, unit) {
  if (limit === null || limit === undefined) return null;
  const projected = moneyAdd(current, proposed);
  return { code, scope: "portfolio", unit, current, proposed: moneyRound(proposed), projected, limit, available: moneyRound(limit - current), breached: projected > limit };
}
function moneyRound(value) { return Math.round(Number(value || 0) * 100) / 100; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
