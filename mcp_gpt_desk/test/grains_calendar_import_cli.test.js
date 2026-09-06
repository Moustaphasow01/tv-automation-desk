import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCalendarEvidenceImport } from "../scripts/import_grains_calendar_evidence.mjs";

test("calendar import adds a new calendar without mutating frozen candles or source input", async (t) => {
  const fixture = await createFixture(t);
  const artifact = await run(fixture);
  const replay = JSON.parse(await readFile(fixture.replayPath, "utf8"));
  assert.equal(artifact.replay_input.original_input_sha256, fixture.inputHash);
  assert.deepEqual(replay.candles, fixture.input.candles);
  assert.deepEqual(JSON.parse(await readFile(fixture.baseInputPath, "utf8")), fixture.input);
  assert.equal(replay.agriCalendarVersions.length, 1);
  assert.equal(artifact.calendarVersion.status, "AVAILABLE");
});

test("calendar import refuses to overwrite an existing artifact", async (t) => {
  const fixture = await createFixture(t);
  await run(fixture);
  await assert.rejects(() => run(fixture), /CALENDAR_OUTPUT_ALREADY_EXISTS/);
});

test("calendar import refuses a replay output that equals the frozen source input", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    () => run(fixture, { replayPath: fixture.baseInputPath }),
    /FROZEN_INPUT_OVERWRITE_FORBIDDEN/,
  );
  assert.deepEqual(JSON.parse(await readFile(fixture.baseInputPath, "utf8")), fixture.input);
});

test("calendar import refuses a frozen input that already contains a calendar", async (t) => {
  const fixture = await createFixture(t, {
    agriCalendarVersions: [{ marketAgriCalendarVersionId: "existing-calendar" }],
  });
  await assert.rejects(() => run(fixture), /REPLAY_CALENDAR_ALREADY_PRESENT_REVIEW_REQUIRED/);
});

test("calendar import refuses a documentary path outside its declared root", async (t) => {
  const fixture = await createFixture(t);
  fixture.manifest.sources[0].documentFile = "../outside.pdf";
  await writeJson(fixture.manifestPath, fixture.manifest);
  await assert.rejects(() => run(fixture), /CALENDAR_DOCUMENT_OUTSIDE_MANIFEST_DIRECTORY/);
});

async function createFixture(t, inputOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "grains-calendar-import-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documents = join(root, "documents");
  const bytes = Buffer.from("reviewed USDA calendar fixture");
  const sourceHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const coverage = {
    start_utc: "2026-08-31T00:00:00Z",
    end_utc: "2026-09-04T23:59:59Z",
    instruments: ["ZC", "ZW"],
  };
  const input = {
    candles: [{ timestamp_utc: "2026-09-01T12:00:00Z", close: 401.25 }],
    source_receipt: { frozen: true },
    ...inputOverrides,
  };
  const manifest = {
    schemaVersion: "grains_calendar_evidence_manifest_v1",
    coverageStart: coverage.start_utc,
    coverageEnd: coverage.end_utc,
    sources: requiredSourceIds().map((sourceId) => {
      const sourceUrl = `https://www.usda.gov/${sourceId}.pdf`;
      return {
        sourceId,
        sourceUrl,
        documentFile: `${sourceId}.pdf`,
        documentSha256: sourceHash,
        coverage,
        review: { citation: "Fixture page 1", scope: "Published schedule" },
        historicalEvidence: {
          kind: "OFFICIAL_DATED_PUBLICATION",
          document_sha256: sourceHash,
          document_url: sourceUrl,
          published_at_utc: "2026-09-01T00:00:00Z",
          citation: "Fixture official publication",
        },
        events: [],
      };
    }),
  };
  const manifestPath = join(root, "manifest.json");
  const baseInputPath = join(root, "frozen-input.json");
  await mkdir(documents, { recursive: true });
  await Promise.all([
    ...manifest.sources.map((source) => writeFile(join(documents, source.documentFile), bytes)),
    writeJson(manifestPath, manifest),
    writeJson(baseInputPath, input),
  ]);
  return {
    root,
    documents,
    manifest,
    manifestPath,
    baseInputPath,
    outputPath: join(root, "calendar-import.json"),
    replayPath: join(root, "augmented-replay.json"),
    input,
    inputHash: createHash("sha256").update(JSON.stringify(input, null, 2) + "\n").digest("hex"),
  };
}

function run(fixture, { replayPath = fixture.replayPath } = {}) {
  return runCalendarEvidenceImport([
    "--manifest", fixture.manifestPath,
    "--output", fixture.outputPath,
    "--retrieved-at", "2026-09-06T12:00:00Z",
    "--document-dir", fixture.documents,
    "--base-input", fixture.baseInputPath,
    "--replay-input", replayPath,
  ]);
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requiredSourceIds() {
  return [
    "usda_nass_release_calendar",
    "usda_wasde_release_schedule",
    "usda_fas_export_sales_schedule",
  ];
}
