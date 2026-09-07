import { createHash } from "node:crypto";
import {
  GRAINS_CALENDAR_AUTOMATION_VERSION,
  GRAINS_CALENDAR_MAX_AGE_SECONDS,
} from "../grains-calendar-freshness.js";

// Market-data use case. Ports own HTTP, immutable archives, SQL locking and status I/O.
// Neither a network wait nor document parsing happens inside the append transaction.
export async function refreshGrainsCalendar(command, ports) {
  if (command.mode === "DISABLED") {
    return ports.writeStatus({ status: "DISABLED_BY_POLICY", asOfUtc: ports.nowUtc() });
  }
  if (command.mode !== "ENABLED") throw new Error("CALENDAR_REFRESH_MODE_INVALID");
  try {
    return await ports.exclusive(() => refreshUnderLease(ports));
  } catch {
    // A lost database connection must not leave a previous success looking current.
    return ports.writeStatus({
      status: "UNAVAILABLE", asOfUtc: ports.nowUtc(),
      reasonCodes: ["CALENDAR_REFRESH_LEASE_FAILED"],
    });
  }
}

async function refreshUnderLease(ports) {
  const startedAtUtc = ports.nowUtc();
  let archiveRef = null;
  try {
    const collected = await ports.collect({ asOfUtc: startedAtUtc });
    archiveRef = await ports.archive(collected);
    if (collected.calendarVersion.status === "UNAVAILABLE") {
      const version = automatedVersion(collected.calendarVersion, archiveRef);
      const receipt = await ports.append(version);
      return ports.writeStatus({
        status: "UNAVAILABLE", startedAtUtc, asOfUtc: ports.nowUtc(), archiveRef,
        knownAtUtc: version.knownAtUtc, version: receipt.version, inserted: receipt.inserted,
        eventCount: version.events.length, sourceCount: version.sources.length,
        reasonCodes: version.reasonCodes,
        sourceDiagnostics: collected.agriCalendarCoverage[0]?.sourceDiagnostics || [],
      });
    }
    if (collected.calendarVersion.status !== "AVAILABLE") {
      return ports.writeStatus({
        status: "UNKNOWN_COVERAGE", startedAtUtc, asOfUtc: ports.nowUtc(), archiveRef,
        reasonCodes: collected.calendarVersion.reasonCodes,
        sourceDiagnostics: collected.agriCalendarCoverage[0]?.sourceDiagnostics || [],
      });
    }
    const version = automatedVersion(collected.calendarVersion, archiveRef);
    const receipt = await ports.append(version);
    return ports.writeStatus({
      status: "AVAILABLE", startedAtUtc, asOfUtc: ports.nowUtc(), archiveRef,
      knownAtUtc: version.knownAtUtc, version: receipt.version, inserted: receipt.inserted,
      eventCount: version.events.length, sourceCount: version.sources.length,
      freshUntilUtc: new Date(Date.parse(version.knownAtUtc)
        + GRAINS_CALENDAR_MAX_AGE_SECONDS * 1000).toISOString(),
      reasonCodes: [],
    });
  } catch (error) {
    // Never serialize provider responses, connection strings, or arbitrary exception messages.
    const code = /^[A-Z][A-Z0-9_]{3,120}$/.test(error.message)
      ? error.message : "CALENDAR_REFRESH_FAILED";
    return ports.writeStatus({
      status: "UNAVAILABLE", startedAtUtc, asOfUtc: ports.nowUtc(), archiveRef,
      reasonCodes: [code],
    });
  }
}

function automatedVersion(version, archiveRef) {
  const identity = JSON.stringify({
    datasetVersion: version.datasetVersion,
    knownAtUtc: version.knownAtUtc,
    automation: GRAINS_CALENDAR_AUTOMATION_VERSION,
  });
  return {
    ...version,
    sourceVersionHash: `sha256:${createHash("sha256").update(identity).digest("hex")}`,
    metadata: {
      ...version.metadata,
      ingestion_mode: GRAINS_CALENDAR_AUTOMATION_VERSION,
      freshness_max_age_seconds: GRAINS_CALENDAR_MAX_AGE_SECONDS,
      raw_archive: archiveRef,
    },
  };
}
