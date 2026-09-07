import { collectUsdaGrainsCalendar, fetchUsdaSourceText } from "./usda-grains-calendar-collector.js";
import { buildUsdaGrainsCalendarSources } from "./usda-grains-calendar-sources.js";

export function createUsdaCalendarCollection({ nowUtc, archiveDocument, fetchText = fetchUsdaSourceText,
  parseCollection = collectUsdaGrainsCalendar }) {
  return async ({ asOfUtc }) => {
    const window = currentWindow(asOfUtc);
    const sources = buildUsdaGrainsCalendarSources({ asOfUtc, ...window });
    const attempts = await Promise.allSettled(sources.map(async (source) => {
      let text;
      try { text = await fetchText(source.url); }
      catch (error) { return { source, fetchFailure: sourceFailure(source, error) }; }
      const receivedAtUtc = nowUtc();
      await archiveDocument({ source, text, receivedAtUtc });
      return { source, text, receivedAtUtc };
    }));
    // Availability is the end of receipt, never request start or a date inside the document.
    const archiveFailure = attempts.find((attempt) => attempt.status === "rejected");
    if (archiveFailure) throw archiveFailure.reason;
    const outcomes = attempts.map((attempt) => attempt.value);
    const documents = outcomes.filter((outcome) => !outcome.fetchFailure);
    const failures = outcomes.flatMap((outcome) =>
      outcome.fetchFailure ? [outcome.fetchFailure] : []);
    if (!documents.length) throw new Error(failures[0]?.reasonCode || "USDA_SOURCE_FETCH_FAILED");
    const retrievedAtUtc = nowUtc();
    if (Date.parse(retrievedAtUtc) < Date.parse(asOfUtc)
      || documents.some((item) => Date.parse(item.receivedAtUtc) > Date.parse(retrievedAtUtc))) {
      throw new Error("USDA_CALENDAR_CLOCK_REGRESSION");
    }
    if (new Date(retrievedAtUtc).getUTCFullYear() !== sources[0].expectedYear)
      throw new Error("USDA_CALENDAR_YEAR_CHANGED_DURING_RECEIPT");
    const collected = await parseCollection({
      sources: documents.map((item) => item.source),
      retrievedAtUtc, ...currentWindow(retrievedAtUtc),
      fetchText: async (url) => documents.find((item) => item.source.url === url).text,
    });
    return failures.length ? unavailablePartialCollection(collected, failures) : collected;
  };
}

function unavailablePartialCollection(collected, failures) {
  const sourceFailures = failures.map(({ sourceId, sourceUrl, reasonCode }) => ({
    sourceId, sourceUrl, reasonCode,
  }));
  const reasons = unique([
    ...(collected.calendarVersion.reasonCodes || []),
    "CALENDAR_REQUIRED_SOURCE_FETCH_FAILED",
    ...sourceFailures.map((failure) => failure.reasonCode),
  ]);
  const coverage = collected.agriCalendarCoverage[0] || {};
  return {
    ...collected,
    sourceFailures,
    agriCalendarCoverage: [{
      ...coverage,
      status: "UNAVAILABLE",
      reasonCodes: reasons,
      sourceDiagnostics: mergeSourceDiagnostics(
        coverage.sourceDiagnostics,
        sourceFailures,
      ),
    }],
    calendarVersion: {
      ...collected.calendarVersion,
      status: "UNAVAILABLE",
      reasonCodes: reasons,
      metadata: {
        ...(collected.calendarVersion.metadata || {}),
        source_failures: sourceFailures.map((failure) => ({
          source_id: failure.sourceId,
          source_url: failure.sourceUrl,
          reason_code: failure.reasonCode,
        })),
      },
    },
  };
}

function mergeSourceDiagnostics(diagnostics, failures) {
  const bySource = new Map((diagnostics || []).map((item) => [item.sourceId, item]));
  for (const failure of failures) {
    const previous = bySource.get(failure.sourceId) || {};
    bySource.set(failure.sourceId, {
      ...previous,
      sourceId: failure.sourceId,
      ignored: false,
      qualified: false,
      reasonCodes: unique([
        ...(previous.reasonCodes || []),
        "CALENDAR_REQUIRED_SOURCE_FETCH_FAILED",
        failure.reasonCode,
      ]),
    });
  }
  return [...bySource.values()].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId));
}

function sourceFailure(source, error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const reasonCode = /^[A-Z][A-Z0-9_]{3,120}$/.test(message)
    ? message : "USDA_SOURCE_FETCH_FAILED";
  return { sourceId: source.sourceId, sourceUrl: source.url, reasonCode };
}

function unique(values) { return [...new Set(values)].sort(); }

function currentWindow(asOfUtc) {
  const asOf = new Date(asOfUtc);
  if (!Number.isFinite(asOf.getTime())) throw new Error("USDA_CALENDAR_AS_OF_REQUIRED");
  const coverageStart = asOf.toISOString();
  const yearEnd = Date.UTC(asOf.getUTCFullYear() + 1, 0, 1) - 1;
  return {
    coverageStart,
    coverageEnd: new Date(Math.min(Date.parse(coverageStart) + 7 * 86400000 - 1, yearEnd)).toISOString(),
  };
}
