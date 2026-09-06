import test from "node:test";
import assert from "node:assert/strict";
import { compareGrainsRiskReplays } from "../scripts/compare_grains_risk_replays.mjs";

function artifact(outcomes = []) {
  return { input: { sha256: "data" }, code_hashes: { engine: "code" },
    replay_bootstrap: { detected_signals_sha256: "signals" }, source_provenance: { runtime_policy: "fixture" },
    report: { provider_commands: 0, ledger: { signals: [], context: [], portfolio: [], risk: [], targets: [],
      intents: [], human_gates: [], theoretical_events: [], trades: [], outcomes } } };
}
test("comparison aggregates canonical R separately from dollar PnL, without nominal-risk conversion", () => {
  const source = artifact([
    { trade_id: "a", status: "final", finalized_at_utc: "2026-09-01T12:00Z", result_r: 0.5, net_realized_pnl: 100, total_fees: 2 },
    { trade_id: "b", status: "final", finalized_at_utc: "2026-09-01T13:00Z", result_r: -1, net_realized_pnl: -150, total_fees: 2 },
  ]);
  const result = compareGrainsRiskReplays(source, source);
  assert.equal(result.raw_signal_payloads_identical, true);
  assert.equal(result.candidate.closed_r, -0.5);
  assert.equal(result.candidate.closed_net_pnl, -50);
  assert.equal(result.candidate.max_closed_drawdown_r, 1);
  assert.equal(result.candidate.max_closed_drawdown_monetary, 150);
});
test("comparison flags changed raw inputs and never reports an unknown PnL as zero", () => {
  const source = artifact();
  const candidate = artifact();
  candidate.input.sha256 = "different";
  candidate.replay_bootstrap.detected_signals_sha256 = null;
  assert.equal(compareGrainsRiskReplays(source, candidate).input_identical, false);
  assert.equal(compareGrainsRiskReplays(source, candidate).raw_signal_payloads_identical, false);
  candidate.report.ledger.outcomes = [{ trade_id: "a", status: "final", finalized_at_utc: "2026-09-01T12:00Z", result_r: 1, net_realized_pnl: null }];
  assert.throws(() => compareGrainsRiskReplays(source, candidate), /CANONICAL_OUTCOME_NUMBER_UNAVAILABLE/);
});
