import test from "node:test";
import assert from "node:assert/strict";
import { resolveStrategySignalRiskBudget } from "../src/strategy-signal-risk-policy.js";

const resolve = (environment = {}, input = {}) => resolveStrategySignalRiskBudget({ environment, input, accountId: "fixture-shadow" });
test("no configuration retains the count-only policy without inventing a monetary risk budget", () => {
  const policy = resolve();
  assert.equal(policy.max_portfolio_abs_size, 20);
  assert.equal(policy.sizing_mode, undefined);
  assert.equal(policy.max_monetary_risk, undefined);
});
test("monetary opt-in has explicit per-position scope and preserves operator caps", () => {
  const policy = resolve({ DESK_SHADOW_RISK_SIZING_MODE: "MONETARY_RISK_BUDGET",
    DESK_SHADOW_RISK_MAX_MONETARY_RISK: "250", DESK_SHADOW_RISK_CURRENCY: "usd",
    DESK_SHADOW_RISK_MAX_ABS_SIZE: "2", DESK_SHADOW_RISK_MAX_DAILY_LOSS_R: "3", DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_R: "6" });
  assert.equal(policy.max_monetary_risk, 250);
  assert.equal(policy.max_monetary_risk_currency, "USD");
  assert.equal(policy.monetary_risk_scope, "PER_ALLOCATION");
  assert.equal(policy.max_account_abs_size["fixture-shadow"], 2);
  assert.equal(policy.max_daily_loss_r, 3);
  assert.equal(policy.max_weekly_loss_r, 6);
});
test("missing monetary amount remains missing and invalid settings never fall back to a permissive default", () => {
  const missing = resolve({ DESK_SHADOW_RISK_SIZING_MODE: "MONETARY_RISK_BUDGET" });
  assert.equal(missing.max_monetary_risk, null);
  assert.equal(missing.max_monetary_risk_currency, null);
  for (const value of ["0", "-1", "NaN", "Infinity", "1.5"]) {
    assert.throws(() => resolve({ DESK_SHADOW_RISK_MAX_ABS_SIZE: value }), /RISK_MAX_ABS_SIZE/);
  }
  assert.throws(() => resolve({ DESK_SHADOW_RISK_MAX_DAILY_LOSS_R: "0" }), /RISK_DAILY_LOSS_INVALID/);
  assert.throws(() => resolve({ DESK_SHADOW_RISK_MAX_MONETARY_RISK: "200" }), /RISK_SIZING_MODE_REQUIRED/);
});
test("a command policy is pinned independently of environment and never mutated", () => {
  const budget = { budget_id: "fixture-policy", max_portfolio_abs_size: 1 };
  const result = resolve({ DESK_SHADOW_RISK_MAX_ABS_SIZE: "99" }, { risk_budget: budget });
  assert.deepEqual(result, budget);
  result.max_portfolio_abs_size = 3;
  assert.equal(budget.max_portfolio_abs_size, 1);
  assert.throws(() => resolve({}, { risk_budget: [] }), /RISK_BUDGET_OBJECT_REQUIRED/);
  assert.throws(() => resolve({}, { risk_budget: null }), /RISK_BUDGET_OBJECT_REQUIRED/);
});

test("monetary loss limits retain USD units and require the matching sizing mode", () => {
  const env = { DESK_SHADOW_RISK_SIZING_MODE: "MONETARY_RISK_BUDGET", DESK_SHADOW_RISK_CURRENCY: "USD",
    DESK_SHADOW_RISK_MAX_MONETARY_RISK: "500", DESK_SHADOW_RISK_MAX_DAILY_LOSS_MONETARY: "2000",
    DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_MONETARY: "4000" };
  assert.equal(resolve(env).max_daily_loss_monetary, 2000);
  assert.equal(resolve(env).max_weekly_loss_monetary, 4000);
  assert.equal(resolve(env).loss_currency, "USD");
  assert.equal(resolve(env).max_daily_loss_r, undefined);
  assert.throws(() => resolve({ ...env, DESK_SHADOW_RISK_SIZING_MODE: "REQUESTED_QUANTITY_CAP" }), /MODE_MISMATCH/);
});
