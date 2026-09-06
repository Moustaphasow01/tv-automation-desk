import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { candlesToRowsBySymbol } from "../src/grains-causal-detection-audit.js";
import { detectUsGrainsStrategySignals } from "../src/us-grains-strategy-suite.js";

// Evidence-only comparison. It never changes sizing or creates a trading result.
const [baselinePath, qualifiedPath, output] = process.argv.slice(2);
if (!baselinePath || !qualifiedPath || !output) throw new Error("EXPECTED_BASELINE_QUALIFIED_NEW_OUTPUT");
const baseline = await json(baselinePath);
const qualified = await json(qualifiedPath);
const before = unwrap(await json(baseline.input.path));
const after = unwrap(await json(qualified.input.path));
assert.deepEqual(before.candles, after.candles, "The only permitted input change is calendar evidence");
assert.deepEqual(baseline.code_hashes, qualified.code_hashes, "Same executable code required");
const sourceIds = (artifact) => artifact.replay_bootstrap.identities.map((row) => row.source_signal_id).sort();
assert.deepEqual(sourceIds(baseline), sourceIds(qualified), "Raw signal identities changed");
const proposalsBefore = proposals(before.candles, baseline);
const proposalsAfter = proposals(after.candles, qualified);
assert.deepEqual(proposalsBefore, proposalsAfter, "Prices, sizes, timing or identities changed");
assert.equal(proposalsBefore.length, baseline.report.signal_count);
assert.equal(baseline.report.provider_commands + qualified.report.provider_commands, 0);
const result = {
  schema_version: "grains_calendar_replay_comparison_v1", generated_at_utc: new Date().toISOString(),
  baseline: { path: baselinePath, ...summary(baseline) }, qualified: { path: qualifiedPath, ...summary(qualified) },
  invariants: { candles_identical: true, candle_count: before.candles.length,
    candles_sha256: hash(before.candles), raw_signal_ids_identical: true,
    proposed_trade_plans_identical: true, proposed_trade_plans_sha256: hash(proposalsBefore),
    executable_code_identical: true, code_files: Object.keys(baseline.code_hashes).length,
    execution_policy: qualified.source_provenance.runtime_policy,
    physical_execution: false, telegram: false },
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(result, null, 2));

function summary(artifact) {
  const ledger = artifact.report.ledger;
  const signals = new Map(ledger.signals.map((row) => [row.signal_id, row]));
  const days = {};
  for (const signal of signals.values()) {
    const day = signal.generated_at_utc.slice(0, 10);
    (days[day] ||= { raw: 0, context: {}, portfolio_rejected: 0 }).raw++;
  }
  for (const decision of ledger.context) {
    const day = signals.get(decision.signal_id).generated_at_utc.slice(0, 10);
    increment(days[day].context, decision.decision);
  }
  const rejected = new Set();
  const reasons = {};
  for (const run of ledger.portfolio) for (const signal of run.payload.allocation_plan.rejected_signals) {
    if (rejected.has(signal.signal_id)) continue;
    rejected.add(signal.signal_id);
    days[signals.get(signal.signal_id).generated_at_utc.slice(0, 10)].portfolio_rejected++;
    for (const issue of signal.issues) increment(reasons, issue.code);
  }
  return { days, portfolio_rejection_reasons_unique_signals: reasons,
    counts: Object.fromEntries(Object.entries(ledger).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])),
    calendar: artifact.report.calendar, canonical_outcomes: ledger.outcomes };
}

function proposals(candles, artifact) {
  assert.equal(artifact.replay_bootstrap.calendar.knowledge_intervals.length, 1,
    "This price-plan comparison requires one calendar knowledge interval per run");
  const signals = artifact.report.ledger.signals;
  const days = signals.map((signal) => signal.generated_at_utc.slice(0, 10)).sort();
  if (!days.length) throw new Error("NONEMPTY_RAW_SIGNAL_COMPARISON_REQUIRED");
  const calendar = artifact.replay_bootstrap.calendar.runtime;
  const found = detectUsGrainsStrategySignals({ rowsBySymbol: candlesToRowsBySymbol(candles),
    instruments: ["ZC", "ZW"], startDate: days[0], endDate: days.at(-1),
    asOfUtc: artifact.report.as_of_utc, ...calendar });
  return found.raw_signals.map((row) => ({ signal_id: row.signal_id, instrument: row.instrument,
    direction: row.direction, proposed_size: row.proposed_size, generated_at_utc: row.generated_at_utc,
    expires_at_utc: row.expires_at_utc, proposed_trade_plan: row.proposed_trade_plan }))
    .sort((a, b) => a.signal_id.localeCompare(b.signal_id));
}
function increment(object, key) { object[key] = (object[key] || 0) + 1; }
function hash(value) { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function unwrap(value) { return value.ledgerFrozen || value.ledger_frozen || value; }
async function json(path) { return JSON.parse(await readFile(path, "utf8")); }
