import { SystemClock } from "@tv-automation/desk-time";

const FALLBACK_FRONT_CLOCK = new SystemClock();

export function clockUtc(clock = FALLBACK_FRONT_CLOCK) {
  return clockTick(clock).utc;
}

export function clockEpochMs(clock = FALLBACK_FRONT_CLOCK) {
  return clockTick(clock).epochMs;
}

function clockTick(clock) {
  const tick = typeof clock?.now === "function" ? clock.now() : FALLBACK_FRONT_CLOCK.now();
  if (Number.isFinite(tick?.epochMs) && tick?.utc) return tick;
  const parsed = Date.parse(tick?.utc || tick);
  return Number.isFinite(parsed) ? { epochMs: parsed, utc: new Date(parsed).toISOString() } : FALLBACK_FRONT_CLOCK.now();
}
