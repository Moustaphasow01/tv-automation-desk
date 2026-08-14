import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROP_FIRM_ACCOUNT_RISK_SCHEMA_VERSION_V1,
  evaluatePropFirmAccountRiskV1,
} from "../index.js";

describe("prop firm account risk V1", () => {
  it("calculates trailing drawdown floor and passes inside buffer", () => {
    const result = evaluatePropFirmAccountRiskV1({
      accounts: [account({ current_equity: 103000, high_watermark_equity: 105000, trailing_drawdown_amount: 2500, trailing_floor_cap_at_initial: false })],
      target_positions: [target({ risk_amount: 200 })],
    });

    assert.equal(result.schema_version, PROP_FIRM_ACCOUNT_RISK_SCHEMA_VERSION_V1);
    assert.equal(result.status, "PASS");
    assert.equal(result.account_evaluations[0].drawdown_floor, 102500);
    assert.equal(result.account_evaluations[0].drawdown_buffer, 500);
    assert.equal(result.account_evaluations[0].approved_risk_amount, 200);
  });

  it("blocks when trailing drawdown buffer is already consumed", () => {
    const result = evaluatePropFirmAccountRiskV1({
      accounts: [account({ current_equity: 100100, high_watermark_equity: 102500, trailing_drawdown_amount: 2500, min_drawdown_buffer: 150 })],
      target_positions: [target({ risk_amount: 50 })],
    });

    assert.equal(result.status, "BLOCK");
    assert.equal(result.account_evaluations[0].available_risk_amount, 0);
    assert.equal(result.account_evaluations[0].approved_risk_amount, 0);
  });

  it("reduces risk when projected risk exceeds available drawdown buffer", () => {
    const result = evaluatePropFirmAccountRiskV1({
      accounts: [account({ current_equity: 100500, high_watermark_equity: 103000, trailing_drawdown_amount: 3000, min_drawdown_buffer: 200 })],
      target_positions: [target({ risk_amount: 400 })],
    });

    assert.equal(result.status, "REDUCE");
    assert.equal(result.account_evaluations[0].available_risk_amount, 300);
    assert.equal(result.account_evaluations[0].approved_risk_amount, 300);
  });

  it("keeps identical instruments separated across accounts with divergent limits", () => {
    const result = evaluatePropFirmAccountRiskV1({
      accounts: [
        account({ account_id: "prop-a", max_contracts: 1 }),
        account({ account_id: "prop-b", max_contracts: 3 }),
      ],
      target_positions: [
        target({ id: "target-a", account_id: "prop-a", instrument: "MNQ", delta_size: 2, risk_amount: 100 }),
        target({ id: "target-b", account_id: "prop-b", instrument: "MNQ", delta_size: 2, risk_amount: 100 }),
      ],
    });

    assert.equal(result.status, "BLOCK");
    assert.equal(result.account_evaluations.find((item) => item.account_id === "prop-a").status, "BLOCK");
    assert.equal(result.account_evaluations.find((item) => item.account_id === "prop-b").status, "PASS");
    assert.deepEqual(result.multi_account_routes.map((item) => item.account_id), ["prop-a", "prop-b"]);
  });

  it("fails closed when account constraints are missing", () => {
    const result = evaluatePropFirmAccountRiskV1({ target_positions: [target()] });
    assert.equal(result.status, "CONFIG_MISSING");
  });
});

function account(overrides = {}) {
  return {
    account_id: "prop-a",
    provider_account_id: "sim-prop-a",
    prop_firm: "generic_eval",
    initial_balance: 100000,
    current_equity: 101000,
    high_watermark_equity: 102000,
    trailing_drawdown_amount: 2500,
    min_drawdown_buffer: 250,
    max_contracts: 3,
    ...overrides,
  };
}

function target(overrides = {}) {
  return {
    id: "target-a",
    account_id: "prop-a",
    instrument: "MNQ",
    delta_size: 1,
    risk_amount: 100,
    ...overrides,
  };
}
