#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const capturedAtUtc = new Date().toISOString();
const outputPath = path.resolve(
  repoRoot,
  args.output || path.join(".local", "baseline", `environment-baseline-${capturedAtUtc.replaceAll(/[-:.]/g, "")}.json`),
);

const report = {
  schema: "desk_environment_baseline_v1",
  captured_at_utc: capturedAtUtc,
  repo_root: repoRoot,
  local: await captureLocalBaseline(),
  vps: await captureVpsBaseline(),
  safety: {
    read_only: true,
    secrets_policy: "no_environment_dump_no_credentials_no_tokens",
    generated_by: "scripts/quality/capture_environment_baseline.mjs",
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath, vps_status: report.vps.status }, null, 2)}\n`);

async function captureLocalBaseline() {
  const [node, npm, gitVersion, branch, revision, status, docker, compose, staticSchema, runtimePostgres] = await Promise.all([
    run("node", ["--version"]),
    run("npm", ["--version"]),
    run("git", ["--version"]),
    run("git", ["branch", "--show-current"]),
    run("git", ["rev-parse", "HEAD"]),
    run("git", ["status", "--short"]),
    run(resolveDockerCommand(), ["--version"]),
    run(resolveDockerCommand(), ["compose", "version"]),
    captureStaticPostgresSchema(),
    captureLocalPostgresRuntime(),
  ]);

  return {
    host: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    memory_total_mb: Math.round(os.totalmem() / 1024 / 1024),
    node: firstLine(node.stdout),
    npm: firstLine(npm.stdout),
    git: {
      version: firstLine(gitVersion.stdout),
      branch: firstLine(branch.stdout),
      revision: firstLine(revision.stdout),
      dirty_entries: status.ok ? status.stdout.split("\n").filter(Boolean).length : null,
    },
    docker: {
      command: resolveDockerCommand(),
      available: docker.ok,
      version: firstLine(docker.stdout || docker.stderr),
      compose_available: compose.ok,
      compose_version: firstLine(compose.stdout || compose.stderr),
      note: docker.ok ? "docker_available" : "docker_unavailable_in_current_shell",
    },
    postgres: {
      static_schema: staticSchema,
      runtime: runtimePostgres,
    },
    package_scripts: await readPackageScripts(),
  };
}

async function captureStaticPostgresSchema() {
  const migrationRoot = path.join(repoRoot, "infra/postgres/init");
  const files = (await readdir(migrationRoot)).filter((name) => name.endsWith(".sql")).sort();
  const tables = new Set();
  const indexes = new Set();
  const enums = new Set();
  for (const file of files) {
    const content = await readFile(path.join(migrationRoot, file), "utf8");
    for (const match of content.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/gi)) tables.add(match[1]);
    for (const match of content.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/gi)) indexes.add(match[1]);
    for (const match of content.matchAll(/CREATE\s+TYPE\s+([a-zA-Z0-9_]+)\s+AS\s+ENUM/gi)) enums.add(match[1]);
  }
  return {
    migration_files: files,
    table_count: tables.size,
    index_count: indexes.size,
    enum_count: enums.size,
    tables: [...tables].sort(),
  };
}

async function captureLocalPostgresRuntime() {
  const databaseUrl = process.env.DESK_BASELINE_DATABASE_URL || process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    return { status: "not_configured", note: "set DESK_BASELINE_DATABASE_URL or DATABASE_URL for read-only runtime counts" };
  }
  const psql = await run("psql", ["--version"]);
  if (!psql.ok) {
    return { status: "psql_unavailable", note: "psql binary is not available in the current shell" };
  }
  return capturePostgresRuntimeWithPsql(databaseUrl);
}

async function capturePostgresRuntimeWithPsql(databaseUrl) {
  const output = {};
  for (const [name, sql] of Object.entries(postgresRuntimeQueries())) {
    const result = await run("psql", [databaseUrl, "-At", "-c", sql], { timeoutMs: 8_000 });
    output[name] = result.ok ? parseMaybeJson(firstLine(result.stdout)) : {
      status: "query_failed",
      stderr_tail: result.stderr.slice(-1_000),
    };
  }
  return { status: "captured", ...output };
}

async function captureVpsBaseline() {
  const target = process.env.DESK_BASELINE_VPS_TARGET || "";
  const key = process.env.DESK_BASELINE_VPS_KEY || "";
  const include = Boolean(args.includeVps || target || key);
  if (!include) {
    return {
      status: "not_requested",
      note: "set DESK_BASELINE_VPS_TARGET and DESK_BASELINE_VPS_KEY, or pass --include-vps, to collect read-only VPS facts",
    };
  }
  if (!target || !key) {
    const missing = [!target && "DESK_BASELINE_VPS_TARGET", !key && "DESK_BASELINE_VPS_KEY"].filter(Boolean);
    if (args.failOnVpsUnreachable) {
      throw new Error(`vps_baseline_missing_configuration:${missing.join(",")}`);
    }
    return { status: "not_configured", missing };
  }

  const encodedCommand = Buffer.from(vpsPowerShell(), "utf16le").toString("base64");
  const sshArgs = [
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${args.vpsConnectTimeoutSeconds}`,
    "-i", key,
    target,
    "powershell", "-NoProfile", "-EncodedCommand", encodedCommand,
  ];
  const result = await run("ssh", sshArgs, { timeoutMs: args.vpsConnectTimeoutSeconds * 1_000 + 20_000 });
  if (!result.ok) {
    if (args.failOnVpsUnreachable) {
      throw new Error(`vps_baseline_unreachable:${result.exitCode}:${result.stderr || result.stdout}`);
    }
    return {
      status: "unreachable",
      exit_code: result.exitCode,
      stderr_tail: redact(result.stderr).slice(-2_000),
    };
  }
  try {
    return {
      status: "captured",
      target_host: target.replace(/^.*@/, ""),
      facts: JSON.parse(result.stdout),
    };
  } catch (error) {
    if (args.failOnVpsUnreachable) throw error;
    return {
      status: "parse_failed",
      stdout_tail: redact(result.stdout).slice(-2_000),
      stderr_tail: redact(result.stderr).slice(-2_000),
    };
  }
}

async function readPackageScripts() {
  const packagePath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const required = [
    "build",
    "typecheck",
    "test:react",
    "test:e2e",
    "test:stack",
    "guard:architecture",
    "guard:static-quality",
    "guard:pr-governance",
    "guard:front-architecture",
    "benchmark:local",
    "baseline:environment",
    "certify:resilience",
  ];
  return Object.fromEntries(required.map((name) => [name, Boolean(packageJson.scripts?.[name])]));
}

function resolveDockerCommand() {
  if (process.env.DESK_BASELINE_DOCKER_BIN) return process.env.DESK_BASELINE_DOCKER_BIN;
  const windowsDocker = "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe";
  if (existsSync(windowsDocker)) return windowsDocker;
  return "docker";
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    execFile(command, commandArgs, {
      cwd: repoRoot,
      timeout: options.timeoutMs || 15_000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        exitCode: error?.code ?? 0,
        stdout: redact(String(stdout || "")),
        stderr: redact(String(stderr || "")),
      });
    });
  });
}

function vpsPowerShell() {
  return String.raw`
$ErrorActionPreference = "Stop"
function Try-CommandValue($Command, $Arguments = @()) {
  try { (& $Command @Arguments 2>$null | Select-Object -First 1) -join "" } catch { $null }
}
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  [ordered]@{
    device = $_.DeviceID
    size_gb = [math]::Round($_.Size / 1GB, 2)
    free_gb = [math]::Round($_.FreeSpace / 1GB, 2)
  }
}
$services = Get-Service | Where-Object {
  $_.Name -match "postgres|nginx|ssh|desk|winsw|ninja" -or
  $_.DisplayName -match "PostgreSQL|Nginx|OpenSSH|Desk|WinSW|Ninja"
} | Sort-Object Name | ForEach-Object {
  [ordered]@{
    name = $_.Name
    display_name = $_.DisplayName
    status = "$($_.Status)"
    start_type = "$($_.StartType)"
  }
}
$listenPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { @(22, 80, 443, 5432, 8080, 8787).Contains([int]$_.LocalPort) } |
  Sort-Object LocalPort |
  ForEach-Object {
    [ordered]@{
      local_address = $_.LocalAddress
      local_port = $_.LocalPort
      owning_process = $_.OwningProcess
    }
  }
$postgresRuntime = [ordered]@{
  status = "not_configured"
  note = "runtime_database_url_not_exposed_to_read_only_vps_baseline"
}
[ordered]@{
  hostname = $env:COMPUTERNAME
  captured_at = (Get-Date -Format o)
  os_caption = $os.Caption
  os_version = $os.Version
  os_build = $os.BuildNumber
  powershell = $PSVersionTable.PSVersion.ToString()
  manufacturer = $computer.Manufacturer
  model = $computer.Model
  logical_processors = $computer.NumberOfLogicalProcessors
  memory_total_gb = [math]::Round($computer.TotalPhysicalMemory / 1GB, 2)
  cpu = $cpu.Name
  disks = @($disks)
  node = Try-CommandValue "node" @("-v")
  npm = Try-CommandValue "npm" @("-v")
  git = Try-CommandValue "git" @("--version")
  psql = Try-CommandValue "psql" @("--version")
  docker = Try-CommandValue "docker" @("--version")
  services = @($services)
  listening_ports = @($listenPorts)
  postgres_runtime = $postgresRuntime
} | ConvertTo-Json -Depth 8
`;
}

function postgresRuntimeQueries() {
  return {
    table_count: "select count(*)::int from information_schema.tables where table_schema = 'public';",
    desk_documents_count: "select count(*)::int from desk_documents;",
    collections: "select coalesce(json_agg(t order by collection), '[]'::json) from (select collection, count(*)::int as documents from desk_documents group by collection order by collection limit 120) t;",
    live_cursor_status: "select coalesce(json_agg(t order by status), '[]'::json) from (select coalesce(data->>'cursor_status', data->>'status', 'UNKNOWN') as status, count(*)::int as documents from desk_documents where collection = 'desk_live_run_cursor' group by 1) t;",
    agent_work_status: "select coalesce(json_agg(t order by status), '[]'::json) from (select coalesce(data->>'status', 'UNKNOWN') as status, count(*)::int as documents from desk_documents where collection = 'desk_agent_work_items' group by 1) t;",
    replay_config_status: "select coalesce(json_agg(t order by status), '[]'::json) from (select coalesce(data->>'status', data->>'enabled', 'UNKNOWN') as status, count(*)::int as documents from desk_documents where collection = 'desk_replay_autopilot_configs' group by 1) t;",
    broker_locks: "select coalesce(json_agg(t order by execution_lock_id), '[]'::json) from (select execution_lock_id, locked, scope_type, scope_value from broker_execution_locks order by execution_lock_id limit 20) t;",
    broker_outbox_status: "select coalesce(json_agg(t order by status), '[]'::json) from (select status, count(*)::int as items from broker_execution_outbox group by status) t;",
  };
}

function parseMaybeJson(value) {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function parseArgs(argv) {
  const parsed = {
    includeVps: false,
    failOnVpsUnreachable: false,
    vpsConnectTimeoutSeconds: 10,
    output: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--include-vps") parsed.includeVps = true;
    else if (item === "--fail-on-vps-unreachable") parsed.failOnVpsUnreachable = true;
    else if (item === "--output") parsed.output = argv[++index] || "";
    else if (item === "--vps-connect-timeout-seconds") parsed.vpsConnectTimeoutSeconds = Number(argv[++index] || 10);
    else throw new Error(`unknown_argument:${item}`);
  }
  parsed.vpsConnectTimeoutSeconds = Math.max(1, Math.min(60, Math.floor(parsed.vpsConnectTimeoutSeconds || 10)));
  return parsed;
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean) || null;
}

function redact(value) {
  return String(value || "")
    .replace(/(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*[^ \r\n]+/gi, "$1=<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>");
}
