#!/usr/bin/env node
import pg from "pg";
import path from "node:path";
import { refreshGrainsCalendar } from "../src/application/refresh-grains-calendar.js";
import { createGrainsCalendarFileArchive } from "../src/adapters/grains-calendar-file-archive.js";
import { createUsdaCalendarCollection } from "../src/adapters/usda-grains-calendar-refresh-source.js";
import { appendGrainsCalendarVersion } from "../src/persistence/postgres-grains-calendar-ledger.js";
import { withGrainsCalendarRefreshLease } from "../src/persistence/postgres-grains-calendar-refresh-lease.js";
import {
  createDeploymentProducerClient,
  runWithDeploymentProducerAdmission,
} from "../src/persistence/postgres-deployment-producer-admission.js";
import {
  GRAINS_CALENDAR_POLICY_V1,
  requireGrainsCalendarSourcePolicy,
} from "../src/grains-calendar-source-policy.js";

main().catch(() => {
  console.error(JSON.stringify({ status: "UNAVAILABLE", reasonCodes: ["CALENDAR_REFRESH_BOOTSTRAP_FAILED"] }));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const enabled = process.env.DESK_GRAINS_CALENDAR_ENABLED;
  if (enabled !== undefined && !["true", "false"].includes(enabled))
    throw new Error("CALENDAR_REFRESH_ENABLED_INVALID");
  const policyId = process.env.DESK_GRAINS_CALENDAR_SOURCE_POLICY || GRAINS_CALENDAR_POLICY_V1;
  requireGrainsCalendarSourcePolicy(policyId);
  const nowUtc = () => new Date().toISOString();
  const mode = enabled === "true" ? "ENABLED" : "DISABLED";
  const connectionString = process.env.DESK_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("CALENDAR_DATABASE_REQUIRED");
  const pool = mode === "ENABLED" ? new pg.Pool({
    connectionString, max: 3, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000, statement_timeout: 30000,
    application_name: "desk-grains-calendar-refresh",
  }) : null;
  const admissionClient = createDeploymentProducerClient({
    connectionString,
    applicationName: "desk-grains-calendar-refresh-admission",
  });
  try {
    const outcome = await runWithDeploymentProducerAdmission(admissionClient, async () => {
      const archive = createGrainsCalendarFileArchive(args);
      return refreshGrainsCalendar({ mode }, {
        nowUtc,
        collect: createUsdaCalendarCollection({
          nowUtc, archiveDocument: archive.archiveDocument, policyId,
        }),
        archive: archive.archiveCollection,
        append: (version) => appendGrainsCalendarVersion(pool, version),
        exclusive: (work) => withGrainsCalendarRefreshLease(pool, work),
        writeStatus: archive.writeStatus,
      });
    });
    const result = outcome.executed ? outcome.value : outcome;
    console.log(JSON.stringify(result));
    if (!["AVAILABLE", "ALREADY_RUNNING", "DISABLED_BY_POLICY", "DEPLOYMENT_PRODUCER_HOLD_ACTIVE"].includes(result.status)) process.exitCode = 1;
  } finally { await pool?.end(); }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!["--output-root", "--status-file"].includes(key) || !value || value.startsWith("--") || parsed[key])
      throw new Error("CALENDAR_REFRESH_ARGUMENT_INVALID");
    parsed[key] = value;
  }
  if (!parsed["--output-root"] || !parsed["--status-file"])
    throw new Error("CALENDAR_REFRESH_PATHS_REQUIRED");
  return { outputRoot: path.resolve(parsed["--output-root"]), statusFile: path.resolve(parsed["--status-file"]) };
}
