import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { batchDays } from "../src/domain/batch-contract.js";
import { verifyFrozen, validateSyntaxReceipt, validateCapture } from "../src/domain/evidence-contract.js";
import { ArtifactArchive, sha256 } from "../src/adapter/artifact-archive.js";

const config = { batch_id: "test", month: "2026-07", cutoff_time: "09:00", symbol: "MES1!" };
test("month includes every calendar date without inventing a trading calendar", () => {
  assert.equal(batchDays(config).length, 31);
  assert.equal(batchDays({ ...config, month: "2026-08" }).length, 31);
  assert.equal(batchDays({ ...config, month: undefined, from: "2026-07-30", to: "2026-08-02" }).length, 4);
  assert.throws(() => batchDays({ ...config, cutoff_time: "25:00" }));
  assert.throws(() => batchDays({ ...config, date: "2026-07-32" }));
});
test("freeze and syntax receipts cannot imply approval of trading semantics", () => {
  assert.throws(() => verifyFrozen({ meta: { status: "PLAN_RECEIVED" } }), /PLAN_NOT_FROZEN/);
  assert.throws(() => validateSyntaxReceipt({ syntax_valid: true, validation_scope: "TRADING_POLICY" }, {}), /PLAN_SYNTAX_INVALID/);
});
test("closed-bar evidence rejects a candle ending after its capture bound", () => {
  const expected = { symbol: "SYNTHETIC", timeframe: "4h", view: "global", date: "2026-07-30", cutoff: "2026-07-30T09:00:00+02:00" };
  const proof = { ...expected, replay: true, visible_as_of: "2026-07-30T05:59:59Z", captured_at: "2026-09-30T00:00:00Z",
    source: "SYNTHETIC", image_base64: "test-only", bar_policy: "CLOSED_ONLY", capture_cutoff: "2026-07-30T06:00:00Z",
    last_bar_open: "2026-07-30T02:00:00Z", last_bar_close: "2026-07-30T06:00:00Z" };
  assert.doesNotThrow(() => validateCapture(proof, expected));
  assert.throws(() => validateCapture({ ...proof, last_bar_close: "2026-07-30T10:00:00Z" }, expected), /CAPTURE_UNCLOSED_BAR/);
});
test("original bytes, whitespace and line order survive, and writes never replace them", async () => {
  const archive = new ArtifactArchive(await mkdtemp(path.join(os.tmpdir(), "oos-contract-")));
  const day = batchDays(config)[0];
  const bytes = Buffer.from("external test document\r\n  opaque input\r\n");
  await archive.put(day, "plan/PLAN_SMC3.txt", bytes);
  await archive.put(day, "plan/PLAN_SMC3.txt", bytes);
  assert.deepEqual(await archive.read(day, "plan/PLAN_SMC3.txt"), bytes);
  assert.equal(sha256(await readFile(await archive.target(day, "plan/PLAN_SMC3.txt"))), sha256(bytes));
  await assert.rejects(archive.put(day, "plan/PLAN_SMC3.txt", Buffer.from("changed")), /IMMUTABLE_ARTIFACT_CONFLICT/);
  await assert.rejects(archive.read(day, "../secret"), /ARTIFACT_PATH_INVALID/);
});
