import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { discoverResearchModels,discoverResearchQuota } from "../src/oos-research-capabilities.js";
import { selectResearchModel } from "../../packages/desk-oos-research/src/domain/research-governance.js";

function transport(result, { silent = false } = {}) {
  const messages = [], child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.killed = true; };
  child.stdin = new Writable({ write(data, encoding, done) {
    const request = JSON.parse(data.toString()); messages.push(request);
    if (!silent && request.id === 1) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`));
    if (!silent && request.id === 2) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: 2, result })}\n`));
    done();
  } });
  const options=[];
  return { child, messages,options,spawnProcess: (file,args,value) => {options.push(value);return child;} };
}
test("Astra is selected only if present in the actual model/list; no conversation or inference launched", async () => {
  const t = transport({ data: [{ id: "gpt-6-astra", model: "gpt-6-astra", supportedReasoningEfforts: [{ reasoningEffort: "xhigh" }] }], nextCursor: null });
  const capabilities = await discoverResearchModels({ codex_bin: "codex", spawnProcess: t.spawnProcess });
  assert.equal(selectResearchModel(capabilities).identifier, "gpt-6-astra");
  assert.equal(capabilities[0].capability_source, "CODEX_APP_SERVER_MODEL_LIST");
  assert.deepEqual(t.messages.map(r => r.method), ["initialize", "initialized", "model/list"]);
  assert.equal(t.child.killed, true);
});
test("unavailable preferred models are not invented; unknown or paginated catalogue fails closed", async () => {
  for (const result of [{ data: [{ id: "OTHER_MODEL" }], nextCursor: null }, { data: [], nextCursor: "more" }]) {
    const t = transport(result);
    await assert.rejects(discoverResearchModels({ codex_bin: "codex", spawnProcess: t.spawnProcess }), /RESEARCH_MODEL_(PREFERENCE_NOT_AVAILABLE|CATALOGUE_INCOMPLETE)/);
  }
});
test("capability discovery timeout is bounded and shuts down the read-only client", async () => {
  const t = transport({}, { silent: true });
  await assert.rejects(discoverResearchModels({ codex_bin: "codex", timeout_ms: 5, spawnProcess: t.spawnProcess }), /DISCOVERY_TIMEOUT/);
  assert.equal(t.child.killed, true);
});
test("provider quota is read without inference, reset, email or account identifiers",async()=>{
  const t=transport({rateLimitsByLimitId:{codex:{primary:{usedPercent:100,resetsAt:1800000000},
    secondary:null}},account:{email:'never-expose'},rateLimitResetCredits:{availableCount:2}});
  const snapshot=await discoverResearchQuota({codex_bin:'codex',spawnProcess:t.spawnProcess});
  assert.deepEqual(t.messages.map(r=>r.method),['initialize','initialized','account/rateLimits/read']);
  assert.equal(snapshot.windows[0].used_percent,100);
  assert.equal(snapshot.windows[0].resets_at,new Date(1800000000000).toISOString());
  assert.ok(!JSON.stringify(snapshot).includes('never-expose'));
  assert.ok(!JSON.stringify(snapshot).includes('credits'));
});
test("read-only metadata subprocess uses the authorized service home, not a different login, without OOS credentials",async()=>{
  const t=transport({rateLimitsByLimitId:{codex:{primary:{usedPercent:1,resetsAt:1800000000}}}});
  await discoverResearchQuota({codex_bin:'codex',spawnProcess:t.spawnProcess,
    environment:{CODEX_HOME:'C:/TEST_ONLY/service-auth',OOS_OPERATOR_TOKEN:'NOT_A_REAL_SECRET'}});
  assert.equal(t.options[0].env.CODEX_HOME,'C:/TEST_ONLY/service-auth');
  assert.equal(t.options[0].env.OOS_OPERATOR_TOKEN,undefined);
});
