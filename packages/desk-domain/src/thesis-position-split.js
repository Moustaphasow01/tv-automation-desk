import { resultFromIssues } from "./result.js";

export const POSITION_THESIS_STATUSES = Object.freeze(["POSITION_ACTIVE", "POSITION_PROTECTED"]);

const POSITION_STATUS_SET = new Set(POSITION_THESIS_STATUSES);

export function isPositionThesisStatus(status) {
  return POSITION_STATUS_SET.has(String(status || "").trim().toUpperCase());
}

export function planThesisSetupPositionSplit(thesis = {}, options = {}) {
  const legacyStatus = String(thesis.status || "").trim().toUpperCase();
  const migrationRequired = isPositionThesisStatus(legacyStatus);
  const tick = options.tick || {};
  const splitAtUtc = options.split_at_utc || tick.utc || thesis.updated_at_utc || thesis.created_at_utc || null;
  const splitAtParis = options.split_at_paris || tick.paris || thesis.updated_at_paris || thesis.created_at_paris || null;
  const thesisId = thesis.thesis_id || thesis.linked_thesis_id || null;
  const setupId = thesis.linked_setup_id || thesis.setup_id || thesis.triggered_setup?.setup_record_id || thesis.triggered_setup?.setup_id || null;
  const positionId = options.position_id || thesis.position_id || deterministicSplitId("position", [
    thesisId || thesis.linked_master_analysis_id || "thesis",
    setupId || thesis.instrument || "instrument",
  ]);
  const nextThesisStatus = options.next_thesis_status || "SETUP_TRIGGERED";
  const positionStatus = legacyStatus === "POSITION_PROTECTED" ? "protected" : "active";
  const evidence = {
    migration_required: migrationRequired,
    legacy_status: legacyStatus || null,
    thesis_id: thesisId,
    setup_id: setupId,
    position_id: positionId,
    target_collections: ["desk_active_theses", "desk_setups", "desk_positions"],
  };

  if (!migrationRequired) {
    return {
      ...resultFromIssues({ evidence }),
      migration_required: false,
      thesis_patch: null,
      position_record: null,
    };
  }

  const thesisPatch = {
    thesis_id: thesisId,
    status: nextThesisStatus,
    linked_position_id: positionId,
    linked_setup_id: setupId,
    legacy_position_status: legacyStatus,
    split_storage_version: "thesis_setup_position_split_v1",
    updated_at_utc: splitAtUtc,
    updated_at_paris: splitAtParis,
  };
  const positionRecord = {
    position_id: positionId,
    linked_thesis_id: thesisId,
    linked_setup_id: setupId,
    linked_decision_id: thesis.linked_decision_id || thesis.decision_id || thesis.decision_audit?.decision_id || null,
    instrument: thesis.instrument || null,
    direction: thesis.direction === "wait" || thesis.direction === "neutral" ? null : thesis.direction || null,
    status: positionStatus,
    source_collection: "desk_active_theses",
    source_status: legacyStatus,
    split_storage_version: "thesis_setup_position_split_v1",
    entry_price: thesis.entry_price ?? thesis.triggered_setup?.entry_price ?? thesis.triggered_setup?.entry ?? null,
    stop_loss: thesis.stop_loss ?? thesis.triggered_setup?.stop_loss ?? null,
    take_profits: thesis.take_profits || thesis.triggered_setup?.take_profits || [],
    risk_pct: thesis.risk_pct ?? thesis.triggered_setup?.risk_pct ?? null,
    created_at_utc: thesis.created_at_utc || splitAtUtc,
    created_at_paris: thesis.created_at_paris || splitAtParis,
    updated_at_utc: splitAtUtc,
    updated_at_paris: splitAtParis,
  };

  return {
    ...resultFromIssues({ evidence: { ...evidence, next_thesis_status: nextThesisStatus, position_status: positionStatus } }),
    migration_required: true,
    thesis_patch: thesisPatch,
    position_record: positionRecord,
  };
}

function deterministicSplitId(prefix, parts = []) {
  const cleaned = parts.map((part) => String(part || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
    || "item");
  return [prefix, ...cleaned].join("_");
}
