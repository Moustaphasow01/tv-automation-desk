import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { sha256 } from "../src/adapter/artifact-archive.js";
import { ForensicIndexReader, publishForensicIndex } from "../src/adapter/forensic-index.js";
import { ForensicArtifacts } from "../src/application/forensic-artifacts.js";
import { ForensicMarket } from "../src/application/forensic-market.js";
import { cropForensicPng } from "../src/adapter/forensic-png.js";

function png() {
  const crc = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let j = 0; j < 8; j++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (type, bytes) => { const b = Buffer.alloc(bytes.length + 12); b.writeUInt32BE(bytes.length);
    b.write(type, 4); bytes.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; };
  const header = Buffer.from([0,0,0,2,0,0,0,2,8,6,0,0,0]);
  const raw = Buffer.from([0,255,0,0,255,0,255,0,255,0,0,0,255,255,255,255,255,255]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
test("indexed files idempotent and content-addressed; corruption is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-forensic-test-"));
  const snapshots = [{ summary: { date: "2026-07-02" }, facts: [1,2,3] }];
  const first = await publishForensicIndex({ root, snapshots, generatedAt: "A" });
  const second = await publishForensicIndex({ root, snapshots, generatedAt: "B" });
  assert.equal(first.catalogue_sha256, second.catalogue_sha256);
  const reader = new ForensicIndexReader(root); assert.deepEqual((await reader.get("2026-07-02")).facts, [1,2,3]);
  const catalogue = await reader.catalogue(); await writeFile(path.join(root, `${catalogue.days[0].snapshot_sha256}.json`), "tampered");
  await assert.rejects(new ForensicIndexReader(root).get("2026-07-02"), /FORENSIC_INDEX_HASH_MISMATCH/);
});
test("PNG crop is lossless, bounds checked, source unchanged, no resampling", () => {
  const bytes = png(), before = sha256(bytes), cropped = cropForensicPng({ bytes, x: 1, y: 1, width: 1, height: 1 });
  assert.equal(cropped.bytes.readUInt32BE(16), 1); assert.equal(cropped.bytes.readUInt32BE(20), 1);
  assert.equal(sha256(bytes), before);
  assert.throws(() => cropForensicPng({ bytes, x: 1, y: 1, width: 2, height: 1 }), /FORENSIC_CROP_BOUNDS_INVALID/);
  const broken = Buffer.from(bytes); broken[broken.length - 1] ^= 1;
  assert.throws(() => cropForensicPng({ bytes: broken, x: 0, y: 0, width: 1, height: 1 }), /FORENSIC_PNG_CRC_INVALID/);
});
test("artifact response rehashes exact bytes; native table is not OCR; missing gap artifacts unavailable", async () => {
  const bytes = png(), audit = Buffer.from('{"published_tables":[{"rows":1,"columns":1,"cells":[{"text":"AUDIT"}]}]}');
  const day = { definition: {}, run_meta: {}, sources: [
    { path: "replay/5m_final.png", sha256: sha256(bytes), provenance: { source_sha256: sha256(bytes) } },
    { path: "replay/audit.json", sha256: sha256(audit), provenance: { source_sha256: sha256(audit) } }] };
  const files = { "replay/5m_final.png": bytes, "replay/audit.json": audit };
  const api = new ForensicArtifacts({ index: { get: async () => day }, archive: { read: async (_d, p) => files[p] }, fingerprint: sha256, crop: cropForensicPng });
  assert.equal((await api.artifact({ date: "2026-07-02", artifact: "5m_final" })).images[0].sha256, sha256(bytes));
  assert.equal((await api.panel({ date: "2026-07-02", view: "AUDIT" })).ocr, false);
  assert.equal((await api.artifact({ date: "2026-07-03", artifact: "positions_final" })).reason, "NOT_PERSISTED");
  files["replay/5m_final.png"] = Buffer.from("corrupt");
  await assert.rejects(api.artifact({ date: "2026-07-02", artifact: "5m_final" }), /FORENSIC_INTEGRITY_VIOLATION/);
});
test("no persisted series means unavailable, even when event OHLC exists; no provider calls", async () => {
  const market = new ForensicMarket({ index: { get: async () => ({ identity: { date: "2026-07-02" }, events: [{ OHLC: { O: 1, H: 2, L: 0, C: 1 } }] }) } });
  const args = { date: "2026-07-02", timeframe: "1m", start_time: "A", end_time: "B" };
  assert.equal((await market.bars(args)).reason, "NOT_PERSISTED");
  assert.equal((await market.interactions(args)).available, false);
});
