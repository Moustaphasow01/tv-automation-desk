import { createHash } from "node:crypto";

export const REPLAY_TRANSPORT_SCHEMA_VERSION = "2.0.0";
export const REPLAY_BUNDLE_VIEWS = Object.freeze(["compact", "manifest", "full"]);
export const REPLAY_BUNDLE_SECTIONS = Object.freeze([
  "contract",
  "save_target",
  "quality",
  "pack",
  "dataset_integrity",
  "macro_calendar",
  "news_digest",
  "market_availability",
  "rolling_snapshots",
  "replan_context",
  "replay_lineage",
  "raw_refs",
  "instructions",
]);
export const REPLAY_LINEAGE_COMPONENTS = Object.freeze([
  "replay_master_analysis",
  "replay_active_thesis",
  "replay_setups",
  "previous_replay_monitor",
  "replay_position",
]);

const DEFAULT_RESPONSE_BUDGET_BYTES = 180_000;
const MIN_RESPONSE_BUDGET_BYTES = 16_000;
const MAX_RESPONSE_BUDGET_BYTES = 512_000;
const DEFAULT_COMPACT_SECTIONS = REPLAY_BUNDLE_SECTIONS.filter((section) => section !== "raw_refs");

export function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null));
}

export function replayTransportContract(bundleType = "master") {
  const type = bundleType === "monitor" ? "monitor" : "master";
  return {
    contract_name: type === "master" ? "DeskReplayMasterBundleTransport" : "DeskReplayMonitorBundleTransport",
    schema_version: REPLAY_TRANSPORT_SCHEMA_VERSION,
    default_view: "compact",
    lossless_access: true,
    canonical_snapshot_path: type === "master" ? "data.rolling_snapshots" : "rolling_snapshots",
    required_read_sequence: [
      "get_active_contracts(view=summary)",
      `${type === "master" ? "get_replay_master_bundle" : "get_replay_monitor_bundle"}(view=compact)`,
      "get_replay_bundle_section or get_replay_snapshot only when deeper evidence is required",
    ],
    tools: {
      compact: type === "master" ? "get_replay_master_bundle" : "get_replay_monitor_bundle",
      manifest: "get_replay_bundle_manifest",
      section: "get_replay_bundle_section",
      snapshot: "get_replay_snapshot",
    },
    save_rule: "Always use save_target.suggested_payload from the compact bundle as the immutable save base.",
    budget_rule: "A budget fallback is not MCP_REQUIRED. Follow section, component and field manifests, verify their SHA-256 receipts, and reassemble replay-scoped evidence before deciding DATA_NOT_READY.",
  };
}

export function projectActiveContracts(contracts, args = {}) {
  if ((args.view || "full") === "full") return contracts;
  const summarize = (contract) => contract ? {
    contract_id: contract.contract_id || null,
    contract_name: contract.contract_name || null,
    schema_version: contract.schema_version || null,
    contract_hash: contract.contract_hash || contract.hash || null,
    status: contract.status || null,
    is_active: Boolean(contract.is_active || contract.status === "active"),
    content_bytes: jsonBytes(contract.content_markdown || ""),
    schema_bytes: jsonBytes(contract.schema_json || {}),
    full_read: {
      tool: "get_contract",
      arguments: {
        contract_name: contract.contract_name || null,
        schema_version: contract.schema_version || null,
      },
    },
  } : null;
  return {
    ok: contracts?.ok !== false,
    view: "summary",
    master_contract: summarize(contracts?.master_contract),
    monitor_contract: summarize(contracts?.monitor_contract),
    front_projection_contract: summarize(contracts?.front_projection_contract),
    registry: contracts?.registry || null,
    source: contracts?.source || null,
  };
}

export function canonicalizeReplayBundle(bundle = {}) {
  const sourceData = bundle.data || {};
  const sourceSnapshots = sourceData.rolling_snapshots || bundle.rolling_snapshots || collectSnapshotAliases(bundle, sourceData);
  const references = createReferenceDictionary();
  for (const ref of bundle.raw_refs || []) references.intern(ref);
  const rollingSnapshots = canonicalizeSnapshots(sourceSnapshots, references);
  const pack = bundle.pack || sourceData.pack || null;
  const replanContext = bundle.replan_context || buildLegacyReplanContext(bundle);
  const bundleType = bundle.bundle_type === "monitor" ? "monitor" : "master";
  const transportContract = replayTransportContract(bundleType);

  const {
    rolling_snapshots: _rollingSnapshots,
    rolling_15m_snapshot: _rolling15m,
    rolling_1h_snapshot: _rolling1h,
    rolling_4h_snapshot: _rolling4h,
    previous_replay_master_analysis: _previousMaster,
    previous_replay_active_thesis: _previousThesis,
    previous_replay_setups: _previousSetups,
    triggering_replay_monitor: _triggeringMonitor,
    raw_refs: _rawRefs,
    data: _sourceData,
    ...rest
  } = bundle;
  const {
    pack: _dataPack,
    rolling_snapshots: _dataSnapshots,
    rolling_15m_snapshot: _dataRolling15m,
    rolling_1h_snapshot: _dataRolling1h,
    rolling_4h_snapshot: _dataRolling4h,
    ...dataRest
  } = sourceData;

  const canonical = {
    ...rest,
    source_schema_version: bundle.source_schema_version || bundle.schema_version || null,
    schema_version: REPLAY_TRANSPORT_SCHEMA_VERSION,
    transport_contract: transportContract,
    contract_handshake: {
      ...(bundle.contract_handshake || {}),
      bundle_transport: transportContract,
    },
    replan_context: replanContext,
    pack,
    data: bundleType === "master" ? {
      ...dataRest,
      pack_ref: pack ? "#/pack" : null,
      rolling_snapshots: rollingSnapshots,
    } : dataRest,
    ...(bundleType === "monitor" ? { rolling_snapshots: rollingSnapshots } : {}),
    raw_refs: references.values,
    raw_ref_dictionary_hash: hashValue(references.values),
    chatgpt_replay_instructions: replayReadInstructions(bundle),
  };
  const withoutHash = { ...canonical };
  delete withoutHash.canonical_bundle_hash;
  return { ...canonical, canonical_bundle_hash: hashValue(withoutHash) };
}

export function replayBundleManifest(bundle = {}) {
  const canonical = isCanonical(bundle) ? bundle : canonicalizeReplayBundle(bundle);
  const identity = replayIdentity(canonical);
  const sections = {};
  for (const section of REPLAY_BUNDLE_SECTIONS) {
    const value = replaySectionValue(canonical, section);
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    sections[section] = {
      bytes: jsonBytes(value),
      sha256: hashValue(value),
      read: section === "rolling_snapshots"
        ? { tool: "get_replay_snapshot", arguments: { ...identityRef(identity), window: "15m" } }
        : { tool: "get_replay_bundle_section", arguments: { ...identityRef(identity), section } },
    };
  }
  return {
    source_bundle_hash: canonical.source_hash || null,
    canonical_bundle_hash: canonical.canonical_bundle_hash,
    source_manifest_hash: canonical.source_manifest_hash || null,
    sections,
  };
}

export function projectReplayBundle(bundle = {}, args = {}) {
  const canonical = canonicalizeReplayBundle(bundle);
  const options = normalizeReadOptions(args);
  const manifest = replayBundleManifest(canonical);
  const selectedSections = selectSections(options);
  const identity = replayIdentity(canonical);
  let response = options.view === "manifest"
    ? manifestResponse(identity, canonical, manifest, options)
    : composeReplayResponse(identity, canonical, manifest, options, selectedSections);
  response = withTransportMetrics(response, bundle, canonical, options, false);

  if (jsonBytes(response) > options.max_response_bytes) {
    const fallback = manifestResponse(identity, canonical, manifest, options, {
      budget_exceeded: true,
      omitted_sections: selectedSections,
    });
    return withTransportMetrics(fallback, bundle, canonical, options, true);
  }
  return response;
}

export function getReplayBundleSectionView(bundle = {}, args = {}) {
  const canonical = canonicalizeReplayBundle(bundle);
  const options = normalizeReadOptions(args);
  const section = String(args.section || "");
  if (!REPLAY_BUNDLE_SECTIONS.includes(section)) {
    throw new Error(`invalid_replay_bundle_section:${section || "missing"}`);
  }
  let sectionData = replaySectionValue(canonical, section);
  if (section === "rolling_snapshots") sectionData = filterSnapshots(sectionData, options);
  if (section === "raw_refs" && args.include_raw_refs === false) sectionData = [];
  const selection = replaySectionSelection(sectionData, section, args);
  const paged = selection.selected
    ? paginateSelectedValue(selection.value, args.offset, args.limit, selection.data_path)
    : paginateSection(sectionData, args.offset, args.limit, section);
  const response = {
    ok: true,
    ...replayIdentity(canonical),
    view: "section",
    complete: true,
    section,
    section_sha256: hashValue(sectionData),
    ...(selection.component ? {
      component: selection.component,
      component_sha256: hashValue(selection.component_value),
    } : {}),
    ...(selection.field ? {
      field: selection.field,
      field_sha256: hashValue(selection.value),
    } : {}),
    data: paged.data,
    pagination: paged.pagination,
    source_bundle_hash: canonical.source_hash || null,
    canonical_bundle_hash: canonical.canonical_bundle_hash,
  };
  const measured = withTransportMetrics(response, bundle, canonical, options, false);
  if (jsonBytes(measured) <= options.max_response_bytes) return measured;
  return withTransportMetrics({
    ok: true,
    ...replayIdentity(canonical),
    view: "section",
    section,
    complete: false,
    budget_exceeded: true,
    section_sha256: hashValue(sectionData),
    ...(selection.component ? {
      component: selection.component,
      component_sha256: hashValue(selection.component_value),
    } : {}),
    ...(selection.field ? {
      field: selection.field,
      field_sha256: hashValue(selection.value),
    } : {}),
    source_bundle_hash: canonical.source_hash || null,
    canonical_bundle_hash: canonical.canonical_bundle_hash,
    ...(!selection.component && section === "replay_lineage"
      ? {
          component_manifest: replayLineageComponentManifest(
            sectionData,
            replayIdentity(canonical),
          ),
        }
      : {}),
    ...(selection.component && !selection.field
      ? {
          field_manifest: replayLineageFieldManifest(
            selection.component_value,
            replayIdentity(canonical),
            selection.component,
          ),
        }
      : {}),
    data: null,
    recommended_action: replaySectionBudgetRecommendation({
      section,
      selection,
    }),
  }, bundle, canonical, options, true);
}

export function getReplaySnapshotView(bundle = {}, args = {}) {
  const window = String(args.window || "");
  if (!window) throw new Error("replay_snapshot_window_required");
  const response = getReplayBundleSectionView(bundle, {
    ...args,
    section: "rolling_snapshots",
    snapshot_windows: [window],
  });
  const output = { ...response, view: "snapshot", window };
  if (output.transport) output.transport.response_bytes = jsonBytes(output);
  return output;
}

function composeReplayResponse(identity, canonical, manifest, options, selectedSections) {
  const response = {
    ok: canonical.ok !== false,
    ...identity,
    view: options.view,
    complete: true,
    lossless_access: true,
    source_bundle_hash: canonical.source_hash || null,
    canonical_bundle_hash: canonical.canonical_bundle_hash,
    source_manifest_hash: canonical.source_manifest_hash || null,
    section_manifest: manifest.sections,
  };
  const has = (section) => selectedSections.includes(section);
  if (has("contract")) Object.assign(response, replaySectionValue(canonical, "contract"));
  if (has("save_target")) response.save_target = canonical.save_target || null;
  if (has("quality")) {
    response.data_quality = canonical.data_quality || null;
    response.anti_lookahead_policy = canonical.anti_lookahead_policy || null;
  }
  if (has("pack")) response.pack = options.view === "full" ? canonical.pack : compactPack(canonical.pack);
  const data = {};
  if (has("dataset_integrity")) data.dataset_integrity = canonical.data?.dataset_integrity || canonical.dataset_integrity || null;
  if (has("macro_calendar")) data.macro_calendar = canonical.data?.macro_calendar || canonical.macro_calendar || null;
  if (has("news_digest")) data.news_digest = canonical.data?.news_digest || canonical.news_digest || null;
  if (has("market_availability")) data.market_availability = canonical.data?.market_availability || canonical.market_availability || null;
  if (has("rolling_snapshots")) data.rolling_snapshots = filterSnapshots(replaySectionValue(canonical, "rolling_snapshots"), options);
  if (Object.keys(data).length) response.data = data;
  if (has("replan_context")) response.replan_context = canonical.replan_context || null;
  if (has("replay_lineage")) Object.assign(response, replaySectionValue(canonical, "replay_lineage"));
  if (has("raw_refs") || options.include_raw_refs) response.raw_refs = canonical.raw_refs || [];
  if (has("instructions")) response.chatgpt_replay_instructions = canonical.chatgpt_replay_instructions || null;
  return response;
}

function manifestResponse(identity, canonical, manifest, options, extra = {}) {
  const requiredFollowupReads = extra.budget_exceeded
    ? replayRequiredFollowupReads(identity, manifest, extra.omitted_sections)
    : [];
  return {
    ok: canonical.ok !== false,
    ...identity,
    view: "manifest",
    requested_view: options.view,
    complete: false,
    lossless_access: true,
    contract_context: canonical.contract_context || null,
    contract_handshake: canonical.contract_handshake || null,
    transport_contract: canonical.transport_contract || null,
    save_target: canonical.save_target || null,
    data_quality: canonical.data_quality || null,
    anti_lookahead_policy: canonical.anti_lookahead_policy || null,
    section_manifest: manifest.sections,
    source_bundle_hash: canonical.source_hash || null,
    canonical_bundle_hash: canonical.canonical_bundle_hash,
    recommended_action: "Read only the required sections with get_replay_bundle_section or get_replay_snapshot.",
    ...(requiredFollowupReads.length ? { required_followup_reads: requiredFollowupReads } : {}),
    ...extra,
  };
}

function replayRequiredFollowupReads(identity, manifest, omittedSections = []) {
  const omitted = new Set(Array.isArray(omittedSections) ? omittedSections : []);
  const sections = Object.keys(manifest.sections || {}).filter((section) => (
    omitted.has(section)
    && !["contract", "save_target", "quality", "raw_refs"].includes(section)
  ));
  const reads = [];
  for (const section of sections) {
    if (section === "rolling_snapshots") {
      for (const window of ["15m", "1h", "4h"]) {
        reads.push({
          tool: "get_replay_snapshot",
          arguments: {
            ...identityRef(identity),
            window,
            include_raw_refs: false,
            max_response_bytes: MAX_RESPONSE_BUDGET_BYTES,
          },
        });
      }
      continue;
    }
    reads.push({
      tool: "get_replay_bundle_section",
      arguments: {
        ...identityRef(identity),
        section,
        include_raw_refs: false,
        max_response_bytes: MAX_RESPONSE_BUDGET_BYTES,
      },
    });
  }
  return reads;
}

function replaySectionValue(bundle, section) {
  const snapshots = bundle.data?.rolling_snapshots || bundle.rolling_snapshots || {};
  const values = {
    contract: {
      contract_context: bundle.contract_context || null,
      contract_handshake: bundle.contract_handshake || null,
      transport_contract: bundle.transport_contract || null,
      contracts: bundle.contracts || null,
    },
    save_target: bundle.save_target || null,
    quality: {
      data_quality: bundle.data_quality || null,
      anti_lookahead_policy: bundle.anti_lookahead_policy || null,
    },
    pack: bundle.pack || null,
    dataset_integrity: bundle.data?.dataset_integrity || bundle.dataset_integrity || null,
    macro_calendar: bundle.data?.macro_calendar || bundle.macro_calendar || null,
    news_digest: bundle.data?.news_digest || bundle.news_digest || null,
    market_availability: bundle.data?.market_availability || bundle.market_availability || null,
    rolling_snapshots: snapshots,
    replan_context: bundle.replan_context || null,
    replay_lineage: {
      replay_master_analysis: bundle.replay_master_analysis || null,
      replay_active_thesis: bundle.replay_active_thesis || null,
      replay_setups: bundle.replay_setups || [],
      previous_replay_monitor: bundle.previous_replay_monitor || null,
      replay_position: bundle.replay_position || bundle.replan_context?.current_position || null,
    },
    raw_refs: bundle.raw_refs || [],
    instructions: bundle.chatgpt_replay_instructions || null,
  };
  return values[section];
}

function replayIdentity(bundle) {
  return {
    bundle_id: bundle.bundle_id || null,
    bundle_type: bundle.bundle_type || null,
    backtest_id: bundle.backtest_id || null,
    replay_run_id: bundle.replay_run_id || bundle.backtest_id || null,
    step_id: bundle.step_id || null,
    strategy_id: bundle.strategy_id || null,
    trading_date: bundle.trading_date || bundle.date || null,
    session: bundle.session || null,
    mode: bundle.mode || "replay",
    timestamp_paris: bundle.timestamp_paris || bundle.replay_time || null,
    cutoff_paris: bundle.cutoff_paris || bundle.timestamp_paris || null,
    timezone: bundle.timezone || "Europe/Paris",
    pack_id: bundle.pack_id || bundle.pack?.pack_id || null,
    pack_build_id: bundle.pack_build_id || bundle.pack?.pack_build_id || null,
    is_replan: Boolean(bundle.is_replan || bundle.replan_context?.requested),
    schema_version: REPLAY_TRANSPORT_SCHEMA_VERSION,
  };
}

function identityRef(identity) {
  return {
    backtest_id: identity.backtest_id,
    step_id: identity.step_id,
    bundle_type: identity.bundle_type,
  };
}

function replayReadInstructions(bundle) {
  const type = bundle.bundle_type === "monitor" ? "monitor" : "master";
  const base = bundle.chatgpt_replay_instructions || {};
  return {
    ...base,
    transport_schema_version: REPLAY_TRANSPORT_SCHEMA_VERSION,
    required_mode: base.required_mode || `manual_gpt_${type}_replay`,
    compact_read_tool: type === "master" ? "get_replay_master_bundle" : "get_replay_monitor_bundle",
    compact_read_arguments: {
      backtest_id: bundle.backtest_id || null,
      step_id: bundle.step_id || null,
      view: "compact",
      include_raw_refs: false,
    },
    deep_read_tools: ["get_replay_bundle_manifest", "get_replay_bundle_section", "get_replay_snapshot"],
    missing_section_rule: "Use a replay-scoped deep read before declaring DATA_NOT_READY. Never use live data as a fallback.",
    budget_fallback_rule: "budget_exceeded is not MCP_REQUIRED; follow section_manifest, component_manifest and field_manifest read instructions and verify every SHA-256.",
    source_coverage_rule: "Verify data_quality.source_coverage covers cutoff_paris. A coverage failure is DATA_NOT_READY and must block the save.",
    market_availability_rule: "data_quality is authoritative. A context-only missing_unexpected is DEGRADED and must not trigger DATA_NOT_READY; block only when execution_allowed=false or analysis_mode=blocked.",
    stale_context_rule: "Use last_known and H4 fallback for regime/context only, never as a fresh trigger or current-session confirmation.",
    tech_gap_rule: "A tech gap marked not_yet_open is not applicable yet. Do not call it missing and do not invent a gap before a current-session quote exists.",
    vix_rule: "VIX cash may be stale outside US cash hours. State that fresh confirmation is unavailable, use last_known as context, and do not require fresh cash VIX before its session opens.",
  };
}

function buildLegacyReplanContext(bundle) {
  const requested = Boolean(bundle.is_replan || bundle.previous_replay_master_analysis || bundle.triggering_replay_monitor);
  if (!requested) return null;
  return {
    requested: true,
    reason: bundle.triggering_replay_monitor?.monitor_decision?.action || "REPLAN_REQUIRED",
    source_step_id: bundle.triggering_replay_monitor?.step_id || null,
    previous_master_analysis: bundle.previous_replay_master_analysis || null,
    previous_active_thesis: bundle.previous_replay_active_thesis || null,
    previous_setups: bundle.previous_replay_setups || [],
    triggering_monitor: bundle.triggering_replay_monitor || null,
    current_position: bundle.replay_position || null,
  };
}

function collectSnapshotAliases(bundle, data) {
  return {
    "15m": data.rolling_15m_snapshot || bundle.rolling_15m_snapshot || null,
    "1h": data.rolling_1h_snapshot || bundle.rolling_1h_snapshot || null,
    "4h": data.rolling_4h_snapshot || bundle.rolling_4h_snapshot || null,
  };
}

function canonicalizeSnapshots(snapshots, references) {
  return Object.fromEntries(Object.entries(snapshots || {}).filter(([, snapshot]) => snapshot).map(([window, snapshot]) => {
    const snapshotRefIndexes = (snapshot.raw_refs || []).map(references.intern);
    const instruments = Object.fromEntries(Object.entries(snapshot.instruments || {}).map(([instrument, block]) => {
      const rawRefIndexes = (block.raw_refs || []).map(references.intern);
      const attemptedRawRefIndexes = (block.attempted_raw_refs || []).map(references.intern);
      const { raw_refs: _rawRefs, attempted_raw_refs: _attemptedRawRefs, ...rest } = block;
      return [instrument, {
        ...rest,
        ...(rawRefIndexes.length ? { raw_ref_indexes: rawRefIndexes } : {}),
        ...(attemptedRawRefIndexes.length ? { attempted_raw_ref_indexes: attemptedRawRefIndexes } : {}),
      }];
    }));
    return [window, {
      ...snapshot,
      instruments,
      ...(snapshotRefIndexes.length ? { raw_ref_indexes: snapshotRefIndexes } : {}),
      raw_ref_dictionary: "#/raw_refs",
    }];
  }));
}

function createReferenceDictionary() {
  const values = [];
  const indexes = new Map();
  const objectIndexes = new WeakMap();
  return {
    values,
    intern(value) {
      if (value && typeof value === "object" && objectIndexes.has(value)) {
        return objectIndexes.get(value);
      }
      const key = stableJson(value);
      if (!indexes.has(key)) {
        indexes.set(key, values.length);
        values.push(value);
      }
      const index = indexes.get(key);
      if (value && typeof value === "object") objectIndexes.set(value, index);
      return index;
    },
  };
}

function compactPack(pack) {
  if (!pack) return null;
  const datasets = Object.entries(pack.datasets || {}).map(([name, ref]) => ({
    name,
    status: ref.status || null,
    format: ref.format || null,
    row_count: ref.row_count ?? null,
    min_timestamp_utc: ref.min_timestamp_utc || null,
    max_timestamp_utc: ref.max_timestamp_utc || null,
    sha256: ref.sha256 || null,
  }));
  return {
    pack_id: pack.pack_id || null,
    pack_build_id: pack.pack_build_id || null,
    date: pack.date || pack.trading_date || null,
    trading_date: pack.trading_date || pack.date || null,
    session: pack.session || null,
    status: pack.status || null,
    pack_purpose: pack.pack_purpose || pack.source_pack?.pack_purpose || "decision_cutoff",
    source_coverage: pack.source_coverage || pack.source_pack?.source_coverage || null,
    cutoff_paris: pack.cutoff_paris || pack.data_cutoff?.end_paris || null,
    cutoff_utc: pack.cutoff_utc || pack.data_cutoff?.end_utc || null,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
    data_quality: pack.data_quality || null,
    datasets,
  };
}

function filterSnapshots(snapshots, options) {
  const windows = options.snapshot_windows?.length ? new Set(options.snapshot_windows) : null;
  const instruments = options.instruments?.length ? new Set(options.instruments) : null;
  return Object.fromEntries(Object.entries(snapshots || {})
    .filter(([window]) => !windows || windows.has(window))
    .map(([window, snapshot]) => {
      const {
        raw_ref_dictionary: _rawRefDictionary,
        raw_ref_indexes: _rawRefIndexes,
        ...snapshotWithoutRawRefs
      } = snapshot;
      const visibleSnapshot = options.include_raw_refs ? snapshot : snapshotWithoutRawRefs;
      return [window, {
        ...visibleSnapshot,
        instruments: Object.fromEntries(Object.entries(snapshot.instruments || {})
          .filter(([instrument]) => !instruments || instruments.has(instrument))
          .map(([instrument, block]) => [instrument, options.include_raw_refs ? block : stripReferenceIndexes(block)])),
      }];
    }));
}

function stripReferenceIndexes(block) {
  const { raw_ref_indexes: _raw, attempted_raw_ref_indexes: _attempted, ...rest } = block;
  return rest;
}

function replaySectionSelection(sectionData, section, args = {}) {
  const component = String(args.component || "");
  const field = String(args.field || "");
  if (!component && !field) return { selected: false };
  if (section !== "replay_lineage") {
    throw new Error(`replay_section_component_unsupported:${section}`);
  }
  if (!REPLAY_LINEAGE_COMPONENTS.includes(component)) {
    throw new Error(`invalid_replay_lineage_component:${component || "missing"}`);
  }
  const componentValue = sectionData?.[component] ?? null;
  if (!field) {
    return {
      selected: true,
      component,
      field: null,
      component_value: componentValue,
      value: componentValue,
      data_path: [component],
    };
  }
  if (
    !componentValue
    || typeof componentValue !== "object"
    || Array.isArray(componentValue)
    || !Object.prototype.hasOwnProperty.call(componentValue, field)
  ) {
    throw new Error(`invalid_replay_lineage_field:${component}.${field || "missing"}`);
  }
  return {
    selected: true,
    component,
    field,
    component_value: componentValue,
    value: componentValue[field],
    data_path: [component, field],
  };
}

function paginateSelectedValue(value, rawOffset, rawLimit, dataPath) {
  const offset = Math.max(0, Number(rawOffset) || 0);
  const limit = Math.max(1, Math.min(Number(rawLimit) || 100, 500));
  const pagedValue = Array.isArray(value)
    ? value.slice(offset, offset + limit)
    : value;
  return {
    data: nestReplaySelection(dataPath, pagedValue),
    pagination: Array.isArray(value)
      ? {
          field: dataPath.join("."),
          path: dataPath,
          offset,
          limit,
          total: value.length,
          has_more: offset + limit < value.length,
        }
      : null,
  };
}

function nestReplaySelection(path, value) {
  return [...path].reverse().reduce(
    (child, field) => ({ [field]: child }),
    value,
  );
}

function replayLineageComponentManifest(sectionData, identity) {
  return Object.fromEntries(REPLAY_LINEAGE_COMPONENTS
    .filter((component) => Object.prototype.hasOwnProperty.call(sectionData || {}, component))
    .map((component) => {
      const value = sectionData[component];
      return [component, {
        bytes: jsonBytes(value),
        sha256: hashValue(value),
        value_type: replayJsonType(value),
        read: {
          tool: "get_replay_bundle_section",
          arguments: {
            ...identityRef(identity),
            section: "replay_lineage",
            component,
            include_raw_refs: false,
            max_response_bytes: MAX_RESPONSE_BUDGET_BYTES,
          },
        },
      }];
    }));
}

function replayLineageFieldManifest(componentValue, identity, component) {
  if (!componentValue || typeof componentValue !== "object" || Array.isArray(componentValue)) {
    return null;
  }
  return Object.fromEntries(Object.entries(componentValue).map(([field, value]) => [
    field,
    {
      bytes: jsonBytes(value),
      sha256: hashValue(value),
      value_type: replayJsonType(value),
      read: {
        tool: "get_replay_bundle_section",
        arguments: {
          ...identityRef(identity),
          section: "replay_lineage",
          component,
          field,
          include_raw_refs: false,
          max_response_bytes: MAX_RESPONSE_BUDGET_BYTES,
        },
      },
    },
  ]));
}

function replayJsonType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value === "object" ? "object" : typeof value;
}

function replaySectionBudgetRecommendation({ section, selection }) {
  if (section === "rolling_snapshots") {
    return "Call get_replay_snapshot with one window and a smaller instruments list.";
  }
  if (section === "replay_lineage" && !selection.component) {
    return "Read each component from component_manifest and reassemble replay_lineage after verifying every hash.";
  }
  if (section === "replay_lineage" && selection.component && !selection.field) {
    return Array.isArray(selection.component_value)
      ? "Retry this component with a smaller limit and consecutive offsets."
      : "Read each field from field_manifest and reassemble the component after verifying every hash.";
  }
  return Array.isArray(selection.value)
    ? "Retry this field with a smaller limit and consecutive offsets."
    : "This scalar field exceeds the maximum response budget and cannot be fragmented further.";
}

function paginateSection(value, rawOffset, rawLimit, section) {
  const offset = Math.max(0, Number(rawOffset) || 0);
  const limit = Math.max(1, Math.min(Number(rawLimit) || 100, 500));
  if (Array.isArray(value)) {
    return {
      data: value.slice(offset, offset + limit),
      pagination: { offset, limit, total: value.length, has_more: offset + limit < value.length },
    };
  }
  const collectionField = {
    macro_calendar: "events",
    news_digest: "items",
    replay_lineage: "replay_setups",
    replan_context: "previous_setups",
  }[section];
  if (collectionField && Array.isArray(value?.[collectionField])) {
    const collection = value[collectionField];
    return {
      data: { ...value, [collectionField]: collection.slice(offset, offset + limit) },
      pagination: { field: collectionField, offset, limit, total: collection.length, has_more: offset + limit < collection.length },
    };
  }
  return { data: value, pagination: null };
}

function normalizeReadOptions(args) {
  const requestedBudget = Number(args.max_response_bytes || process.env.DESK_MCP_REPLAY_RESPONSE_BUDGET_BYTES || DEFAULT_RESPONSE_BUDGET_BYTES);
  return {
    view: REPLAY_BUNDLE_VIEWS.includes(args.view) ? args.view : "compact",
    include_sections: normalizeArray(args.include_sections),
    exclude_sections: normalizeArray(args.exclude_sections),
    snapshot_windows: normalizeArray(args.snapshot_windows),
    instruments: normalizeArray(args.instruments),
    include_raw_refs: args.include_raw_refs === true,
    max_response_bytes: Math.max(MIN_RESPONSE_BUDGET_BYTES, Math.min(requestedBudget || DEFAULT_RESPONSE_BUDGET_BYTES, MAX_RESPONSE_BUDGET_BYTES)),
  };
}

function selectSections(options) {
  const selected = options.include_sections.length
    ? options.include_sections.filter((section) => REPLAY_BUNDLE_SECTIONS.includes(section))
    : options.view === "full" ? [...REPLAY_BUNDLE_SECTIONS] : [...DEFAULT_COMPACT_SECTIONS];
  const excluded = new Set(options.exclude_sections);
  const result = selected.filter((section) => !excluded.has(section));
  if (options.include_raw_refs && !excluded.has("raw_refs") && !result.includes("raw_refs")) result.push("raw_refs");
  return result;
}

function normalizeArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
}

function withTransportMetrics(response, source, canonical, options, budgetExceeded) {
  const base = {
    ...response,
    transport: {
      schema_version: REPLAY_TRANSPORT_SCHEMA_VERSION,
      source_bytes: jsonBytes(source),
      canonical_bytes: jsonBytes(canonical),
      response_bytes: 0,
      max_response_bytes: options.max_response_bytes,
      budget_exceeded: Boolean(budgetExceeded),
      double_serialization: false,
    },
  };
  base.transport.response_bytes = jsonBytes(base);
  base.transport.reduction_ratio = base.transport.source_bytes
    ? Number((base.transport.response_bytes / base.transport.source_bytes).toFixed(4))
    : null;
  base.transport.response_bytes = jsonBytes(base);
  return base;
}

function isCanonical(bundle) {
  return bundle?.schema_version === REPLAY_TRANSPORT_SCHEMA_VERSION && Boolean(bundle?.canonical_bundle_hash);
}

function hashValue(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  const chunks = [];
  appendStableJson(value, chunks);
  return chunks.join("");
}


function appendStableJson(value, chunks) {
  if (Array.isArray(value)) {
    chunks.push("[");
    for (let index = 0; index < value.length; index += 1) {
      if (index) chunks.push(",");
      appendStableJson(value[index], chunks);
    }
    chunks.push("]");
    return;
  }
  if (value && typeof value === "object") {
    chunks.push("{");
    const keys = Object.keys(value).sort();
    for (let index = 0; index < keys.length; index += 1) {
      if (index) chunks.push(",");
      const key = keys[index];
      chunks.push(JSON.stringify(key), ":");
      appendStableJson(value[key], chunks);
    }
    chunks.push("}");
    return;
  }
  chunks.push(JSON.stringify(value ?? null));
}
