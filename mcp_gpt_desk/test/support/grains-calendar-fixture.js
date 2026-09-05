// Test-only certificate: never imported by application or replay production code.
export function grainsCalendarFixture(overrides = {}) {
  return {
    sourceId: "market_agri_events",
    sourceType: "AGRI_EVENT_CALENDAR",
    status: "AVAILABLE",
    datasetVersion: "test-calendar-v1",
    sourceVersionHash: `sha256:${"a".repeat(64)}`,
    provider: "test",
    asOf: "2026-01-01T00:00:00Z",
    coverageStart: "2026-01-01T00:00:00Z",
    coverageEnd: "2026-12-31T23:59:59Z",
    ...overrides,
  };
}
