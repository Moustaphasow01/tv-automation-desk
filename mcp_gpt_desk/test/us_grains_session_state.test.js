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

test("grains admission closes at the end-exclusive RTH boundary without dropping the last bar-open", () => {
  const session = grainsTradingSessionState("2026-09-04T18:20:00.000Z");

  assert.equal(session.state, "POSTCLOSE");
  assert.equal(session.market_closed, true);
  assert.equal(isGrainsRth("2026-09-04T18:20:00.000Z"), true);
});

test("qualified Labor Day RTH exception waits until Tuesday without claiming Globex coverage", () => {
  const session = grainsTradingSessionState("2026-09-07T15:10:00.000Z");
  const disposition = grainsRuntimeEvaluationDisposition({
    timestampUtc: "2026-09-07T15:10:00.000Z",
    hasSignal: false,
  });

  assert.equal(session.state, "HOLIDAY");
  assert.equal(session.active_session, "CBOT_GRAINS_HOLIDAY");
  assert.equal(session.market_closed, true);
  assert.equal(session.next_eligible_at_utc, "2026-09-08T13:30:00.000Z");
  assert.equal(session.last_expected_market_date, "2026-09-04");
  assert.deepEqual(session.last_expected_core_close_utc_by_timeframe, {
    "1": "2026-09-04T18:20:00.000Z",
    "5": "2026-09-04T18:20:00.000Z",
  });
  assert.equal(session.calendar_qualification.status, "QUALIFIED_RTH_ONLY");
  assert.equal(
    session.calendar_qualification.limitation,
    "authenticated_product_globex_holiday_rows_not_obtained",
  );
  assert.equal(disposition.status, "WAITING_SESSION");
  assert.equal(disposition.next_evaluation_at_utc, "2026-09-08T13:30:00.000Z");
});

test("Tuesday reopening is normal RTH and exposes only the bounded feed grace", () => {
  const before = grainsTradingSessionState("2026-09-08T13:29:59.000Z");
  const reopening = grainsTradingSessionState("2026-09-08T13:30:00.000Z");
  const afterGrace = grainsTradingSessionState("2026-09-08T13:55:00.000Z");
  const postclose = grainsTradingSessionState("2026-09-08T18:21:00.000Z");

  assert.equal(before.state, "PREOPEN");
  assert.equal(before.reason, "cbot_grains_post_holiday_preopen");
  assert.equal(before.last_expected_market_date, "2026-09-04");
  assert.equal(before.next_eligible_at_utc, "2026-09-08T13:30:00.000Z");
  assert.equal(reopening.state, "OPEN");
  assert.equal(reopening.reopen_data_grace_active, true);
  assert.equal(reopening.reopen_data_grace_until_utc, "2026-09-08T13:55:00.000Z");
  assert.equal(afterGrace.state, "OPEN");
  assert.equal(afterGrace.reopen_data_grace_active, false);
  assert.equal(postclose.state, "POSTCLOSE");
  assert.equal(postclose.last_expected_market_date, null);
  assert.equal(postclose.last_expected_core_close_utc_by_timeframe, null);
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
