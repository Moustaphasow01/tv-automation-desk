import { createHash } from "node:crypto";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { frontProjectionSchema } from "./schemas.js";

export const FRONT_PROJECTION_CONTRACT_NAME = "DeskFrontProjectionContract";
export const FRONT_PROJECTION_SCHEMA_VERSION = "1.0.0";

export function frontProjectionCurrentStateId(scope = {}) {
  const normalized = frontProjectionScope(scope);
  return [
    normalized.strategy_id,
    normalized.trading_date,
    normalized.session,
    normalized.mode,
    normalized.run_id,
  ].map(safeIdPart).join("__");
}

export function frontProjectionScope(input = {}) {
  return {
    strategy_id: stringValue(input.strategy_id, input.strategyId),
    session: stringValue(input.session),
    mode: stringValue(input.mode),
    trading_date: stringValue(input.trading_date, input.tradingDate, input.date),
    run_id: stringValue(input.run_id, input.runId),
  };
}

export function frontProjectionMatchesScope(document, scope) {
  const actual = frontProjectionScope(document?.projection?.source || document);
  const expected = frontProjectionScope(scope);
  return Object.keys(expected).every((field) => actual[field] === expected[field]);
}

export function prepareFrontProjectionMaterialization({
  canonical,
  sourceType,
  sourceId,
  tick,
  existingCurrent = null,
}) {
  const projectionInput = canonical?.front_projection;
  if (projectionInput === undefined || projectionInput === null) {
    return {
      status: "not_provided",
      writes: [],
      currentStatePrecondition: null,
      result: { status: "not_provided" },
    };
  }

  const parsed = frontProjectionSchema.safeParse(projectionInput);
  if (!parsed.success) {
    return rejectedPlan({
      canonical,
      sourceType,
      sourceId,
      tick,
      code: "FRONT_PROJECTION_SCHEMA_INVALID",
      message: "front_projection does not satisfy DeskFrontProjectionContract v1.0.0",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      projectionInput,
    });
  }

  const projection = parsed.data;
  const mismatches = sourceMismatches({ canonical, sourceType, sourceId, projection });
  if (mismatches.length) {
    return rejectedPlan({
      canonical,
      sourceType,
      sourceId,
      tick,
      code: "FRONT_PROJECTION_SOURCE_SCOPE_MISMATCH",
      message: "front_projection does not match its canonical source and operational scope",
      issues: mismatches,
      projectionInput: projection,
    });
  }

  const stateId = frontProjectionCurrentStateId(projection.source);
  const projectionHash = hashJson(projection);
  const orderingIssue = projectionOrderingIssue(existingCurrent, projection, projectionHash);
  if (orderingIssue?.idempotent) {
    return {
      status: "idempotent",
      writes: [],
      currentStatePrecondition: null,
      result: {
        status: "idempotent",
        current_state_id: stateId,
        revision: projection.source.revision,
        sequence: projection.source.sequence,
        projection_hash: projectionHash,
      },
    };
  }
  if (orderingIssue) {
    return rejectedPlan({
      canonical,
      sourceType,
      sourceId,
      tick,
      code: orderingIssue.code,
      message: orderingIssue.message,
      issues: orderingIssue.issues,
      projectionInput: projection,
    });
  }

  const source = projection.source;
  const snapshotId = `${stateId}__r${source.revision}__s${source.sequence}__${safeIdPart(source.sourceId)}`;
  const eventId = `front_event__${snapshotId}`;
  const common = {
    contract_name: FRONT_PROJECTION_CONTRACT_NAME,
    schema_version: FRONT_PROJECTION_SCHEMA_VERSION,
    strategy_id: source.strategyId,
    session: source.session,
    mode: source.mode,
    trading_date: source.tradingDate,
    run_id: source.runId,
    source_type: source.sourceType,
    source_id: source.sourceId,
    master_id: source.masterId,
    monitor_id: source.monitorId,
    thesis_id: source.thesisId,
    sequence: source.sequence,
    revision: source.revision,
    projection_hash: projectionHash,
    timestamp_paris: source.timestampParis,
    as_of_utc: source.asOfUtc,
  };
  const current = {
    current_state_id: stateId,
    ...common,
    previous_revision: existingCurrent?.revision ?? null,
    previous_source_id: existingCurrent?.source_id ?? null,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    projection,
  };
  const snapshot = {
    snapshot_id: snapshotId,
    current_state_id: stateId,
    ...common,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    projection,
  };
  const event = {
    event_id: eventId,
    current_state_id: stateId,
    snapshot_id: snapshotId,
    ...common,
    previous_revision: existingCurrent?.revision ?? null,
    previous_source_id: existingCurrent?.source_id ?? null,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    event: projection.timelineEvent,
  };

  return {
    status: "materialized",
    currentStatePrecondition: {
      collection: DESK_COLLECTIONS.deskFrontCurrentStates,
      documentId: stateId,
      expectedRevision: existingCurrent?.revision ?? null,
      expectedProjectionHash: existingCurrent?.projection_hash ?? null,
    },
    writes: [
      { collection: DESK_COLLECTIONS.deskFrontCurrentStates, documentId: stateId, data: current },
      { collection: DESK_COLLECTIONS.deskFrontSnapshots, documentId: snapshotId, data: snapshot },
      { collection: DESK_COLLECTIONS.deskFrontEvents, documentId: eventId, data: event },
    ],
    result: {
      status: "materialized",
      current_state_id: stateId,
      snapshot_id: snapshotId,
      event_id: eventId,
      revision: source.revision,
      sequence: source.sequence,
      projection_hash: projectionHash,
    },
  };
}

function sourceMismatches({ canonical, sourceType, sourceId, projection }) {
  const source = projection.source;
  const expected = {
    sourceType,
    sourceId,
    masterId: sourceType === "MASTER"
      ? sourceId
      : stringValue(canonical.linked_master_analysis_id, canonical.master_id, canonical.analysis_id),
    monitorId: sourceType === "MONITOR" ? sourceId : null,
    thesisId: sourceType === "MASTER"
      ? stringValue(canonical.active_thesis_id)
      : stringValue(canonical.linked_active_thesis_id, canonical.thesis_id),
    strategyId: stringValue(canonical.strategy_id),
    session: stringValue(canonical.session),
    mode: stringValue(canonical.mode),
    tradingDate: stringValue(canonical.trading_date, canonical.date),
    runId: stringValue(canonical.run_id),
    timestampParis: sourceType === "MASTER"
      ? stringValue(canonical.created_at_paris)
      : stringValue(canonical.timestamp_paris),
    asOfUtc: stringValue(canonical.as_of_utc),
  };
  const issues = [];
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (source[field] !== expectedValue) {
      issues.push({ path: `source.${field}`, expected: expectedValue || null, actual: source[field] ?? null });
    }
  }
  return issues;
}

function projectionOrderingIssue(current, projection, projectionHash) {
  if (!current) return null;
  const source = projection.source;
  const currentRevision = Number(current.revision);
  const currentSequence = Number(current.sequence);
  if (source.revision === currentRevision) {
    if (source.sourceId === current.source_id && projectionHash === current.projection_hash) {
      return { idempotent: true };
    }
    return {
      code: "FRONT_PROJECTION_REVISION_CONFLICT",
      message: "The current front projection already uses this revision with different content or source.",
      issues: [{ path: "source.revision", expected: `>${currentRevision} or identical retry`, actual: source.revision }],
    };
  }
  if (source.revision < currentRevision) {
    return {
      code: "FRONT_PROJECTION_STALE_REVISION",
      message: "The front projection revision is older than the materialized current state.",
      issues: [{ path: "source.revision", expected: `>${currentRevision}`, actual: source.revision }],
    };
  }
  if (source.sequence < currentSequence || (source.sourceId !== current.source_id && source.sequence <= currentSequence)) {
    return {
      code: "FRONT_PROJECTION_STALE_SEQUENCE",
      message: "A new canonical source must advance the front projection sequence.",
      issues: [{ path: "source.sequence", expected: `>${currentSequence}`, actual: source.sequence }],
    };
  }
  return null;
}

function rejectedPlan({ canonical, sourceType, sourceId, tick, code, message, issues, projectionInput }) {
  const errorHash = hashJson({ code, sourceType, sourceId, projectionInput });
  const errorId = `front_projection_error__${safeIdPart(sourceId)}__${errorHash.slice(0, 20)}`;
  const error = {
    error_id: errorId,
    error_code: code,
    error_message: message,
    contract_name: projectionInput?.contractName || null,
    schema_version: projectionInput?.schemaVersion || null,
    source_type: sourceType,
    source_id: sourceId,
    strategy_id: canonical?.strategy_id || null,
    session: canonical?.session || null,
    mode: canonical?.mode || null,
    trading_date: canonical?.trading_date || canonical?.date || null,
    run_id: canonical?.run_id || null,
    projection_hash: hashJson(projectionInput),
    issues,
    status: "rejected",
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  return {
    status: "rejected",
    currentStatePrecondition: null,
    writes: [{
      collection: DESK_COLLECTIONS.deskFrontProjectionErrors,
      documentId: errorId,
      data: error,
    }],
    result: { status: "rejected", error_id: errorId, error_code: code, issues },
  };
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  return value;
}

function safeIdPart(value) {
  return String(value || "missing")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100) || "missing";
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
