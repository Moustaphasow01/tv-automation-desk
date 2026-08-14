#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(new URL("../..", import.meta.url).pathname);
const startedAt = new Date().toISOString();
const commands = [
  ["node", ["--test",
    "mcp_gpt_desk/test/resilience_stress.test.js",
    "mcp_gpt_desk/test/replay_agent_work.test.js",
    "mcp_gpt_desk/test/replay_preparation.test.js",
    "mcp_gpt_desk/test/tradingview_webhook.test.js",
    "mcp_gpt_desk/test/news_ingestion_service.test.js",
    "mcp_gpt_desk/test/position_continuity_engine.test.js",
    "mcp_gpt_desk/test/broker_execution_service.test.js",
    "mcp_gpt_desk/test/ninjatrader_addon_installation.test.js",
  ]],
  ["npm", ["run", "guard:strategy-contracts"]],
  ["npm", ["run", "guard:architecture:test"]],
  ["npm", ["run", "guard:architecture"]],
  ["npm", ["run", "guard:static-quality:test"]],
  ["npm", ["run", "guard:static-quality"]],
  ["npm", ["run", "guard:exceptions:test"]],
  ["npm", ["run", "guard:exceptions"]],
  ["npm", ["run", "guard:architecture-scorecard:test"]],
  ["npm", ["run", "guard:architecture-scorecard"]],
  ["npm", ["run", "guard:pr-governance:test"]],
  ["npm", ["run", "guard:pr-governance"]],
  ["npm", ["run", "guard:security-supply-chain:test"]],
  ["npm", ["run", "guard:security-supply-chain"]],
  ["npm", ["run", "guard:jira-backlog-sync"]],
  ["npm", ["run", "guard:sql-migrations:test"]],
  ["npm", ["run", "guard:sql-migrations"]],
  ["npm", ["run", "guard:problem-details:test"]],
  ["npm", ["run", "guard:problem-details"]],
  ["npm", ["run", "guard:runtime-safety:test"]],
  ["npm", ["run", "guard:runtime-safety"]],
  ["npm", ["run", "guard:mcp-slices:test"]],
  ["npm", ["run", "guard:mcp-slices"]],
  ["npm", ["run", "guard:front-architecture:test"]],
  ["npm", ["run", "guard:front-architecture"]],
  ["npm", ["run", "guard:front-vnext-data-mode:test"]],
  ["npm", ["run", "guard:front-vnext-data-mode"]],
  ["npm", ["run", "guard:windows-deployment"]],
];

const results = [];
for (const [command, args] of commands) {
  const result = await run(command, args);
  results.push(result);
  if (!result.ok) break;
}

if (process.env.DESK_BENCHMARK_BASE_URL) {
  const result = await run("node", ["scripts/quality/benchmark_local_readiness.mjs"]);
  results.push(result);
}

const report = {
  schema: "desk_resilience_certification_v1",
  ok: results.every((result) => result.ok),
  started_at_utc: startedAt,
  completed_at_utc: new Date().toISOString(),
  environment: process.env.DESK_BENCHMARK_BASE_URL ? "running-stack" : "offline-deterministic",
  results,
};
const outputRoot = resolve(root, ".local", "certification");
await mkdir(outputRoot, { recursive: true });
const reportPath = resolve(outputRoot, `resilience-${startedAt.replaceAll(/[-:.]/g, "")}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: report.ok, report: reportPath, checks: results.length }, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

function run(command, args) {
  const started = Date.now();
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("close", (code) => resolveRun({
      command: `${command} ${args.join(" ")}`,
      ok: code === 0,
      exit_code: code,
      duration_ms: Date.now() - started,
      stdout_tail: stdout.slice(-4_000),
      stderr_tail: stderr.slice(-4_000),
    }));
  });
}
