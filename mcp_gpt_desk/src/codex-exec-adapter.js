import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESK_AI_CODEX_OUTPUT_JSON_SCHEMA,
  normalizeCodexAnalysisOutput,
} from "./desk-ai-worker-envelope.js";
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  normalizeCodexReasoningEffort,
} from "./codex-runtime-settings.js";
import {
  DESK_AI_CONTEXT_MCP_SERVER_NAME,
  DESK_AI_CONTEXT_TOOL_NAMES,
  verifyDeskContextEvidenceReceipt,
} from "./desk-ai-context-capability.js";
import { deskContextToolNamesForScope } from "./desk-ai-context-policy.js";

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_MCP_SCRIPT = resolve(
  MODULE_ROOT,
  "../scripts/run_desk_context_mcp.mjs",
);
const DEFAULT_CODEX_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_CONTEXT_EVIDENCE_POLL_MS = 1_000;
const DEFAULT_PRIVATE_TEMP_ROOT = join(tmpdir(), "desk-futures-codex");
const FILE_WIPE_CHUNK_BYTES = 64 * 1024;

export class CodexExecAdapter {
  constructor(options = {}) {
    this.baseEnv = options.baseEnv || process.env;
    this.platform = options.platform || process.platform;
    this.codexBin = options.codexBin || process.env.DESK_CODEX_BIN || "codex";
    this.cwd = resolve(options.cwd || process.cwd());
    this.model = options.model || process.env.DESK_CODEX_MODEL || "";
    this.reasoningEffort = normalizeCodexReasoningEffort(
      options.reasoningEffort ?? process.env.DESK_CODEX_REASONING_EFFORT,
      DEFAULT_CODEX_REASONING_EFFORT,
    );
    this.runtimeSettingsProvider = options.runtimeSettingsProvider || null;
    this.timeoutMs = boundedInteger(
      options.timeoutMs ?? process.env.DESK_CODEX_TIMEOUT_MS,
      480_000,
      30_000,
      780_000,
    );
    this.codexHome = options.codexHome || process.env.CODEX_HOME || "";
    this.maxOutputBytes = boundedInteger(
      options.maxOutputBytes ?? process.env.DESK_CODEX_MAX_OUTPUT_BYTES,
      DEFAULT_CODEX_OUTPUT_LIMIT_BYTES,
      64 * 1024,
      16 * 1024 * 1024,
    );
    this.contextEvidencePollMs = boundedInteger(
      options.contextEvidencePollMs ?? process.env.DESK_CODEX_CONTEXT_EVIDENCE_POLL_MS,
      DEFAULT_CONTEXT_EVIDENCE_POLL_MS,
      25,
      10_000,
    );
    this.privateTempRoot = resolve(
      options.privateTempRoot
        || process.env.DESK_CODEX_PRIVATE_TEMP_ROOT
        || DEFAULT_PRIVATE_TEMP_ROOT,
    );
    this.systemCommandRunner = options.systemCommandRunner || runSystemCommand;
    this.createRunDirectory = options.createRunDirectory || (() => (
      createSecureCodexRunDirectory({
        baseRoot: this.privateTempRoot,
        platform: this.platform,
        aclEnv: options.aclEnv || process.env,
        systemCommandRunner: this.systemCommandRunner,
      })
    ));
    this.cleanupRunDirectory = options.cleanupRunDirectory
      || ((runRoot) => cleanupSecureCodexRunDirectory(runRoot, {
        platform: this.platform,
      }));
    this.spawnProcess = options.spawnProcess || ((input) => spawnCodex({
      ...input,
      platform: this.platform,
      maxOutputBytes: this.maxOutputBytes,
      systemCommandRunner: this.systemCommandRunner,
    }));
    this.contextMcpScript = resolve(
      options.contextMcpScript
        || process.env.DESK_AI_CONTEXT_MCP_SCRIPT
        || DEFAULT_CONTEXT_MCP_SCRIPT,
    );
    this.nodeBin = options.nodeBin || process.execPath;
  }

  async preflight() {
    const result = await this.spawnProcess({
      executable: this.codexBin,
      args: ["--version"],
      cwd: this.cwd,
      env: sanitizedCodexEnv(this.baseEnv, this.codexHome),
      stdin: "",
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) {
      throw codexError("CODEX_CLI_UNAVAILABLE", "Codex CLI preflight failed.", {
        stderr: tail(result.stderr),
      });
    }
    return {
      ok: true,
      version: String(result.stdout || result.stderr || "").trim(),
      runtime_settings: await this.getRuntimeSettings(),
    };
  }

  async analyze({
    prompt,
    outputSchema = DESK_AI_CODEX_OUTPUT_JSON_SCHEMA,
    contextCapability = null,
    onContextEvidence = null,
    sessionId = null,
    reasoningEffort = null,
    timeoutMs = null,
  } = {}) {
    if (!prompt) throw codexError("CODEX_PROMPT_REQUIRED", "Codex analysis prompt is required.");
    if (onContextEvidence !== null && typeof onContextEvidence !== "function") {
      throw codexError(
        "CODEX_CONTEXT_EVIDENCE_CALLBACK_INVALID",
        "onContextEvidence must be a function when provided.",
      );
    }
    const runtimeSettings = await this.getRuntimeSettings();
    const effectiveReasoningEffort = normalizeCodexReasoningEffort(
      reasoningEffort,
      runtimeSettings.reasoningEffort,
    );
    const effectiveTimeoutMs = timeoutMs === null || timeoutMs === undefined
      ? this.timeoutMs
      : boundedInteger(timeoutMs, this.timeoutMs, 30_000, 780_000);
    const analysisStartedAtMs = performance.now();
    const runRoot = await this.createRunDirectory();
    const schemaPath = join(runRoot, "output-schema.json");
    const outputPath = join(runRoot, "final-output.json");
    const capabilityPath = join(runRoot, "context-capability.json");
    const contextTracePath = join(runRoot, "context-evidence.jsonl");
    let primaryError = null;
    let evidencePoller = null;
    try {
      await writeFile(schemaPath, JSON.stringify(outputSchema), { encoding: "utf8", mode: 0o600 });
      if (contextCapability) {
        await writeFile(capabilityPath, JSON.stringify(contextCapability), {
          encoding: "utf8",
          mode: 0o600,
        });
        await writeFile(contextTracePath, "", { encoding: "utf8", mode: 0o600 });
        if (onContextEvidence) {
          evidencePoller = startContextEvidencePolling({
            tracePath: contextTracePath,
            capability: contextCapability,
            onContextEvidence,
            intervalMs: this.contextEvidencePollMs,
          });
        }
      }
      const executionOptions = [
        "--json",
        "--ignore-rules",
        "--ignore-user-config",
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="read-only"',
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.multi_agent=false",
        "-c",
        "features.apps=false",
        "-c",
        "features.browser_use=false",
        "-c",
        "features.browser_use_external=false",
        "-c",
        "features.computer_use=false",
        "-c",
        "features.image_generation=false",
        "-c",
        "features.skill_search=false",
        "-c",
        "features.plugin_sharing=false",
      ];
      const args = sessionId
        ? ["exec", "resume", ...executionOptions]
        : ["exec", "--sandbox", "read-only", ...executionOptions];
      if (contextCapability) {
        args.push(...contextMcpConfigArgs({
          serverName: DESK_AI_CONTEXT_MCP_SERVER_NAME,
          command: this.nodeBin,
          script: this.contextMcpScript,
          capabilityPath,
          tracePath: contextTracePath,
          enabledTools: deskContextToolNamesForScope(contextCapability.scope).filter((tool) => (
            contextCapability.allowed_tools?.includes(tool)
          )),
        }));
      }
      args.push(
        "--skip-git-repo-check",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
      );
      if (runtimeSettings.model) args.push("--model", runtimeSettings.model);
      args.push(
        "-c",
        `model_reasoning_effort=${JSON.stringify(effectiveReasoningEffort)}`,
      );
      if (sessionId) args.push(String(sessionId));
      args.push("-");
      const result = await this.spawnProcess({
        executable: this.codexBin,
        args,
        cwd: runRoot,
        env: sanitizedCodexEnv(this.baseEnv, this.codexHome),
        stdin: prompt,
        timeoutMs: effectiveTimeoutMs,
      });
      await evidencePoller?.stop();
      evidencePoller = null;
      if (result.timedOut) {
        throw codexError("CODEX_TIMEOUT", `Codex exceeded ${effectiveTimeoutMs} ms.`, {
          stderr: tail(result.stderr),
          ...(result.terminationError
            ? { termination_error: compactProcessError(result.terminationError) }
            : {}),
        }, true);
      }
      if (result.stdinError) {
        throw codexError(
          ["EPIPE", "ECONNRESET"].includes(result.stdinError.code)
            ? "CODEX_STDIN_CLOSED"
            : "CODEX_STDIN_WRITE_FAILED",
          "Codex closed its input before the complete prompt was delivered.",
          { stdin_error: compactProcessError(result.stdinError) },
          true,
        );
      }
      if (result.exitCode !== 0) {
        throw classifyCodexFailure(result);
      }
      const finalText = await readFile(outputPath, "utf8").catch(() => "");
      if (!finalText.trim()) {
        throw codexError("CODEX_OUTPUT_MISSING", "Codex completed without a final structured output.", {
          stdout: tail(result.stdout),
          stderr: tail(result.stderr),
        }, true);
      }
      let parsed;
      try {
        parsed = JSON.parse(finalText);
      } catch {
        throw codexError("CODEX_OUTPUT_INVALID_JSON", "Codex final output is not valid JSON.", {
          output: tail(finalText),
        });
      }
      const contextEvidenceReceipts = contextCapability
        ? parseContextEvidenceTrace(
            await readFile(contextTracePath, "utf8").catch(() => ""),
            contextCapability,
          )
        : [];
      const codexTelemetry = result.jsonlTelemetry || parseCodexJsonlTelemetry(result.stdout);
      if (
        sessionId
        && codexTelemetry.thread_id
        && String(codexTelemetry.thread_id) !== String(sessionId)
      ) {
        throw codexError(
          "CODEX_SESSION_SCOPE_MISMATCH",
          "Codex resumed a different conversation than the canonical run session.",
          {
            expected_thread_id: String(sessionId),
            actual_thread_id: String(codexTelemetry.thread_id),
          },
        );
      }
      return {
        output: normalizeCodexAnalysisOutput(parsed),
        telemetry: {
          ...codexTelemetry,
          thread_id: codexTelemetry.thread_id || (sessionId ? String(sessionId) : null),
          conversation_mode: sessionId ? "RESUMED" : "CREATED",
          ...(runtimeSettings.model ? { model: runtimeSettings.model } : {}),
          reasoning_effort: effectiveReasoningEffort,
          configured_reasoning_effort: runtimeSettings.reasoningEffort,
          runtime_settings_revision: runtimeSettings.revision,
          analysis_duration_ms: Math.max(0, performance.now() - analysisStartedAtMs),
          context_mcp_enabled: Boolean(contextCapability),
          context_tool_call_count: contextEvidenceReceipts.length,
          stdout_truncated: result.stdoutTruncated === true,
          stderr_truncated: result.stderrTruncated === true,
        },
        context_evidence_receipts: contextEvidenceReceipts,
      };
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      await evidencePoller?.stop().catch(() => undefined);
      try {
        await this.cleanupRunDirectory(runRoot);
      } catch (cleanupError) {
        throw codexError(
          "CODEX_TEMP_CLEANUP_FAILED",
          "The private Codex run directory could not be securely erased.",
          {
            cleanup_error: compactProcessError(cleanupError),
            ...(primaryError
              ? { primary_error: compactProcessError(primaryError) }
              : {}),
          },
          false,
        );
      }
    }
  }

  async getRuntimeSettings() {
    let dynamic = null;
    if (this.runtimeSettingsProvider) {
      try {
        dynamic = await this.runtimeSettingsProvider();
      } catch (error) {
        throw codexError(
          "CODEX_RUNTIME_SETTINGS_UNAVAILABLE",
          "Codex runtime settings could not be loaded.",
          { cause: String(error?.message || error || "unknown") },
          true,
        );
      }
    }
    return {
      model: String(dynamic?.model ?? this.model ?? "").trim(),
      reasoningEffort: normalizeCodexReasoningEffort(
        dynamic?.reasoningEffort ?? dynamic?.reasoning_effort,
        this.reasoningEffort,
      ),
      revision: Number(dynamic?.revision || 0),
      source: dynamic?.source || (this.runtimeSettingsProvider ? "provider" : "process"),
    };
  }
}

export function contextMcpConfigArgs({
  serverName = DESK_AI_CONTEXT_MCP_SERVER_NAME,
  command,
  script,
  capabilityPath,
  tracePath,
  enabledTools = DESK_AI_CONTEXT_TOOL_NAMES,
} = {}) {
  if (!command || !script || !capabilityPath || !tracePath) {
    throw codexError(
      "CODEX_CONTEXT_MCP_CONFIG_INVALID",
      "The scoped context MCP configuration is incomplete.",
    );
  }
  const prefix = `mcp_servers.${serverName}`;
  return [
    "-c",
    `${prefix}.command=${JSON.stringify(command)}`,
    "-c",
    `${prefix}.args=${JSON.stringify([
      script,
      `--capability-file=${capabilityPath}`,
      `--trace-file=${tracePath}`,
    ])}`,
    "-c",
    `${prefix}.cwd=${JSON.stringify(dirname(script))}`,
    "-c",
    `${prefix}.enabled=true`,
    "-c",
    `${prefix}.required=true`,
    "-c",
    `${prefix}.startup_timeout_sec=20`,
    "-c",
    `${prefix}.tool_timeout_sec=120`,
    "-c",
    `${prefix}.enabled_tools=${JSON.stringify(enabledTools)}`,
    "-c",
    `${prefix}.default_tools_approval_mode="approve"`,
  ];
}

export function parseContextEvidenceTrace(value = "", capability = null) {
  if (!capability) return [];
  const seen = new Set();
  return String(value || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const receipt = JSON.parse(line);
        if (
          receipt?.schema_version !== "desk_context_evidence_receipt_v1"
          || !receipt.receipt_id
          || seen.has(receipt.receipt_id)
          || (capability && !verifyDeskContextEvidenceReceipt(receipt, capability).valid)
        ) {
          return [];
        }
        seen.add(receipt.receipt_id);
        return [receipt];
      } catch {
        return [];
      }
    });
}

export function sanitizedCodexEnv(source = process.env, codexHome = "") {
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "ComSpec",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "APPDATA",
    "PROGRAMDATA",
    "LANG",
    "LC_ALL",
    "CODEX_API_KEY",
  ];
  const env = {};
  for (const key of allowed) {
    if (source[key] !== undefined) env[key] = String(source[key]);
  }
  if (codexHome) env.CODEX_HOME = codexHome;
  return env;
}

export function parseCodexJsonlTelemetry(stdout = "") {
  const events = String(stdout).split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const completed = [...events].reverse().find((event) => event.type === "turn.completed");
  const started = events.find((event) => event.type === "thread.started");
  return {
    provider: "openai",
    thread_id: started?.thread_id || null,
    input_tokens: numberOrNull(completed?.usage?.input_tokens),
    cached_input_tokens: numberOrNull(completed?.usage?.cached_input_tokens),
    output_tokens: numberOrNull(completed?.usage?.output_tokens),
    reasoning_output_tokens: numberOrNull(completed?.usage?.reasoning_output_tokens),
    event_count: events.length,
  };
}

export async function spawnCodex({
  executable,
  args,
  cwd,
  env,
  stdin,
  timeoutMs,
  platform = process.platform,
  maxOutputBytes = DEFAULT_CODEX_OUTPUT_LIMIT_BYTES,
  spawnImpl = spawn,
  processKill = process.kill.bind(process),
  systemCommandRunner = runSystemCommand,
}) {
  const invocation = resolveCodexInvocation(executable, args, { platform });
  return new Promise((resolveRun, rejectRun) => {
    let child;
    try {
      child = spawnImpl(invocation.executable, invocation.args, {
        cwd,
        env,
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
        detached: platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      rejectRun(codexError(
        "CODEX_PROCESS_START_FAILED",
        String(error?.message || error),
        undefined,
        true,
      ));
      return;
    }

    const stdout = createBoundedOutputCollector(maxOutputBytes);
    const stderr = createBoundedOutputCollector(maxOutputBytes);
    const telemetry = createCodexTelemetryAccumulator();
    let timedOut = false;
    let stdinError = null;
    let terminationError = null;
    let terminationPromise = null;
    let terminationWatchdog = null;
    let settled = false;
    let closed = false;

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      rejectRun(error);
    };
    const requestTermination = () => {
      if (terminationPromise) return terminationPromise;
      terminationPromise = terminateCodexProcessTree(child, {
        platform,
        processKill,
        systemCommandRunner,
      }).catch((error) => {
        terminationError = error;
        try {
          child.kill?.("SIGKILL");
        } catch {
          // The watchdog converts a still-running child into a fail-closed error.
        }
      });
      terminationWatchdog = setTimeout(() => {
        if (closed || settled) return;
        finishReject(codexError(
          "CODEX_PROCESS_TREE_TERMINATION_TIMEOUT",
          "The Codex process tree did not close after forced termination.",
          { pid: child?.pid || null },
          true,
        ));
      }, 15_000);
      terminationWatchdog.unref?.();
      return terminationPromise;
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void requestTermination();
    }, boundedInteger(timeoutMs, 480_000, 1, 24 * 60 * 60_000));

    child.stdout?.on("data", (chunk) => {
      stdout.append(chunk);
      telemetry.append(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr.append(chunk);
    });
    child.stdin?.on("error", (error) => {
      stdinError = compactNodeError(error);
      if (!closed) void requestTermination();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (terminationWatchdog) clearTimeout(terminationWatchdog);
      finishReject(codexError(
        "CODEX_PROCESS_START_FAILED",
        String(error?.message || error),
        undefined,
        true,
      ));
    });
    child.on("close", async (exitCode) => {
      clearTimeout(timer);
      if (terminationWatchdog) clearTimeout(terminationWatchdog);
      closed = true;
      if (terminationPromise) await terminationPromise;
      if (settled) return;
      settled = true;
      telemetry.finish();
      resolveRun({
        exitCode: exitCode ?? -1,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut,
        stdinError,
        terminationError,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        stdoutDroppedBytes: stdout.droppedBytes,
        stderrDroppedBytes: stderr.droppedBytes,
        jsonlTelemetry: telemetry.snapshot(),
      });
    });

    try {
      child.stdin?.end(stdin || "");
    } catch (error) {
      stdinError = compactNodeError(error);
      void requestTermination();
    }
  });
}

export async function terminateCodexProcessTree(child, {
  platform = process.platform,
  processKill = process.kill.bind(process),
  systemCommandRunner = runSystemCommand,
} = {}) {
  const pid = Number(child?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return;

  if (platform === "win32") {
    const result = await systemCommandRunner({
      executable: "taskkill.exe",
      args: ["/PID", String(pid), "/T", "/F"],
      timeoutMs: 20_000,
      maxOutputBytes: 64 * 1024,
    });
    if (result.exitCode === 0 || !processExists(pid, processKill)) return;
    try {
      child.kill?.("SIGKILL");
    } catch {
      // The typed tree-termination error below remains the fail-closed outcome.
    }
    throw codexError(
      "CODEX_PROCESS_TREE_TERMINATION_FAILED",
      "taskkill could not terminate the complete Codex process tree.",
      {
        pid,
        exit_code: result.exitCode,
        stderr: tail(result.stderr),
      },
      true,
    );
  }

  try {
    processKill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw codexError(
      "CODEX_PROCESS_TREE_TERMINATION_FAILED",
      "The Codex Unix process group could not be terminated.",
      { pid, cause: compactProcessError(error) },
      true,
    );
  }
}

export function createBoundedOutputCollector(limitBytes = DEFAULT_CODEX_OUTPUT_LIMIT_BYTES) {
  const limit = boundedInteger(
    limitBytes,
    DEFAULT_CODEX_OUTPUT_LIMIT_BYTES,
    1,
    64 * 1024 * 1024,
  );
  let buffers = [];
  let retainedBytes = 0;
  let totalBytes = 0;
  let truncated = false;
  return {
    append(value) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "utf8");
      totalBytes += buffer.length;
      if (buffer.length >= limit) {
        buffers = [buffer.subarray(buffer.length - limit)];
        retainedBytes = limit;
        truncated = totalBytes > limit;
        return;
      }
      buffers.push(buffer);
      retainedBytes += buffer.length;
      while (retainedBytes > limit && buffers.length) {
        const excess = retainedBytes - limit;
        const first = buffers[0];
        if (first.length <= excess) {
          buffers.shift();
          retainedBytes -= first.length;
        } else {
          buffers[0] = first.subarray(excess);
          retainedBytes -= excess;
        }
        truncated = true;
      }
    },
    text() {
      let value = Buffer.concat(buffers, retainedBytes).toString("utf8");
      while (Buffer.byteLength(value, "utf8") > limit && value.length) {
        value = value.slice(1);
      }
      return value;
    },
    get truncated() {
      return truncated;
    },
    get droppedBytes() {
      return Math.max(0, totalBytes - retainedBytes);
    },
    get retainedBytes() {
      return retainedBytes;
    },
  };
}

export async function createSecureCodexRunDirectory({
  baseRoot = DEFAULT_PRIVATE_TEMP_ROOT,
  platform = process.platform,
  aclEnv = process.env,
  systemCommandRunner = runSystemCommand,
} = {}) {
  const resolvedBase = resolve(baseRoot);
  await mkdir(resolvedBase, { recursive: true, mode: 0o700 });
  try {
    await assertPlainDirectory(resolvedBase);
    if (platform === "win32") {
      await hardenWindowsDirectoryAcl(resolvedBase, {
        aclEnv,
        systemCommandRunner,
      });
    } else {
      await chmod(resolvedBase, 0o700);
    }
  } catch (error) {
    throw tempSecurityError(
      "CODEX_TEMP_ACL_FAILED",
      "The private Codex temporary root could not be secured.",
      error,
    );
  }

  const runRoot = await mkdtemp(join(resolvedBase, "run-"));
  try {
    await assertPathInside(resolvedBase, runRoot);
    await assertPlainDirectory(runRoot);
    if (platform === "win32") {
      await hardenWindowsDirectoryAcl(runRoot, {
        aclEnv,
        systemCommandRunner,
      });
    } else {
      await chmod(runRoot, 0o700);
    }
    return runRoot;
  } catch (error) {
    await cleanupSecureCodexRunDirectory(runRoot, {
      platform,
      maxAttempts: 1,
    }).catch(() => undefined);
    throw tempSecurityError(
      "CODEX_TEMP_ACL_FAILED",
      "The private Codex run directory could not be secured.",
      error,
    );
  }
}

export async function cleanupSecureCodexRunDirectory(runRoot, {
  platform = process.platform,
  maxAttempts = platform === "win32" ? 4 : 2,
  retryDelayMs = 75,
  sleep = delay,
} = {}) {
  if (!runRoot) return;
  const resolvedRoot = resolve(runRoot);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await wipeDirectoryTree(resolvedRoot, resolvedRoot);
      const stillExists = await lstat(resolvedRoot)
        .then(() => true)
        .catch((error) => {
          if (error?.code === "ENOENT") return false;
          throw error;
        });
      if (stillExists) {
        throw Object.assign(new Error("private_run_directory_still_exists"), {
          code: "CODEX_TEMP_DIRECTORY_STILL_EXISTS",
        });
      }
      return;
    } catch (error) {
      if (error?.code === "ENOENT") return;
      lastError = error;
      if (attempt < maxAttempts && isRetryableCleanupError(error, platform)) {
        await sleep(retryDelayMs * attempt);
        continue;
      }
      break;
    }
  }
  throw tempSecurityError(
    "CODEX_TEMP_CLEANUP_FAILED",
    "The private Codex run directory could not be securely erased.",
    lastError,
  );
}

export function startContextEvidencePolling({
  tracePath,
  capability,
  onContextEvidence,
  intervalMs = DEFAULT_CONTEXT_EVIDENCE_POLL_MS,
  readTrace = (path) => readFile(path, "utf8"),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (!tracePath || !capability || typeof onContextEvidence !== "function") {
    throw codexError(
      "CODEX_CONTEXT_EVIDENCE_POLLER_INVALID",
      "Context evidence polling requires a trace, capability and callback.",
    );
  }
  let stopped = false;
  let lastCount = 0;
  let callbackChain = Promise.resolve();
  const poll = () => {
    callbackChain = callbackChain.then(async () => {
      if (stopped) return;
      const text = await readTrace(tracePath).catch((error) => {
        if (error?.code === "ENOENT") return "";
        throw error;
      });
      const receipts = parseContextEvidenceTrace(text, capability);
      if (receipts.length <= lastCount) return;
      lastCount = receipts.length;
      await onContextEvidence(receipts);
    }).catch(() => undefined);
    return callbackChain;
  };
  const timer = setIntervalImpl(
    () => { void poll(); },
    boundedInteger(intervalMs, DEFAULT_CONTEXT_EVIDENCE_POLL_MS, 1, 60_000),
  );
  timer?.unref?.();
  void poll();
  return {
    async stop() {
      if (stopped) return;
      await poll();
      stopped = true;
      clearIntervalImpl(timer);
      await callbackChain;
    },
  };
}

async function hardenWindowsDirectoryAcl(path, {
  aclEnv,
  systemCommandRunner,
}) {
  const principal = windowsCurrentPrincipal(aclEnv);
  const grants = [...new Set([
    `${principal}:(OI)(CI)F`,
    "*S-1-5-18:(OI)(CI)F",
    "*S-1-5-32-544:(OI)(CI)F",
  ])];
  const apply = await systemCommandRunner({
    executable: "icacls.exe",
    args: [path, "/inheritance:r", "/grant:r", ...grants, "/Q"],
    timeoutMs: 20_000,
    maxOutputBytes: 64 * 1024,
  });
  if (apply.exitCode !== 0) {
    throw Object.assign(new Error("icacls_apply_failed"), {
      code: "CODEX_TEMP_ACL_APPLY_FAILED",
      details: {
        exit_code: apply.exitCode,
        stderr: tail(apply.stderr),
      },
    });
  }
  const verify = await systemCommandRunner({
    executable: "icacls.exe",
    args: [path, "/verify", "/Q"],
    timeoutMs: 20_000,
    maxOutputBytes: 64 * 1024,
  });
  if (verify.exitCode !== 0) {
    throw Object.assign(new Error("icacls_verify_failed"), {
      code: "CODEX_TEMP_ACL_VERIFY_FAILED",
      details: {
        exit_code: verify.exitCode,
        stderr: tail(verify.stderr),
      },
    });
  }
}

function windowsCurrentPrincipal(env = process.env) {
  const explicit = String(env.DESK_CODEX_TEMP_PRINCIPAL || "").trim();
  if (explicit) return explicit;
  const username = String(env.USERNAME || "").trim();
  const domain = String(env.USERDOMAIN || "").trim();
  const computer = String(env.COMPUTERNAME || "").trim();
  if (!username) {
    throw Object.assign(new Error("windows_identity_unavailable"), {
      code: "CODEX_TEMP_ACL_IDENTITY_REQUIRED",
    });
  }
  const authority = domain && domain.toUpperCase() !== "WORKGROUP"
    ? domain
    : computer;
  return authority ? `${authority}\\${username}` : username;
}

async function assertPlainDirectory(path) {
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw Object.assign(new Error("private_temp_root_is_not_a_plain_directory"), {
      code: "CODEX_TEMP_DIRECTORY_INVALID",
    });
  }
}

async function assertPathInside(parent, candidate) {
  const value = relative(resolve(parent), resolve(candidate));
  if (!value || value.startsWith(`..${sep}`) || value === ".." || resolve(value) === value) {
    throw Object.assign(new Error("private_run_directory_escaped_its_root"), {
      code: "CODEX_TEMP_DIRECTORY_INVALID",
    });
  }
}

async function wipeDirectoryTree(root, current) {
  await assertPathAtOrInside(root, current);
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(current, entry.name);
    await assertPathAtOrInside(root, path);
    if (entry.isSymbolicLink()) {
      throw Object.assign(new Error("symlink_forbidden_in_private_run_directory"), {
        code: "CODEX_TEMP_SYMLINK_FORBIDDEN",
      });
    }
    if (entry.isDirectory()) {
      await wipeDirectoryTree(root, path);
      continue;
    }
    if (!entry.isFile()) {
      throw Object.assign(new Error("special_file_forbidden_in_private_run_directory"), {
        code: "CODEX_TEMP_SPECIAL_FILE_FORBIDDEN",
      });
    }
    await wipeAndUnlinkFile(path);
  }
  await rmdir(current);
}

async function wipeAndUnlinkFile(path) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw Object.assign(new Error("private_run_entry_is_not_a_plain_file"), {
      code: "CODEX_TEMP_FILE_INVALID",
    });
  }
  const handle = await open(path, "r+");
  try {
    const zeros = Buffer.alloc(Math.min(FILE_WIPE_CHUNK_BYTES, Math.max(1, details.size)));
    let offset = 0;
    while (offset < details.size) {
      const length = Math.min(zeros.length, details.size - offset);
      await handle.write(zeros, 0, length, offset);
      offset += length;
    }
    await handle.sync();
    await handle.truncate(0);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await unlink(path);
}

async function assertPathAtOrInside(root, candidate) {
  const base = resolve(root);
  const value = resolve(candidate);
  const pathRelative = relative(base, value);
  if (pathRelative === "" || (!pathRelative.startsWith(`..${sep}`) && pathRelative !== "..")) return;
  throw Object.assign(new Error("private_run_path_escaped_its_root"), {
    code: "CODEX_TEMP_DIRECTORY_INVALID",
  });
}

function isRetryableCleanupError(error, platform) {
  if (["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(error?.code)) return true;
  return platform === "win32" && error?.code === "UNKNOWN";
}

function tempSecurityError(code, message, cause) {
  if (cause?.code === code) return cause;
  return codexError(code, message, {
    cause: compactProcessError(cause),
  });
}

function createCodexTelemetryAccumulator() {
  let carry = "";
  let started = null;
  let completed = null;
  let eventCount = 0;
  const acceptLine = (line) => {
    if (!line) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    eventCount += 1;
    if (!started && event.type === "thread.started") started = event;
    if (event.type === "turn.completed") completed = event;
  };
  return {
    append(value) {
      carry += Buffer.isBuffer(value) ? value.toString("utf8") : String(value || "");
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() || "";
      for (const line of lines) acceptLine(line);
      if (Buffer.byteLength(carry) > 512 * 1024) {
        carry = "";
      }
    },
    finish() {
      acceptLine(carry);
      carry = "";
    },
    snapshot() {
      return {
        provider: "openai",
        thread_id: started?.thread_id || null,
        input_tokens: numberOrNull(completed?.usage?.input_tokens),
        cached_input_tokens: numberOrNull(completed?.usage?.cached_input_tokens),
        output_tokens: numberOrNull(completed?.usage?.output_tokens),
        reasoning_output_tokens: numberOrNull(completed?.usage?.reasoning_output_tokens),
        event_count: eventCount,
      };
    },
  };
}

async function runSystemCommand({
  executable,
  args = [],
  timeoutMs = 20_000,
  maxOutputBytes = 64 * 1024,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let child;
    try {
      child = spawnImpl(executable, args, {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      rejectRun(error);
      return;
    }
    const stdout = createBoundedOutputCollector(maxOutputBytes);
    const stderr = createBoundedOutputCollector(maxOutputBytes);
    let settled = false;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The close/error handler below settles the command.
      }
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => stdout.append(chunk));
    child.stderr?.on("data", (chunk) => stderr.append(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(error);
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({
        exitCode: exitCode ?? -1,
        stdout: stdout.text(),
        stderr: stderr.text(),
      });
    });
  });
}

function processExists(pid, processKill) {
  try {
    processKill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function compactNodeError(error) {
  return {
    code: String(error?.code || "UNKNOWN"),
    message: String(error?.message || error || "unknown").slice(0, 1_000),
  };
}

function compactProcessError(error) {
  if (!error) return null;
  return {
    code: String(error?.code || "UNKNOWN"),
    message: String(error?.message || error || "unknown").slice(0, 1_000),
  };
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export function resolveCodexInvocation(executable, args, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(executable)) {
    return { executable, args };
  }

  // npm's codex.cmd is only a wrapper around the JS entrypoint. Calling that
  // entrypoint with the already-running Node executable avoids cmd.exe quoting
  // ambiguities for service paths such as "C:\Program Files\...".
  const fileExists = options.fileExists || existsSync;
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const npmEntrypoint = win32.join(
    win32.dirname(executable),
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js",
  );
  if (fileExists(npmEntrypoint)) {
    return {
      executable: nodeExecutable,
      args: [npmEntrypoint, ...args],
    };
  }

  // Non-npm .cmd/.bat installations remain supported. The complete command is
  // wrapped once for cmd /s /c and passed verbatim so Node does not add
  // backslashes that cmd would interpret as literal executable characters.
  const comspec = options.comspec || process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
  const commandLine = [quoteCmd(executable), ...args.map(quoteCmd)].join(" ");
  return {
    executable: comspec,
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

function quoteCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function classifyCodexFailure(result) {
  const diagnostic = `${result.stderr || ""}\n${result.stdout || ""}`.toLowerCase();
  if (diagnostic.includes("401") || diagnostic.includes("authentication") || diagnostic.includes("login")) {
    return codexError("CODEX_AUTH_REQUIRED", "Codex authentication is missing or invalid.", {
      stderr: tail(result.stderr),
    });
  }
  if (diagnostic.includes("429") || diagnostic.includes("rate limit")) {
    return codexError("CODEX_RATE_LIMITED", "Codex is temporarily rate limited.", {
      stderr: tail(result.stderr),
    }, true);
  }
  return codexError("CODEX_EXEC_FAILED", `Codex exited with code ${result.exitCode}.`, {
    stderr: tail(result.stderr),
    stdout: tail(result.stdout),
  }, true);
}

function codexError(code, message, details = undefined, retryable = false) {
  return Object.assign(new Error(message), { code, details, retryable });
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tail(value, max = 4_000) {
  const text = String(value || "");
  return text.length <= max ? text : text.slice(-max);
}
