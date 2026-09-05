const TIMING_PROVENANCE_VERSION = "tradingview_webhook_timing_v1";

export function marketFeedIngestionTiming(row = {}, latestClosedAtUtc = null) {
  const currentEventProven = hasCurrentEventProof(row);
  const sourceBarCloseUtc = isoOrNull(latestClosedAtUtc) || isoOrNull(row.latest_source_bar_close_utc);
  const sourceBarOpenUtc = isoOrNull(row.latest_source_bar_open_utc);
  const receivedAtUtc = currentEventProven ? isoOrNull(row.current_event_received_at_utc) : null;
  const firstPersistedAtUtc = currentEventProven ? isoOrNull(row.event_first_persisted_at_utc) : null;
  return {
    provenance: currentEventProven ? "current_event_linked" : "legacy_history_unverified",
    timing_provenance_version: currentEventProven ? TIMING_PROVENANCE_VERSION : null,
    source_bar_open_utc: sourceBarOpenUtc,
    source_bar_close_utc: sourceBarCloseUtc,
    event_id: currentEventProven ? textOrNull(row.current_event_id) : null,
    received_at_utc: receivedAtUtc,
    event_first_persisted_at_utc: firstPersistedAtUtc,
    first_import_meaning: currentEventProven
      ? "first_db_persistence_of_event_not_current_revision_availability"
      : null,
    close_to_first_import: intervalObservation(sourceBarCloseUtc, firstPersistedAtUtc),
    close_to_received: intervalObservation(sourceBarCloseUtc, receivedAtUtc),
    received_to_persisted: intervalObservation(receivedAtUtc, firstPersistedAtUtc),
  };
}

function hasCurrentEventProof(row) {
  const candleEventId = textOrNull(row.latest_candle_event_id);
  const currentEventId = textOrNull(row.current_event_id);
  return candleEventId !== null
    && candleEventId === currentEventId
    && textOrNull(row.latest_timing_provenance_version) === TIMING_PROVENANCE_VERSION
    && textOrNull(row.current_event_timing_provenance_version) === TIMING_PROVENANCE_VERSION;
}

function intervalObservation(earlierUtc, laterUtc) {
  const earlierMs = Date.parse(earlierUtc || "");
  const laterMs = Date.parse(laterUtc || "");
  if (!Number.isFinite(earlierMs) || !Number.isFinite(laterMs)) {
    return { seconds: null, status: "unavailable" };
  }
  const milliseconds = laterMs - earlierMs;
  return {
    seconds: milliseconds / 1000,
    status: milliseconds < 0 ? "negative_clock_skew" : "observed",
  };
}

function isoOrNull(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}
