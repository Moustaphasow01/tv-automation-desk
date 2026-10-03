import { requireFact } from "./batch-contract.js";

/** Explicit pre-cutoff calendar input for future bundles; never a inferred calendar or GAP command. */
export function sessionCalendarEvidence(input, day, fingerprint) {
  if (!input) return {};
  requireFact(input.date === day.date && input.symbol === day.symbol && input.timezone === day.timezone,
    "SESSION_CALENDAR_SCOPE_MISMATCH");
  requireFact(typeof input.source === "string" && input.source.length > 0
    && typeof input.version === "string" && input.version.length > 0, "SESSION_CALENDAR_PROVENANCE_REQUIRED");
  requireFact(Number.isFinite(Date.parse(input.known_at)) && Date.parse(input.known_at) <= Date.parse(day.cutoff),
    "SESSION_CALENDAR_POST_CUTOFF");
  const open = Date.parse(input.session_open), close = Date.parse(input.session_close);
  requireFact(Number.isFinite(open) && close > open && typeof input.early_close === "boolean",
    "SESSION_CALENDAR_WINDOW_INVALID");
  const content = { date: input.date, symbol: input.symbol, timezone: input.timezone,
    source: input.source, version: input.version, known_at: input.known_at,
    session_open: input.session_open, session_close: input.session_close, early_close: input.early_close };
  return { session_calendar: { ...content, sha256: fingerprint(JSON.stringify(content, null, 2) + "\n") } };
}
