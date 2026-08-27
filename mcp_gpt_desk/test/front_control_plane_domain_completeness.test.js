import assert from "node:assert/strict";
import test from "node:test";
import { liveCanonicalRuntime } from "../src/front-control-plane-domain-completeness.js";

test("live canonical context decisions preserve their StrategySignal lineage", () => {
  const runtime = liveCanonicalRuntime({
    strategy: {
      signals: [{
        signal_id: "sig_lineage_1",
        instrument_code: "MNQ",
        created_at_utc: "2026-08-27T10:00:00.000Z",
      }],
    },
    ai: {
      decisions: [{
        decision_id: "ctx_lineage_1",
        signal_id: "sig_lineage_1",
        status: "RECORDED",
        recommendation: "TAKE",
        decided_at_utc: "2026-08-27T10:01:00.000Z",
      }],
    },
    launchGate: { marketClosed: false, checksById: {}, hasLastKnownMarketData: true },
  });

  assert.equal(runtime.aiContextGate.length, 1);
  assert.equal(runtime.aiContextGate[0].signalId, "sig_lineage_1");
});
