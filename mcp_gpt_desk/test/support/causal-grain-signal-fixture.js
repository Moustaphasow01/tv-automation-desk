import { randomUUID } from "node:crypto";
import { US_GRAINS_STRATEGY_SUITE_VERSION } from "../../src/us-grains-strategy-suite.js";
import { grainsCalendarFixture } from "./grains-calendar-fixture.js";
const NOW = "2026-09-04T15:00:00.000Z";

export function grainSignal({ direction, ...ids }) {
  const long = direction === "LONG";
  return {
    ...ids,
    signal_id: randomUUID(),
    correlation_id: `test-${direction}`,
    instrument: "ZW",
    direction,
    proposed_size: 1,
    confidence: 0.73,
    source_class: "SHADOW",
    execution_mode_origin: "SHADOW",
    timeframe: "M5",
    session: "cbot_grains_rth",
    generated_at_utc: NOW,
    source_data_cutoff_utc: NOW,
    expires_at_utc: "2026-09-04T15:45:00Z",
    setup: {
      setup_kind: "VWAP_PULLBACK",
      context: {
        schema_version: "us_grains_market_context_v2",
        instrument: "ZW",
        valid_until_utc: "2026-09-04T15:45Z",
        data_quality: { tradeable: true },
        source_data_cutoff_utc: NOW,
        instrument_bias: "LONG_BIASED",
        allowed_sides: ["LONG"],
        preferred_strategy_families: ["VWAP_PULLBACK"],
        discouraged_strategy_families: [],
        risk_multiplier: 1,
        macro_event_risk: {
          events: [],
          coverage: { source: grainsCalendarFixture() },
        },
        reason_codes: ["LONG_BIASED"],
      },
    },
    predicates: [{ code: "TEST_PATTERN", value: true }],
    evidence: [{ type: "test", timestamp_utc: NOW }],
    reason_codes: ["TEST_CAUSAL_SIGNAL"],
    signal_quality: {
      strategy_suite_version: US_GRAINS_STRATEGY_SUITE_VERSION,
    },
    proposed_trade_plan: {
      instrument: "ZW",
      direction,
      order_type: "LIMIT",
      entry_price: 500,
      stop_price: long ? 498 : 502,
      targets: [{ price: long ? 503 : 497 }],
      source_data_cutoff_utc: NOW,
    },
    payload: {
      strategy_family: "VWAP_PULLBACK",
      market_universe: "US_GRAINS_CBOT",
    },
  };
}
