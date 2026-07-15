import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  canonicalizeReplayBundle,
  getReplayBundleSectionView,
  getReplaySnapshotView,
  jsonBytes,
  projectReplayBundle,
  replayBundleManifest,
} from "../src/replay-bundle-view.js";
import { toolResult } from "../src/result.js";
import { createDeskToolRegistry, listDeskTools } from "../src/tools.js";

test("Replay compact view preserves decision evidence while removing duplicate snapshots", () => {
  const source = largeReplayBundle("master");
  const before = decisionEvidence(source);
  const compact = projectReplayBundle(source, { view: "compact", include_raw_refs: false });
  const after = decisionEvidence(compact);

  assert.deepEqual(after, before);
  assert.equal(compact.view, "compact");
  assert.equal(compact.complete, true);
  assert.equal(compact.transport.budget_exceeded, false);
  assert.equal(compact.transport.double_serialization, false);
  assert.ok(jsonBytes(compact) < jsonBytes(source) * 0.25, `${jsonBytes(compact)} should be less than 25% of ${jsonBytes(source)}`);
  assert.equal(compact.data.pack, undefined);
  assert.equal(compact.data.rolling_15m_snapshot, undefined);
  assert.equal(compact.raw_refs, undefined);
  assert.equal(findUndefinedPath(compact), null);
  assert.equal(compact.save_target.suggested_payload.idempotency_key, source.save_target.suggested_payload.idempotency_key);
  assert.equal(compact.section_manifest.pack.sha256.length, 64);
});

test("Replay canonical view losslessly dictionaries raw references", () => {
  const source = largeReplayBundle("master");
  const canonical = canonicalizeReplayBundle(source);
  const instrument = canonical.data.rolling_snapshots["15m"].instruments.MNQ;

  assert.equal(canonical.raw_refs.length, 18);
  assert.equal(instrument.raw_refs, undefined);
  assert.equal(instrument.raw_ref_indexes.length, 18);
  assert.deepEqual(instrument.raw_ref_indexes.map((index) => canonical.raw_refs[index]), source.data.rolling_snapshots["15m"].instruments.MNQ.raw_refs);
  assert.equal(canonical.data.pack, undefined);
  assert.equal(canonical.previous_replay_master_analysis, undefined);
  assert.equal(canonical.replan_context.previous_master_analysis.analysis_id, "master_previous");
  assert.ok(jsonBytes(canonical) < jsonBytes(source) * 0.5);
});

test("Replay include, exclude, window, instrument and raw-ref options are effective", () => {
  const source = largeReplayBundle("master");
  const selected = projectReplayBundle(source, {
    view: "compact",
    include_sections: ["rolling_snapshots", "macro_calendar"],
    exclude_sections: ["macro_calendar"],
    snapshot_windows: ["15m"],
    instruments: ["MNQ"],
    include_raw_refs: false,
  });

  assert.deepEqual(Object.keys(selected.data), ["rolling_snapshots"]);
  assert.deepEqual(Object.keys(selected.data.rolling_snapshots), ["15m"]);
  assert.deepEqual(Object.keys(selected.data.rolling_snapshots["15m"].instruments), ["MNQ"]);
  assert.equal(selected.contract_context, undefined);
  assert.equal(selected.save_target, undefined);
  assert.equal(selected.raw_refs, undefined);

  const withRefs = projectReplayBundle(source, {
    view: "compact",
    include_sections: ["rolling_snapshots"],
    snapshot_windows: ["15m"],
    instruments: ["MNQ"],
    include_raw_refs: true,
  });
  assert.equal(withRefs.raw_refs.length, 18);
  assert.equal(withRefs.data.rolling_snapshots["15m"].instruments.MNQ.raw_ref_indexes.length, 18);
});

test("Replay manifest and section reads prove full-section equality", () => {
  const source = largeReplayBundle("master");
  const canonical = canonicalizeReplayBundle(source);
  const manifest = replayBundleManifest(source);
  const pack = getReplayBundleSectionView(source, replayRef({ section: "pack" }));
  const snapshot = getReplaySnapshotView(source, replayRef({ window: "1h", instruments: ["MNQ", "NQ"] }));

  assert.equal(pack.section_sha256, manifest.sections.pack.sha256);
  assert.deepEqual(pack.data, canonical.pack);
  assert.equal(snapshot.view, "snapshot");
  assert.deepEqual(Object.keys(snapshot.data), ["1h"]);
  assert.deepEqual(Object.keys(snapshot.data["1h"].instruments), ["MNQ", "NQ"]);
  assert.ok(jsonBytes(snapshot) < 16000);
});

test("Replay response budget falls back explicitly to a lossless manifest", () => {
  const source = largeReplayBundle("master", { narrativeSize: 80000 });
  const response = projectReplayBundle(source, {
    view: "compact",
    include_sections: ["contract", "save_target", "replan_context"],
    max_response_bytes: 16000,
  });

  assert.equal(response.view, "manifest");
  assert.equal(response.requested_view, "compact");
  assert.equal(response.complete, false);
  assert.equal(response.budget_exceeded, true);
  assert.equal(response.transport.budget_exceeded, true);
  assert.equal(response.save_target.suggested_payload.expected_revision, 11);
  assert.equal(response.section_manifest.replan_context.sha256.length, 64);
});

test("Replay Monitor compact view keeps exact lineage and save contract", () => {
  const source = largeReplayBundle("monitor");
  const compact = projectReplayBundle(source, { view: "compact" });

  assert.equal(compact.bundle_type, "monitor");
  assert.equal(compact.replay_master_analysis.analysis_id, "master_current");
  assert.equal(compact.replay_active_thesis.thesis_id, "thesis_current");
  assert.equal(compact.previous_replay_monitor.monitor_id, "monitor_previous");
  assert.equal(compact.save_target.tool, "save_replay_monitor");
  assert.equal(compact.contract_context.contract_name, "DeskHourlyThesisMonitorContract");
  assert.equal(compact.transport_contract.tools.snapshot, "get_replay_snapshot");
});

test("Replay projections are deterministic, read-only and stable under repetition", () => {
  const source = largeReplayBundle("master");
  const before = JSON.stringify(source);
  const first = projectReplayBundle(source, { view: "compact" });
  const started = performance.now();
  for (let index = 0; index < 100; index += 1) {
    const next = projectReplayBundle(source, { view: "compact" });
    assert.equal(next.canonical_bundle_hash, first.canonical_bundle_hash);
    assert.equal(next.section_manifest.rolling_snapshots.sha256, first.section_manifest.rolling_snapshots.sha256);
  }
  const elapsed = performance.now() - started;

  assert.equal(JSON.stringify(source), before);
  assert.ok(elapsed < 5000, `100 projections took ${elapsed.toFixed(1)}ms`);
});

test("MCP success results use structured output without JSON text duplication", () => {
  const payload = projectReplayBundle(largeReplayBundle("master"), { view: "compact" });
  const result = toolResult(payload);
  const error = toolResult({ ok: false, error: "failure" }, true);
  const tools = listDeskTools(createDeskToolRegistry({}));

  assert.deepEqual(result.content, []);
  assert.equal(result.structuredContent, payload);
  assert.equal(result._meta["desk/transport"].content_bytes, 0);
  assert.equal(result._meta["desk/transport"].double_serialized, false);
  assert.match(error.content[0].text, /failure/);
  assert.ok(tools.every((tool) => tool.outputSchema?.type === "object"));
});

function replayRef(extra = {}) {
  return {
    backtest_id: "bt_transport",
    step_id: "bt_transport__step__0004__master",
    bundle_type: "master",
    max_response_bytes: 180000,
    ...extra,
  };
}

function decisionEvidence(bundle) {
  const snapshots = bundle.data?.rolling_snapshots || bundle.rolling_snapshots || {};
  return {
    cutoff_paris: bundle.cutoff_paris,
    contract_name: bundle.contract_context?.contract_name,
    contract_hash: bundle.contract_context?.contract_hash,
    save_target: bundle.save_target?.suggested_payload,
    anti_lookahead: bundle.anti_lookahead_policy,
    macro_events: bundle.data?.macro_calendar?.events || [],
    news_items: bundle.data?.news_digest?.items || [],
    snapshots: Object.fromEntries(Object.entries(snapshots).map(([window, snapshot]) => [window,
      Object.fromEntries(Object.entries(snapshot.instruments || {}).map(([instrument, block]) => [instrument, {
        status: block.status,
        row_count: block.row_count,
        open: block.open,
        high: block.high,
        low: block.low,
        close: block.close,
        first_timestamp_paris: block.first_timestamp_paris,
        last_timestamp_paris: block.last_timestamp_paris,
        range_points: block.range_points,
        missing_reason: block.missing_reason,
      }]))
    ])),
  };
}

function findUndefinedPath(value, path = "$") {
  if (value === undefined) return path;
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const found = findUndefinedPath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function largeReplayBundle(type, { narrativeSize = 5000 } = {}) {
  const refs = Array.from({ length: 18 }, (_, index) => ({
    dataset: `DATASET_${index}`,
    object_path: `desk-data/build/dataset_${index}.csv`,
    gcs_generation: String(1000 + index),
    sha256: String(index).padStart(64, "0"),
  }));
  const instruments = ["MNQ", "MES", "NQ", "ES", "US02Y", "US10Y", "CL", "GC", "DXY", "VIX", "NI225", "HSI", "DAX", "SX5E", "AAPL", "MSFT", "NVDA", "SMH"];
  const snapshots = Object.fromEntries(["15m", "1h", "4h"].map((window, windowIndex) => [window, {
    snapshot_id: `snapshot_${window}`,
    backtest_id: "bt_transport",
    step_id: `bt_transport__step__0004__${type}`,
    window,
    timeframe: window === "4h" ? "M15" : "M5",
    timestamp_paris: "2026-07-06T00:35:00+02:00",
    instruments: Object.fromEntries(instruments.map((instrument, index) => [instrument, {
      status: index < 4 ? "ready" : "missing",
      row_count: index < 4 ? 3 + windowIndex : 0,
      open: index < 4 ? 100 + index : null,
      high: index < 4 ? 105 + index : null,
      low: index < 4 ? 98 + index : null,
      close: index < 4 ? 103 + index : null,
      first_timestamp_paris: index < 4 ? "2026-07-06T00:20:00+02:00" : null,
      last_timestamp_paris: index < 4 ? "2026-07-06T00:35:00+02:00" : null,
      range_points: index < 4 ? 7 : null,
      missing_reason: index < 4 ? null : "dataset_missing",
      raw_refs: refs,
      attempted_raw_refs: [],
    }])),
    data_quality: { status: "degraded", missing_instruments: instruments.slice(4), execution_allowed: true },
    anti_lookahead_compliant: true,
  }]));
  const pack = {
    pack_id: "2026-07-06_asia_open",
    pack_build_id: "packbuild_transport",
    date: "2026-07-06",
    trading_date: "2026-07-06",
    session: "asia_open",
    status: "ready",
    cutoff_paris: "2026-07-06T00:35:00+02:00",
    datasets: Object.fromEntries(refs.map((ref, index) => [ref.dataset, { ...ref, row_count: 100 + index, format: "csv" }])),
  };
  const common = {
    ok: true,
    bundle_id: `bt_transport__bundle__${type}`,
    bundle_type: type,
    backtest_id: "bt_transport",
    replay_run_id: "bt_transport",
    step_id: `bt_transport__step__0004__${type}`,
    strategy_id: "asia_open",
    trading_date: "2026-07-06",
    date: "2026-07-06",
    session: "asia_open",
    mode: "replay",
    timestamp_paris: "2026-07-06T00:35:00+02:00",
    cutoff_paris: "2026-07-06T00:35:00+02:00",
    pack_id: pack.pack_id,
    pack_build_id: pack.pack_build_id,
    source_hash: "a".repeat(64),
    source_manifest_hash: "b".repeat(64),
    contract_context: {
      contract_name: type === "master" ? "DeskMasterAnalysisContract" : "DeskHourlyThesisMonitorContract",
      schema_version: type === "master" ? "4.0.0" : "1.0.0",
      contract_hash: "c".repeat(64),
      pinned_for_replay: true,
      contract_snapshot_ref: { backtest_id: "bt_transport" },
    },
    contract_handshake: { required_first_tool: "get_active_contracts", direct_mcp_save_required: true },
    contracts: {},
    pack,
    data_quality: { status: "ready", execution_allowed: true },
    anti_lookahead_policy: { compliant: true, cutoff_paris: "2026-07-06T00:35:00+02:00", future_prices_used: false },
    raw_refs: refs,
    chatgpt_replay_instructions: { save_tool: type === "master" ? "save_replay_master_analysis" : "save_replay_monitor" },
  };
  if (type === "monitor") {
    return {
      ...common,
      replay_master_analysis: { analysis_id: "master_current", summary: "m".repeat(narrativeSize) },
      replay_active_thesis: { thesis_id: "thesis_current", linked_master_analysis_id: "master_current" },
      replay_setups: [{ setup_id: "setup_current", instrument: "MNQ", direction: "long" }],
      previous_replay_monitor: { monitor_id: "monitor_previous", monitor_decision: { action: "WAIT_MORE" } },
      replay_position: null,
      rolling_snapshots: snapshots,
      rolling_15m_snapshot: snapshots["15m"],
      rolling_1h_snapshot: snapshots["1h"],
      rolling_4h_snapshot: snapshots["4h"],
      dataset_integrity: Object.fromEntries(refs.map((ref) => [ref.dataset, { valid: true, sha256: ref.sha256 }])),
      save_target: {
        tool: "save_replay_monitor",
        suggested_payload: { backtest_id: "bt_transport", step_id: common.step_id, expected_revision: 11, idempotency_key: "save-monitor-transport", pack_build_id: pack.pack_build_id },
      },
    };
  }
  const replanContext = {
    requested: true,
    reason: "REPLAN_FULL",
    previous_master_analysis: { analysis_id: "master_previous", summary: "m".repeat(narrativeSize) },
    previous_active_thesis: { thesis_id: "thesis_previous" },
    previous_setups: [{ setup_id: "setup_previous", instrument: "MNQ", direction: "short" }],
    triggering_monitor: { monitor_id: "monitor_trigger", monitor_decision: { action: "REPLAN_FULL" } },
    current_position: null,
  };
  return {
    ...common,
    is_replan: true,
    replan_context: replanContext,
    previous_replay_master_analysis: replanContext.previous_master_analysis,
    previous_replay_active_thesis: replanContext.previous_active_thesis,
    previous_replay_setups: replanContext.previous_setups,
    triggering_replay_monitor: replanContext.triggering_monitor,
    data: {
      pack,
      dataset_integrity: Object.fromEntries(refs.map((ref) => [ref.dataset, { valid: true, sha256: ref.sha256 }])),
      macro_calendar: { events: [{ event_id: "macro_1", time: "00:30", actual: 2.1 }] },
      news_digest: { items: [{ news_id: "news_1", published_at_paris: "2026-07-06T00:25:00+02:00" }] },
      rolling_snapshots: snapshots,
      rolling_15m_snapshot: snapshots["15m"],
      rolling_1h_snapshot: snapshots["1h"],
      rolling_4h_snapshot: snapshots["4h"],
    },
    save_target: {
      tool: "save_replay_master_analysis",
      suggested_payload: { backtest_id: "bt_transport", step_id: common.step_id, expected_revision: 11, idempotency_key: "save-master-transport", pack_build_id: pack.pack_build_id },
    },
  };
}
