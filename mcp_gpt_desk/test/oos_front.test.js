import test from "node:test";
import assert from "node:assert/strict";
import { handleOosHttp, isOosMethod, isOosWrite, requireOosAuth } from "../src/front-oos-batch.js";
import { fixture, DAY } from "../../packages/desk-oos-batch/test/support.js";
const auth = { ok: true, kind: "operator_session", scopes: ["desk.read", "desk.write"] };
function context(view, query = {}) {
  const output = {};
  return { req: { method: "GET" }, res: { writeHead(status, headers) { output.status = status; output.headers = headers; }, end(bytes) { output.bytes = bytes; } },
    pathname: `/front-api/v1/oos-batch/${view}`, query, auth, output,
    sendJson(res, status, value, headers) { Object.assign(output, { status, value, headers }); } };
}
test("OOS routes reject anonymous reads and unscoped writes; no broker route", () => {
  for (const kind of ["anonymous", "rest_read", undefined]) assert.throws(() => requireOosAuth({ ...auth, kind }, false), { code: "OOS_AUTH_REQUIRED" });
  assert.throws(() => requireOosAuth({ ...auth, scopes: ["desk.read"] }, true), { code: "OOS_SCOPE_REQUIRED" });
  assert.equal(isOosMethod("/front-api/v1/oos-batch/orders", "POST"), false);
  assert.equal(isOosWrite("/front-api/v1/oos-batch/days", "POST"), false);
  assert.equal(isOosMethod("/front-api/v1/oos-batch/commands", "GET"), false);
});
test("BFF lists archived premarket images under correct path and never exposes evidence/private candidates", async () => {
  const f = await fixture(), row = await f.workflow.execute(DAY, "capture");
  const runtime = { ...f, repository: { get: async () => row, timeline: async () => [] } };
  const ctx = context("day", { batch_id: DAY.batch_id, date: DAY.date });
  await handleOosHttp(ctx, async () => runtime);
  assert.equal(ctx.output.status, 200);
  assert.equal(ctx.output.value.artifacts.filter(p => p.endsWith(".png")).length, 8);
  assert.ok(ctx.output.value.artifacts.includes("premarket/4h_zoom.png"));
  const image = context("artifact", { ...ctx.query, name: "premarket/4h_zoom.png" });
  await handleOosHttp(image, async () => runtime);
  assert.equal(image.output.headers["content-type"], "image/png");
  assert.equal(image.output.bytes.subarray(1, 4).toString(), "PNG");
  const invalid = context("artifact", { ...ctx.query, name: "../evidence/candidate-1.json" });
  await handleOosHttp(invalid, async () => runtime);
  assert.equal(invalid.output.status, 404);
});
test("POST only enqueues a command; provider and replay are not called in HTTP request", async () => {
  let enqueued = 0;
  const ctx = context("commands"); ctx.req.method = "POST";
  ctx.readJsonBody = async () => ({ command_id: "fixture-command", action: "capture" });
  await handleOosHttp(ctx, async () => ({ commands: { enqueue: async (body, id) => { enqueued++; assert.equal(id, body.command_id); return { status: "QUEUED" }; } } }));
  assert.equal(enqueued, 1); assert.equal(ctx.output.status, 202);
  assert.equal(ctx.output.value.status, "QUEUED");
});

test("BFF preparation endpoints invoke capture-only use cases, reject extra fields and scope writes", async () => {
  const calls = [], runtime = { preparations: { prepare: async date => { calls.push(date); return { date, state: "CAPTURING" }; },
    prepareRange: async (start, end) => { calls.push([start, end]); return { batch_id: "TEST", status: "RUNNING" }; },
    status: async filters => ({ filters, days: [] }) } };
  const ctx = context("prepare-premarket"); ctx.req.method = "POST"; ctx.readJsonBody = async () => ({ date: "2026-07-29" });
  await handleOosHttp(ctx, async () => runtime); assert.equal(ctx.output.status, 202);
  const bad = context("prepare-range"); bad.req.method = "POST";
  bad.readJsonBody = async () => ({ start_date: "2026-07-27", end_date: "2026-07-29", plan_text: "FORBIDDEN" });
  await handleOosHttp(bad, async () => runtime); assert.equal(bad.output.value.code, "PREPARATION_FIELDS_INVALID");
  const read = context("batch-status", { month: "2026-07" });
  await handleOosHttp(read, async () => runtime); assert.deepEqual(read.output.value.filters, { month: "2026-07" });
  const denied = context("prepare-premarket"); denied.req.method = "POST"; denied.auth = { ...auth, scopes: ["desk.read"] };
  await assert.rejects(handleOosHttp(denied, async () => runtime), { code: "OOS_SCOPE_REQUIRED" });
  assert.deepEqual(calls, ["2026-07-29"]);
});
