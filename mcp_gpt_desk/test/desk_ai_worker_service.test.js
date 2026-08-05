import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DeskAiWorkerService,
  LocalDeskWorkerFacade,
  normalizeIdempotentTerminalSetupRepair,
  replayAdmissionAgainstLiveCursor,
} from "../src/desk-ai-worker-service.js";
import {
  signDeskContextEvidenceReceipt,
} from "../src/desk-ai-context-capability.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";
import {
  makeNativeMasterV5,
  makeNativeMonitorV2,
} from "./support/native-strategy-fixtures.js";

test("active AI worker owns claim, analysis, save and complete in order", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  const adapter = {
    async analyze() {
      calls.push(["analyze"]);
      return {
        output: {
          save_payload: { monitor_output: nativeLiveMonitorOutput() },
          supplementary_writes: [],
          decision_summary: "WAIT",
          data_quality_status: "ready",
          warnings: [],
        },
        telemetry: { provider: "openai", input_tokens: 120, output_tokens: 30 },
      };
    },
  };
  const worker = new DeskAiWorkerService({
    facade,
    adapter,
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
    heartbeatIntervalMs: 60_000,
  });
  const result = await worker.runOnce();
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(
    calls.filter(([name]) => !["record"].includes(name)).map(([name]) => name),
    ["claim", "read", "analyze", "save:save_manual_monitor", "complete"],
  );
  const saved = calls.find(([name]) => name === "save:save_manual_monitor")[1];
  assert.equal(saved.worker_id, "codex-live-01");
  assert.equal(saved.lease_token, "lease-token-live");
  assert.equal(saved.monitor_output.command.requested_action, "NO_ACTION");
});

test("successive work items reuse one bounded run conversation while retaining backend authority", async () => {
  const calls = [];
  const sessionIds = [];
  const facade = fakeFacade(calls);
  let canonicalThreadId = null;
  let turnCount = 0;
  facade.getConversationSession = async () => ({
    scope: "live",
    scope_id: "front_live_2026-07-28",
    thread_id: canonicalThreadId,
    resume_thread_id: canonicalThreadId,
    last_thread_id: canonicalThreadId,
    turn_count: turnCount,
  });
  facade.recordConversationSession = async (_envelope, telemetry) => {
    canonicalThreadId = telemetry.thread_id;
    turnCount += 1;
  };
  const worker = new DeskAiWorkerService({
    facade,
    adapter: {
      async analyze(input) {
        sessionIds.push(input.sessionId);
        return {
          output: {
            save_payload: { monitor_output: nativeLiveMonitorOutput() },
            supplementary_writes: [],
            decision_summary: "WAIT",
            data_quality_status: "ready",
            warnings: [],
          },
          telemetry: {
            thread_id: input.sessionId || `thread-live-work-${sessionIds.length}`,
            conversation_mode: input.sessionId ? "RESUMED" : "CREATED",
          },
        };
      },
    },
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
    heartbeatIntervalMs: 60_000,
  });

  assert.equal((await worker.runOnce()).status, "COMPLETED");
  assert.equal((await worker.runOnce()).status, "COMPLETED");
  assert.deepEqual(sessionIds, [null, "thread-live-work-1"]);
  assert.equal(canonicalThreadId, "thread-live-work-1");
  assert.equal(turnCount, 2);
});

test("local facade resumes only a monotonic same-runtime conversation and rebases at the turn cap", async () => {
  const documents = new Map();
  const persistence = {
    async getDocument(collection, id) {
      const document = documents.get(`${collection}/${id}`);
      if (!document) throw new Error("document_not_found");
      return structuredClone(document);
    },
    async setDocument(collection, id, value, { merge } = {}) {
      const key = `${collection}/${id}`;
      documents.set(key, merge
        ? { ...(documents.get(key) || {}), ...structuredClone(value) }
        : structuredClone(value));
    },
  };
  const facade = new LocalDeskWorkerFacade({ persistence }, { tools: [] });
  const first = conversationEnvelope("2026-06-11T00:15:00.000Z");
  await facade.recordConversationSession(first, {
    thread_id: "thread-replay-11",
    conversation_mode: "CREATED",
  });

  const next = await facade.getConversationSession(
    conversationEnvelope("2026-06-11T00:30:00.000Z"),
  );
  assert.equal(next.resume_thread_id, "thread-replay-11");
  assert.equal(next.reuse_policy, "BOUNDED_RUN_CONTINUITY");
  assert.equal(next.reuse_immutable_context, true);

  const key = [...documents.keys()][0];
  documents.set(key, { ...documents.get(key), turn_count: 12 });
  const rebased = await facade.getConversationSession(
    conversationEnvelope("2026-06-11T00:45:00.000Z"),
  );
  assert.equal(rebased.resume_thread_id, null);
  assert.equal(rebased.turn_count, 0);
});

test("one replay conversation crosses Master and Monitor while loading each contract artifact once", async () => {
  const documents = new Map();
  const persistence = {
    async getDocument(collection, id) {
      const document = documents.get(`${collection}/${id}`);
      if (!document) throw new Error("document_not_found");
      return structuredClone(document);
    },
    async setDocument(collection, id, value, { merge } = {}) {
      const key = `${collection}/${id}`;
      documents.set(key, merge
        ? { ...(documents.get(key) || {}), ...structuredClone(value) }
        : structuredClone(value));
    },
  };
  const facade = new LocalDeskWorkerFacade({ persistence }, { tools: [] });
  const master = conversationEnvelope("2026-06-11T00:15:00.000Z", "REPLAY_MASTER");
  await facade.recordConversationSession(master, {
    thread_id: "thread-replay-day",
    conversation_mode: "CREATED",
  });

  const firstMonitor = conversationEnvelope("2026-06-11T00:30:00.000Z", "REPLAY_MONITOR");
  const firstMonitorSession = await facade.getConversationSession(firstMonitor);
  assert.equal(firstMonitorSession.resume_thread_id, "thread-replay-day");
  assert.equal(firstMonitorSession.reuse_immutable_context, false);

  await facade.recordConversationSession(firstMonitor, {
    thread_id: "thread-replay-day",
    conversation_mode: "RESUMED",
  });
  const nextMonitor = await facade.getConversationSession(
    conversationEnvelope("2026-06-11T00:45:00.000Z", "REPLAY_MONITOR"),
  );
  assert.equal(nextMonitor.resume_thread_id, "thread-replay-day");
  assert.equal(nextMonitor.reuse_immutable_context, true);

  const stored = [...documents.values()][0];
  assert.equal(stored.turn_count, 2);
  assert.equal(stored.seen_artifact_hashes.length, 2);
});

test("agentic worker requires ten-phase MCP evidence before the first save", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  let analyzeInput = null;
  const worker = new DeskAiWorkerService({
    facade,
    adapter: {
      async analyze(input) {
        analyzeInput = input;
        calls.push(["analyze"]);
        const receipts = agenticContextReceipts(input.contextCapability);
        await input.onContextEvidence(receipts.slice(0, 3));
        return {
          output: {
            schema_version: "desk_ai_analysis_output_v2",
            save_payload: { monitor_output: nativeLiveMonitorOutput() },
            supplementary_writes: [],
            decision_summary: "WAIT",
            data_quality_status: "ready",
            warnings: [],
          },
          telemetry: { provider: "openai" },
          context_evidence_receipts: receipts,
        };
      },
    },
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
    agenticContextEnabled: true,
    contextCapabilityEnv: {
      DATABASE_URL: "postgresql://desk:secret@localhost:5432/desk",
      DESK_OBJECT_ROOT: "/desk/objects",
    },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });

  const result = await worker.runOnce();

  assert.equal(result.status, "COMPLETED");
  assert.match(analyzeInput.prompt, /get_thesis_evolution_context/);
  assert.equal(analyzeInput.contextCapability.scope, "live");
  assert.match(
    analyzeInput.contextCapability.runtime_env.DATABASE_URL,
    /default_transaction_read_only/,
  );
  const completedRun = calls
    .filter(([name]) => name === "record")
    .map(([, document]) => document)
    .find((document) => document.status === "COMPLETED");
  assert.equal(completedRun.research_progress.coverage.percent, 100);
  assert.equal(completedRun.analytical_validation.decision_allowed, true);
  const inProgressRun = calls
    .filter(([name]) => name === "record")
    .map(([, document]) => document)
    .find((document) => document.research_progress?.coverage?.percent === 20);
  assert.equal(inProgressRun.status, "ANALYZING");
  assert.equal(inProgressRun.research_progress.current_phase, "CORE_MARKET");
  assert.equal(
    calls.findIndex(([name]) => name.startsWith("save:"))
      > calls.findIndex(([name, document]) => (
        name === "record" && document.status === "ANALYZING"
      )),
    true,
  );
});

test("agentic worker fails retryably and never saves when one context phase is absent", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  const worker = new DeskAiWorkerService({
    facade,
    adapter: {
      async analyze(input) {
        return {
          output: {
            schema_version: "desk_ai_analysis_output_v2",
            save_payload: { monitor_output: nativeLiveMonitorOutput() },
            supplementary_writes: [],
            decision_summary: "WAIT",
            data_quality_status: "ready",
            warnings: [],
          },
          telemetry: {},
          context_evidence_receipts: resequenceAgenticReceipts(
            agenticContextReceipts(input.contextCapability)
              .filter((receipt) => receipt.phase !== "NEWS"),
            input.contextCapability,
          ),
        };
      },
    },
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
    agenticContextEnabled: true,
    contextCapabilityEnv: {
      DATABASE_URL: "postgresql://desk:secret@localhost:5432/desk",
    },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });

  const result = await worker.runOnce();

  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "AI_ANALYTICAL_RESEARCH_INCOMPLETE");
  assert.equal(result.error.retryable, true);
  assert.equal(calls.some(([name]) => name.startsWith("save:")), false);
  assert.equal(calls.some(([name]) => name === "complete"), false);
});

test("Replay admission ignores an expired LIVE lease at the SQL boundary", async () => {
  const calls = [];
  const persistence = {
    pool: {
      async query(sql, args) {
        calls.push({ sql, args });
        return { rows: [] };
      },
    },
  };

  const result = await replayAdmissionAgainstLiveCursor(persistence, "2026-07-29");

  assert.deepEqual(result, { allowed: true });
  assert.equal(calls[0].args[0], "2026-07-29");
  assert.match(calls[0].sql, /lease_expires_at_utc/);
  assert.match(calls[0].sql, /> now\(\)/);
});

test("Replay admission still yields to a genuinely actionable LIVE cursor", async () => {
  const persistence = {
    pool: {
      async query() {
        return { rows: [{ status: "DUE" }] };
      },
    },
  };

  const result = await replayAdmissionAgainstLiveCursor(persistence, "2026-07-29");

  assert.deepEqual(result, { allowed: false, reason: "live_due" });
});

test("worker fails the protected claim when Codex execution fails", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  const adapter = {
    async analyze() {
      throw Object.assign(new Error("temporary rate limit"), {
        code: "CODEX_RATE_LIMITED",
        retryable: true,
      });
    },
  };
  const worker = new DeskAiWorkerService({
    facade,
    adapter,
    scope: "live",
    workerId: "codex-live-02",
    mode: "active",
  });
  const result = await worker.runOnce();
  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "CODEX_RATE_LIMITED");
  const failure = calls.find(([name]) => name === "fail");
  assert.ok(failure);
  assert.equal(failure[2].retryable, true);
  assert.equal(calls.some(([name]) => name === "complete"), false);
});

test("worker persists useful Codex diagnostics without leaking credentials or lease tokens", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  const adapter = {
    async analyze() {
      throw Object.assign(new Error("Codex exited with code 1."), {
        code: "CODEX_EXEC_FAILED",
        retryable: true,
        details: {
          stderr: [
            "required MCP servers failed to initialize: desk_context",
            "DATABASE_URL=postgresql://desk:super-secret@localhost:5432/desk",
            "lease_token=lease-token-live",
          ].join("\n"),
          stdout: "authorization: Bearer extremely-sensitive-token",
          password: "must-never-be-recorded",
        },
      });
    },
  };
  const worker = new DeskAiWorkerService({
    facade,
    adapter,
    scope: "live",
    workerId: "codex-live-02",
    mode: "active",
  });

  const result = await worker.runOnce();
  const failedRun = calls
    .filter(([name]) => name === "record")
    .map(([, document]) => document)
    .find((document) => document.status === "FAILED");
  const serialized = JSON.stringify({ result, failedRun });

  assert.match(serialized, /required MCP servers failed to initialize/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.doesNotMatch(serialized, /super-secret/);
  assert.doesNotMatch(serialized, /lease-token-live/);
  assert.doesNotMatch(serialized, /extremely-sensitive-token/);
  assert.doesNotMatch(serialized, /must-never-be-recorded/);
  assert.equal(result.error.retryable, true);
});

test("shadow worker never claims or mutates analytical work", async () => {
  let claimed = false;
  const worker = new DeskAiWorkerService({
    facade: {
      async claim() { claimed = true; },
    },
    adapter: {},
    scope: "replay",
    workerId: "codex-replay-01",
    mode: "shadow",
  });
  const result = await worker.runOnce();
  assert.equal(result.status, "SHADOW_STANDBY");
  assert.equal(claimed, false);
});

test("Replay claim guard yields immediately while LIVE work has priority", async () => {
  let claimed = false;
  const worker = new DeskAiWorkerService({
    facade: {
      async claim() { claimed = true; },
    },
    adapter: {},
    scope: "replay",
    workerId: "codex-replay-01",
    mode: "active",
    claimGuard: async () => ({ allowed: false, reason: "live_due" }),
  });
  const result = await worker.runOnce();
  assert.equal(result.status, "PRIORITY_STANDBY");
  assert.equal(result.reason, "live_due");
  assert.equal(claimed, false);
});

test("LIVE Master persists its native analysis and active thesis atomically", async () => {
  const calls = [];
  const claim = {
    status: "WORK_CLAIMED",
    scope: "live",
    claim_handle: {
      cursor_id: "livecur__2026-07-28",
      trading_date: "2026-07-28",
      run_id: "front_live_2026-07-28",
      session: "asia_open",
      workflow: "LIVE_MASTER",
      checkpoint: "2026-07-28T00:15:00+02:00",
      lease_token: "lease-token-master",
    },
    bundle: {
      bundle_tool: "get_master_cutoff_bundle",
      bundle_args: { bundle_id: "master-bundle-0015" },
    },
  };
  const bundle = {
    bundle_id: "master-bundle-0015",
    bundle_type: "master",
    strategy_id: "asia_open",
    trading_date: "2026-07-28",
    date: "2026-07-28",
    session: "asia_open",
    mode: "live",
    run_id: "front_live_2026-07-28",
    as_of_utc: "2026-07-27T22:15:00.000Z",
    contract_context: activeContractContext("LIVE_MASTER", "master-hash"),
    anti_lookahead_policy: { compliant: true },
    save_target: {
      tool: "save_master_analysis",
      suggested_payload: {
        analysis_id: "master-analysis-0015",
        ...activeSavePins("LIVE_MASTER", "live"),
        contract_hash: "master-hash",
        bundle_id: "master-bundle-0015",
        strategy_id: "asia_open",
        date: "2026-07-28",
        trading_date: "2026-07-28",
        session: "asia_open",
        mode: "live",
        run_id: "front_live_2026-07-28",
        as_of_utc: "2026-07-27T22:15:00.000Z",
        timezone: "Europe/Paris",
        created_at_paris: "2026-07-28T00:15:00+02:00",
        pack_id: "pack-master-0015",
        pack_build_id: "packbuild-master-0015",
      },
    },
  };
  const facade = {
    async claim() { calls.push(["claim"]); return claim; },
    async readClaimContext() {
      calls.push(["read"]);
      return {
        bundle,
        contract: {
          contract_name: "DeskMasterAnalysisContract",
          schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
          hash: "master-hash",
          content_markdown: "Master contract",
        },
        followupReads: [],
      };
    },
    async heartbeat() { return { ok: true }; },
    async validate(_tool, payload) { return payload; },
    async save(tool, payload) {
      calls.push([`save:${tool}`, payload]);
      return { ok: true, analysis_id: payload.analysis_id };
    },
    async complete() { calls.push(["complete"]); return { ok: true, status: "DONE" }; },
    async fail(_scope, _handle, error) { calls.push(["fail", error]); return { ok: true }; },
    async recordRun() {},
  };
  const adapter = {
    async analyze() {
      return {
        output: {
          save_payload: {
            analysis_output: makeNativeMasterV5({
              mode: "LIVE",
              tradingDate: "2026-07-28",
              session: "asia_open",
              runId: "front_live_2026-07-28",
              cutoffParis: "2026-07-28T00:15:00+02:00",
              analysisId: "master-analysis-0015",
              bundleId: "master-bundle-0015",
              packId: "pack-master-0015",
              packBuildId: "packbuild-master-0015",
              planId: "plan-master-0015",
              thesisId: "thesis-master-0015",
            }),
          },
          supplementary_writes: [],
          decision_summary: "WAIT",
          data_quality_status: "ready",
          warnings: [],
        },
        telemetry: {},
      };
    },
  };
  const worker = new DeskAiWorkerService({
    facade,
    adapter,
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
  });

  const result = await worker.runOnce();
  assert.equal(result.status, "COMPLETED");
  const masterSave = calls.find(([name]) => name === "save:save_master_analysis");
  assert.equal(masterSave[1].analysis_output.active_thesis.thesis_id, "thesis-master-0015");
  assert.equal(calls.some(([name]) => name === "save:save_active_thesis"), false);
  assert.deepEqual(
    calls.filter(([name]) => name.startsWith("save:") || name === "complete").map(([name]) => name),
    ["save:save_master_analysis", "complete"],
  );
});

test("worker repairs one structurally invalid LIVE output before the first save", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  let inferenceCount = 0;
  const adapter = {
    async analyze({ prompt, outputSchema }) {
      inferenceCount += 1;
      calls.push([`analyze:${inferenceCount}`, prompt, outputSchema]);
      return {
        output: {
          save_payload: inferenceCount === 1
            ? { monitor_decision: "WAIT" }
            : { monitor_output: nativeLiveMonitorOutput() },
          supplementary_writes: [],
          decision_summary: "WAIT",
          data_quality_status: "ready",
          warnings: [],
        },
        telemetry: { input_tokens: 10, output_tokens: 5 },
      };
    },
  };
  const worker = new DeskAiWorkerService({
    facade,
    adapter,
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
  });

  const result = await worker.runOnce();
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.repair_attempts, 1);
  assert.equal(inferenceCount, 2);
  assert.match(calls.find(([name]) => name === "analyze:2")[1], /MODE_REPARATION_STRUCTURELLE_BORNEE=1/);
  assert.deepEqual(
    calls.find(([name]) => name === "analyze:1")[2]
      .properties.save_payload.required,
    ["monitor_output"],
  );
  assert.equal(
    calls.find(([name]) => name === "analyze:2")[2]
      .properties.schema_version.const,
    "desk_ai_analysis_output_v2",
  );
  assert.equal(calls.filter(([name]) => name.startsWith("save:")).length, 1);
  assert.equal(
    calls.findIndex(([name]) => name.startsWith("save:"))
      > calls.findIndex(([name]) => name === "analyze:2"),
    true,
  );
});

test("worker repairs a deterministic save-boundary rejection before the first save", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  let validationCount = 0;
  facade.validateForSave = async (_tool, payload) => {
    validationCount += 1;
    calls.push([`validate-for-save:${validationCount}`]);
    if (validationCount === 1) {
      throw Object.assign(
        new Error("DETERMINISTIC_MONITOR_COMMAND compilation failed at the save boundary."),
        {
          code: "DETERMINISTIC_MONITOR_COMMAND_INVALID",
          details: {
            errors: [{
              code: "STATE_TRANSITION_REJECTED",
              evidence: {
                domain: "setup",
                previous_state: "INVALIDATED",
                command: "ARM",
              },
            }],
          },
        },
      );
    }
    return payload;
  };
  let inferenceCount = 0;
  const worker = new DeskAiWorkerService({
    facade,
    adapter: {
      async analyze({ prompt }) {
        inferenceCount += 1;
        calls.push([`analyze:${inferenceCount}`, prompt]);
        return {
          output: {
            save_payload: { monitor_output: nativeLiveMonitorOutput() },
            supplementary_writes: [],
            decision_summary: "WAIT",
            data_quality_status: "ready",
            warnings: [],
          },
          telemetry: {},
        };
      },
    },
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
  });

  const result = await worker.runOnce();
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.repair_attempts, 1);
  assert.equal(inferenceCount, 2);
  assert.equal(validationCount, 2);
  assert.match(
    calls.find(([name]) => name === "analyze:2")[1],
    /STATE_TRANSITION_REJECTED/,
  );
  assert.equal(calls.filter(([name]) => name.startsWith("save:")).length, 1);
  assert.equal(
    calls.findIndex(([name]) => name.startsWith("save:"))
      > calls.findIndex(([name]) => name === "validate-for-save:2"),
    true,
  );
});

test("worker normalizes only an idempotent repeated terminal setup command to NOOP", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  let validationCount = 0;
  facade.validateForSave = async (_tool, payload) => {
    validationCount += 1;
    calls.push([`validate-for-save:${validationCount}`, payload]);
    if (validationCount === 1) {
      throw terminalSetupRepeatError({
        previousState: "INVALIDATED",
        command: "INVALIDATE",
      });
    }
    assert.equal(
      payload.monitor_output.command.setup_transition.command,
      "NOOP",
    );
    return payload;
  };
  let inferenceCount = 0;
  const worker = new DeskAiWorkerService({
    facade,
    adapter: {
      async analyze() {
        inferenceCount += 1;
        return {
          output: repeatedInvalidationCodexOutput(),
          telemetry: {},
        };
      },
    },
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
  });

  const result = await worker.runOnce();

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.repair_attempts, 1);
  assert.equal(inferenceCount, 2);
  assert.equal(validationCount, 2);
  const saved = calls.find(([name]) => name === "save:save_manual_monitor")[1];
  assert.equal(saved.monitor_output.command.setup_transition.command, "NOOP");
});

test("worker re-evaluates the repaired command before normalizing a terminal repeat", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  let validationCount = 0;
  facade.validateForSave = async (_tool, payload) => {
    validationCount += 1;
    const command = payload.monitor_output.command.setup_transition.command;
    calls.push([`validate-for-save:${validationCount}`, command]);
    if (validationCount === 1) {
      assert.equal(command, "ARM");
      throw terminalSetupRepeatError({
        previousState: "INVALIDATED",
        command: "ARM",
      });
    }
    if (validationCount === 2) {
      assert.equal(command, "INVALIDATE");
      throw terminalSetupRepeatError({
        previousState: "INVALIDATED",
        command: "INVALIDATE",
      });
    }
    assert.equal(command, "NOOP");
    return payload;
  };
  let inferenceCount = 0;
  const worker = new DeskAiWorkerService({
    facade,
    adapter: {
      async analyze() {
        inferenceCount += 1;
        const output = repeatedInvalidationCodexOutput();
        if (inferenceCount === 1) {
          output.save_payload.monitor_output.command.setup_transition.command = "ARM";
        }
        return { output, telemetry: {} };
      },
    },
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
  });

  const result = await worker.runOnce();

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.repair_attempts, 1);
  assert.equal(inferenceCount, 2);
  assert.equal(validationCount, 3);
  const saved = calls.find(([name]) => name === "save:save_manual_monitor")[1];
  assert.equal(saved.monitor_output.command.setup_transition.command, "NOOP");
});

test("terminal setup repair never hides a non-idempotent rearm attempt", () => {
  const output = repeatedInvalidationCodexOutput();
  output.save_payload.monitor_output.command.setup_transition.command = "ARM";
  const repaired = normalizeIdempotentTerminalSetupRepair(
    output,
    terminalSetupRepeatError({
      previousState: "INVALIDATED",
      command: "ARM",
    }),
  );
  assert.equal(repaired, output);
  assert.equal(
    repaired.save_payload.monitor_output.command.setup_transition.command,
    "ARM",
  );
});

test("terminal setup repair normalizes a redundant terminalization command across terminal states", () => {
  const output = repeatedInvalidationCodexOutput();
  output.save_payload.monitor_output.command.setup_transition.command = "CANCEL";
  const repaired = normalizeIdempotentTerminalSetupRepair(
    output,
    terminalSetupRepeatError({
      previousState: "INVALIDATED",
      command: "CANCEL",
    }),
  );
  assert.notEqual(repaired, output);
  assert.equal(
    repaired.save_payload.monitor_output.command.setup_transition.command,
    "NOOP",
  );
});

test("worker facade preflights deterministic Replay artifacts with the canonical store", async () => {
  const calls = [];
  const facade = new LocalDeskWorkerFacade({
    async validateReplayMasterStrategyPayload(payload) {
      calls.push(["master", payload]);
    },
    async validateReplayMonitorStrategyPayload(payload) {
      calls.push(["monitor", payload]);
    },
  }, { tools: [] });
  facade.validate = (_tool, payload) => payload;

  const master = { analysis_output: { contract: { version: "5.3.0" } } };
  const monitor = { monitor_output: { contract: { version: "2.3.0" } } };
  assert.equal(
    await facade.validateForSave("save_replay_master_analysis", master),
    master,
  );
  assert.equal(
    await facade.validateForSave("save_replay_monitor", monitor),
    monitor,
  );
  assert.deepEqual(calls, [
    ["master", master],
    ["monitor", monitor],
  ]);
});

test("worker facade applies the exact native Master schema before any save", () => {
  const facade = new LocalDeskWorkerFacade({}, {
    tools: [{
      name: "save_replay_master_analysis",
      validator: { parse: (payload) => payload },
    }],
  });
  const analysisOutput = makeNativeMasterV5({
    mode: "REPLAY",
    tradingDate: "2026-06-11",
    session: "asia_open",
    runId: "replay-2026-06-11",
    cutoffParis: "2026-06-11T00:15:00+02:00",
    analysisId: "analysis-replay-master-0015",
    bundleId: "bundle-replay-master-0015",
    packId: "pack-replay",
    packBuildId: "packbuild-replay",
    planId: "plan-replay-master-0015",
    thesisId: "thesis-replay-master-0015",
  });
  const payload = {
    schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
    analysis_id: "analysis-replay-master-0015",
    bundle_id: "bundle-replay-master-0015",
    pack_id: "pack-replay",
    pack_build_id: "packbuild-replay",
    plan_id: "plan-replay-master-0015",
    thesis_id: "thesis-replay-master-0015",
    trading_date: "2026-06-11",
    session: "asia_open",
    replay_run_id: "replay-2026-06-11",
    analysis_output: analysisOutput,
  };

  assert.equal(
    facade.validate("save_replay_master_analysis", payload),
    payload,
  );

  const invalid = structuredClone(payload);
  delete invalid.analysis_output.active_thesis;
  assert.throws(
    () => facade.validate("save_replay_master_analysis", invalid),
    (error) => {
      assert.equal(error.code, "AI_SAVE_PAYLOAD_VALIDATION_FAILED");
      assert.deepEqual(
        error.details.issues[0].path,
        ["analysis_output", "active_thesis"],
      );
      return true;
    },
  );
});

test("worker performs at most one repair and never saves a still-invalid output", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  facade.validate = async () => {
    throw Object.assign(new Error("monitor_decision must be an object"), {
      code: "AI_SAVE_PAYLOAD_VALIDATION_FAILED",
    });
  };
  let inferenceCount = 0;
  const worker = new DeskAiWorkerService({
    facade,
    adapter: {
      async analyze() {
        inferenceCount += 1;
        return {
          output: {
            save_payload: { monitor_output: nativeLiveMonitorOutput() },
            supplementary_writes: [],
            decision_summary: "WAIT",
            data_quality_status: "degraded",
            warnings: ["invalid shape"],
          },
          telemetry: {},
        };
      },
    },
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
  });

  const result = await worker.runOnce();
  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "AI_SAVE_PAYLOAD_VALIDATION_FAILED");
  assert.equal(result.error.retryable, true);
  assert.equal(result.repair_attempts, 1);
  assert.equal(inferenceCount, 2);
  assert.equal(calls.some(([name]) => name.startsWith("save:")), false);
  assert.equal(calls.filter(([name]) => name === "fail").length, 1);
  assert.equal(calls.find(([name]) => name === "fail")[2].retryable, true);
});

test("worker does not repair a protected-field override", async () => {
  const calls = [];
  const facade = fakeFacade(calls);
  let inferenceCount = 0;
  const worker = new DeskAiWorkerService({
    facade,
    adapter: {
      async analyze() {
        inferenceCount += 1;
        return {
          output: {
            save_payload: {
              pack_build_id: "invented-pack",
              monitor_output: nativeLiveMonitorOutput(),
            },
            supplementary_writes: [],
            decision_summary: "WAIT",
            data_quality_status: "ready",
            warnings: [],
          },
          telemetry: {},
        };
      },
    },
    scope: "live",
    workerId: "codex-live-01",
    mode: "active",
  });

  const result = await worker.runOnce();
  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "AI_PROTECTED_FIELD_OVERRIDE");
  assert.equal(result.repair_attempts, 0);
  assert.equal(inferenceCount, 1);
  assert.equal(calls.some(([name]) => name.startsWith("save:")), false);
});

test("Replay facade starts or resumes the next published config before claiming it", async () => {
  const calls = [];
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool, args) => {
    calls.push([tool, args]);
    if (tool === "start_or_resume_replay_autopilot") {
      return {
        status: "WAITING_GPT",
        gpt_claim: {
          args: {
            worker_id: "codex-replay-01",
            backtest_id: "replay-2026-06-12",
            workflows: ["REPLAY_MASTER", "REPLAY_MONITOR"],
          },
        },
      };
    }
    return { status: "WORK_CLAIMED", claim_handle: { work_item_id: "work-1" } };
  };

  const result = await facade.claim("replay", {
    workerId: "codex-replay-01",
    leaseSeconds: 900,
  });
  assert.equal(result.status, "WORK_CLAIMED");
  assert.equal(calls[0][0], "start_or_resume_replay_autopilot");
  assert.equal(calls[0][1].mode, "next_ready_config");
  assert.equal(calls[0][1].worker_group, "replay-v4");
  assert.equal(calls[1][0], "claim_next_replay_work");
  assert.equal(calls[1][1].backtest_id, "replay-2026-06-12");
  assert.equal(calls[1][1].lease_seconds, 900);
});

test("Replay facade requests the complete local bundle budget before analysis", async () => {
  const calls = [];
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool, args) => {
    calls.push([tool, args]);
    if (tool === "get_replay_master_bundle") {
      return {
        backtest_id: "replay-2026-06-12",
        step_id: "step-90",
        bundle_type: "master",
        mode: "replay",
        source_bundle_hash: "sha256:replay-source-step-90",
        complete: true,
        contract_context: {
          contract_name: "DeskMasterAnalysisContract",
          schema_version: "4.0.0",
        },
      };
    }
    if (tool === "get_contract") {
      return {
        contract_name: "DeskMasterAnalysisContract",
        schema_version: "4.0.0",
      };
    }
    throw new Error(`unexpected_tool:${tool}`);
  };

  await facade.readClaimContext({
    bundle: {
      bundle_tool: "get_replay_master_bundle",
      bundle_args: {
        backtest_id: "replay-2026-06-12",
        step_id: "step-90",
        view: "compact",
        max_response_bytes: 180_000,
      },
    },
  });

  assert.equal(calls[0][0], "get_replay_master_bundle");
  assert.equal(calls[0][1].view, "compact");
  assert.equal(calls[0][1].max_response_bytes, 512_000);
  assert.equal(calls[0][1].include_raw_refs, false);
});

test("agentic LIVE facade reads the same bounded bootstrap as Replay", async () => {
  const calls = [];
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool, args) => {
    calls.push([tool, args]);
    if (tool === "get_master_cutoff_bundle") {
      return {
        bundle_id: "live-master-bundle-0915",
        bundle_type: "master",
        trading_date: "2026-07-28",
        session: "asia_open",
        run_id: "front_live_2026-07-28",
        mode: "live",
        complete: true,
        contract_context: {
          contract_name: "DeskMasterAnalysisContract",
          schema_version: "5.1.0",
        },
      };
    }
    if (tool === "get_contract") {
      return {
        contract_name: "DeskMasterAnalysisContract",
        schema_version: "5.1.0",
      };
    }
    throw new Error(`unexpected_tool:${tool}`);
  };

  await facade.readClaimContext({
    bundle: {
      bundle_tool: "get_master_cutoff_bundle",
      bundle_args: {
        trading_date: "2026-07-28",
        session: "asia_open",
        timestamp_paris: "2026-07-28T09:15:00+02:00",
      },
    },
  }, { agenticContext: true });

  assert.equal(calls[0][0], "get_master_cutoff_bundle");
  assert.equal(calls[0][1].view, "compact");
  assert.equal(calls[0][1].max_response_bytes, 512_000);
  assert.equal(calls[0][1].include_raw_refs, false);
  assert.deepEqual(calls[0][1].include_sections, [
    "contract",
    "save_target",
    "quality",
    "pack",
    "dataset_integrity",
    "market_availability",
    "instructions",
  ]);
});

test("Replay facade classifies an unpageable budget fallback as recoverable", async () => {
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async () => ({
    backtest_id: "replay-2026-06-12",
    step_id: "step-91",
    bundle_type: "monitor",
    mode: "replay",
    source_bundle_hash: "sha256:replay-source-step-91",
    complete: false,
    view: "manifest",
    required_followup_reads: [],
  });

  await assert.rejects(
    facade.readClaimContext({
      bundle: {
        bundle_tool: "get_replay_monitor_bundle",
        bundle_args: { backtest_id: "replay-2026-06-12", step_id: "step-91" },
      },
    }),
    (error) => (
      error.code === "AI_REPLAY_CONTEXT_TRANSPORT_EXHAUSTED"
      && error.retryable === true
      && error.details?.reason === "missing_followup_reads"
    ),
  );
});

test("Replay facade shrinks and paginates a large lineage section losslessly", async () => {
  const calls = [];
  const lineage = {
    replay_master_analysis: { analysis_id: "master-11" },
    replay_active_thesis: { thesis_id: "thesis-11" },
    replay_setups: Array.from({ length: 73 }, (_, index) => ({
      setup_id: `setup-${String(index + 1).padStart(3, "0")}`,
      state: index % 2 ? "EXPIRED" : "CANCELLED",
    })),
    previous_replay_monitor: { monitor_id: "monitor-72" },
    replay_position: null,
  };
  const sectionHash = stableTestHash(lineage);
  const identity = replayTestIdentity();
  const facade = new LocalDeskWorkerFacade({}, {
    tools: {},
    maxReplayTransportReads: 12,
  });
  facade.call = async (tool, args) => {
    calls.push([tool, args]);
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, [{
        tool: "get_replay_bundle_section",
        arguments: {
          backtest_id: identity.backtest_id,
          step_id: identity.step_id,
          bundle_type: identity.bundle_type,
          section: "replay_lineage",
        },
      }], {
        replay_lineage: { sha256: sectionHash, bytes: 700_000 },
      });
    }
    if (tool === "get_replay_bundle_section") {
      if (args.limit > 50) {
        return {
          ...identity,
          section: "replay_lineage",
          complete: false,
          budget_exceeded: true,
          section_sha256: sectionHash,
          data: null,
        };
      }
      const data = {
        ...lineage,
        replay_setups: lineage.replay_setups.slice(args.offset, args.offset + args.limit),
      };
      return {
        ...identity,
        section: "replay_lineage",
        complete: true,
        section_sha256: sectionHash,
        data,
        pagination: {
          field: "replay_setups",
          offset: args.offset,
          limit: args.limit,
          total: lineage.replay_setups.length,
          has_more: args.offset + args.limit < lineage.replay_setups.length,
        },
      };
    }
    if (tool === "get_contract") return replayTestContract();
    throw new Error(`unexpected_tool:${tool}`);
  };

  const context = await facade.readClaimContext(replayTestClaim(identity));

  assert.equal(context.followupReads.length, 1);
  assert.equal(context.followupReads[0].result.complete, true);
  assert.equal(
    context.followupReads[0].result.data.replay_setups.length,
    lineage.replay_setups.length,
  );
  assert.equal(context.followupReads[0].result.fragmentation.mode, "offset_limit");
  assert.equal(context.followupReads[0].result.fragmentation.pages, 2);
  assert.equal(context.transportTelemetry.tool_calls, 4);
  assert.equal(context.transportTelemetry.budget_retries, 1);
  assert.equal(context.transportTelemetry.pages, 2);
  assert.equal(context.transportTelemetry.fragmented_reads, 1);
  assert.deepEqual(
    calls
      .filter(([tool]) => tool === "get_replay_bundle_section")
      .map(([, args]) => [args.offset, args.limit]),
    [[0, 100], [0, 50], [50, 50]],
  );
});

test("Replay facade reconstructs oversized fixed lineage components through field receipts", async () => {
  const identity = replayTestIdentity();
  const lineage = {
    replay_master_analysis: {
      analysis_id: "master-large",
      overview: "o".repeat(280_000),
      details: "d".repeat(280_000),
    },
    replay_active_thesis: { thesis_id: "thesis-large" },
    replay_setups: [{ setup_id: "setup-large" }],
    previous_replay_monitor: { monitor_id: "monitor-72", action: "WAIT" },
    replay_position: null,
  };
  const sectionHash = stableTestHash(lineage);
  const componentManifest = Object.fromEntries(
    Object.entries(lineage).map(([component, value]) => [
      component,
      {
        sha256: stableTestHash(value),
        value_type: Array.isArray(value)
          ? "array"
          : value === null
            ? "null"
            : typeof value,
      },
    ]),
  );
  const masterFieldManifest = Object.fromEntries(
    Object.entries(lineage.replay_master_analysis).map(([field, value]) => [
      field,
      {
        sha256: stableTestHash(value),
        value_type: typeof value,
      },
    ]),
  );
  const facade = new LocalDeskWorkerFacade({}, {
    tools: {},
    maxReplayTransportReads: 20,
  });
  facade.call = async (tool, args) => {
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, [{
        tool: "get_replay_bundle_section",
        arguments: {
          backtest_id: identity.backtest_id,
          step_id: identity.step_id,
          bundle_type: identity.bundle_type,
          section: "replay_lineage",
        },
      }], {
        replay_lineage: { sha256: sectionHash, bytes: 700_000 },
      });
    }
    if (tool === "get_replay_bundle_section") {
      if (!args.component) {
        return {
          ...identity,
          section: "replay_lineage",
          complete: false,
          budget_exceeded: true,
          section_sha256: sectionHash,
          component_manifest: componentManifest,
          data: null,
        };
      }
      const componentValue = lineage[args.component];
      const componentHash = stableTestHash(componentValue);
      if (args.component === "replay_master_analysis" && !args.field) {
        return {
          ...identity,
          section: "replay_lineage",
          component: args.component,
          complete: false,
          budget_exceeded: true,
          section_sha256: sectionHash,
          component_sha256: componentHash,
          field_manifest: masterFieldManifest,
          data: null,
        };
      }
      if (args.field) {
        const fieldValue = componentValue[args.field];
        return {
          ...identity,
          section: "replay_lineage",
          component: args.component,
          field: args.field,
          complete: true,
          section_sha256: sectionHash,
          component_sha256: componentHash,
          field_sha256: stableTestHash(fieldValue),
          data: {
            [args.component]: {
              [args.field]: fieldValue,
            },
          },
          pagination: null,
        };
      }
      const array = Array.isArray(componentValue);
      return {
        ...identity,
        section: "replay_lineage",
        component: args.component,
        complete: true,
        section_sha256: sectionHash,
        component_sha256: componentHash,
        data: { [args.component]: componentValue },
        pagination: array
          ? {
              field: args.component,
              path: [args.component],
              offset: args.offset,
              limit: args.limit,
              total: componentValue.length,
              has_more: false,
            }
          : null,
      };
    }
    if (tool === "get_contract") return replayTestContract();
    throw new Error(`unexpected_tool:${tool}`);
  };

  const context = await facade.readClaimContext(replayTestClaim(identity));
  const reconstructed = context.followupReads[0].result;

  assert.deepEqual(reconstructed.data, lineage);
  assert.equal(reconstructed.section_sha256, sectionHash);
  assert.equal(reconstructed.fragmentation.mode, "component_fields");
  assert.equal(reconstructed.fragmentation.components.length, 5);
  assert.equal(context.transportTelemetry.components, 5);
  assert.equal(context.transportTelemetry.fields, 3);
  assert.equal(context.transportTelemetry.fragmented_reads, 1);
  assert.ok(context.transportTelemetry.response_bytes > 560_000);
});

test("Replay facade fragments an oversized snapshot by replay-scoped instruments", async () => {
  const calls = [];
  const identity = replayTestIdentity();
  const instruments = ["MNQ", "MES", "NQ", "ES"];
  const marketAvailability = {
    as_of_paris: "2026-06-11T12:30:00+02:00",
    instruments: Object.fromEntries(instruments.map((instrument) => [
      instrument,
      { availability: "fresh" },
    ])),
  };
  const snapshotData = (selected) => ({
    "15m": {
      snapshot_id: "snapshot-15m",
      window: "15m",
      timestamp_paris: "2026-06-11T12:30:00+02:00",
      instruments: Object.fromEntries(selected.map((instrument) => [
        instrument,
        { close: 20_000 + instruments.indexOf(instrument) },
      ])),
    },
  });
  const marketHash = stableTestHash(marketAvailability);
  const fullSnapshotHash = stableTestHash(snapshotData(instruments));
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool, args) => {
    calls.push([tool, args]);
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, [
        {
          tool: "get_replay_bundle_section",
          arguments: {
            backtest_id: identity.backtest_id,
            step_id: identity.step_id,
            bundle_type: identity.bundle_type,
            section: "market_availability",
          },
        },
        {
          tool: "get_replay_snapshot",
          arguments: {
            backtest_id: identity.backtest_id,
            step_id: identity.step_id,
            bundle_type: identity.bundle_type,
            window: "15m",
          },
        },
      ], {
        market_availability: { sha256: marketHash, bytes: 2_000 },
        rolling_snapshots: { sha256: "full-canonical-hash", bytes: 900_000 },
      });
    }
    if (tool === "get_replay_bundle_section") {
      return {
        ...identity,
        section: "market_availability",
        complete: true,
        section_sha256: marketHash,
        data: marketAvailability,
        pagination: null,
      };
    }
    if (tool === "get_replay_snapshot") {
      if (!args.instruments) {
        return {
          ...identity,
          view: "snapshot",
          window: "15m",
          complete: false,
          budget_exceeded: true,
          section_sha256: fullSnapshotHash,
          data: null,
        };
      }
      const data = snapshotData(args.instruments);
      return {
        ...identity,
        view: "snapshot",
        window: "15m",
        complete: true,
        section_sha256: stableTestHash(data),
        data,
      };
    }
    if (tool === "get_contract") return replayTestContract();
    throw new Error(`unexpected_tool:${tool}`);
  };

  const context = await facade.readClaimContext(replayTestClaim(identity));
  const snapshot = context.followupReads[1].result;

  assert.deepEqual(
    Object.keys(snapshot.data["15m"].instruments).sort(),
    [...instruments].sort(),
  );
  assert.equal(snapshot.fragmentation.mode, "instrument_groups");
  assert.equal(snapshot.fragmentation.fragments, 2);
  assert.equal(context.transportTelemetry.fragments, 2);
  assert.equal(context.transportTelemetry.fragmented_reads, 1);
  assert.equal(
    calls.filter(([tool]) => tool === "get_replay_snapshot").length,
    3,
  );
  assert.ok(
    calls
      .filter(([tool]) => tool === "get_replay_snapshot")
      .every(([, args]) => args.include_raw_refs === false),
  );
});

test("Replay facade rejects cross-scope follow-up descriptors before reading them", async () => {
  const calls = [];
  const identity = replayTestIdentity();
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool) => {
    calls.push(tool);
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, [{
        tool: "get_replay_bundle_section",
        arguments: {
          backtest_id: "another-replay",
          step_id: identity.step_id,
          bundle_type: identity.bundle_type,
          section: "replay_lineage",
        },
      }]);
    }
    throw new Error(`unexpected_tool:${tool}`);
  };

  await assert.rejects(
    facade.readClaimContext(replayTestClaim(identity)),
    (error) => (
      error.code === "AI_REPLAY_CONTEXT_SCOPE_MISMATCH"
      && error.retryable !== true
    ),
  );
  assert.deepEqual(calls, ["get_replay_monitor_bundle"]);
});

test("Replay deep reads pin the immutable source hash across claim CAS enrichment", async () => {
  const identity = replayTestIdentity();
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool) => {
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, [{
        tool: "get_replay_bundle_section",
        arguments: {
          backtest_id: identity.backtest_id,
          step_id: identity.step_id,
          bundle_type: identity.bundle_type,
          section: "market_availability",
        },
      }], {
        market_availability: {
          sha256: stableTestHash({ available: true }),
          bytes: 32,
        },
      });
    }
    if (tool === "get_replay_bundle_section") {
      return {
        ...identity,
        canonical_bundle_hash: "canonical-hash-without-claim-cas",
        section: "market_availability",
        complete: true,
        section_sha256: stableTestHash({ available: true }),
        data: { available: true },
        pagination: null,
      };
    }
    if (tool === "get_contract") return replayTestContract();
    throw new Error(`unexpected_tool:${tool}`);
  };

  const context = await facade.readClaimContext(replayTestClaim(identity));

  assert.equal(context.followupReads.length, 1);
  assert.equal(
    context.followupReads[0].result.source_bundle_hash,
    identity.source_bundle_hash,
  );
  assert.notEqual(
    context.followupReads[0].result.canonical_bundle_hash,
    identity.canonical_bundle_hash,
  );
});

test("Replay deep reads still fail closed when the immutable source hash changes", async () => {
  const identity = replayTestIdentity();
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool) => {
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, [{
        tool: "get_replay_bundle_section",
        arguments: {
          backtest_id: identity.backtest_id,
          step_id: identity.step_id,
          bundle_type: identity.bundle_type,
          section: "market_availability",
        },
      }]);
    }
    if (tool === "get_replay_bundle_section") {
      return {
        ...identity,
        source_bundle_hash: "foreign-immutable-source",
        section: "market_availability",
        complete: true,
        section_sha256: stableTestHash({ available: true }),
        data: { available: true },
      };
    }
    throw new Error(`unexpected_tool:${tool}`);
  };

  await assert.rejects(
    facade.readClaimContext(replayTestClaim(identity)),
    (error) => (
      error.code === "AI_REPLAY_CONTEXT_HASH_MISMATCH"
      && error.details?.field === "source_bundle_hash"
    ),
  );
});

test("Replay primary context fails before analysis without an immutable source hash", async () => {
  const identity = replayTestIdentity();
  delete identity.source_bundle_hash;
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool) => {
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, []);
    }
    throw new Error(`unexpected_tool:${tool}`);
  };

  await assert.rejects(
    facade.readClaimContext(replayTestClaim(identity)),
    (error) => (
      error.code === "AI_REPLAY_CONTEXT_SOURCE_HASH_MISSING"
      && error.retryable === true
    ),
  );
});

test("Replay facade treats an irreducible section and global budget exhaustion as recoverable", async () => {
  const identity = replayTestIdentity();
  const sectionHash = stableTestHash({ replay_setups: [] });
  let sectionCalls = 0;
  const irreducible = new LocalDeskWorkerFacade({}, {
    tools: {},
    maxReplayTransportReads: 20,
  });
  irreducible.call = async (tool) => {
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, [{
        tool: "get_replay_bundle_section",
        arguments: {
          backtest_id: identity.backtest_id,
          step_id: identity.step_id,
          bundle_type: identity.bundle_type,
          section: "replay_lineage",
        },
      }]);
    }
    if (tool === "get_replay_bundle_section") {
      sectionCalls += 1;
      return {
        ...identity,
        section: "replay_lineage",
        complete: false,
        budget_exceeded: true,
        section_sha256: sectionHash,
        data: null,
      };
    }
    throw new Error(`unexpected_tool:${tool}`);
  };

  await assert.rejects(
    irreducible.readClaimContext(replayTestClaim(identity)),
    (error) => (
      error.code === "AI_REPLAY_CONTEXT_TRANSPORT_EXHAUSTED"
      && error.retryable === true
      && error.details?.reason === "minimum_page_budget_exceeded"
      && error.details?.transport_telemetry?.budget_retries === 7
    ),
  );
  assert.equal(sectionCalls, 7);

  const largeLineage = {
    replay_setups: Array.from({ length: 4 }, (_, index) => ({
      setup_id: `large-${index}`,
      narrative: "x".repeat(130_000),
    })),
  };
  const largeHash = stableTestHash(largeLineage);
  const globallyBounded = new LocalDeskWorkerFacade({}, {
    tools: {},
    replayContextBudgetBytes: 512_000,
    maxReplayTransportReads: 20,
  });
  globallyBounded.call = async (tool, args) => {
    if (tool === "get_replay_monitor_bundle") {
      return replayFallbackBundle(identity, [{
        tool: "get_replay_bundle_section",
        arguments: {
          backtest_id: identity.backtest_id,
          step_id: identity.step_id,
          bundle_type: identity.bundle_type,
          section: "replay_lineage",
        },
      }]);
    }
    if (tool === "get_replay_bundle_section") {
      if (args.limit > 1) {
        return {
          ...identity,
          section: "replay_lineage",
          complete: false,
          budget_exceeded: true,
          section_sha256: largeHash,
          data: null,
        };
      }
      const data = {
        replay_setups: largeLineage.replay_setups.slice(args.offset, args.offset + 1),
      };
      return {
        ...identity,
        section: "replay_lineage",
        complete: true,
        section_sha256: largeHash,
        data,
        pagination: {
          field: "replay_setups",
          offset: args.offset,
          limit: 1,
          total: largeLineage.replay_setups.length,
          has_more: args.offset + 1 < largeLineage.replay_setups.length,
        },
      };
    }
    throw new Error(`unexpected_tool:${tool}`);
  };

  await assert.rejects(
    globallyBounded.readClaimContext(replayTestClaim(identity)),
    (error) => (
      error.code === "AI_REPLAY_CONTEXT_TRANSPORT_EXHAUSTED"
      && error.retryable === true
      && error.details?.reason === "global_context_budget"
      && error.details?.transport_telemetry?.response_bytes > 512_000
    ),
  );
});

test("worker facade maps LIVE and REPLAY failure payloads to their distinct lifecycle contracts", async () => {
  const calls = [];
  const facade = new LocalDeskWorkerFacade({}, { tools: {} });
  facade.call = async (tool, args) => {
    calls.push([tool, args]);
    return { ok: true };
  };
  await facade.fail("live", {
    cursor_id: "livecur__2026-07-29",
    checkpoint: "2026-07-29T02:15:00+02:00",
    worker_id: "codex-live-01",
    lease_token: "live-lease-token",
  }, Object.assign(new Error("invalid output"), {
    code: "AI_SAVE_PAYLOAD_VALIDATION_FAILED",
    retryable: false,
  }));
  await facade.fail("replay", {
    work_item_id: "deskwork__replay__001",
    worker_id: "codex-replay-01",
    lease_token: "replay-lease-token",
  }, Object.assign(new Error("temporary outage"), {
    code: "DATABASE_UNAVAILABLE",
    retryable: true,
  }));

  assert.equal(calls[0][0], "fail_live");
  assert.equal(calls[0][1].error_class, "deterministic");
  assert.equal("retryable" in calls[0][1], false);
  assert.equal(calls[1][0], "fail_replay");
  assert.equal(calls[1][1].retryable, true);
  assert.equal("error_class" in calls[1][1], false);
});

function replayTestIdentity() {
  return {
    backtest_id: "replay-2026-06-11-v5",
    replay_run_id: "replay-2026-06-11-v5",
    step_id: "step-monitor-0073",
    bundle_type: "monitor",
    mode: "replay",
    canonical_bundle_hash: "canonical-bundle-hash-11",
    source_bundle_hash: "source-bundle-hash-11",
  };
}

function replayFallbackBundle(identity, requiredFollowupReads, sectionManifest = {}) {
  return {
    ...identity,
    complete: false,
    view: "manifest",
    budget_exceeded: true,
    contract_context: {
      contract_name: "DeskHourlyThesisMonitorContract",
      schema_version: "2.1.0",
      contract_hash: "monitor-contract-hash",
    },
    section_manifest: sectionManifest,
    required_followup_reads: requiredFollowupReads,
  };
}

function replayTestClaim(identity) {
  return {
    status: "WORK_CLAIMED",
    scope: "replay",
    claim_handle: {
      backtest_id: identity.backtest_id,
      step_id: identity.step_id,
      workflow: "REPLAY_MONITOR",
      work_item_id: "replay-work-73",
      lease_token: "replay-lease-73",
    },
    bundle: {
      bundle_tool: "get_replay_monitor_bundle",
      bundle_args: {
        backtest_id: identity.backtest_id,
        step_id: identity.step_id,
        bundle_type: identity.bundle_type,
        view: "compact",
      },
    },
  };
}

function replayTestContract() {
  return {
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "2.1.0",
    hash: "monitor-contract-hash",
  };
}

function stableTestHash(value) {
  const chunks = [];
  const append = (item) => {
    if (Array.isArray(item)) {
      chunks.push("[");
      item.forEach((entry, index) => {
        if (index) chunks.push(",");
        append(entry);
      });
      chunks.push("]");
      return;
    }
    if (item && typeof item === "object") {
      chunks.push("{");
      Object.keys(item).sort().forEach((key, index) => {
        if (index) chunks.push(",");
        chunks.push(JSON.stringify(key), ":");
        append(item[key]);
      });
      chunks.push("}");
      return;
    }
    chunks.push(JSON.stringify(item ?? null));
  };
  append(value);
  return createHash("sha256").update(chunks.join("")).digest("hex");
}

function agenticContextReceipts(capability) {
  const rows = [
    [null, "get_context_catalog", {}],
    ["CONTINUITY", "get_continuity_context", {}],
    ["CORE_MARKET", "get_market_context", { domain: "core_market" }],
    ["INDEX_CONFIRMATION", "get_market_context", { domain: "index_confirmation" }],
    ["CROSS_ASSET", "get_market_context", { domain: "cross_asset" }],
    ["MEGACAPS", "get_market_context", { domain: "megacaps" }],
    ["MACRO", "get_macro_context", {}],
    ["NEWS", "get_news_context", {}],
    ["THESIS_EVOLUTION", "get_thesis_evolution_context", {}],
  ];
  return rows.map(([phase, tool, query], index) => {
    const unsigned = {
    schema_version: "desk_context_evidence_receipt_v1",
    receipt_id: `context-receipt-${index}`,
    recorded_at_utc: `2026-08-02T12:00:${String(index).padStart(2, "0")}.000Z`,
    capability_id: capability.capability_id,
    job_id: capability.job_id,
    envelope_hash: capability.envelope_hash,
    scope: capability.scope,
    workflow: capability.workflow,
    sequence: index + 1,
    phase,
    tool,
    query: { ...query, tool },
    status: "COMPLETE",
    result_sha256: createHash("sha256").update(`${phase}:${tool}`).digest("hex"),
    evidence_count: 1,
    };
    return {
      ...unsigned,
      receipt_hmac: signDeskContextEvidenceReceipt(unsigned, capability),
    };
  });
}

function resequenceAgenticReceipts(receipts, capability) {
  return receipts.map((receipt, index) => {
    const { receipt_hmac: _ignored, ...unsigned } = receipt;
    unsigned.sequence = index + 1;
    return {
      ...unsigned,
      receipt_hmac: signDeskContextEvidenceReceipt(unsigned, capability),
    };
  });
}

function fakeFacade(calls) {
  const claim = {
    status: "WORK_CLAIMED",
    scope: "live",
    claim_handle: {
      cursor_id: "livecur__2026-07-28",
      trading_date: "2026-07-28",
      run_id: "front_live_2026-07-28",
      session: "asia_open",
      workflow: "LIVE_M15_MONITOR",
      checkpoint: "2026-07-28T12:45:00+02:00",
      lease_token: "lease-token-live",
    },
    bundle: {
      bundle_tool: "get_manual_monitor_bundle",
      bundle_args: { bundle_id: "monitor-bundle-1245" },
    },
  };
  const bundle = {
    bundle_id: "monitor-bundle-1245",
    bundle_type: "monitor",
    strategy_id: "asia_open",
    trading_date: "2026-07-28",
    session: "asia_open",
    mode: "live",
    run_id: "front_live_2026-07-28",
    as_of_utc: "2026-07-28T10:45:00.000Z",
    cutoff_paris: "2026-07-28T12:45:00+02:00",
    pack_id: "pack-live-1245",
    pack_build_id: "packbuild-live-1245",
    contract_context: activeContractContext("LIVE_M15_MONITOR", "monitor-hash"),
    anti_lookahead_policy: { compliant: true },
    save_target: {
      tool: "save_manual_monitor",
      suggested_payload: {
        monitor_id: "monitor-1245",
        ...activeSavePins("LIVE_M15_MONITOR", "live"),
        contract_hash: "monitor-hash",
        bundle_id: "monitor-bundle-1245",
        strategy_id: "asia_open",
        trading_date: "2026-07-28",
        session: "asia_open",
        mode: "live",
        run_id: "front_live_2026-07-28",
        as_of_utc: "2026-07-28T10:45:00.000Z",
        timezone: "Europe/Paris",
        timestamp_paris: "2026-07-28T12:45:00+02:00",
        pack_id: "pack-live-1245",
        pack_build_id: "packbuild-live-1245",
      },
    },
  };
  return {
    async claim() {
      calls.push(["claim"]);
      return claim;
    },
    async readClaimContext() {
      calls.push(["read"]);
      return {
        bundle,
        contract: {
          contract_name: "DeskHourlyThesisMonitorContract",
          schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
          hash: "monitor-hash",
          content_markdown: "Monitor contract",
        },
        followupReads: [],
      };
    },
    async heartbeat() {
      calls.push(["heartbeat"]);
      return { ok: true };
    },
    async validate(_tool, payload) {
      return payload;
    },
    async save(tool, payload) {
      calls.push([`save:${tool}`, payload]);
      return { ok: true, monitor_id: payload.monitor_id };
    },
    async complete(_scope, handle, telemetry) {
      calls.push(["complete", handle, telemetry]);
      return { ok: true, status: "DONE" };
    },
    async fail(scope, handle, error) {
      calls.push(["fail", scope, error, handle]);
      return { ok: true, status: "RETRY" };
    },
    async recordRun(document) {
      calls.push(["record", document]);
    },
  };
}

function conversationEnvelope(cutoffUtc, workflow = "REPLAY_MONITOR") {
  const master = workflow.endsWith("MASTER");
  return {
    scope: "replay",
    workflow,
    claim_handle: {
      backtest_id: "replay-2026-06-11",
    },
    suggested_payload: {
      backtest_id: "replay-2026-06-11",
      as_of_utc: cutoffUtc,
    },
    bundle: {
      backtest_id: "replay-2026-06-11",
      cutoff_utc: cutoffUtc,
    },
    contract_context: {
      contract_name: master
        ? "DeskMasterAnalysisContract"
        : "DeskHourlyThesisMonitorContract",
      schema_version: master
        ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
        : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      contract_hash: master ? "master-contract-hash" : "monitor-contract-hash",
    },
    normative_runtime: {
      primary_schema_file: master
        ? "master-analysis-v5-4.schema.json"
        : "hourly-monitor-v2-4.schema.json",
      normative_schemas: master
        ? { "master-analysis-v5-4.schema.json": { type: "object" } }
        : { "hourly-monitor-v2-4.schema.json": { type: "object" } },
      condition_catalog: {
        catalog_sha256: "condition-catalog-hash",
      },
      validation_authority: "BACKEND_EXACT_JSON_SCHEMA_AND_CROSS_FIELD_VALIDATORS",
    },
  };
}

function nativeLiveMonitorOutput() {
  return makeNativeMonitorV2({
    mode: "LIVE",
    tradingDate: "2026-07-28",
    session: "asia_open",
    runId: "front_live_2026-07-28",
    cutoffParis: "2026-07-28T12:45:00+02:00",
    monitorId: "monitor-1245",
    bundleId: "monitor-bundle-1245",
    packId: "pack-live-1245",
    packBuildId: "packbuild-live-1245",
    masterId: "master-live-0015",
    planId: "plan-live-0015",
    thesisId: "thesis-live-0015",
    commandId: "command-live-1245",
    expectedRevision: 1,
  });
}

function repeatedInvalidationCodexOutput() {
  const monitorOutput = nativeLiveMonitorOutput();
  monitorOutput.links.setup_id = "setup-current";
  monitorOutput.command.requested_action = "APPLY_ORTHOGONAL_COMMANDS";
  monitorOutput.command.setup_transition = {
    command: "INVALIDATE",
    setup_id: "setup-current",
    replaces_setup_id: null,
    reason: "The current setup is already invalidated.",
    setup: null,
  };
  return {
    save_payload: { monitor_output: monitorOutput },
    supplementary_writes: [],
    decision_summary: "INVALIDATE",
    data_quality_status: "ready",
    warnings: [],
  };
}

function terminalSetupRepeatError({ previousState, command }) {
  return Object.assign(
    new Error("DETERMINISTIC_MONITOR_COMMAND compilation failed at the save boundary."),
    {
      code: "DETERMINISTIC_MONITOR_COMMAND_INVALID",
      details: {
        errors: [{
          code: "STATE_TRANSITION_REJECTED",
          evidence: {
            domain: "setup",
            reason: "TERMINAL_SETUP_IMMUTABLE",
            previous_state: previousState,
            command,
          },
        }],
      },
    },
  );
}

function activeContractContext(workflow, contractHash) {
  const master = workflow.endsWith("MASTER");
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    contract_hash: contractHash,
    execution_policy: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy },
    execution_plan: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan },
    monitor_command: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command },
    condition_catalog: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog },
  };
}

function activeSavePins(workflow, mode) {
  const master = workflow.endsWith("MASTER");
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    ...(mode === "replay"
      ? { replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy }
      : { execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy }),
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
  };
}
