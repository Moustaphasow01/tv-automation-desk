import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { validateArtifactList, requiredReplayArtifacts } from "../src/domain/replay-artifacts.js";
import { fixture, DAY } from "./support.js";

test("COMPLETED requires all mandatory artifacts and a separate hash of run_meta", async () => {
  const f = await fixture(), row = await f.workflow.execute(DAY);
  assert.equal(row.state, "COMPLETED");
  const integrity = await f.replay.verifyResults(DAY, row.run_meta);
  for (const name of requiredReplayArtifacts(row.run_meta)) assert.ok(integrity.artifacts.some(x => x.path === name));
  assert.ok(integrity.artifacts.some(x => x.path === "replay/run_meta.json" && /^[a-f0-9]{64}$/.test(x.sha256)));
});
test("a tiny dashboard within the price chart is not a dedicated audit", async () => {
  const f = await fixture(), collect = f.tradingView.collectResults.bind(f.tradingView);
  f.tradingView.collectResults = async input => {
    const result = await collect(input);
    result.capture_provenance["dashboard_final.png"].presentation.dedicated_panel = false;
    return result;
  };
  const row = await f.workflow.execute(DAY);
  assert.equal(row.state, "FAILED_TECHNICAL"); assert.equal(row.error.code, "DEDICATED_AUDIT_REQUIRED");
  assert.equal(await f.archive.optionalJson(DAY, "replay/run_meta.json"), null);
});
test("distinct positions and accessible Pine Logs are mandatory, not optional omissions", async () => {
  for (const mode of ["positions", "logs"]) {
    const f = await fixture(), collect = f.tradingView.collectResults.bind(f.tradingView);
    f.tradingView.collectResults = async input => {
      const result = await collect(input); result[mode === "positions" ? "positions_distinct" : "logs_accessible"] = true;
      return result;
    };
    const row = await f.workflow.execute(DAY);
    assert.equal(row.state, "FAILED_TECHNICAL");
    assert.equal(row.error.code, mode === "positions" ? "RESULT_PROVENANCE_REQUIRED" : "PINE_LOGS_REQUIRED");
  }
});
test("artifact lists cannot omit, duplicate or skip a required hash", () => {
  const meta = { positions_distinct: true, logs_accessible: true };
  const artifacts = requiredReplayArtifacts(meta).map(path => ({ path, sha256: "a".repeat(64) }));
  assert.doesNotThrow(() => validateArtifactList(artifacts, meta));
  assert.throws(() => validateArtifactList(artifacts.slice(1), meta), /RESULT_ARTIFACT_MISSING/);
  assert.throws(() => validateArtifactList([...artifacts, artifacts[0]], meta), /RESULT_ARTIFACT_INVALID/);
  assert.throws(() => validateArtifactList([{ ...artifacts[0], sha256: "" }, ...artifacts.slice(1)], meta), /RESULT_ARTIFACT_INVALID/);
});
test("changed artifact bytes block result re-reading even after completed", async () => {
  const f = await fixture(), row = await f.workflow.execute(DAY);
  await writeFile(await f.archive.target(DAY, "replay/dashboard_final.png"), "SYNTHETIC_TAMPER_TEST_ONLY");
  await assert.rejects(() => f.replay.verifyResults(DAY, row.run_meta), { code: "RESULT_HASH_MISMATCH" });
});
test("partial final capture retries without asking a new external plan or altering freeze", async () => {
  const f = await fixture(), collect = f.tradingView.collectResults.bind(f.tradingView);
  let calls = 0;
  f.tradingView.collectResults = async input => {
    if (++calls === 1) throw Object.assign(new Error("TV_CAPTURE_FAILED"), { code: "TV_CAPTURE_FAILED" });
    return collect(input);
  };
  const failed = await f.workflow.execute(DAY);
  assert.equal(failed.state, "FAILED_TECHNICAL");
  const row = await f.workflow.execute(DAY, "retry");
  assert.equal(row.state, "COMPLETED"); assert.equal(row.plan_sha256, failed.plan_sha256);
  assert.equal(f.submissions.length, 1);
});
