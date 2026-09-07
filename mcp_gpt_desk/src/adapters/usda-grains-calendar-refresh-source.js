import { collectUsdaGrainsCalendar, fetchUsdaSourceText } from "./usda-grains-calendar-collector.js";
import { buildUsdaGrainsCalendarSources } from "./usda-grains-calendar-sources.js";

export function createUsdaCalendarCollection({ nowUtc, archiveDocument, fetchText = fetchUsdaSourceText,
  parseCollection = collectUsdaGrainsCalendar }) {
  return async ({ asOfUtc }) => {
    const window = currentWindow(asOfUtc);
    const sources = buildUsdaGrainsCalendarSources({ asOfUtc, ...window });
    const attempts = await Promise.allSettled(sources.map(async (source) => {
      const text = await fetchText(source.url);
      const receivedAtUtc = nowUtc();
      await archiveDocument({ source, text, receivedAtUtc });
      return { source, text, receivedAtUtc };
    }));
    // Availability is the end of receipt, never request start or a date inside the document.
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    if (rejected) throw rejected.reason;
    const documents = attempts.map((attempt) => attempt.value);
    const retrievedAtUtc = nowUtc();
    if (Date.parse(retrievedAtUtc) < Date.parse(asOfUtc)
      || documents.some((item) => Date.parse(item.receivedAtUtc) > Date.parse(retrievedAtUtc))) {
      throw new Error("USDA_CALENDAR_CLOCK_REGRESSION");
    }
    if (new Date(retrievedAtUtc).getUTCFullYear() !== sources[0].expectedYear)
      throw new Error("USDA_CALENDAR_YEAR_CHANGED_DURING_RECEIPT");
    return parseCollection({
      sources, retrievedAtUtc, ...currentWindow(retrievedAtUtc),
      fetchText: async (url) => documents.find((item) => item.source.url === url).text,
    });
  };
}

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
