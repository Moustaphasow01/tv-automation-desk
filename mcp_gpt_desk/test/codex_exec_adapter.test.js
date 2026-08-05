import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  appendFile,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  CodexExecAdapter,
  cleanupSecureCodexRunDirectory,
  contextMcpConfigArgs,
  createBoundedOutputCollector,
  createSecureCodexRunDirectory,
  parseCodexJsonlTelemetry,
  parseContextEvidenceTrace,
  resolveCodexInvocation,
  sanitizedCodexEnv,
  spawnCodex,
  terminateCodexProcessTree,
} from "../src/codex-exec-adapter.js";
import {
  buildDeskAiContextCapability,
  signDeskContextEvidenceReceipt,
} from "../src/desk-ai-context-capability.js";

test("Codex adapter creates a persistent read-only structured session and parses telemetry", async () => {
  let invocation = null;
  const adapter = new CodexExecAdapter({
    cwd: process.cwd(),
    baseEnv: {
      PATH: "/bin",
      DATABASE_URL: "must-not-leak",
      DESK_OPERATOR_ADMIN_PIN: "must-not-leak",
      CODEX_API_KEY: "allowed-single-process-secret",
    },
    spawnProcess: async (input) => {
      invocation = input;
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify({
        schema_version: "desk_ai_analysis_output_v1",
        save_payload_json: JSON.stringify({ monitor_decision: { action: "WAIT" } }),
        supplementary_writes_json: "[]",
        decision_summary: "WAIT",
        data_quality_status: "ready",
        warnings: [],
      }));
      return {
        exitCode: 0,
        stderr: "",
        timedOut: false,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25, reasoning_output_tokens: 4 },
          }),
        ].join("\n"),
      };
    },
  });

  const result = await adapter.analyze({ prompt: "Analyze this immutable bundle." });
  assert.equal(result.output.save_payload.monitor_decision.action, "WAIT");
  assert.equal(result.telemetry.thread_id, "thread-1");
  assert.equal(result.telemetry.input_tokens, 100);
  assert.equal(invocation.args.includes("--ephemeral"), false);
  assert.ok(invocation.args.includes("--json"));
  assert.ok(invocation.args.includes("--skip-git-repo-check"));
  assert.ok(invocation.args.includes('model_reasoning_effort="xhigh"'));
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf("--sandbox"), invocation.args.indexOf("--sandbox") + 2), [
    "--sandbox",
    "read-only",
  ]);
  assert.equal(invocation.args.at(-1), "-");
  assert.equal(invocation.stdin, "Analyze this immutable bundle.");
  assert.notEqual(invocation.cwd, process.cwd());
  assert.equal(invocation.env.DATABASE_URL, undefined);
  assert.equal(invocation.env.DESK_OPERATOR_ADMIN_PIN, undefined);
  assert.equal(invocation.env.CODEX_API_KEY, "allowed-single-process-secret");
  assert.equal(result.telemetry.reasoning_effort, "xhigh");
  assert.equal(result.telemetry.runtime_settings_revision, 0);
  assert.equal(result.telemetry.conversation_mode, "CREATED");
});

test("Codex adapter resumes the canonical run conversation without creating a new session", async () => {
  let invocation = null;
  const adapter = new CodexExecAdapter({
    spawnProcess: async (input) => {
      invocation = input;
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(basicCodexOutput()));
      return {
        exitCode: 0,
        stderr: "",
        timedOut: false,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread-replay-11" }),
          JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 3 } }),
        ].join("\n"),
      };
    },
  });

  const result = await adapter.analyze({
    prompt: "Continue the same replay causally.",
    sessionId: "thread-replay-11",
  });

  assert.deepEqual(invocation.args.slice(0, 3), ["exec", "resume", "--json"]);
  assert.equal(invocation.args.includes("--ephemeral"), false);
  assert.equal(
    invocation.args[invocation.args.length - 2],
    "thread-replay-11",
  );
  assert.equal(invocation.args.at(-1), "-");
  assert.equal(result.telemetry.thread_id, "thread-replay-11");
  assert.equal(result.telemetry.conversation_mode, "RESUMED");
});

test("Codex adapter reloads the persisted reasoning effort before every analysis", async () => {
  const invocations = [];
  let revision = 7;
  let reasoningEffort = "high";
  const adapter = new CodexExecAdapter({
    runtimeSettingsProvider: async () => ({
      reasoningEffort,
      revision,
      source: "database",
    }),
    spawnProcess: async (input) => {
      invocations.push(input);
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify({
        schema_version: "desk_ai_analysis_output_v1",
        save_payload_json: JSON.stringify({ monitor_decision: { action: "WAIT" } }),
        supplementary_writes_json: "[]",
        decision_summary: "WAIT",
        data_quality_status: "ready",
        warnings: [],
      }));
      return { exitCode: 0, stderr: "", stdout: "", timedOut: false };
    },
  });

  const first = await adapter.analyze({ prompt: "first" });
  reasoningEffort = "xhigh";
  revision = 8;
  const second = await adapter.analyze({ prompt: "second" });

  assert.ok(invocations[0].args.includes('model_reasoning_effort="high"'));
  assert.ok(invocations[1].args.includes('model_reasoning_effort="xhigh"'));
  assert.equal(first.telemetry.runtime_settings_revision, 7);
  assert.equal(second.telemetry.reasoning_effort, "xhigh");
});

test("Codex adapter applies a per-analysis effort without changing the persisted ceiling", async () => {
  let invocation = null;
  const adapter = new CodexExecAdapter({
    runtimeSettingsProvider: async () => ({
      reasoningEffort: "xhigh",
      revision: 12,
      source: "database",
    }),
    spawnProcess: async (input) => {
      invocation = input;
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(basicCodexOutput()));
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
        timedOut: false,
      };
    },
  });

  const result = await adapter.analyze({
    prompt: "routine monitor",
    reasoningEffort: "high",
  });

  assert.ok(invocation.args.includes('model_reasoning_effort="high"'));
  assert.equal(result.telemetry.reasoning_effort, "high");
  assert.equal(result.telemetry.configured_reasoning_effort, "xhigh");
  assert.equal(result.telemetry.runtime_settings_revision, 12);
  assert.equal(Number.isFinite(result.telemetry.analysis_duration_ms), true);
});

test("Codex adapter keeps its configured timeout when no per-analysis timeout is supplied", async () => {
  let observedTimeoutMs = null;
  const adapter = new CodexExecAdapter({
    timeoutMs: 720_000,
    spawnProcess: async (input) => {
      observedTimeoutMs = input.timeoutMs;
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(basicCodexOutput()));
      return { exitCode: 0, stderr: "", stdout: "", timedOut: false };
    },
  });

  await adapter.analyze({ prompt: "configured timeout" });
  assert.equal(observedTimeoutMs, 720_000);
});

test("Codex adapter exposes only the scoped read-only context MCP and returns evidence receipts", async () => {
  let invocation = null;
  const contextCapability = testContextCapability();
  const adapter = new CodexExecAdapter({
    contextMcpScript: "/desk/run_desk_context_mcp.mjs",
    nodeBin: "/usr/bin/node",
    spawnProcess: async (input) => {
      invocation = input;
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      const mcpArgsConfig = input.args.find((value) => (
        String(value).startsWith("mcp_servers.desk_context.args=")
      ));
      const configuredArgs = JSON.parse(mcpArgsConfig.split("=").slice(1).join("="));
      const tracePath = configuredArgs.find((value) => value.startsWith("--trace-file=")).slice(13);
      const unsignedReceipt = {
        schema_version: "desk_context_evidence_receipt_v1",
        receipt_id: "evidence-1",
        recorded_at_utc: "2026-08-02T12:00:01.000Z",
        capability_id: contextCapability.capability_id,
        job_id: contextCapability.job_id,
        envelope_hash: contextCapability.envelope_hash,
        scope: contextCapability.scope,
        workflow: contextCapability.workflow,
        sequence: 1,
        phase: "CORE_MARKET",
        tool: "get_market_context",
        query: { tool: "get_market_context", domain: "core_market" },
        status: "COMPLETE",
        result_sha256: "f".repeat(64),
        evidence_count: 1,
      };
      await writeFile(tracePath, `${JSON.stringify({
        ...unsignedReceipt,
        receipt_hmac: signDeskContextEvidenceReceipt(
          unsignedReceipt,
          contextCapability,
        ),
      })}\n`);
      await writeFile(outputPath, JSON.stringify({
        schema_version: "desk_ai_analysis_output_v1",
        save_payload_json: JSON.stringify({ monitor_decision: { action: "WAIT" } }),
        supplementary_writes_json: "[]",
        decision_summary: "WAIT",
        data_quality_status: "ready",
        warnings: [],
      }));
      return { exitCode: 0, stderr: "", timedOut: false, stdout: "" };
    },
  });

  const result = await adapter.analyze({
    prompt: "Use the mandatory context phases.",
    contextCapability,
  });

  assert.ok(invocation.args.includes("mcp_servers.desk_context.required=true"));
  assert.ok(invocation.args.includes('mcp_servers.desk_context.default_tools_approval_mode="approve"'));
  assert.ok(invocation.args.some((value) => (
    String(value).startsWith("mcp_servers.desk_context.enabled_tools=")
  )));
  assert.equal(invocation.env.DATABASE_URL, undefined);
  assert.equal(result.context_evidence_receipts[0].phase, "CORE_MARKET");
  assert.equal(result.telemetry.context_tool_call_count, 1);
});

test("Codex adapter enables replay-only context tools only for Replay capabilities", async () => {
  const enabledToolsByScope = {};
  const adapter = new CodexExecAdapter({
    spawnProcess: async (input) => {
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      const enabledConfig = input.args.find((value) => String(value).startsWith(
        "mcp_servers.desk_context.enabled_tools=",
      ));
      const capabilityArgs = input.args.find((value) => String(value).startsWith(
        "mcp_servers.desk_context.args=",
      ));
      const configuredArgs = JSON.parse(capabilityArgs.split("=").slice(1).join("="));
      const capabilityPath = configuredArgs
        .find((value) => value.startsWith("--capability-file="))
        .slice(18);
      const capability = JSON.parse(await readFile(capabilityPath, "utf8"));
      enabledToolsByScope[capability.scope] = JSON.parse(
        enabledConfig.split("=").slice(1).join("="),
      );
      await writeFile(outputPath, JSON.stringify(basicCodexOutput()));
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });
  const replayCapability = testContextCapability();
  const liveCapability = {
    ...replayCapability,
    scope: "live",
  };

  await adapter.analyze({
    prompt: "Replay tools",
    contextCapability: replayCapability,
  });
  await adapter.analyze({
    prompt: "LIVE tools",
    contextCapability: liveCapability,
  });

  assert.equal(enabledToolsByScope.replay.includes("get_replay_section_page"), true);
  assert.equal(enabledToolsByScope.live.includes("get_replay_section_page"), false);
  assert.deepEqual(
    enabledToolsByScope.live,
    enabledToolsByScope.replay.filter((tool) => tool !== "get_replay_section_page"),
  );
});

test("Codex adapter enforces the capability deep-read allowlist", async () => {
  let enabledTools = [];
  const adapter = new CodexExecAdapter({
    spawnProcess: async (input) => {
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      const enabledConfig = input.args.find((value) => String(value).startsWith(
        "mcp_servers.desk_context.enabled_tools=",
      ));
      enabledTools = JSON.parse(enabledConfig.split("=").slice(1).join("="));
      await writeFile(outputPath, JSON.stringify(basicCodexOutput()));
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });
  const full = testContextCapability();
  const bounded = {
    ...full,
    allowed_tools: full.allowed_tools.filter((tool) => (
      !["get_market_dataset", "get_replay_section_page"].includes(tool)
    )),
  };

  await adapter.analyze({
    prompt: "Routine bounded context",
    contextCapability: bounded,
  });

  assert.equal(enabledTools.includes("get_market_dataset"), false);
  assert.equal(enabledTools.includes("get_replay_section_page"), false);
  assert.equal(enabledTools.includes("get_market_context"), true);
});

test("Codex adapter preserves direct V2 analytical objects without JSON-string nesting", async () => {
  const adapter = new CodexExecAdapter({
    spawnProcess: async (input) => {
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify({
        schema_version: "desk_ai_analysis_output_v2",
        save_payload: {
          analysis_output: {
            contract: {
              name: "DeskMasterAnalysisContract",
              version: "5.3.0",
            },
            execution_plan: {
              contract: {
                name: "DeskExecutionPlanContract",
                version: "1.2.0",
              },
            },
          },
        },
        supplementary_writes: [],
        decision_summary: "WAIT",
        data_quality_status: "ready",
        warnings: [],
      }));
      return {
        exitCode: 0,
        stderr: "",
        timedOut: false,
        stdout: "",
      };
    },
  });

  const result = await adapter.analyze({
    prompt: "Return one direct Master output.",
    outputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true,
    },
  });

  assert.equal(
    result.output.save_payload.analysis_output.contract.name,
    "DeskMasterAnalysisContract",
  );
  assert.equal("save_payload_json" in result.output, false);
  assert.deepEqual(result.output.supplementary_writes, []);
});

test("Codex adapter classifies authentication and timeout failures", async () => {
  const authAdapter = new CodexExecAdapter({
    spawnProcess: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "401 authentication required; run codex login",
      timedOut: false,
    }),
  });
  await assert.rejects(
    () => authAdapter.analyze({ prompt: "test" }),
    (error) => error.code === "CODEX_AUTH_REQUIRED" && error.retryable === false,
  );

  const timeoutAdapter = new CodexExecAdapter({
    spawnProcess: async () => ({
      exitCode: -1,
      stdout: "",
      stderr: "",
      timedOut: true,
    }),
  });
  await assert.rejects(
    () => timeoutAdapter.analyze({ prompt: "test" }),
    (error) => error.code === "CODEX_TIMEOUT" && error.retryable === true,
  );
});

test("Codex environment allowlist excludes Desk and database credentials", () => {
  const env = sanitizedCodexEnv({
    PATH: "/bin",
    DATABASE_URL: "secret",
    DESK_MCP_API_KEY: "secret",
    OPENAI_API_KEY: "not-used-by-codex-exec",
    CODEX_API_KEY: "codex-only",
  }, "/secure/codex");
  assert.deepEqual(env, {
    PATH: "/bin",
    CODEX_API_KEY: "codex-only",
    CODEX_HOME: "/secure/codex",
  });
});

test("JSONL parser tolerates non-JSON diagnostic lines", () => {
  const telemetry = parseCodexJsonlTelemetry([
    "diagnostic",
    JSON.stringify({ type: "thread.started", thread_id: "thread-2" }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 3 } }),
  ].join("\n"));
  assert.equal(telemetry.thread_id, "thread-2");
  assert.equal(telemetry.input_tokens, 12);
  assert.equal(telemetry.event_count, 2);
});

test("context evidence parser ignores malformed and duplicate receipts", () => {
  const capability = testContextCapability();
  const unsignedReceipt = {
    schema_version: "desk_context_evidence_receipt_v1",
    receipt_id: "receipt-1",
    recorded_at_utc: "2026-08-02T12:00:01.000Z",
    capability_id: capability.capability_id,
    job_id: capability.job_id,
    envelope_hash: capability.envelope_hash,
    scope: capability.scope,
    workflow: capability.workflow,
    sequence: 1,
    phase: "NEWS",
    tool: "get_news_context",
    query: { tool: "get_news_context" },
    status: "COMPLETE",
    result_sha256: "e".repeat(64),
    evidence_count: 1,
  };
  const receipt = {
    ...unsignedReceipt,
    receipt_hmac: signDeskContextEvidenceReceipt(unsignedReceipt, capability),
  };
  const parsed = parseContextEvidenceTrace([
    "diagnostic",
    JSON.stringify(receipt),
    JSON.stringify(receipt),
  ].join("\n"), capability);
  assert.deepEqual(parsed, [receipt]);
  assert.deepEqual(
    parseContextEvidenceTrace(JSON.stringify({
      ...receipt,
      receipt_id: "forged",
      receipt_hmac: "0".repeat(64),
    }), capability),
    [],
  );
});

test("context MCP config uses a strict allowlist and no inherited Desk secrets", () => {
  const args = contextMcpConfigArgs({
    command: "/usr/bin/node",
    script: "/desk/context.mjs",
    capabilityPath: "/tmp/capability.json",
    tracePath: "/tmp/trace.jsonl",
    enabledTools: ["get_context_catalog"],
  });
  assert.ok(args.includes('mcp_servers.desk_context.enabled_tools=["get_context_catalog"]'));
  assert.ok(args.includes("mcp_servers.desk_context.required=true"));
  assert.equal(args.some((value) => String(value).includes("DATABASE_URL")), false);
});

test("context MCP config has no orphan or duplicate startup timeout assignment", () => {
  const args = contextMcpConfigArgs({
    command: "/usr/bin/node",
    script: "/desk/context.mjs",
    capabilityPath: "/tmp/capability.json",
    tracePath: "/tmp/trace.jsonl",
  });
  const assignment = "mcp_servers.desk_context.startup_timeout_sec=20";
  const indices = args.flatMap((value, index) => value === assignment ? [index] : []);
  assert.deepEqual(indices.length, 1);
  assert.equal(args[indices[0] - 1], "-c");
  for (let index = 0; index < args.length; index += 2) {
    assert.equal(args[index], "-c");
    assert.match(args[index + 1], /^mcp_servers\.desk_context\./);
  }
});

test("private POSIX Codex run directories are mode 0700 and securely removed", {
  skip: process.platform === "win32",
}, async () => {
  const outer = await mkdtemp("/tmp/desk-codex-secure-test-");
  try {
    const runRoot = await createSecureCodexRunDirectory({
      baseRoot: join(outer, "private"),
      platform: "linux",
    });
    assert.equal((await lstat(runRoot)).mode & 0o777, 0o700);
    await writeFile(join(runRoot, "secret.txt"), "database-password", { mode: 0o600 });
    await cleanupSecureCodexRunDirectory(runRoot, { platform: "linux" });
    await assert.rejects(
      lstat(runRoot),
      (error) => error.code === "ENOENT",
    );
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("Windows private run directory applies and verifies a fail-closed DACL before use", async () => {
  const outer = await mkdtemp(join(tmpdir(), "desk-codex-acl-test-"));
  const calls = [];
  try {
    const runRoot = await createSecureCodexRunDirectory({
      baseRoot: join(outer, "private"),
      platform: "win32",
      aclEnv: {
        USERDOMAIN: "DESK",
        USERNAME: "DeskWorker",
      },
      systemCommandRunner: async (input) => {
        calls.push(input);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(calls.length, 4);
    assert.deepEqual(
      calls.filter((call) => call.args.includes("/inheritance:r")).map((call) => ({
        executable: call.executable,
        shell: call.shell,
        grants: call.args.filter((value) => value.includes("(OI)(CI)F")),
      })),
      [
        {
          executable: "icacls.exe",
          shell: undefined,
          grants: [
            "DESK\\DeskWorker:(OI)(CI)F",
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
          ],
        },
        {
          executable: "icacls.exe",
          shell: undefined,
          grants: [
            "DESK\\DeskWorker:(OI)(CI)F",
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
          ],
        },
      ],
    );
    assert.equal(calls.filter((call) => call.args.includes("/verify")).length, 2);
    await cleanupSecureCodexRunDirectory(runRoot, { platform: "linux" });
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("Windows private run creation fails closed when icacls cannot secure the root", async () => {
  const outer = await mkdtemp(join(tmpdir(), "desk-codex-acl-fail-test-"));
  try {
    await assert.rejects(
      createSecureCodexRunDirectory({
        baseRoot: join(outer, "private"),
        platform: "win32",
        aclEnv: {
          USERDOMAIN: "DESK",
          USERNAME: "DeskWorker",
        },
        systemCommandRunner: async () => ({
          exitCode: 5,
          stdout: "",
          stderr: "access denied",
        }),
      }),
      (error) => error.code === "CODEX_TEMP_ACL_FAILED",
    );
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("Windows private run ACL resolves a WORKGROUP local account through COMPUTERNAME", async () => {
  const outer = await mkdtemp(join(tmpdir(), "desk-codex-local-acl-test-"));
  const calls = [];
  try {
    const runRoot = await createSecureCodexRunDirectory({
      baseRoot: join(outer, "private"),
      platform: "win32",
      aclEnv: {
        USERDOMAIN: "WORKGROUP",
        COMPUTERNAME: "WIN-DESK",
        USERNAME: "Administrator",
      },
      systemCommandRunner: async (input) => {
        calls.push(input);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    const grants = calls
      .filter((call) => call.args.includes("/grant:r"))
      .flatMap((call) => call.args);
    assert.ok(grants.includes("WIN-DESK\\Administrator:(OI)(CI)F"));
    assert.equal(grants.some((value) => value.includes("WORKGROUP\\Administrator")), false);
    await cleanupSecureCodexRunDirectory(runRoot, { platform: "linux" });
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("Codex adapter treats cleanup verification failure as a fail-closed error", async () => {
  const runRoot = await mkdtemp(join(tmpdir(), "desk-codex-cleanup-fail-test-"));
  const adapter = new CodexExecAdapter({
    createRunDirectory: async () => runRoot,
    cleanupRunDirectory: async () => {
      throw Object.assign(new Error("directory busy"), { code: "EBUSY" });
    },
    spawnProcess: async (input) => {
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(basicCodexOutput()));
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });
  try {
    await assert.rejects(
      adapter.analyze({ prompt: "test cleanup" }),
      (error) => error.code === "CODEX_TEMP_CLEANUP_FAILED",
    );
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("bounded output collector preserves only a UTF-8 tail and reports dropped bytes", () => {
  const collector = createBoundedOutputCollector(32);
  collector.append("prefix-".repeat(20));
  collector.append("résultat-final");
  assert.equal(Buffer.byteLength(collector.text()) <= 32, true);
  assert.match(collector.text(), /résultat-final$/);
  assert.equal(collector.truncated, true);
  assert.equal(collector.droppedBytes > 0, true);
});

test("spawnCodex bounds stdout and stderr while preserving streamed JSONL telemetry", async () => {
  const script = [
    `process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"bounded-thread"})+"\\n");`,
    `process.stdout.write("x".repeat(200000)+"\\n");`,
    `process.stderr.write("e".repeat(200000));`,
    `process.stdout.write(JSON.stringify({type:"turn.completed",usage:{input_tokens:17,output_tokens:5}})+"\\nTAIL");`,
  ].join("");
  const result = await spawnCodex({
    executable: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    env: process.env,
    stdin: "",
    timeoutMs: 10_000,
    maxOutputBytes: 4_096,
    platform: process.platform,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.byteLength(result.stdout) <= 4_096, true);
  assert.equal(Buffer.byteLength(result.stderr) <= 4_096, true);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
  assert.match(result.stdout, /TAIL$/);
  assert.equal(result.jsonlTelemetry.thread_id, "bounded-thread");
  assert.equal(result.jsonlTelemetry.input_tokens, 17);
});

test("Windows timeout termination uses taskkill for the complete process tree", async () => {
  const calls = [];
  await terminateCodexProcessTree({
    pid: 4321,
    exitCode: null,
    kill() {
      throw new Error("direct kill must not be used after taskkill succeeds");
    },
  }, {
    platform: "win32",
    processKill: () => undefined,
    systemCommandRunner: async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "taskkill.exe");
  assert.deepEqual(calls[0].args, ["/PID", "4321", "/T", "/F"]);
});

test("Unix timeout termination targets the detached process group", async () => {
  const kills = [];
  await terminateCodexProcessTree({ pid: 9876 }, {
    platform: "linux",
    processKill: (...args) => kills.push(args),
  });
  assert.deepEqual(kills, [[-9876, "SIGKILL"]]);
});

for (const code of ["EPIPE", "ECONNRESET"]) {
  test(`spawnCodex captures ${code} from stdin without an unhandled process error`, async () => {
    const child = fakeEarlyClosingChild(code);
    const result = await spawnCodex({
      executable: "codex.exe",
      args: ["exec"],
      cwd: process.cwd(),
      env: {},
      stdin: "large prompt",
      timeoutMs: 5_000,
      platform: "win32",
      spawnImpl: () => child,
      processKill: () => undefined,
      systemCommandRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    assert.equal(result.stdinError.code, code);
    assert.equal(result.exitCode, 1);
  });
}

test("onContextEvidence polls during analysis and emits only HMAC-verified receipts", async () => {
  const capability = testContextCapability();
  const callbacks = [];
  const adapter = new CodexExecAdapter({
    contextMcpScript: "/desk/run_desk_context_mcp.mjs",
    nodeBin: "/usr/bin/node",
    contextEvidencePollMs: 25,
    spawnProcess: async (input) => {
      const outputPath = input.args[input.args.indexOf("--output-last-message") + 1];
      const config = input.args.find((value) => String(value).startsWith(
        "mcp_servers.desk_context.args=",
      ));
      const configuredArgs = JSON.parse(config.split("=").slice(1).join("="));
      const tracePath = configuredArgs.find((value) => value.startsWith("--trace-file=")).slice(13);
      const unsigned = signedReceiptFixture(capability);
      await writeFile(tracePath, `${JSON.stringify({
        ...unsigned,
        receipt_id: "forged",
        receipt_hmac: "0".repeat(64),
      })}\n`);
      await wait(40);
      await appendFile(tracePath, `${JSON.stringify({
        ...unsigned,
        receipt_hmac: signDeskContextEvidenceReceipt(unsigned, capability),
      })}\n`);
      await wait(40);
      await writeFile(outputPath, JSON.stringify(basicCodexOutput()));
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await adapter.analyze({
    prompt: "poll evidence",
    contextCapability: capability,
    onContextEvidence: async (receipts) => {
      callbacks.push(receipts);
    },
  });

  assert.equal(result.context_evidence_receipts.length, 1);
  assert.equal(callbacks.length >= 1, true);
  assert.deepEqual(
    callbacks.flatMap((receipts) => receipts.map((receipt) => receipt.receipt_id)),
    ["evidence-poll-1"],
  );
});

test("Windows npm Codex wrapper executes through Node without cmd quoting", () => {
  const invocation = resolveCodexInvocation(
    "C:\\ProgramData\\DeskFutures\\bin\\codex\\codex.cmd",
    ["--version"],
    {
      platform: "win32",
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      fileExists: (candidate) => candidate.endsWith("node_modules\\@openai\\codex\\bin\\codex.js"),
    },
  );

  assert.equal(invocation.executable, "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(
    invocation.args[0],
    "C:\\ProgramData\\DeskFutures\\bin\\codex\\node_modules\\@openai\\codex\\bin\\codex.js",
  );
  assert.equal(invocation.args[1], "--version");
  assert.equal(invocation.windowsVerbatimArguments, undefined);
});

test("Windows non-npm command wrappers use a verbatim cmd invocation", () => {
  const invocation = resolveCodexInvocation(
    "C:\\Tools With Spaces\\codex.cmd",
    ["exec", "--model", "gpt-5.6"],
    {
      platform: "win32",
      comspec: "C:\\Windows\\System32\\cmd.exe",
      fileExists: () => false,
    },
  );

  assert.equal(invocation.executable, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(invocation.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(
    invocation.args[3],
    '""C:\\Tools With Spaces\\codex.cmd" "exec" "--model" "gpt-5.6""',
  );
  assert.equal(invocation.windowsVerbatimArguments, true);
});

function basicCodexOutput() {
  return {
    schema_version: "desk_ai_analysis_output_v1",
    save_payload_json: JSON.stringify({ monitor_decision: { action: "WAIT" } }),
    supplementary_writes_json: "[]",
    decision_summary: "WAIT",
    data_quality_status: "ready",
    warnings: [],
  };
}

function fakeEarlyClosingChild(code) {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new EventEmitter();
  child.stdin.end = () => {
    queueMicrotask(() => {
      child.stdin.emit("error", Object.assign(new Error(code), { code }));
      child.exitCode = 1;
      child.emit("close", 1);
    });
  };
  child.kill = () => true;
  return child;
}

function signedReceiptFixture(capability) {
  return {
    schema_version: "desk_context_evidence_receipt_v1",
    receipt_id: "evidence-poll-1",
    recorded_at_utc: new Date(
      Date.parse(capability.created_at_utc) + 1_000,
    ).toISOString(),
    capability_id: capability.capability_id,
    job_id: capability.job_id,
    envelope_hash: capability.envelope_hash,
    scope: capability.scope,
    workflow: capability.workflow,
    sequence: 1,
    phase: "CORE_MARKET",
    tool: "get_market_context",
    query: { tool: "get_market_context", domain: "core_market" },
    status: "COMPLETE",
    result_sha256: "f".repeat(64),
    evidence_count: 1,
  };
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function testContextCapability() {
  return buildDeskAiContextCapability({
    job_id: "adapter-ai-run-1",
    envelope_hash: "a".repeat(64),
    scope: "replay",
    workflow: "REPLAY_MONITOR",
    worker_id: "codex-replay-01",
    claim_handle: {
      work_item_id: "work-73",
      backtest_id: "replay-11",
      step_id: "step-73",
    },
    bundle_tool: "get_replay_monitor_bundle",
    bundle_args: {
      backtest_id: "replay-11",
      step_id: "step-73",
    },
    suggested_payload: {
      backtest_id: "replay-11",
      replay_run_id: "replay-11",
      step_id: "step-73",
      trading_date: "2026-06-11",
      session: "asia_open",
      mode: "replay",
      bundle_id: "bundle-73",
      pack_id: "pack-11",
      pack_build_id: "build-11",
    },
    bundle: {
      bundle_id: "bundle-73",
      bundle_type: "monitor",
      backtest_id: "replay-11",
      replay_run_id: "replay-11",
      step_id: "step-73",
      trading_date: "2026-06-11",
      session: "asia_open",
      mode: "replay",
      cutoff_utc: "2026-06-11T01:55:00.000Z",
      cutoff_paris: "2026-06-11T03:55:00+02:00",
      pack_id: "pack-11",
      pack_build_id: "build-11",
      source_bundle_hash: "immutable-source-bundle-hash",
    },
  }, {
    env: {
      DATABASE_URL: "postgresql://desk:secret@localhost/desk",
    },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });
}
