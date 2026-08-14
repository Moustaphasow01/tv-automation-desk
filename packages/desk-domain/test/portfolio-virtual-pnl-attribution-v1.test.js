import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTFOLIO_VIRTUAL_PNL_ATTRIBUTION_SCHEMA_VERSION_V1,
  buildPortfolioVirtualPnlAttributionV1,
} from "../index.js";

describe("portfolio virtual pnl attribution V1", () => {
  it("attributes virtual R per strategy instance", () => {
    const report = buildPortfolioVirtualPnlAttributionV1({
      trades: [
        trade({ strategy_instance_id: "inst-a", net_r: 1.5 }),
        trade({ strategy_instance_id: "inst-a", net_r: -0.5 }),
        trade({ strategy_instance_id: "inst-b", net_r: 2 }),
      ],
      virtual_portfolio: { by_strategy_instance: [{ strategy_instance_id: "inst-a", open_signed_size: 1 }] },
    });

    assert.equal(report.schema_version, PORTFOLIO_VIRTUAL_PNL_ATTRIBUTION_SCHEMA_VERSION_V1);
    assert.equal(report.portfolio_totals.total_r, 3);
    assert.equal(report.strategy_attributions.find((item) => item.strategy_instance_id === "inst-a").total_r, 1);
    assert.equal(report.strategy_attributions.find((item) => item.strategy_instance_id === "inst-a").win_rate, 0.5);
    assert.equal(report.strategy_attributions.find((item) => item.strategy_instance_id === "inst-a").open_signed_size, 1);
  });

  it("flags too similar strategies and reduces the weaker allocation", () => {
    const report = buildPortfolioVirtualPnlAttributionV1({
      trades: [trade({ strategy_instance_id: "inst-a", net_r: 4 }), trade({ strategy_instance_id: "inst-b", net_r: 1 })],
      strategy_genomes: [
        genome({ strategy_instance_id: "inst-a", confirmation_signals: ["VWAP", "RSI"] }),
        genome({ strategy_instance_id: "inst-b", confirmation_signals: ["VWAP", "RSI", "DXY"] }),
      ],
      policy: { too_close_threshold: 0.7, duplicate_threshold: 0.98, too_close_allocation_multiplier: 0.25 },
    });

    assert.equal(report.similarity.alerts.length, 1);
    assert.equal(report.similarity.alerts[0].decision, "TOO_SIMILAR");
    assert.equal(report.similarity.alerts[0].weaker_strategy_instance_id, "inst-b");
    assert.equal(report.allocation_impacts[0].strategy_instance_id, "inst-b");
    assert.equal(report.allocation_impacts[0].recommended_allocation_multiplier, 0.25);
  });

  it("adds allocation size from candidate allocation contributing signals", () => {
    const report = buildPortfolioVirtualPnlAttributionV1({
      candidate_allocations: [{ contributing_signals: [{ strategy_instance_id: "inst-a", proposed_size: 2 }] }],
    });

    assert.equal(report.strategy_attributions[0].strategy_instance_id, "inst-a");
    assert.equal(report.strategy_attributions[0].allocation_size, 2);
    assert.equal(report.strategy_attributions[0].status, "ACTIVE");
  });

  it("keeps attribution hash stable", () => {
    const input = { as_of_utc: "2026-08-09T09:00:00.000Z", trades: [trade({ strategy_instance_id: "inst-a", net_r: 1 })], strategy_genomes: [genome({ strategy_instance_id: "inst-a" })] };
    assert.equal(buildPortfolioVirtualPnlAttributionV1(input).attribution_hash, buildPortfolioVirtualPnlAttributionV1(input).attribution_hash);
  });
});

function trade(overrides = {}) {
  return { strategy_instance_id: "inst-a", net_r: 1, ...overrides };
}

function genome(overrides = {}) {
  return {
    strategy_instance_id: "inst-a",
    candidate_key: "mnq.breakout.retest",
    primary_change_summary: "Breakout retest continuation with VWAP and RSI confirmation.",
    instruments: ["MNQ"],
    timeframes: ["M1", "M15"],
    session_scope: ["ny_open"],
    entry_logic: ["breakout", "retest"],
    confirmation_signals: ["VWAP", "RSI"],
    exit_logic: ["target", "stop"],
    risk_model: ["fixed_risk"],
    ...overrides,
  };
}
