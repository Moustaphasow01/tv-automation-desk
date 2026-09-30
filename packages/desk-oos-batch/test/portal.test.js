import test from "node:test";
import assert from "node:assert/strict";
import { fixture, DAY, PLAN } from "./support.js";
import { sha256 } from "../src/adapter/artifact-archive.js";
import { SubmittedPlan } from "../src/application/submitted-plan.js";
import { OosPortal } from "../src/application/oos-portal.js";

async function setup() {
  const f = await fixture();
  f.submittedPlan = new SubmittedPlan({ ...f, fingerprint: sha256, clock: () => "2026-09-30T10:00:00Z" });
  f.repository.list = async () => [await f.repository.get()];
  f.portal = new OosPortal({ runtime: f, batchId: DAY.batch_id, symbol: DAY.symbol, cutoffTime: "09:00" });
  await f.workflow.execute(DAY, "capture");
  return f;
}

test("push preserves exact text and freezes without analyst, replay or hidden scenario cap", async () => {
  const f = await setup();
  const text = PLAN + Array.from({ length: 18 }, (_, i) => `EXTERNAL TEST BRANCH ${i}\r\n`).join("");
  const receipt = await f.portal.submit(DAY.date, text);
  assert.equal(receipt.status, "FROZEN"); assert.equal(receipt.accepted, true);
  assert.equal(receipt.plan_sha256, sha256(text));
  assert.equal((await f.archive.read(DAY, "plan/PLAN_SMC3.txt")).toString("utf8"), text);
  assert.deepEqual(await f.portal.submit(DAY.date, text), receipt);
  assert.equal(f.submissions.length, 0); assert.ok(!f.calls.includes("load")); assert.ok(!f.calls.includes("replay"));
  await assert.rejects(f.portal.submit(DAY.date, text + "changed"), /FROZEN_PLAN_CONFLICT/);
});
test("all remote read surfaces hide injected future results before freeze", async () => {
  const f = await setup();
  f.repository.row.audit = { net_r: 123456789 };
  f.repository.row.run_meta = { future: "SECRET_FUTURE" };
  await f.archive.putJson(DAY, "replay/run_meta.json", { future: "SECRET_FUTURE" });
  await assert.rejects(f.portal.result(DAY.date), /PLAN_NOT_FROZEN/);
  await assert.rejects(f.portal.requestReplay(DAY.date), /PLAN_NOT_FROZEN/);
  for (const response of [await f.portal.premarket(DAY.date), await f.portal.status(DAY.date),
    await f.portal.list("pending"), await f.portal.month("2026-07")]) {
    assert.ok(!JSON.stringify(response).includes("SECRET_FUTURE"));
    assert.ok(!JSON.stringify(response).includes("123456789"));
  }
});
test("syntax refusal preserves original rejected candidate and never produces frozen plan", async () => {
  const f = await setup();
  f.syntaxValidator.validate = async input => ({ ...input, syntax_valid: false });
  assert.equal((await f.portal.submit(DAY.date, PLAN)).status, "FAILED_PLAN_VALIDATION");
  assert.equal((await f.archive.readJson(DAY, "evidence/candidate-1.json")).plan_text, PLAN);
  assert.equal(await f.archive.optionalJson(DAY, "plan/plan_meta.json"), null);
  assert.ok(!f.calls.includes("replay"));
});
test("manifest embeds a verifiable digest excluding only its own digest field", async () => {
  const f = await setup(), bundle = await f.portal.premarket(DAY.date);
  const { manifest_sha256, ...content } = bundle.manifest;
  assert.equal(manifest_sha256, sha256(JSON.stringify(content, null, 2) + "\n"));
  assert.equal(bundle.manifest_sha256, manifest_sha256);
  assert.equal(content.engine_version, "V3.9.8"); assert.equal(content.book_mode, "PORTEFEUILLE_REALISTE");
  assert.equal(bundle.images.length, 8);
});
