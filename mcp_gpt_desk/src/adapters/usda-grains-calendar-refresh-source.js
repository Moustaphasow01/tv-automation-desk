import { createHash } from "node:crypto";
import {
  assembleGrainsCalendarCollection,
  collectUsdaGrainsCalendar,
  fetchUsdaSourceText,
} from "./usda-grains-calendar-collector.js";
import { buildUsdaGrainsCalendarSources } from "./usda-grains-calendar-sources.js";
import { collectDormanGrainsCalendar } from "./dorman-grains-calendar-source.js";
import {
  DORMAN_CALENDAR_SOURCE_ID,
  FAS_CALENDAR_SOURCE_ID,
  GRAINS_CALENDAR_POLICY_V1,
  GRAINS_CALENDAR_POLICY_V2,
  requireGrainsCalendarSourcePolicy,
} from "../grains-calendar-source-policy.js";

export function createUsdaCalendarCollection({ nowUtc, archiveDocument, fetchText = fetchUsdaSourceText,
  parseCollection = collectUsdaGrainsCalendar,
  assembleCollection = assembleGrainsCalendarCollection,
  collectDorman = collectDormanGrainsCalendar,
  policyId = GRAINS_CALENDAR_POLICY_V1 }) {
  requireGrainsCalendarSourcePolicy(policyId);
  const ports = { nowUtc, archiveDocument, fetchText, parseCollection,
    assembleCollection, collectDorman, policyId };
  return (command) => collectCalendar(command, ports);
}

async function collectCalendar({ asOfUtc }, ports) {
  const { nowUtc, archiveDocument, parseCollection, assembleCollection, policyId } = ports;
  const window = currentWindow(asOfUtc);
  const sources = buildUsdaGrainsCalendarSources({ asOfUtc, ...window });
  const { documents, failures } = await collectPrimarySources({ sources, ...ports });
  if (!documents.length) throw new Error(failures[0]?.reasonCode || "USDA_SOURCE_FETCH_FAILED");
  const fasFailure = failures.find((failure) =>
    failure.sourceId === FAS_CALENDAR_SOURCE_ID
    && failure.reasonCode === "USDA_SOURCE_HTTP_403");
  const dorman = await optionalDorman({
    fasFailure, failures, window, expectedYear: sources[0].expectedYear, ...ports,
  });
  // Availability is the end of receipt, never request start or a date inside the document.
  const retrievedAtUtc = nowUtc();
  if (Date.parse(retrievedAtUtc) < Date.parse(asOfUtc)
    || documents.some((item) => Date.parse(item.receivedAtUtc) > Date.parse(retrievedAtUtc)))
    throw new Error("USDA_CALENDAR_CLOCK_REGRESSION");
  if (new Date(retrievedAtUtc).getUTCFullYear() !== sources[0].expectedYear)
    throw new Error("USDA_CALENDAR_YEAR_CHANGED_DURING_RECEIPT");
  const finalWindow = currentWindow(retrievedAtUtc);
  const collected = await parseCollection({
    sources: documents.map((item) => item.source), retrievedAtUtc, ...finalWindow, policyId,
    fetchText: async (url) => documents.find((item) => item.source.url === url).text,
  });
  const withSecondary = dorman ? assembleCollection({
    manifests: [...collected.manifests, dorman.manifest],
    agriEvents: [...collected.agriEvents, ...dorman.events],
    retrievedAtUtc, ...finalWindow, policyId, fallbackEvidence: fasFailure,
  }) : collected;
  if (dorman && failures.length === 1 && fasFailure)
    return fallbackCollection(withSecondary, fasFailure);
  return failures.length ? unavailablePartialCollection(withSecondary, failures) : withSecondary;
}

async function collectPrimarySources({ sources, fetchText, nowUtc, archiveDocument, policyId }) {
  const attempts = await Promise.allSettled(sources.map((source) => collectPrimarySource({
    source, fetchText, nowUtc, archiveDocument, policyId,
  })));
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  if (rejected) throw rejected.reason;
  const outcomes = attempts.map((attempt) => attempt.value);
  return {
    documents: outcomes.filter((outcome) => !outcome.fetchFailure),
    failures: outcomes.flatMap((outcome) => outcome.fetchFailure ? [outcome.fetchFailure] : []),
  };
}

async function collectPrimarySource({ source, fetchText, nowUtc, archiveDocument, policyId }) {
  let text;
  try { text = await fetchText(source.url); }
  catch (error) {
    const failure = sourceFailure(source, error);
    const shouldArchive = policyId === GRAINS_CALENDAR_POLICY_V2
      && source.sourceId === FAS_CALENDAR_SOURCE_ID
      && failure.reasonCode === "USDA_SOURCE_HTTP_403";
    return { source, fetchFailure: shouldArchive
      ? await archiveFas403Observation({ source, failure, nowUtc, archiveDocument })
      : failure };
  }
  const receivedAtUtc = nowUtc();
  await archiveDocument({ source, text, receivedAtUtc });
  return { source, text, receivedAtUtc };
}

async function optionalDorman({ fasFailure, failures, window, expectedYear,
  policyId, collectDorman, nowUtc, archiveDocument }) {
  if (policyId !== GRAINS_CALENDAR_POLICY_V2 || !fasFailure) return null;
  try {
    return await collectDorman({
      expectedYear, coverageStart: window.coverageStart, coverageEnd: window.coverageEnd,
      nowUtc, archiveDocument,
    });
  } catch (error) {
    failures.push({
      sourceId: DORMAN_CALENDAR_SOURCE_ID,
      sourceUrl: "https://www.dormantrading.com/trading-resources/market-calendar/",
      reasonCode: failureReason(error, "CALENDAR_DORMAN_SOURCE_FAILED"),
    });
    return null;
  }
}

function fallbackCollection(collected, primaryFailure) {
  return {
    ...collected,
    sourceFailures: [primaryFailure],
    calendarVersion: {
      ...collected.calendarVersion,
      metadata: {
        ...(collected.calendarVersion.metadata || {}),
        fallback_activation_reason: "USDA_SOURCE_HTTP_403",
        primary_source_failure: {
          source_id: primaryFailure.sourceId,
          source_url: primaryFailure.sourceUrl,
          reason_code: primaryFailure.reasonCode,
        },
      },
    },
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
  const reasonCode = failureReason(error, "USDA_SOURCE_FETCH_FAILED");
  return { sourceId: source.sourceId, sourceUrl: source.url, reasonCode };
}

async function archiveFas403Observation({ source, failure, nowUtc, archiveDocument }) {
  const observedAtUtc = normalizedTimestamp(nowUtc(), "USDA_SOURCE_FAILURE_TIME_INVALID");
  const observation = JSON.stringify({
    schema_version: "calendar-source-http-failure.v1",
    source_id: source.sourceId,
    source_url: source.url,
    reason_code: failure.reasonCode,
    observed_at_utc: observedAtUtc,
  });
  const observationSha256 = `sha256:${createHash("sha256").update(observation).digest("hex")}`;
  const archiveReceipt = await archiveDocument({
    source: {
      ...source,
      sourceId: `${source.sourceId}_http_failure_observation`,
      sourceKind: "HTTP_FAILURE_OBSERVATION",
      archiveSuffix: ".json",
    },
    text: observation,
    receivedAtUtc: observedAtUtc,
  });
  return {
    ...failure,
    observed_at_utc: observedAtUtc,
    observation_sha256: observationSha256,
    archive_receipt: archiveReceipt,
  };
}

function failureReason(error, fallback) {
  const message = typeof error?.message === "string" ? error.message : "";
  return /^[A-Z][A-Z0-9_]{3,120}$/.test(message) ? message : fallback;
}

function unique(values) { return [...new Set(values)].sort(); }

function normalizedTimestamp(value, code) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return new Date(parsed).toISOString();
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
