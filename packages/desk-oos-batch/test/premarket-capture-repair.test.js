import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PremarketCaptureRepair } from "../src/application/premarket-capture-repair.js";
import { validateManifest, validateCapture } from "../src/domain/evidence-contract.js";
import { sha256, jsonBytes, decodePng } from "../src/adapter/artifact-archive.js";
import { fixture, DAY } from "./support.js";

async function brokenFixture() {
  const f = await fixture(); await f.workflow.execute(DAY, "capture");
  const original = await f.archive.readJson(DAY, "premarket/manifest.json");
  const broken = structuredClone(original), capture = "4h_zoom.png";
  const target = broken.captures.find(c => c.path === capture);
  target.capture_cutoff = new Date(DAY.cutoff).toISOString(); target.visible_as_of = new Date(Date.parse(DAY.cutoff) - 1000).toISOString();
  const { manifest_sha256, ...content } = broken; broken.manifest_sha256 = sha256(jsonBytes(content));
  await writeFile(await f.archive.target(DAY, "premarket/manifest.json"), jsonBytes(broken));
  await f.repository.save(await f.repository.get(), { manifest_sha256: broken.manifest_sha256 }, "2026-10-03T09:00:00Z");
  const repair = new PremarketCaptureRepair({ ...f, fingerprint: sha256, encodeJson: jsonBytes, decodeImage: decodePng, clock: () => "2026-10-03T09:00:00Z" });
  const command = { day: DAY, capture, expected_manifest_sha256: broken.manifest_sha256 };
  return { ...f, original, broken, repair, command };
}

test("validation refuses the exact 07:00 H4 zoom failure and mismatched paired bounds", async () => {
  const f = await brokenFixture();
  assert.throws(() => validateManifest(f.broken, DAY), /CAPTURE_UNCLOSED_BAR/);
  const proof = await f.archive.readJson(DAY, "evidence/4h_zoom.png.json");
  assert.throws(() => validateCapture({ ...proof, capture_cutoff: "2026-07-01T07:00:00Z", visible_as_of: "2026-07-01T06:59:59Z" }, proof), /CAPTURE_UNCLOSED_BAR/);
  const paired = structuredClone(f.original), zoom = paired.captures.find(c => c.path === "4h_zoom.png");
  Object.assign(zoom, { last_bar_open: "2026-06-30T22:00:00Z", last_bar_close: "2026-07-01T02:00:00Z", capture_cutoff: "2026-07-01T02:00:00Z", visible_as_of: "2026-07-01T01:59:59Z" });
  assert.throws(() => validateManifest(paired, DAY), /MANIFEST_VIEW_CUTOFF_MISMATCH/);
});

test("targeted repair recaptures once, changes the manifest hash, preserves seven captures and triggers no replay/plan", async () => {
  const f = await brokenFixture(), beforeCalls = f.calls.length;
  const a = await f.repair.execute(f.command), b = await f.repair.execute(f.command);
  assert.deepEqual(a, b); assert.notEqual(a.manifest_sha256, f.broken.manifest_sha256);
  assert.deepEqual(f.calls.slice(beforeCalls), ["prepare", "4h_zoom.png"]);
  const next = await f.archive.readJson(DAY, "premarket/manifest.json");
  assert.deepEqual(next.captures.filter(c => c.path !== "4h_zoom.png"), f.original.captures.filter(c => c.path !== "4h_zoom.png"));
  assert.equal(a.state, "PREMARKET_READY"); assert.equal(a.replay_triggered, false); assert.equal(a.plan_modified, false);
  assert.equal(f.repository.row.plan_sha256, undefined);
  const backup = await f.archive.read(DAY, `evidence/premarket-repair-${f.broken.manifest_sha256}/original-premarket_manifest.json`);
  assert.deepEqual(backup, jsonBytes(f.broken));
});

test("frozen registry or metadata halts before UI, files or plan can change", async () => {
  for (const source of ["registry", "metadata"]) {
    const f = await brokenFixture(), before = await f.archive.read(DAY, "premarket/manifest.json"), count = f.calls.length;
    if (source === "registry") f.repository.row.plan_sha256 = "f".repeat(64);
    else await f.archive.putJson(DAY, "plan/plan_meta.json", { status: "FROZEN", plan_sha256: "f".repeat(64) });
    await assert.rejects(f.repair.execute(f.command), /FROZEN_BUNDLE_INTEGRITY_VIOLATION/);
    assert.equal(f.calls.length, count); assert.deepEqual(await f.archive.read(DAY, "premarket/manifest.json"), before);
  }
});

test("interrupted replacement resumes from durable journal without a second capture", async () => {
  const f = await brokenFixture(), original = f.archive.replaceUnfrozenCapture.bind(f.archive), start = f.calls.length;
  let fail = true;
  f.archive.replaceUnfrozenCapture = async (day, input) => { if (input.name === "premarket/manifest.json" && fail) { fail = false; throw new Error("TEST_CRASH"); } return original(day, input); };
  await assert.rejects(f.repair.execute(f.command), /TEST_CRASH/);
  const result = await f.repair.execute(f.command);
  assert.equal(result.state, "PREMARKET_READY"); assert.deepEqual(f.calls.slice(start), ["prepare", "4h_zoom.png"]);
});

test("repair archive rejects every plan and replay replacement path", async () => {
  const f = await fixture();
  for (const name of ["plan/PLAN_SMC3.txt", "replay/audit.json", "../manifest.json"]) {
    await assert.rejects(f.archive.replaceUnfrozenCapture(DAY, { name, repair_id: "a".repeat(64), bytes: Buffer.from("TEST_ONLY") }), /CAPTURE_REPAIR_PATH_REJECTED/);
  }
});

test("technical recapture preserves explicitly supplied future-cycle calendar evidence", async () => {
  const f = await brokenFixture();
  const calendar = { source: "SYNTHETIC_TEST_ONLY", version: "fixture/1", early_close: true };
  f.broken.session_calendar = calendar;
  const { manifest_sha256, ...content } = f.broken;
  f.broken.manifest_sha256 = sha256(jsonBytes(content));
  await writeFile(await f.archive.target(DAY, "premarket/manifest.json"), jsonBytes(f.broken));
  await f.repository.save(await f.repository.get(), { manifest_sha256: f.broken.manifest_sha256 }, "2026-10-03T09:00:00Z");
  const receipt = await f.repair.execute({ ...f.command, expected_manifest_sha256: f.broken.manifest_sha256 });
  assert.equal(receipt.state, "PREMARKET_READY");
  assert.deepEqual((await f.archive.readJson(DAY, "premarket/manifest.json")).session_calendar, calendar);
});
