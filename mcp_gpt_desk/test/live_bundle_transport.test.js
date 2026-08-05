import assert from "node:assert/strict";
import test from "node:test";
import {
  liveBundleReceiptText,
  liveClaimReceiptText,
  projectLiveBundle,
} from "../src/live-bundle-view.js";

test("LIVE compact transport follows the Replay analytical reference without changing the source bundle", () => {
  const source = liveMasterBundle({ newsItemCount: 400 });
  const before = JSON.stringify(source);
  const compact = projectLiveBundle(source, {
    view: "compact",
    include_raw_refs: false,
    max_response_bytes: 100000,
  });

  assert.equal(JSON.stringify(source), before);
  assert.equal(compact.transport_contract.analytical_reference, "DeskReplayMasterBundleTransport");
  assert.equal(compact.transport_contract.analytical_reference_version, "2.0.0");
  assert.equal(compact.contract_context.contract_name, "DeskMasterAnalysisContract");
  assert.equal(compact.save_target.suggested_payload.pack_build_id, "packbuild_live");
  assert.equal(compact.data.rolling_snapshots["15m"].instruments.MNQ.close, 102);
  assert.equal(compact.data.rolling_snapshots["15m"].instruments.MNQ.raw_refs, undefined);
  assert.equal(compact.pack.transport_projection.schema_version, "live_pack_compact_v1");
  assert.equal(compact.pack.datasets.DATASET_0.storage_path, undefined);
  assert.equal(compact.pack.datasets.DATASET_0.sha256, "0".repeat(64));
  assert.equal(compact.pack.manifest, null);
  assert.equal(compact.level_map, undefined);
  assert.equal(compact.futures_core, undefined);
  assert.equal(compact.rolling_15m_snapshot, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 100000);
  assert.equal(compact.transport.budget_exceeded, false);
  assert.ok(compact.omitted_sections.includes("news_digest"));
  assert.equal(compact.required_followup_reads[0].tool, "get_master_cutoff_bundle");
  assert.deepEqual(compact.required_followup_reads[0].arguments.include_sections, ["news_digest"]);
});

test("LIVE sectioned read returns the complete omitted evidence under the same bundle identity", () => {
  const source = liveMasterBundle();
  const response = projectLiveBundle(source, {
    view: "compact",
    include_sections: ["news_digest"],
    include_raw_refs: false,
    max_response_bytes: 300000,
  });

  assert.equal(response.bundle_id, source.bundle_id);
  assert.equal(response.complete, true);
  assert.equal(response.data.news_digest.items.length, 100);
  assert.equal(response.omitted_sections, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 300000);
});

test("LIVE production-shaped news remains in the primary analytical bundle without a moving-pack follow-up", () => {
  const source = liveMasterBundle({
    newsItemCount: 131,
    title: "Fed speakers and US earnings shape the index futures session",
    summary: "The release changes the near-term macro context without invalidating the pinned cutoff.",
  });
  const response = projectLiveBundle(source, {
    view: "compact",
    include_raw_refs: false,
    max_response_bytes: 180000,
  });

  assert.equal(response.complete, true);
  assert.equal(response.omitted_sections, undefined);
  assert.equal(response.required_followup_reads, undefined);
  assert.equal(response.data.news_digest.items.length, 131);
  assert.equal(response.data.news_digest.highlights.length, 12);
  assert.equal(response.data.news_digest.projection.item_encoding, "rows");
  assert.equal(response.data.news_digest.projection.analytical_coverage.includes("Every source article"), true);
  assert.equal(response.data.news_digest.items[0].raw, undefined);
  assert.equal(response.data.news_digest.items[0].url, undefined);
  assert.equal(response.data.news_digest.projection.schema_version, "live_news_analytical_compact_v2");
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 180000);
});

test("LIVE news transport bounds pathological provider text while retaining every headline row", () => {
  const source = liveMasterBundle({ newsItemCount: 131 });
  const response = projectLiveBundle(source, {
    view: "compact",
    include_raw_refs: false,
    max_response_bytes: 180000,
  });

  assert.equal(response.complete, true);
  assert.equal(response.data.news_digest.items.length, 131);
  assert.equal(response.data.news_digest.highlights.length, 12);
  assert.equal(response.data.news_digest.items.every((row) => row[1].length <= 180), true);
  assert.equal(response.data.news_digest.highlights.every((item) => item.summary.length <= 320), true);
  assert.equal(response.omitted_sections, undefined);
  assert.equal(response.required_followup_reads, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 180000);
});

test("LIVE receipts make the protected handle and save base text-visible without duplicating analysis data", () => {
  const bundle = projectLiveBundle(liveMasterBundle(), { view: "compact", max_response_bytes: 180000 });
  const bundleReceipt = JSON.parse(liveBundleReceiptText(bundle));
  const claimReceipt = JSON.parse(liveClaimReceiptText({
    ok: true,
    status: "WORK_CLAIMED",
    scope: "live",
    claim_handle: {
      cursor_id: "livecur__2026-07-27",
      worker_id: "gpt-live-pool-04",
      lease_token: "lease-exact",
      checkpoint: "2026-07-27T00:15:00+02:00",
    },
    bundle: {
      bundle_id: bundle.bundle_id,
      bundle_tool: "get_master_cutoff_bundle",
      bundle_args: bundle.transport_contract.read_scope,
    },
    save_target: bundle.save_target,
  }));

  assert.equal(bundleReceipt.pack_build_id, "packbuild_live");
  assert.equal(bundleReceipt.save_target.suggested_payload.strategy_id, "asia_open");
  assert.equal(claimReceipt.claim_handle.cursor_id, "livecur__2026-07-27");
  assert.equal(claimReceipt.claim_handle.lease_token, "lease-exact");
  assert.equal(claimReceipt.bundle.bundle_tool, "get_master_cutoff_bundle");
});

function liveMasterBundle({
  newsItemCount = 100,
  title = null,
  summary = null,
} = {}) {
  const repeatedText = "Macro and company headline ".repeat(28);
  const newsItems = Array.from({ length: newsItemCount }, (_, index) => ({
    id: `news_${index}`,
    title: title || `${index} ${repeatedText}`,
    summary: summary || repeatedText,
    raw: { duplicated_provider_payload: repeatedText },
    url: `https://example.test/${index}?tracking=provider`,
    canonical_url: `https://example.test/${index}`,
    published_at_utc: `2026-07-27T${String(index % 10).padStart(2, "0")}:00:00.000Z`,
  }));
  const rawRefs = Array.from({ length: 40 }, (_, index) => ({
    dataset: `DATASET_${index}`,
    object_path: `local://dataset_${index}.csv`,
    sha256: String(index).padStart(64, "0"),
  }));
  const snapshots = Object.fromEntries(["15m", "1h", "4h"].map((window) => [window, {
    snapshot_id: `snapshot_${window}`,
    window,
    timestamp_paris: "2026-07-27T00:15:00+02:00",
    instruments: {
      MNQ: {
        status: "ready",
        availability: "fresh",
        row_count: 3,
        open: 100,
        high: 104,
        low: 98,
        close: 102,
        raw_refs: rawRefs,
        attempted_raw_refs: rawRefs,
      },
      MES: {
        status: "ready",
        availability: "fresh",
        row_count: 3,
        open: 100,
        high: 103,
        low: 99,
        close: 101,
        raw_refs: rawRefs,
      },
    },
    data_quality: { status: "ready", execution_allowed: true },
    anti_lookahead_compliant: true,
  }]));
  const pack = {
    pack_id: "2026-07-27_asia_open",
    pack_build_id: "packbuild_live",
    status: "ready",
    datasets: Object.fromEntries(rawRefs.map((ref) => [ref.dataset, {
      storage_path: ref.object_path,
      sha256: ref.sha256,
      row_count: 100,
    }])),
  };
  return {
    ok: true,
    status: "ready",
    bundle_id: "master_cutoff_bundle_2026_07_27_asia_open_0015_live",
    bundle_type: "master_cutoff",
    strategy_id: "asia_open",
    trading_date: "2026-07-27",
    date: "2026-07-27",
    run_id: "front_live_2026-07-27",
    session: "asia_open",
    mode: "live",
    timezone: "Europe/Paris",
    cutoff_paris: "2026-07-27T00:15:00+02:00",
    timestamp_paris: "2026-07-27T00:15:00+02:00",
    as_of_utc: "2026-07-26T22:15:00.000Z",
    pack_build_id: pack.pack_build_id,
    source_hash: "a".repeat(64),
    source_manifest_hash: "b".repeat(64),
    contract_context: {
      contract_name: "DeskMasterAnalysisContract",
      schema_version: "4.0.0",
      contract_hash: "c".repeat(64),
    },
    contract_handshake: { valid: true },
    pack_or_source_context: { status: "ready", pack },
    macro_calendar: { events: [{ id: "macro_1", scheduled_at_paris: "2026-07-27T14:30:00+02:00" }] },
    news_digest: { status: "ready", items: newsItems },
    market_availability: { instruments: { MNQ: { availability: "fresh" }, MES: { availability: "fresh" } } },
    rolling_snapshots: snapshots,
    rolling_15m_snapshot: snapshots["15m"],
    rolling_1h_snapshot: snapshots["1h"],
    rolling_4h_snapshot: snapshots["4h"],
    futures_core: { MNQ_M5: { rows: Array.from({ length: 500 }, () => ({ close: 100 })) } },
    level_map: { levels: Array.from({ length: 1000 }, (_, index) => ({ price: index, note: repeatedText })) },
    raw_refs: rawRefs,
    data_quality: { status: "ready", execution_allowed: true, anti_lookahead_compliant: true },
    anti_lookahead_policy: { cutoff_paris: "2026-07-27T00:15:00+02:00", compliant: true },
    chatgpt_master_instructions: { required_mode: "live_master_cutoff" },
    save_target: {
      tool: "save_master_analysis",
      suggested_payload: {
        bundle_id: "master_cutoff_bundle_2026_07_27_asia_open_0015_live",
        strategy_id: "asia_open",
        trading_date: "2026-07-27",
        run_id: "front_live_2026-07-27",
        session: "asia_open",
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
      },
    },
  };
}
