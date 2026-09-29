import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fixture, DAY, PLAN } from "./support.js";

test("full technical chain freezes exact bytes, excludes all results from builder and is idempotent", async () => {
  const f = await fixture();
  await f.archive.put(DAY, "replay/forbidden-future.txt", "future result must never be sent");
  const result = await f.workflow.execute(DAY);
  assert.equal(result.state, "COMPLETED");
  assert.equal(result.capture_count, 8);
  assert.equal(f.submissions.length, 1);
  assert.deepEqual(Object.keys(f.submissions[0]).sort(), ["images", "manifest", "manifest_sha256", "request_id"]);
  assert.equal(f.submissions[0].images.length, 8);
  assert.ok(!JSON.stringify(f.submissions).includes("forbidden-future"));
  assert.equal((await f.archive.read(DAY, "plan/PLAN_SMC3.txt")).toString(), PLAN);
  assert.equal(f.tradingView.loaded.plan_text, PLAN);
  assert.equal(f.tradingView.loaded.meta.status, "FROZEN");
  assert.ok(f.repository.events.some(row => row.state === "FROZEN"));
  const before = f.calls.length;
  await f.workflow.execute(DAY);
  assert.equal(f.calls.length, before);
  const audit = await f.archive.readJson(DAY, "replay/audit.json");
  assert.equal(audit.net_r, undefined);
  assert.ok(await f.archive.read(DAY, "replay/run_meta.json"));
});
test("explicit replay request before freeze performs no capture or provider mutation", async () => {
  const f = await fixture();
  await assert.rejects(f.workflow.execute(DAY, "replay"), /PLAN_NOT_FROZEN/);
  assert.deepEqual(f.calls, []);
});
test("future premarket image fails before builder, plan or replay", async () => {
  const f = await fixture();
  const original = f.tradingView.capturePremarket;
  f.tradingView.capturePremarket = async input => ({ ...await original(input), visible_as_of: "2026-07-01T12:00:00Z" });
  const result = await f.workflow.execute(DAY);
  assert.equal(result.error.code, "CAPTURE_LOOKAHEAD");
  assert.equal(f.submissions.length, 0);
  assert.ok(!f.calls.includes("load"));
});
test("invalid plan is never silently fixed; explicit external replacement required", async () => {
  const f = await fixture();
  const valid = f.syntaxValidator.validate;
  f.syntaxValidator.validate = async input => ({ ...input, syntax_valid: false });
  assert.equal((await f.workflow.execute(DAY)).state, "FAILED_PLAN_VALIDATION");
  await assert.rejects(f.workflow.execute(DAY, "retry"), /NEW_EXTERNAL_PLAN_REQUIRED/);
  assert.ok(!f.calls.includes("replay"));
  f.syntaxValidator.validate = valid;
  assert.equal((await f.workflow.execute(DAY, "new-plan")).state, "FROZEN");
  assert.equal(f.submissions.length, 2);
  assert.notEqual(f.submissions[0].request_id, f.submissions[1].request_id);
});
test("tampering after freeze blocks replay", async () => {
  const f = await fixture();
  await f.workflow.execute(DAY, "scenario");
  await writeFile(await f.archive.target(DAY, "plan/PLAN_SMC3.txt"), "tampered by test");
  assert.equal((await f.workflow.execute(DAY, "replay")).error.code, "FROZEN_HASH_MISMATCH");
  assert.ok(!f.calls.includes("load"));
});
test("loaded fingerprint mismatch never starts replay", async () => {
  const f = await fixture();
  f.tradingView.readPlanFingerprint = async () => ({ plan_sha256: "wrong" });
  assert.equal((await f.workflow.execute(DAY)).error.code, "LOADED_PLAN_MISMATCH");
  assert.ok(!f.calls.includes("replay"));
});
test("capture technical retry reuses proven images and scenario pending resumes the same request", async () => {
  const f = await fixture();
  const original = f.tradingView.capturePremarket;
  let fail = true;
  f.tradingView.capturePremarket = async input => {
    if (input.name === "15m_global.png" && fail) { fail = false; throw new Error("temporary"); }
    return original(input);
  };
  assert.equal((await f.workflow.execute(DAY)).state, "FAILED_TECHNICAL");
  assert.equal((await f.workflow.execute(DAY, "retry")).state, "COMPLETED");
  assert.equal(f.calls.filter(call => call === "5m_global.png").length, 1);
  const pending = await fixture();
  const request = pending.scenarioBuilder.request;
  pending.scenarioBuilder.request = async () => ({ status: "PENDING" });
  assert.equal((await pending.workflow.execute(DAY)).state, "WAITING_SCENARIO");
  pending.scenarioBuilder.request = request;
  assert.equal((await pending.workflow.execute(DAY)).state, "COMPLETED");
});
