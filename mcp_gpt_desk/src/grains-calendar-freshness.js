export const GRAINS_CALENDAR_MAX_AGE_SECONDS = 6 * 60 * 60;
export const GRAINS_CALENDAR_AUTOMATION_VERSION = "AUTOMATED_USDA_V1";

// Market-data policy: a recent observation is not proof of historical knowledge.
// Legacy qualified snapshots keep their original, explicitly supplied coverage.
export function applyGrainsCalendarFreshness(coverage, { metadata, cutoff }) {
  if (metadata?.ingestion_mode !== GRAINS_CALENDAR_AUTOMATION_VERSION) return coverage;
  const ageLimit = metadata.freshness_max_age_seconds;
  const knownAt = Date.parse(coverage.asOf);
  const evaluatedAt = Date.parse(cutoff);
  if (!Number.isInteger(ageLimit) || ageLimit < 1 || ageLimit > GRAINS_CALENDAR_MAX_AGE_SECONDS
    || !Number.isFinite(knownAt) || !Number.isFinite(evaluatedAt)) {
    return stale(coverage, "CALENDAR_FRESHNESS_POLICY_INVALID");
  }
  const expiresAt = knownAt + ageLimit * 1000;
  const coverageEnd = Math.min(Date.parse(coverage.coverageEnd), expiresAt - 1);
  const bounded = {
    ...coverage,
    coverageEnd: Number.isFinite(coverageEnd) ? new Date(coverageEnd).toISOString() : null,
    freshUntilUtc: new Date(expiresAt).toISOString(),
    ageSeconds: Math.max(0, Math.floor((evaluatedAt - knownAt) / 1000)),
  };
  return evaluatedAt >= expiresAt ? stale(bounded, "CALENDAR_REFRESH_OVERDUE") : bounded;
}

function stale(coverage, reason) {
  return {
    ...coverage,
    status: coverage.status === "AVAILABLE" ? "STALE" : coverage.status,
    reasonCodes: [...new Set([...(coverage.reasonCodes || []), reason])].sort(),
  };
}
