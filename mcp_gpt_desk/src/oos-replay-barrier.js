const iso = seconds => Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;

/** Prove each M15 barrier from native timestamps; never fabricate candles over gaps. */
export function replayBarSequence({ previous, observation, bound }) {
  const expected = previous + 900, observed = observation.last_bar_time;
  const times = observation.bar_times ?? [observed];
  const advanced = times.filter(time => time >= expected && time <= observed);
  const complete = advanced.length > 0 && advanced.every((time, i) => time === expected + i * 900)
    && advanced.at(-1) === observed;
  const within = observed + 900 <= bound;
  return { accepted: observed === expected && within || complete && within,
    expected_next_bar_open: iso(expected), expected_next_bar_close: iso(expected + 900),
    observed_bar_open: iso(observed), observed_bar_close: iso(observed + 900),
    target_session_end: iso(bound), previous_confirmed_bar: iso(previous), step_size: "15m",
    steps_requested: 1, bars_actually_advanced: advanced.length,
    replay_cursor_before: iso(previous + 899), replay_cursor_after: iso(observed + 899),
    sequence_verified: complete, native_bar_sequence: advanced.map(iso),
    reason: !within ? "SESSION_BARRIER_EXCEEDED" : "NATIVE_M15_SEQUENCE_MISSING" };
}

export function nativeGap(observation, previous) {
  const expected = previous + 900, times = observation.bar_times ?? [];
  const index = times.indexOf(previous), next = times[index + 1];
  if (index < 0 || !Number.isFinite(next) || next <= expected) return null;
  return { expected_next_bar_open: iso(expected), next_native_bar_open: iso(next),
    previous_confirmed_bar: iso(previous), source: "TradingView native bars() consecutive indices" };
}
