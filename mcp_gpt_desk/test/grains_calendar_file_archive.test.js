import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGrainsCalendarFileArchive } from "../src/adapters/grains-calendar-file-archive.js";

async function fixture(t) {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "desk-calendar-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const statusFile = path.join(outputRoot, "status.json");
  return { outputRoot, statusFile, archive: createGrainsCalendarFileArchive({ outputRoot, statusFile }) };
}

test("calendar raw documents and receipts are immutable, content addressed and replayable", async (t) => {
  const { archive, outputRoot } = await fixture(t);
  const input = { source: { sourceId: "test", url: "https://www.usda.gov/test" },
    text: "official fixture text\r\n", receivedAtUtc: "2026-09-07T08:00:00Z" };
  const receiptRef = await archive.archiveDocument(input);
  assert.equal(await archive.archiveDocument(input), receiptRef);
  const receipt = JSON.parse(await readFile(path.join(outputRoot, receiptRef), "utf8"));
  assert.equal(await readFile(path.join(outputRoot, receipt.document), "utf8"), input.text);
  assert.equal(receipt.receivedAtUtc, input.receivedAtUtc);
  await writeFile(path.join(outputRoot, receipt.document), "corrupt test archive");
  await assert.rejects(archive.archiveDocument(input), /CALENDAR_ARCHIVE_HASH_CONFLICT/);
});

test("a failed refresh preserves last-success provenance, without presenting it as a fresh success", async (t) => {
  const { archive, statusFile } = await fixture(t);
  await archive.writeStatus({ status: "AVAILABLE", knownAtUtc: "2026-09-07T08:00:00Z", version: { id: "v1" } });
  await archive.writeStatus({ status: "UNAVAILABLE", asOfUtc: "2026-09-07T08:30:00Z", reasonCodes: ["USDA_HTTP_403"] });
  const result = JSON.parse(await readFile(statusFile, "utf8"));
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.lastSuccessfulAtUtc, "2026-09-07T08:00:00Z");
  assert.deepEqual(result.lastSuccessfulVersion, { id: "v1" });
  assert.equal(result.knownAtUtc, undefined);
});

test("a persisted partial version does not replace or extend the last successful calendar", async (t) => {
  const { archive, statusFile } = await fixture(t);
  await archive.writeStatus({
    status: "AVAILABLE", knownAtUtc: "2026-09-07T08:00:00Z",
    freshUntilUtc: "2026-09-07T14:00:00Z", version: { id: "full-v1" },
  });
  await archive.writeStatus({
    status: "UNAVAILABLE", knownAtUtc: "2026-09-07T08:30:00Z",
    version: { id: "partial-v2" }, reasonCodes: ["USDA_SOURCE_HTTP_403"],
  });
  const result = JSON.parse(await readFile(statusFile, "utf8"));
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.knownAtUtc, "2026-09-07T08:30:00Z");
  assert.deepEqual(result.version, { id: "partial-v2" });
  assert.equal(result.lastSuccessfulAtUtc, "2026-09-07T08:00:00Z");
  assert.deepEqual(result.lastSuccessfulVersion, { id: "full-v1" });
  assert.equal(result.freshUntilUtc, undefined);
});

test("binary PDF receipts preserve exact bytes and content hash", async (t) => {
  const { archive, outputRoot } = await fixture(t);
  const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 255]);
  const receiptRef = await archive.archiveDocument({
    source: {
      sourceId: "dorman_2026_09", url: "https://www.dormantrading.com/calendar.pdf",
      archiveSuffix: ".pdf",
    },
    bytes,
    receivedAtUtc: "2026-09-07T08:00:00Z",
  });
  const receipt = JSON.parse(await readFile(path.join(outputRoot, receiptRef), "utf8"));
  assert.match(receipt.document, /\.pdf$/);
  assert.deepEqual(await readFile(path.join(outputRoot, receipt.document)), Buffer.from(bytes));
  assert.equal(receipt.bytes, bytes.byteLength);
});
