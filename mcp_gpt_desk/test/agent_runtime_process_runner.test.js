import assert from "node:assert/strict";
import { test } from "node:test";
import { createProcessAgentTaskRunner } from "../src/agent-runtime-supervisor.js";

test("process runner returns a structured error instead of crashing on early input closure", async () => {
  const runner = createProcessAgentTaskRunner({
    command: process.execPath,
    args: ["-e", "process.stdin.destroy(); process.exit(3)"],
    timeoutMs: 5000,
  });
  await assert.rejects(runner.run({ payload: "x".repeat(4 * 1024 * 1024) }), error => {
    assert.ok(["AGENT_RUNNER_STDIN_FAILED", "AGENT_RUNNER_EXIT_FAILED"].includes(error.code));
    assert.equal(error.retryable, true);
    assert.ok(!error.message.includes("x".repeat(100)));
    return true;
  });
});

test("process runner still delivers its JSON payload and returns the real response", async () => {
  const runner = createProcessAgentTaskRunner({
    command: process.execPath,
    args: ["-e", "let s='';process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({ok:true,id:JSON.parse(s).id})))"],
    timeoutMs: 5000,
  });
  assert.deepEqual(await runner.run({ id: "bounded-context-task" }), { ok: true, id: "bounded-context-task" });
});

test("process runner reports a failed spawn without an unhandled input error", async () => {
  const runner = createProcessAgentTaskRunner({
    command: "definitely-missing-desk-task-runner-executable",
    timeoutMs: 5000,
  });
  await assert.rejects(runner.run({ id: "not-spawned" }), error => {
    assert.equal(error.retryable, true);
    assert.ok(["ENOENT", "AGENT_RUNNER_STDIN_FAILED"].includes(error.code));
    return true;
  });
});
