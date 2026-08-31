import assert from "node:assert/strict";
import test from "node:test";

import { grainsRuntimeEvaluationDisposition, grainsTradingSessionState, isGrainsRth } from "../src/us-grains-data-quality.js";

test("grains session distinguishes Monday preopen and publishes the next CBOT RTH eligibility", () => {
  const session = grainsTradingSessionState("2026-08-31T13:00:00.000Z");

  assert.equal(session.state, "PREOPEN");
  assert.equal(session.active_session, "CBOT_GRAINS_PREOPEN");
  assert.equal(session.exchange_timezone, "America/Chicago");
  assert.equal(session.market_closed, true);
  assert.equal(session.next_eligible_at_utc, "2026-08-31T13:30:00.000Z");
});

test("grains RTH is weekday-only and respects the Chicago session window", () => {
  assert.equal(isGrainsRth("2026-08-31T13:30:00.000Z"), true);
  assert.equal(isGrainsRth("2026-08-31T18:20:00.000Z"), true);
  assert.equal(isGrainsRth("2026-08-31T18:21:00.000Z"), false);
  assert.equal(isGrainsRth("2026-08-30T14:00:00.000Z"), false);
});

test("runtime evaluation waits for the next CBOT RTH instead of publishing a false no-signal", () => {
  const waiting = grainsRuntimeEvaluationDisposition({ timestampUtc: "2026-08-31T13:00:00.000Z", hasSignal: false });
  const openWithoutSignal = grainsRuntimeEvaluationDisposition({ timestampUtc: "2026-08-31T13:35:00.000Z", hasSignal: false });

  assert.deepEqual(waiting.reason_codes, ["US_GRAINS_RUNTIME_EVALUATED", "WAITING_FOR_CBOT_RTH"]);
  assert.equal(waiting.status, "WAITING_SESSION");
  assert.equal(waiting.next_evaluation_at_utc, "2026-08-31T13:30:00.000Z");
  assert.equal(openWithoutSignal.status, "NO_SIGNAL");
  assert.equal(openWithoutSignal.next_evaluation_at_utc, "2026-08-31T13:36:00.000Z");
});
