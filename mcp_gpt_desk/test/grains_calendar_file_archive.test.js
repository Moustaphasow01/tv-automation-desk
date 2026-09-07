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
