import assert from "node:assert/strict";
import test from "node:test";
import {
  DESK_DATA_AVAILABILITY_POLICY_VERSION,
  finalizeDeskDataQuality,
  isContextOnlyWorkerFailure,
  normalizeDeskInstrumentScopes,
} from "../src/data-availability-policy.js";
import {
  masterCutoffDataQuality,
  manualBundleDataQuality,
} from "../src/desk-live-bundle-algorithms.js";
import { replayBundleQuality } from "../src/desk-replay-orchestration-algorithms.js";

test("context gaps remain executable and canonical gaps block", () => {
  const degraded = finalizeDeskDataQuality({
    warnings: ["cross_asset_context_missing_open_sources:GC,DXY"],
    stale: ["cross_asset_delta"],
  });
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.execution_allowed, true);
  assert.equal(degraded.analysis_mode, "degraded");
  assert.equal(degraded.new_entries_allowed, true);
  assert.equal(degraded.position_management_allowed, true);
  assert.equal(degraded.severity_policy_version, DESK_DATA_AVAILABILITY_POLICY_VERSION);

  const blocked = finalizeDeskDataQuality({
    blockers: ["MNQ_M5:source_missing"],
    missing: ["MNQ_M5"],
  });
  assert.equal(blocked.status, "missing");
  assert.equal(blocked.execution_allowed, false);
  assert.equal(blocked.analysis_mode, "blocked");
  assert.equal(blocked.position_management_allowed, true);
});

test("LIVE Master and Monitor do not block on missing cross-asset context", () => {
  const rolling = rollingFixture({ GC: "missing_unexpected", DXY: "missing_unexpected" });
  const master = masterCutoffDataQuality({
    pack: { pack_id: "pack-live" },
    futures_core: {
      MNQ_M5: { status: "ready", raw_refs: [{ id: "mnq" }] },
      MES_M5: { status: "ready", raw_refs: [{ id: "mes" }] },
    },
    cross_asset: {},
    rolling,
    cross_delta: { stale_check: { is_stale: true }, delta: null },
    macro_calendar: { events: [] },
    news_digest: { items: [], status: "missing", reason: "source_not_configured" },
  });
  assert.equal(master.status, "degraded");
  assert.equal(master.execution_allowed, true);
  assert.equal(master.blockers.length, 0);
  assert.ok(master.warnings.some((item) => item.includes("DXY") && item.includes("GC")));

  const monitor = manualBundleDataQuality({
    pack: { pack_id: "pack-live" },
    activeThesis: { thesis_id: "thesis-1" },
    latestMaster: { analysis_id: "master-1" },
    macro_calendar: { events: [] },
    news_digest: { items: [], status: "missing", reason: "source_not_configured" },
    features: {
      level: { level_map: { levels: [] } },
      technical: { events: [] },
      cross: { delta: null, stale_check: { is_stale: true } },
    },
    rolling,
  });
  assert.equal(monitor.status, "degraded");
  assert.equal(monitor.execution_allowed, true);
  assert.equal(monitor.blockers.length, 0);
});

test("Replay context gaps are warnings while MNQ/MES gaps remain blocking", () => {
  const contextOnly = replayBundleQuality({
    pack: { pack_id: "pack-replay" },
    rolling: {
      integrity: { MNQ_M5: { valid: true }, MES_M5: { valid: true } },
      snapshots: {
        "15m": { data_quality: { missing_instruments: ["GC", "DXY"] } },
      },
    },
    sourceCoverage: { mode: "full_replay_range" },
  });
  assert.equal(contextOnly.status, "degraded");
  assert.equal(contextOnly.execution_allowed, true);
  assert.equal(contextOnly.analysis_mode, "degraded");

  const canonicalMissing = replayBundleQuality({
    pack: { pack_id: "pack-replay" },
    rolling: {
      integrity: { MNQ_M5: { valid: true }, MES_M5: { valid: true } },
      snapshots: {
        "15m": { data_quality: { missing_instruments: ["MNQ", "GC"] } },
      },
    },
    sourceCoverage: { mode: "full_replay_range" },
  });
  assert.equal(canonicalMissing.execution_allowed, false);
  assert.equal(canonicalMissing.analysis_mode, "blocked");
});

test("bounded recovery recognizes context-only failures but not a missing canonical feed", () => {
  assert.equal(isContextOnlyWorkerFailure({
    code: "REPLAY_STORAGE_TEMPORARILY_UNAVAILABLE",
    message: "GC is availability=missing_unexpected and row_count=0 at the replay cutoff.",
  }), true);
  assert.equal(isContextOnlyWorkerFailure({
    code: "REPLAY_STORAGE_TEMPORARILY_UNAVAILABLE",
    message: "MNQ is availability=missing_unexpected and row_count=0 at the replay cutoff.",
  }), false);
  assert.equal(isContextOnlyWorkerFailure({
    code: "STRUCTURAL_DATA_INCONSISTENCY",
    message: "Equivalent-contract mismatch: NQ versus MNQ and ES versus MES.",
  }), true);
});


test("V5 instrument scopes separate canonical trading feeds from market context", () => {
  assert.deepEqual(normalizeDeskInstrumentScopes(), {
    trading_instruments: ["MNQ", "MES"],
    context_instruments: ["NQ", "ES"],
    instruments: ["MNQ", "MES", "NQ", "ES"],
  });
  assert.deepEqual(normalizeDeskInstrumentScopes({
    instruments: ["mnq", "MES", "NQ", "ES", "NQ"],
  }), {
    trading_instruments: ["MNQ", "MES"],
    context_instruments: ["NQ", "ES"],
    instruments: ["MNQ", "MES", "NQ", "ES"],
  });
  assert.deepEqual(normalizeDeskInstrumentScopes({
    trading_instruments: ["MES", "NQ", "MES"],
    context_instruments: ["ES", "MNQ", "ES"],
  }), {
    trading_instruments: ["MES"],
    context_instruments: ["ES"],
    instruments: ["MES", "ES"],
  });
});

function rollingFixture(availability = {}) {
  const instruments = Object.fromEntries([
    ["MNQ", "fresh"],
    ["MES", "fresh"],
    ["GC", availability.GC || "fresh"],
    ["DXY", availability.DXY || "fresh"],
    ["CL", "fresh"],
    ["VIX", "fresh"],
    ["US10Y", "fresh"],
    ["US02Y", "fresh"],
  ].map(([instrument, state]) => [instrument, {
    availability: state,
    raw_refs: state === "fresh" ? [{ instrument }] : [],
  }]));
  return {
    snapshots: {
      "15m": {
        instruments,
        data_quality: {
          missing_instruments: Object.entries(instruments)
            .filter(([, item]) => item.availability === "missing_unexpected")
            .map(([instrument]) => instrument),
        },
      },
    },
  };
}
