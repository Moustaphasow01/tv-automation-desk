import { canonicalSha256 } from "./execution-scope.js";

export const PROP_FIRM_ACCOUNT_RISK_SCHEMA_VERSION_V1 = "prop_firm_account_risk_v1";
export const PROP_FIRM_ACCOUNT_RISK_STATUSES_V1 = Object.freeze(["PASS", "REDUCE", "BLOCK", "CONFIG_MISSING"]);
export const PROP_FIRM_DRAWDOWN_MODES_V1 = Object.freeze(["STATIC", "TRAILING_EOD", "TRAILING_INTRADAY"]);

export function evaluatePropFirmAccountRiskV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const accounts = normalizeAccounts(firstDefined(input.accounts, input.prop_firm_accounts));
  const targets = array(firstDefined(input.target_positions, input.order_intents, input.allocations));
  const evaluations = accounts.map((account) => evaluateAccount(account, targets));
  const base = {
    schema_version: PROP_FIRM_ACCOUNT_RISK_SCHEMA_VERSION_V1,
    status: accounts.length ? aggregateStatus(evaluations) : "CONFIG_MISSING",
    as_of_utc: asOf,
    account_evaluations: evaluations,
    multi_account_routes: targetRoutes(targets),
  };
  return { ...base, evaluation_hash: hash(base) };
}

function evaluateAccount(account, targets) {
  const scopedTargets = targets.filter((target) => accountId(target) === account.account_id);
  const projectedRisk = round(scopedTargets.reduce((total, target) => total + riskAmount(target, account), 0));
  const projectedContracts = round(scopedTargets.reduce((total, target) => total + Math.abs(number(firstDefined(target.delta_size, target.quantity, target.net_target_size))), 0));
  const floor = drawdownFloor(account);
  const buffer = round(account.current_equity - floor);
  const availableRisk = round(Math.max(0, buffer - account.min_drawdown_buffer));
  const checks = [
    limitCheck("TRAILING_DRAWDOWN_BUFFER", buffer, projectedRisk, availableRisk, account.min_drawdown_buffer),
    maxCheck("MAX_CONTRACTS", projectedContracts, account.max_contracts),
    dailyLossCheck(account),
  ].filter(Boolean);
  const status = accountStatus(checks);
  return {
    account_id: account.account_id,
    provider_account_id: account.provider_account_id,
    prop_firm: account.prop_firm,
    status,
    drawdown_mode: account.drawdown_mode,
    current_equity: account.current_equity,
    high_watermark_equity: account.high_watermark_equity,
    drawdown_floor: floor,
    drawdown_buffer: buffer,
    available_risk_amount: availableRisk,
    projected_risk_amount: projectedRisk,
    approved_risk_amount: status === "BLOCK" ? 0 : Math.min(projectedRisk, availableRisk),
    projected_contracts: projectedContracts,
    max_contracts: account.max_contracts,
    target_position_ids: scopedTargets.map((target) => text(firstDefined(target.target_position_id, target.id))).filter(Boolean),
    limit_checks: checks,
  };
}

function normalizeAccounts(input) {
  return array(input).map((account) => {
    const initial = positive(firstDefined(account.initial_balance, account.starting_balance, account.balance), null);
    const current = positive(firstDefined(account.current_equity, account.net_liquidation, account.equity), null);
    const high = positive(firstDefined(account.high_watermark_equity, account.high_watermark, current, initial), null);
    const amount = positive(firstDefined(account.trailing_drawdown_amount, account.max_drawdown_amount, account.drawdown_amount), null);
    return {
      account_id: text(firstDefined(account.account_id, account.id, account.provider_account_id)),
      provider_account_id: text(firstDefined(account.provider_account_id, account.broker_account_id, account.account_id)),
      prop_firm: text(firstDefined(account.prop_firm, account.provider, "unknown")),
      drawdown_mode: enumValue(firstDefined(account.drawdown_mode, account.trailing_drawdown_mode, "TRAILING_EOD"), PROP_FIRM_DRAWDOWN_MODES_V1),
      initial_balance: initial,
      current_equity: current,
      high_watermark_equity: high,
      trailing_drawdown_amount: amount,
      min_drawdown_buffer: positive(firstDefined(account.min_drawdown_buffer, account.reserve_buffer), 0),
      max_daily_loss: positive(firstDefined(account.max_daily_loss, account.daily_loss_limit), null),
      current_daily_pnl: number(firstDefined(account.current_daily_pnl, account.daily_pnl)),
      max_contracts: positive(firstDefined(account.max_contracts, account.contract_limit), Infinity),
      trailing_floor_cap_at_initial: firstDefined(account.trailing_floor_cap_at_initial, true) !== false,
    };
  }).filter((account) => account.account_id && account.current_equity !== null && account.trailing_drawdown_amount !== null);
}

function drawdownFloor(account) {
  if (account.drawdown_mode === "STATIC") return round(account.initial_balance - account.trailing_drawdown_amount);
  const raw = account.high_watermark_equity - account.trailing_drawdown_amount;
  return round(account.trailing_floor_cap_at_initial && account.initial_balance !== null ? Math.min(account.initial_balance, raw) : raw);
}

function targetRoutes(targets) {
  return array(targets).map((target) => ({
    account_id: accountId(target),
    instrument: upper(target.instrument),
    target_position_id: text(firstDefined(target.target_position_id, target.id)),
    signed_size: number(firstDefined(target.net_target_size, target.delta_size, target.quantity)),
  })).sort((left, right) => `${left.account_id}:${left.instrument}`.localeCompare(`${right.account_id}:${right.instrument}`));
}

function riskAmount(target, account) {
  const explicit = positive(firstDefined(target.risk_amount, target.max_loss_amount, target.notional_risk), null);
  if (explicit !== null) return explicit;
  const riskPerContract = positive(firstDefined(target.risk_per_contract, target.max_loss_per_contract, account.default_risk_per_contract), 0);
  const contracts = Math.abs(number(firstDefined(target.delta_size, target.quantity, target.net_target_size)));
  return riskPerContract * contracts;
}

function limitCheck(code, buffer, projectedRisk, availableRisk, minimumBuffer) {
  return { code, current_buffer: round(buffer), projected_risk_amount: projectedRisk, available_risk_amount: availableRisk, minimum_buffer: minimumBuffer, breached: projectedRisk > availableRisk || buffer <= minimumBuffer };
}

function maxCheck(code, projected, limit) {
  if (!Number.isFinite(limit)) return null;
  return { code, projected, limit, breached: projected > limit };
}

function dailyLossCheck(account) {
  if (account.max_daily_loss === null) return null;
  const loss = Math.abs(Math.min(0, account.current_daily_pnl));
  return { code: "DAILY_LOSS_LIMIT", current_loss: round(loss), limit: account.max_daily_loss, breached: loss >= account.max_daily_loss };
}

function accountStatus(checks) {
  if (checks.some((check) => check.breached && Number(check.available_risk_amount ?? 0) <= 0)) return "BLOCK";
  if (checks.some((check) => check.breached && check.code !== "TRAILING_DRAWDOWN_BUFFER")) return "BLOCK";
  if (checks.some((check) => check.breached)) return "REDUCE";
  return "PASS";
}

function aggregateStatus(evaluations) {
  if (evaluations.some((item) => item.status === "BLOCK")) return "BLOCK";
  if (evaluations.some((item) => item.status === "REDUCE")) return "REDUCE";
  return "PASS";
}

function accountId(value) { return text(firstDefined(value.account_id, value.broker_account_id, value.provider_account_id, "default")); }
function enumValue(value, allowed) { const normalized = upper(value); return allowed.includes(normalized) ? normalized : allowed[0]; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function positive(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
