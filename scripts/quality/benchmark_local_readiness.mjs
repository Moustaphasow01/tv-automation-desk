#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const baseUrl = String(process.env.DESK_BENCHMARK_BASE_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const concurrency = bounded(process.env.DESK_BENCHMARK_CONCURRENCY, 6, 1, 32);
const iterations = bounded(process.env.DESK_BENCHMARK_ITERATIONS, 8, 1, 100);
const p95LimitMs = bounded(process.env.DESK_BENCHMARK_P95_LIMIT_MS, 3_000, 100, 30_000);
const endpoints = [
  "/status",
  "/api/v1/live-desk/current?session=asia_open",
  "/api/v1/operations/summary",
  "/api/v1/replays?limit=10",
  "/api/v1/execution/overview",
];

const results = [];
for (const endpoint of endpoints) {
  await request(endpoint);
  const timings = [];
  const statuses = [];
  const tasks = Array.from({ length: concurrency }, async (_, worker) => {
    for (let index = worker; index < iterations * concurrency; index += concurrency) {
      const result = await request(endpoint);
      timings.push(result.elapsedMs);
      statuses.push(result.status);
    }
  });
  await Promise.all(tasks);
  timings.sort((left, right) => left - right);
  const item = {
    endpoint,
    requests: timings.length,
    p50_ms: percentile(timings, 0.5),
    p95_ms: percentile(timings, 0.95),
    p99_ms: percentile(timings, 0.99),
    max_ms: Math.round(timings.at(-1) || 0),
    statuses: Object.fromEntries([...new Set(statuses)].map((status) => [status, statuses.filter((item) => item === status).length])),
  };
  results.push(item);
  console.log(JSON.stringify(item));
}

const failures = results.filter((item) =>
  item.p95_ms > p95LimitMs ||
  Object.keys(item.statuses).some((status) => Number(status) < 200 || Number(status) >= 400)
);
console.log(JSON.stringify({
  ok: failures.length === 0,
  base_url: baseUrl,
  concurrency,
  requests_per_endpoint: concurrency * iterations,
  p95_limit_ms: p95LimitMs,
  failures: failures.map((item) => item.endpoint),
}));
if (failures.length) process.exitCode = 1;

async function request(endpoint) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  await response.arrayBuffer();
  return { status: response.status, elapsedMs: performance.now() - started };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  return Math.round(values[Math.max(0, Math.ceil(values.length * ratio) - 1)]);
}

function bounded(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}
