import { compactPack } from "./desk-pack-service.js";
import { hashObject } from "./desk-replay-orchestration-algorithms.js";

export const LIVE_BUNDLE_TRANSPORT_SCHEMA_VERSION = "2.0.0";
export const LIVE_BUNDLE_SECTIONS = Object.freeze([
  "contract",
  "save_target",
  "quality",
  "pack",
  "dataset_integrity",
  "macro_calendar",
  "news_digest",
  "market_availability",
  "rolling_snapshots",
  "live_lineage",
  "raw_refs",
  "instructions",
]);

const DEFAULT_RESPONSE_BUDGET_BYTES = 180_000;
const MIN_RESPONSE_BUDGET_BYTES = 16_000;
const MAX_RESPONSE_BUDGET_BYTES = 512_000;
const REQUIRED_COMPACT_SECTIONS = new Set([
  "contract",
  "save_target",
  "quality",
  "market_availability",
  "rolling_snapshots",
  "instructions",
]);

export function projectLiveBundle(bundle = {}, args = {}) {
  if (!bundle?.bundle_id || bundle?.ok === false) return bundle;
  const options = normalizeOptions(args);
  const canonical = canonicalLiveBundle(bundle, options);
  const manifest = liveBundleManifest(canonical);
  const selected = selectSections(options);
  let included = selected.slice();
  let response = composeResponse(canonical, manifest, included, options);
  const omitted = [];

  if (jsonBytes(response) > options.max_response_bytes) {
    const optionalBySize = included
      .filter((section) => !REQUIRED_COMPACT_SECTIONS.has(section))
      .sort((left, right) => (manifest[right]?.bytes || 0) - (manifest[left]?.bytes || 0));
    for (const section of optionalBySize) {
      included = included.filter((candidate) => candidate !== section);
      omitted.push(section);
      response = composeResponse(canonical, manifest, included, options, omitted);
      if (jsonBytes(response) <= options.max_response_bytes) break;
    }
  }

  if (jsonBytes(response) > options.max_response_bytes) {
    included = included.filter((section) => ["contract", "save_target", "quality", "instructions"].includes(section));
    for (const section of selected) {
      if (!included.includes(section) && !omitted.includes(section)) omitted.push(section);
    }
    response = composeResponse(canonical, manifest, included, options, omitted);
  }

  return withTransport(response, bundle, options, omitted);
}

export function liveBundleManifest(bundle = {}) {
  const canonical = bundle?.transport_contract ? bundle : canonicalLiveBundle(bundle, normalizeOptions({}));
  return Object.fromEntries(LIVE_BUNDLE_SECTIONS.flatMap((section) => {
    const value = sectionValue(canonical, section);
    if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return [];
    return [[section, {
      bytes: jsonBytes(value),
      sha256: hashObject(value),
      read: {
        tool: canonical.transport_contract.tools.compact,
        arguments: {
          ...canonical.transport_contract.read_scope,
          view: "compact",
          include_sections: [section],
          include_raw_refs: section === "raw_refs",
          max_response_bytes: DEFAULT_RESPONSE_BUDGET_BYTES,
        },
      },
    }]];
  }));
}

export function liveBundleReceiptText(value = {}) {
  if (!value || typeof value !== "object") return undefined;
  return JSON.stringify({
    ok: value.ok !== false,
    status: value.status || null,
    bundle_id: value.bundle_id || null,
    bundle_type: value.bundle_type || null,
    run_id: value.run_id || null,
    trading_date: value.trading_date || value.date || null,
    session: value.session || null,
    cutoff_paris: value.cutoff_paris || value.timestamp_paris || null,
    pack_build_id: value.pack_build_id || null,
    contract_context: value.contract_context || null,
    save_target: value.save_target || null,
    complete: value.complete !== false,
    omitted_sections: value.omitted_sections || [],
    required_followup_reads: value.required_followup_reads || [],
    transport: value.transport || null,
  });
}

export function liveClaimReceiptText(value = {}) {
  if (!value || typeof value !== "object") return undefined;
  const handle = value.claim_handle || null;
  return JSON.stringify({
    ok: value.ok !== false,
    status: value.status || null,
    scope: value.scope || "live",
    claim_handle: handle,
    target_checkpoint: value.target_checkpoint || null,
    last_completed_checkpoint: value.last_completed_checkpoint || null,
    reason: value.reason || null,
    next_eligible_at_utc: value.next_eligible_at_utc || null,
    claim_retry: value.claim_retry || null,
    catchup_context: value.catchup_context || null,
    rolled_forward_from: value.rolled_forward_from || null,
    bundle: value.bundle || null,
    save_target: value.save_target || null,
    worker_id: handle?.worker_id || value.worker_id || null,
    next_action: value.status === "WORK_CLAIMED"
      ? "Read execution_prompt, call bundle.tool with bundle.args, then save and complete with this exact claim_handle."
      : null,
  });
}

function canonicalLiveBundle(bundle, options) {
  const master = bundle.bundle_type === "master_cutoff";
  const pack = bundle.pack || bundle.pack_or_source_context?.pack || null;
  const rollingSnapshots = projectSnapshots(bundle.rolling_snapshots || {}, options);
  const readScope = liveReadScope(bundle, master);
  const compact = {
    ok: bundle.ok !== false,
    status: bundle.status || bundle.data_quality?.status || "ready",
    bundle_id: bundle.bundle_id,
    bundle_type: master ? "master" : "monitor",
    strategy_id: bundle.strategy_id || null,
    trading_date: bundle.trading_date || bundle.date || null,
    date: bundle.trading_date || bundle.date || null,
    run_id: bundle.run_id || null,
    session: bundle.session || null,
    mode: bundle.mode || "live",
    timezone: bundle.timezone || "Europe/Paris",
    timestamp_paris: bundle.timestamp_paris || bundle.cutoff_paris || null,
    cutoff_paris: bundle.cutoff_paris || bundle.timestamp_paris || null,
    as_of_utc: bundle.as_of_utc || bundle.timestamp_utc || null,
    pack_id: pack?.pack_id || bundle.save_target?.suggested_payload?.pack_id || null,
    pack_build_id: bundle.pack_build_id || pack?.pack_build_id || bundle.save_target?.suggested_payload?.pack_build_id || null,
    source_hash: bundle.source_hash || null,
    source_manifest_hash: bundle.source_manifest_hash || null,
    contract_context: bundle.contract_context || null,
    contract_handshake: bundle.contract_handshake || null,
    save_target: bundle.save_target || null,
    data_quality: bundle.data_quality || null,
    anti_lookahead_policy: bundle.anti_lookahead_policy || {
      cutoff_paris: bundle.cutoff_paris || bundle.timestamp_paris || null,
      compliant: bundle.data_quality?.anti_lookahead_compliant !== false,
    },
    pack: pack ? compactLivePack(pack) : null,
    dataset_integrity: bundle.dataset_integrity || pack?.dataset_integrity || pack?.integrity || null,
    macro_calendar: bundle.macro_calendar || null,
    news_digest: compactNewsDigest(bundle.news_digest),
    market_availability: bundle.market_availability || null,
    rolling_snapshots: rollingSnapshots,
    live_lineage: master ? {
      latest_master_analysis: bundle.latest_master_analysis || null,
      active_thesis: bundle.active_thesis || null,
    } : {
      latest_master_analysis: bundle.latest_master_analysis || null,
      active_thesis: bundle.active_thesis || null,
      candidate_setups: bundle.candidate_setups || [],
      live_setups: bundle.live_setups || [],
      active_position: bundle.active_position || null,
      latest_monitor: bundle.latest_monitor || null,
      previous_manual_monitor: bundle.previous_manual_monitor || null,
      catchup_context: bundle.catchup_context || null,
    },
    raw_refs: options.include_raw_refs ? bundle.raw_refs || [] : [],
    instructions: master
      ? bundle.chatgpt_master_instructions || null
      : bundle.chatgpt_manual_monitor_instructions || null,
  };
  return {
    ...compact,
    schema_version: LIVE_BUNDLE_TRANSPORT_SCHEMA_VERSION,
    transport_contract: {
      contract_name: master ? "DeskLiveMasterBundleTransport" : "DeskLiveMonitorBundleTransport",
      schema_version: LIVE_BUNDLE_TRANSPORT_SCHEMA_VERSION,
      analytical_reference: master ? "DeskReplayMasterBundleTransport" : "DeskReplayMonitorBundleTransport",
      analytical_reference_version: "2.0.0",
      parity_rule: "Same contracts, immutable pack evidence, cutoff, rolling snapshots, quality and anti-lookahead semantics as Replay. Only clock and persistence scope differ.",
      source_rule: "LIVE reads the immutable rolling pack built at the claimed cutoff; REPLAY reads the immutable historical pack rebuilt at that cutoff.",
      tools: {
        compact: master ? "get_master_cutoff_bundle" : "get_manual_monitor_bundle",
      },
      read_scope: readScope,
    },
  };
}

function composeResponse(canonical, manifest, included, options, omitted = []) {
  const response = {
    ok: canonical.ok,
    status: canonical.status,
    bundle_id: canonical.bundle_id,
    bundle_type: canonical.bundle_type,
    strategy_id: canonical.strategy_id,
    trading_date: canonical.trading_date,
    date: canonical.date,
    run_id: canonical.run_id,
    session: canonical.session,
    mode: canonical.mode,
    timezone: canonical.timezone,
    timestamp_paris: canonical.timestamp_paris,
    cutoff_paris: canonical.cutoff_paris,
    as_of_utc: canonical.as_of_utc,
    pack_id: canonical.pack_id,
    pack_build_id: canonical.pack_build_id,
    source_hash: canonical.source_hash,
    source_manifest_hash: canonical.source_manifest_hash,
    schema_version: LIVE_BUNDLE_TRANSPORT_SCHEMA_VERSION,
    view: "compact",
    complete: omitted.length === 0,
    lossless_access: true,
    transport_contract: canonical.transport_contract,
    section_manifest: manifest,
  };
  if (included.includes("contract")) {
    response.contract_context = canonical.contract_context;
    response.contract_handshake = canonical.contract_handshake;
  }
  if (included.includes("save_target")) response.save_target = canonical.save_target;
  if (included.includes("quality")) {
    response.data_quality = canonical.data_quality;
    response.anti_lookahead_policy = canonical.anti_lookahead_policy;
  }
  if (included.includes("pack")) response.pack = canonical.pack;
  const data = {};
  if (included.includes("dataset_integrity")) data.dataset_integrity = canonical.dataset_integrity;
  if (included.includes("macro_calendar")) data.macro_calendar = canonical.macro_calendar;
  if (included.includes("news_digest")) data.news_digest = canonical.news_digest;
  if (included.includes("market_availability")) data.market_availability = canonical.market_availability;
  if (included.includes("rolling_snapshots")) data.rolling_snapshots = canonical.rolling_snapshots;
  if (Object.keys(data).length) response.data = data;
  if (included.includes("live_lineage")) response.live_lineage = canonical.live_lineage;
  if (included.includes("raw_refs") && options.include_raw_refs) response.raw_refs = canonical.raw_refs;
  if (included.includes("instructions")) {
    response.instructions = canonical.instructions;
    response.execution_rules = {
      parity: canonical.transport_contract.parity_rule,
      required_followup_rule: "Before analysis, execute every required_followup_read returned by this response. Omitted means sectioned transport, not missing data.",
    };
  }
  if (omitted.length) {
    response.omitted_sections = omitted;
    response.required_followup_reads = omitted.map((section) => manifest[section]?.read).filter(Boolean);
  }
  return response;
}

function sectionValue(bundle, section) {
  const values = {
    contract: {
      contract_context: bundle.contract_context,
      contract_handshake: bundle.contract_handshake,
      transport_contract: bundle.transport_contract,
    },
    save_target: bundle.save_target,
    quality: {
      data_quality: bundle.data_quality,
      anti_lookahead_policy: bundle.anti_lookahead_policy,
    },
    pack: bundle.pack,
    dataset_integrity: bundle.dataset_integrity,
    macro_calendar: bundle.macro_calendar,
    news_digest: bundle.news_digest,
    market_availability: bundle.market_availability,
    rolling_snapshots: bundle.rolling_snapshots,
    live_lineage: bundle.live_lineage,
    raw_refs: bundle.raw_refs,
    instructions: {
      instructions: bundle.instructions,
      parity_rule: bundle.transport_contract?.parity_rule,
    },
  };
  return values[section];
}

function selectSections(options) {
  const included = options.include_sections?.length
    ? options.include_sections
    : LIVE_BUNDLE_SECTIONS.filter((section) => section !== "raw_refs");
  const excluded = new Set(options.exclude_sections || []);
  return [...new Set(included)]
    .filter((section) => LIVE_BUNDLE_SECTIONS.includes(section))
    .filter((section) => !excluded.has(section))
    .filter((section) => section !== "raw_refs" || options.include_raw_refs);
}

function projectSnapshots(snapshots, options) {
  const windows = options.snapshot_windows?.length ? new Set(options.snapshot_windows) : null;
  const instruments = options.instruments?.length ? new Set(options.instruments) : null;
  return Object.fromEntries(Object.entries(snapshots || {}).flatMap(([window, snapshot]) => {
    if (windows && !windows.has(window)) return [];
    const blocks = Object.fromEntries(Object.entries(snapshot?.instruments || {}).flatMap(([instrument, block]) => {
      if (instruments && !instruments.has(instrument)) return [];
      if (options.include_raw_refs) return [[instrument, block]];
      const { raw_refs: _rawRefs, attempted_raw_refs: _attemptedRawRefs, ...rest } = block || {};
      return [[instrument, rest]];
    }));
    const { raw_refs: _rawRefs, ...rest } = snapshot || {};
    return [[window, { ...rest, instruments: blocks }]];
  }));
}

function compactLivePack(pack) {
  const compact = compactPack(pack);
  const datasets = Object.fromEntries(Object.entries(compact.datasets || {}).map(([dataset, ref]) => [
    dataset,
    {
      status: ref?.status || null,
      row_count: ref?.row_count ?? null,
      size_bytes: ref?.size_bytes ?? ref?.bytes ?? null,
      sha256: ref?.sha256 || null,
      crc32c: ref?.crc32c || null,
      min_timestamp_utc: ref?.min_timestamp_utc || ref?.from_time_utc || null,
      max_timestamp_utc: ref?.max_timestamp_utc || ref?.to_time_utc || null,
      cutoff_utc: ref?.cutoff_utc || null,
    },
  ]));
  const manifest = compact.manifest && typeof compact.manifest === "object"
    ? {
        source_manifest_hash: compact.source_manifest_hash
          || compact.manifest.source_manifest_hash
          || null,
        dataset_count: Object.keys(datasets).length,
        generation: compact.manifest_generation
          || compact.manifest.generation
          || compact.manifest.manifest_generation
          || null,
        created_at_utc: compact.manifest.created_at_utc
          || compact.manifest.generated_at_utc
          || null,
      }
    : null;
  return {
    ...compact,
    manifest,
    datasets,
    transport_projection: {
      schema_version: "live_pack_compact_v1",
      source_pack_sha256: hashObject(pack),
      omitted_fields: [
        "dataset storage paths",
        "dataset columns",
        "duplicated manifest object entries",
      ],
      integrity_rule: "Dataset hashes, row counts, time bounds, pack identity and source_manifest_hash remain pinned.",
    },
  };
}

function compactNewsDigest(news) {
  if (!news || typeof news !== "object") return news || null;
  const items = Array.isArray(news.items) ? news.items : [];
  const rowFields = [
    "published_at_utc",
    "title",
    "source",
    "importance",
    "sentiment",
    "topics",
    "assets",
    "instruments",
  ];
  const rows = items.map((item) => [
    item.published_at_utc || null,
    compactText(item.title, 180),
    compactText(item.source || item.source_domain, 80),
    item.importance ?? null,
    item.sentiment ?? null,
    compactList(item.topics, 8, 60),
    compactList(item.assets, 8, 40),
    compactList(item.instruments, 8, 40),
  ]);
  const highlights = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const importanceDelta = newsImportanceScore(right.item.importance)
        - newsImportanceScore(left.item.importance);
      if (importanceDelta) return importanceDelta;
      const publishedDelta = Date.parse(right.item.published_at_utc || "")
        - Date.parse(left.item.published_at_utc || "");
      if (Number.isFinite(publishedDelta) && publishedDelta) return publishedDelta;
      return left.index - right.index;
    })
    .slice(0, 12)
    .map(({ item }) => ({
      article_id: item.article_id || item.provider_article_id || null,
      title: compactText(item.title, 180),
      summary: compactText(item.summary, 320),
      published_at_utc: item.published_at_utc || null,
      source: compactText(item.source || item.source_domain, 80),
      importance: item.importance ?? null,
      sentiment: item.sentiment ?? null,
      topics: compactList(item.topics, 8, 60),
      assets: compactList(item.assets, 8, 40),
      instruments: compactList(item.instruments, 8, 40),
    }));
  return {
    ok: news.ok !== false,
    status: news.status || null,
    date: news.date || null,
    session: news.session || null,
    pack_id: news.pack_id || null,
    pack_build_id: news.pack_build_id || null,
    scope_hash: news.scope_hash || null,
    source_manifest_hash: news.source_manifest_hash || null,
    resolved_scope: news.resolved_scope || null,
    projection: {
      schema_version: "live_news_analytical_compact_v2",
      source_item_count: items.length,
      source_sha256: hashObject(news),
      item_encoding: "rows",
      fields: rowFields,
      analytical_coverage: "Every source article is represented once in items; highlights add summaries for the 12 highest-priority recent articles.",
      highlight_count: highlights.length,
    },
    items: rows,
    highlights,
  };
}

function compactText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function compactList(value, maxItems, maxItemLength) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => compactText(item, maxItemLength)).filter(Boolean);
}

function newsImportanceScore(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const normalized = String(value || "").trim().toLowerCase();
  if (["critical", "very_high", "high"].includes(normalized)) return 3;
  if (["medium", "moderate"].includes(normalized)) return 2;
  if (["low", "minor"].includes(normalized)) return 1;
  return 0;
}

function liveReadScope(bundle, master) {
  const suggested = bundle.save_target?.suggested_payload || {};
  return {
    bundle_id: bundle.bundle_id,
    strategy_id: bundle.strategy_id,
    session: bundle.session,
    mode: bundle.mode || "live",
    trading_date: bundle.trading_date || bundle.date,
    run_id: bundle.run_id,
    as_of_utc: bundle.as_of_utc || bundle.timestamp_utc,
    timezone: bundle.timezone || "Europe/Paris",
    ...(master
      ? { cutoff_paris: bundle.cutoff_paris || bundle.timestamp_paris }
      : {
          timestamp_paris: bundle.timestamp_paris,
          master_id: suggested.linked_master_analysis_id,
          thesis_id: suggested.linked_active_thesis_id,
          ...(suggested.pack_id ? { pack_id: suggested.pack_id } : {}),
        }),
  };
}

function normalizeOptions(args = {}) {
  const budget = Number(args.max_response_bytes);
  return {
    include_sections: Array.isArray(args.include_sections) ? args.include_sections : null,
    exclude_sections: Array.isArray(args.exclude_sections) ? args.exclude_sections : null,
    snapshot_windows: Array.isArray(args.snapshot_windows) ? args.snapshot_windows : null,
    instruments: Array.isArray(args.snapshot_instruments) ? args.snapshot_instruments : null,
    include_raw_refs: args.include_raw_refs === true,
    max_response_bytes: Number.isFinite(budget)
      ? Math.max(MIN_RESPONSE_BUDGET_BYTES, Math.min(budget, MAX_RESPONSE_BUDGET_BYTES))
      : DEFAULT_RESPONSE_BUDGET_BYTES,
  };
}

function withTransport(response, source, options, omitted) {
  return {
    ...response,
    transport: {
      schema_version: LIVE_BUNDLE_TRANSPORT_SCHEMA_VERSION,
      source_bytes: jsonBytes(source),
      response_bytes: jsonBytes(response),
      budget_bytes: options.max_response_bytes,
      budget_exceeded: jsonBytes(response) > options.max_response_bytes,
      sectioned: omitted.length > 0,
    },
  };
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null));
}
