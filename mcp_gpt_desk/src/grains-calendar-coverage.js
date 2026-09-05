import { evaluateAgriEventCoverageV1 } from "@tv-automation/desk-domain";

// Market-data evidence, shared by detection context and the downstream gate.
// A list of events (including an empty list) is never a coverage certificate.
export function evaluateGrainsCalendarCoverage({ sources = [], cutoff } = {}) {
  const at = Date.parse(cutoff);
  const known = (Array.isArray(sources) ? sources : [])
    .filter(
      (source) =>
        source?.sourceId === "market_agri_events" &&
        source?.sourceType === "AGRI_EVENT_CALENDAR" &&
        Number.isFinite(Date.parse(source.asOf)) &&
        Date.parse(source.asOf) <= at,
    )
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf));
  const source = known[0];
  if (!source) return unavailable("AGRI_CALENDAR_KNOWLEDGE_UNPROVEN");
  const simultaneous = known.filter(
    (item) => Date.parse(item.asOf) === Date.parse(source.asOf),
  );
  if (new Set(simultaneous.map(coverageIdentity)).size > 1) {
    return unavailable("AGRI_CALENDAR_VERSION_AMBIGUOUS");
  }
  if (
    !source.datasetVersion ||
    !/^sha256:[a-f0-9]{64}$/.test(source.sourceVersionHash || "")
  ) {
    return unavailable("AGRI_CALENDAR_VERSION_UNPROVEN");
  }
  const evaluated = evaluateAgriEventCoverageV1({
    sourceState: source,
    cutoff,
  });
  return {
    ...evaluated,
    source: {
      ...evaluated.source,
      sourceVersionHash: source.sourceVersionHash,
    },
  };
}

function coverageIdentity(source) {
  return JSON.stringify([
    source.datasetVersion,
    source.sourceVersionHash,
    source.status,
    source.coverageStart,
    source.coverageEnd,
  ]);
}

function unavailable(reason) {
  return {
    admissible: false,
    decision: "WAIT",
    source: null,
    reasonCodes: [reason],
  };
}
