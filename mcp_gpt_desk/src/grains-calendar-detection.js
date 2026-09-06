import { detectUsGrainsStrategySignals } from "./us-grains-strategy-suite.js";

// Simulation application: reuse the detector, changing only the calendar read
// projection at each knowledge boundary. Never use the final version all week.
export async function detectCalendarVersionedGrainsSignals({ detectionInput, calendarKnownTimes, readCalendarAt }) {
  const start = Date.parse(`${detectionInput.startDate}T00:00:00.000Z`);
  const end = Date.parse(detectionInput.asOfUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
    throw new Error("CALENDAR_DETECTION_WINDOW_INVALID");
  const times = [...new Set([start, ...calendarKnownTimes.map(Date.parse)
    .filter((time) => Number.isFinite(time) && time > start && time <= end)])].sort((a, b) => a - b);
  const signals = [];
  const intervals = [];
  for (const [index, time] of times.entries()) {
    const cutoff = new Date(time).toISOString();
    const calendar = await readCalendarAt(cutoff);
    const detected = detectUsGrainsStrategySignals({ ...detectionInput, ...calendar });
    const next = times[index + 1] ?? end + 1;
    signals.push(...detected.raw_signals.filter((signal) => {
      const at = Date.parse(signal.source_data_cutoff_utc);
      return at >= time && at < next;
    }));
    intervals.push({ fromUtc: cutoff, untilUtc: new Date(Math.min(next, end)).toISOString(),
      coverage: calendar.agriCalendarCoverage });
  }
  return { raw_signals: signals.sort((a, b) => a.generated_at_utc.localeCompare(b.generated_at_utc) || a.signal_id.localeCompare(b.signal_id)),
    calendar_intervals: intervals };
}
