import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 45_000;

export const DESK_WINDOWS_SERVICE_TOPOLOGY = Object.freeze({
  schema_version: "desk_windows_service_topology_v1",
  control_plane_services: Object.freeze([
    service("postgresql-x64-16", "postgres", { role: "source_of_truth", mutable: false }),
    service("DeskFuturesApi", "api", { role: "bff", mutable: false }),
    service("DeskFuturesCaddy", "gateway", { role: "public_https", mutable: false }),
  ]),
  managed_services: Object.freeze([
    service("DeskFuturesBrokerManagement", "broker_management", { order: 10 }),
    service("DeskFuturesLiveRuntime", "live_runtime_scheduler", { order: 20 }),
    service("DeskFuturesReplayPreparation", "replay_preparation", { order: 30 }),
    service("DeskFuturesTelegram", "telegram_alerting", { order: 40 }),
    service("DeskFuturesAgentRuntimeSupervisor", "agent_runtime_supervisor", { order: 50 }),
    service("DeskFuturesAgentRuntimeResearch", "agent_runtime_research", { order: 60 }),
    service("DeskFuturesCodexLive01", "codex_live_worker", { order: 70 }),
    service("DeskFuturesCodexLive02", "codex_live_worker", { order: 80 }),
    service("DeskFuturesCodexReplay01", "codex_replay_worker", { order: 90 }),
  ]),
});

export async function executeWindowsServiceActuator({
  action,
  dryRun = true,
  topology = DESK_WINDOWS_SERVICE_TOPOLOGY,
  runner = new PowerShellWindowsServiceRunner(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedAction = normalizeAction(action);
  const plan = buildWindowsServiceActuatorPlan({ action: normalizedAction, dryRun, topology, timeoutMs });
  const before = await runner.inspect({ serviceNames: plan.allowlist, timeoutMs });
  const validation = validateWindowsServiceTopology({ plan, before });
  if (!validation.ok) return actuatorResult({ plan, before, validation, operations: [] });
  const operations = dryRun ? dryRunOperations(plan, before) : await executeOperations({ plan, before, runner, timeoutMs });
  const after = dryRun ? before : await runner.inspect({ serviceNames: plan.allowlist, timeoutMs });
  return actuatorResult({ plan, before, after, validation, operations });
}

export function buildWindowsServiceActuatorPlan({ action, dryRun = true, topology = DESK_WINDOWS_SERVICE_TOPOLOGY, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const normalizedAction = normalizeAction(action);
  const managed = [...topology.managed_services].sort((left, right) => left.order - right.order);
  const control = [...topology.control_plane_services];
  const stopOrder = [...managed].reverse();
  const startOrder = managed;
  const sequence = normalizedAction === "stop"
    ? stopOrder.map((item) => operation("stop", item))
    : normalizedAction === "start"
      ? startOrder.map((item) => operation("start", item))
      : [...stopOrder.map((item) => operation("stop", item)), ...startOrder.map((item) => operation("start", item))];
  return {
    schema_version: "desk_windows_service_actuator_plan_v1",
    action: normalizedAction,
    dry_run: dryRun === true,
    timeout_ms: boundedTimeout(timeoutMs),
    allowlist: [...control, ...managed].map((item) => item.name),
    control_plane_services: control,
    managed_services: managed,
    dependency_order: startOrder.map((item) => item.name),
    rollback_order: stopOrder.map((item) => item.name),
    sequence,
    safety: {
      broker_execution: false,
      live_execution: false,
      auto_execution: false,
      provider_command_allowed: false,
      control_plane_remains_online: true,
      control_plane_services_mutable: false,
    },
  };
}

export class PowerShellWindowsServiceRunner {
  constructor({ powershell = process.env.DESK_POWERSHELL || "powershell.exe" } = {}) {
    this.powershell = powershell;
  }

  async inspect({ serviceNames, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const names = safeServiceNames(serviceNames);
    if (!names.length) return [];
    return JSON.parse(await this.#run(encodedPowerShell(inspectScript(names)), timeoutMs));
  }

  async mutate({ operation: requestedOperation, serviceName, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const operationName = normalizeServiceOperation(requestedOperation);
    const [safeName] = safeServiceNames([serviceName]);
    const output = await this.#run(encodedPowerShell(mutateScript(operationName, safeName, boundedTimeout(timeoutMs))), timeoutMs);
    return JSON.parse(output);
  }

  #run(encodedCommand, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.powershell,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
        { windowsHide: true, timeout: boundedTimeout(timeoutMs) + 5_000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(Object.assign(error, { stderr: String(stderr || "").slice(0, 1000) }));
          } else {
            resolve(String(stdout || "[]").trim() || "[]");
          }
        },
      );
      child.stdin?.end();
    });
  }
}

function validateWindowsServiceTopology({ plan, before }) {
  const statuses = new Map(rows(before).map((item) => [item.name, item]));
  const missing = plan.allowlist.filter((name) => !statuses.has(name) || statuses.get(name)?.status === "Missing");
  const unexpected = rows(before).filter((item) => !plan.allowlist.includes(item.name)).map((item) => item.name);
  const mutableControlPlane = plan.control_plane_services.filter((item) => item.mutable !== false).map((item) => item.name);
  return {
    ok: missing.length === 0 && unexpected.length === 0 && mutableControlPlane.length === 0,
    missing_services: missing,
    unexpected_services: unexpected,
    mutable_control_plane_services: mutableControlPlane,
    safe_to_execute: missing.length === 0 && unexpected.length === 0 && mutableControlPlane.length === 0,
  };
}

async function executeOperations({ plan, before, runner, timeoutMs }) {
  const statusByName = new Map(rows(before).map((item) => [item.name, item.status]));
  const operations = [];
  for (const step of plan.sequence) {
    const current = statusByName.get(step.service_name);
    if (isNoop(step.operation, current)) {
      operations.push({ ...step, status: "NOOP", before_status: current, after_status: current, mutated: false });
      continue;
    }
    try {
      const executed = await runner.mutate({ operation: step.operation, serviceName: step.service_name, timeoutMs });
      operations.push({ ...step, ...executed, status: executed.ok ? "OK" : "FAILED", mutated: executed.mutated === true });
      statusByName.set(step.service_name, executed.after_status || current);
    } catch (error) {
      operations.push({ ...step, status: "FAILED", error_code: error?.code || "WINDOWS_SERVICE_ACTUATOR_FAILED", error_message: String(error?.message || error).slice(0, 300), mutated: false });
      break;
    }
  }
  return operations;
}

function dryRunOperations(plan, before) {
  const statusByName = new Map(rows(before).map((item) => [item.name, item.status]));
  return plan.sequence.map((step) => {
    const current = statusByName.get(step.service_name) || "Missing";
    return {
      ...step,
      status: "DRY_RUN",
      before_status: current,
      after_status: predictedStatus(step.operation, current),
      mutated: false,
    };
  });
}

function actuatorResult({ plan, before, after = before, validation, operations }) {
  const failures = [
    ...validation.missing_services.map((name) => ({ type: "missing_service", service_name: name })),
    ...operations.filter((item) => item.status === "FAILED").map((item) => ({ type: "operation_failed", service_name: item.service_name, operation: item.operation, error_code: item.error_code || "FAILED" })),
  ];
  const ok = validation.ok && failures.length === 0;
  return {
    schema_version: "desk_windows_service_actuator_result_v1",
    status: ok ? (plan.dry_run ? "DRY_RUN_PASSED" : "PASSED") : "FAILED",
    ok,
    dry_run: plan.dry_run,
    broker_execution: false,
    live_execution: false,
    auto_execution: false,
    provider_command_allowed: false,
    plan,
    validation,
    before,
    after,
    operations,
    rollback: {
      available: true,
      order: plan.rollback_order,
      dry_run_only: plan.dry_run,
    },
    failures,
  };
}

function operation(name, item) {
  return { operation: name, service_name: item.name, service_kind: item.kind };
}

function service(name, kind, options = {}) {
  return Object.freeze({ name, kind, order: Number(options.order || 0), role: options.role || kind, mutable: options.mutable !== false });
}

function normalizeAction(value) {
  const action = String(value || "").replace(/^desk\./, "").trim().toLowerCase();
  if (!["start", "stop", "restart"].includes(action)) throw new Error(`Unsupported Windows service actuator action: ${value}`);
  return action;
}

function normalizeServiceOperation(value) {
  const operationName = String(value || "").trim().toLowerCase();
  if (!["start", "stop"].includes(operationName)) throw new Error(`Unsupported Windows service operation: ${value}`);
  return operationName;
}

function isNoop(operationName, status) {
  return (operationName === "start" && status === "Running") || (operationName === "stop" && status === "Stopped");
}

function predictedStatus(operationName, status) {
  if (status === "Missing") return "Missing";
  return operationName === "start" ? "Running" : "Stopped";
}

function rows(value) {
  return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
}

function safeServiceNames(names) {
  return rows(names).map((name) => String(name || "").trim()).filter((name) => /^[A-Za-z0-9_.-]+$/.test(name));
}

function boundedTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(parsed, 120_000)) : DEFAULT_TIMEOUT_MS;
}

function encodedPowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function inspectScript(names) {
  return `
$ErrorActionPreference = "Stop"
$names = @(${names.map(powerShellString).join(",")})
$rows = @()
foreach ($name in $names) {
  $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($null -eq $svc) {
    $rows += [ordered]@{ name=$name; status="Missing"; start_type="Missing"; display_name=$null }
  } else {
    $rows += [ordered]@{ name=$name; status=[string]$svc.Status; start_type=[string]$svc.StartType; display_name=[string]$svc.DisplayName }
  }
}
$rows | ConvertTo-Json -Depth 6 -Compress
`;
}

function mutateScript(operationName, serviceName, timeoutMs) {
  return `
$ErrorActionPreference = "Stop"
$name = ${powerShellString(serviceName)}
$operation = ${powerShellString(operationName)}
$timeout = [TimeSpan]::FromMilliseconds(${boundedTimeout(timeoutMs)})
$svc = Get-Service -Name $name -ErrorAction SilentlyContinue
if ($null -eq $svc) {
  [ordered]@{ name=$name; operation=$operation; ok=$false; before_status="Missing"; after_status="Missing"; mutated=$false; error_code="WINDOWS_SERVICE_MISSING" } | ConvertTo-Json -Depth 6 -Compress
  exit 0
}
$before = [string]$svc.Status
$mutated = $false
if ($operation -eq "start" -and $svc.Status -ne "Running") {
  Start-Service -Name $name
  (Get-Service -Name $name).WaitForStatus("Running", $timeout)
  $mutated = $true
}
if ($operation -eq "stop" -and $svc.Status -ne "Stopped") {
  Stop-Service -Name $name -Force
  (Get-Service -Name $name).WaitForStatus("Stopped", $timeout)
  $mutated = $true
}
$afterService = Get-Service -Name $name
$after = [string]$afterService.Status
$expected = if ($operation -eq "start") { "Running" } else { "Stopped" }
[ordered]@{ name=$name; operation=$operation; ok=($after -eq $expected); before_status=$before; after_status=$after; mutated=$mutated } | ConvertTo-Json -Depth 6 -Compress
`;
}

function powerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
