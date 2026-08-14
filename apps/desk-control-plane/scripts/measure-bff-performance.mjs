import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.DESK_FRONT_API_URL || "http://127.0.0.1:8787/front-api/v1";
const sampleCount = Math.max(5, Number(process.env.DESK_BFF_PERF_SAMPLES || 5));
const viewBudgetMs = 1_000;
const views = [
  "auth-session", "operator-settings", "admin-access", "command-center", "demo-paper-readiness", "events-audit",
  "operations-queue", "research-agent-fleet", "research-compute-scheduler", "research-data-catalog",
  "research-lab", "strategy-center", "live-trading", "orders", "portfolio", "risk",
  "execution-providers", "execution-incidents", "jarvis-workspace", "sessions", "live-plan", "live-news",
  "live-timeline", "execution-reconciliation", "operations-observability", "research-experiments",
  "research-candidates", "strategy-deployments", "replay-overview", "replay-runs", "performance-overview",
  "performance-calendar", "performance-strategies", "performance-trades", "operations-runbooks",
  "governance-prompts", "governance-policies"
];

const measurements = {};
for (const view of views) {
  const timesMs = [];
  let status = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    const response = await fetch(`${baseUrl}/views/${view}`, { headers: { Accept: "application/json" } });
    await response.arrayBuffer();
    status = response.status;
    timesMs.push(Math.round(performance.now() - started));
  }
  timesMs.sort((left, right) => left - right);
  const p75Ms = timesMs[Math.ceil(timesMs.length * 0.75) - 1];
  measurements[view] = { status, timesMs, p75Ms, budgetMs: viewBudgetMs, passed: status === 200 && p75Ms < viewBudgetMs };
}

const reportPath = resolve(process.cwd(), "../../reports/ui-ux/front-v2-bff-performance.json");
await mkdir(resolve(reportPath, ".."), { recursive: true });
const failed = Object.entries(measurements).filter(([, value]) => !value.passed);
await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, sampleCount, measurements, failed: failed.map(([view]) => view) }, null, 2)}\n`);
console.log(`BFF performance: ${views.length - failed.length}/${views.length} views within P75 < ${viewBudgetMs} ms · ${reportPath}`);
if (failed.length) {
  for (const [view, value] of failed) console.error(`${view}: HTTP ${value.status}, P75 ${value.p75Ms} ms`);
  process.exitCode = 1;
}
