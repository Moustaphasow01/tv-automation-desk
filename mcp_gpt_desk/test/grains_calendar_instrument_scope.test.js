import test from "node:test";
import assert from "node:assert/strict";
import { buildCausalGrainContext } from "../src/us-grains-causal-context.js";

test("a corn-specific calendar event does not become a wheat blackout", () => {
  const input = {
    rows: [], peerRows: [], tradingDate: "2026-09-01", asOfUtc: "2026-09-01T18:50:00Z",
    events: [{ market_agri_event_id: "corn-crushings", event_kind: "OTHER", importance: "HIGH",
      event_timestamp_utc: "2026-09-01T19:00:00Z", source_published_at_utc: "2026-01-29T20:24:34Z",
      commodity_codes: ["zc"] }],
  };
  const corn = buildCausalGrainContext({ ...input, instrument: "ZC" });
  const wheat = buildCausalGrainContext({ ...input, instrument: "ZW" });
  assert.equal(corn.macro_event_risk.events.length, 1);
  assert.equal(wheat.macro_event_risk.events.length, 0);
  const both = { ...input, events: input.events.map(({ commodity_codes, ...event }) => event) };
  assert.equal(buildCausalGrainContext({ ...both, instrument: "ZW" }).macro_event_risk.events.length, 1);
  assert.equal(input.events[0].commodity_codes[0], "zc", "the source is immutable");
});
