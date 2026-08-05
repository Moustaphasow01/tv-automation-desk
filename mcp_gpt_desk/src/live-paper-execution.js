import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  PREDICATE_EVENT_ROWS_INSTRUMENT_V1,
  setupConditionInstrumentsV1,
} from "@tv-automation/desk-domain";
import { sanitizeMacroActualsAtCutoff } from "./pack-integrity.js";
import { stableVNextId } from "./desk-ids.js";
import {
  buildReplaySetupMutationDocsFromMonitor,
  evaluateReplaySetupOnRows,
  normalizeReplayTriggerScore,
  projectReplaySetupLifecycleAt,
  selectActiveReplaySetups,
} from "./replay-continuity.js";
import {
  buildPositionFromTriggeredSetup,
  evaluatePositionOnRows,
  selectOpenPosition,
} from "./position-continuity-engine.js";
import { dailyCursorId } from "./daily-run-model.js";
import { deriveCanonicalTimeframeFromClosedM1 } from "./canonical-market-resampler.js";

const C = DESK_COLLECTIONS;
const LIVE_CURSOR_COLLECTION = "desk_live_run_cursor";

export function buildLiveSetupMutationDocsFromMonitor({ monitor, existingSetups = [], tick }) {
  const run = liveRunShape(monitor);
  const step = {
    step_id: monitor.monitor_id,
    timestamp_paris: monitor.timestamp_paris,
  };
  const mutation = buildReplaySetupMutationDocsFromMonitor({
    monitor,
    run,
    step,
    existingSetups,
    tick,
    makeSetupId: (value) => stableVNextId("live_setup", monitor.run_id, value),
  });
  const toLive = (setups) => setups.map((setup) => toLiveSetup(setup, monitor));
  const materializedSetups = toLive(mutation.materializedSetups);
  const replacedSetups = toLive(mutation.replacedSetups);
  return {
    materializedSetups,
    replacedSetups,
    allSetups: [...replacedSetups, ...materializedSetups],
  };
}

export function buildLiveSetupDocsFromMonitor(args) {
  return buildLiveSetupMutationDocsFromMonitor(args).materializedSetups;
}

export async function reconcileLivePaperExecution({ persistence, args, tick }) {
  if (!persistence || typeof persistence.queryMarketCandles !== "function") {
    return { ok: true, status: "SKIPPED", reason: "MARKET_CANDLE_QUERY_UNAVAILABLE" };
  }
  const cursorId = dailyCursorId(args.trading_date);
  const cursor = await persistence.getDocument(LIVE_CURSOR_COLLECTION, cursorId).catch(() => null);
  const fromParis = cursor?.last_completed_checkpoint
    || cursor?.window?.master_cutoff_paris
    || args.cutoff_paris
    || args.timestamp_paris;
  const toParis = args.timestamp_paris || args.as_of_utc;
  if (!fromParis || !toParis || Date.parse(toParis) <= Date.parse(fromParis)) {
    return {
      ok: true,
      status: "NO_INTERVAL",
      cursor_id: cursorId,
      from_paris: fromParis || null,
      to_paris: toParis || null,
    };
  }

  const [allSetups, allPositions, allTheses] = await Promise.all([
    queryScopedLiveDocuments(persistence, C.deskSetups, args, 2_000),
    queryScopedLiveDocuments(persistence, C.deskPositions, args, 2_000),
    queryScopedLiveDocuments(persistence, C.deskActiveTheses, args, 500),
  ]);
  const setups = allSetups.filter((item) => liveDocumentMatchesScope(item, args));
  const positions = allPositions.filter((item) => liveDocumentMatchesScope(item, args));
  const theses = allTheses.filter((item) => liveDocumentMatchesScope(item, args));
  const openPosition = selectOpenPosition(positions.filter(isPaperShadowPosition));
  const writes = [];
  const events = [];
  const rowsCache = new Map();
  const portfolioArbitration = {
    policy: "RANK_THEN_PRIORITY_FIRST_ELIGIBLE",
    max_setups: 5,
    max_simultaneous_positions: 1,
    global_risk_budget_pct: 0.25,
    evaluated_setup_ids: [],
    winner_setup_id: null,
    deferred_setup_ids: [],
  };
  const intervalTick = {
    ...tick,
    paris: toParis,
    utc: new Date(toParis).toISOString(),
    epochMs: Date.parse(toParis),
  };
  const normalizedSetups = setups.map((setup) => normalizeLiveSetupForExecution(
    inheritLiveSetupThesisValidity(setup, theses),
  ));
  const lifecycleSetups = normalizedSetups.map((setup) => projectReplaySetupLifecycleAt(
    setup,
    {
      asOfParis: toParis,
      asOfUtc: intervalTick.utc,
    },
  ));
  for (let index = 0; index < lifecycleSetups.length; index += 1) {
    const source = normalizedSetups[index];
    const projected = lifecycleSetups[index];
    const sourceStatus = String(
      source.status || source.lifecycle_status || source.setup_status || "",
    ).toUpperCase();
    const projectedStatus = String(
      projected.status || projected.lifecycle_status || projected.setup_status || "",
    ).toUpperCase();
    if (sourceStatus === projectedStatus) continue;
    const liveProjected = toLiveSetup(projected, args);
    writes.push({
      collection: C.deskSetups,
      documentId: liveProjected.setup_record_id,
      data: liveProjected,
      merge: true,
    });
    events.push(lifecycleEvent(args, intervalTick, "PAPER_SETUP_EXPIRED", {
      setup_record_id: liveProjected.setup_record_id,
      previous_status: sourceStatus || null,
      next_status: projectedStatus,
      expires_at_paris: liveProjected.expires_at_paris || null,
    }));
  }
  for (let index = 0; index < setups.length; index += 1) {
    const source = setups[index];
    const normalized = normalizedSetups[index];
    if (normalized.lifecycle_integrity_status !== "INVALID_RETROACTIVE_LIFECYCLE") continue;
    const sourceStatus = String(source.status || source.lifecycle_status || source.setup_status || "").toUpperCase();
    if (sourceStatus === "EXPIRED"
      && source.lifecycle_status === "EXPIRED"
      && source.setup_status === "EXPIRED"
      && source.backend_can_trigger === false) continue;
    const repaired = {
      ...normalized,
      status: "EXPIRED",
      lifecycle_status: "EXPIRED",
      setup_status: "EXPIRED",
      backend_can_trigger: false,
      activation_eligible: false,
      activation_rejected: true,
      activation_rejected_reason: normalized.lifecycle_integrity?.reason || "INVALID_RETROACTIVE_LIFECYCLE",
      historical_triggered_at_paris: source.triggered_at_paris || source.triggered_at_utc || source.triggered_at || null,
      triggered_at_paris: null,
      triggered_at_utc: null,
      lifecycle_integrity_status: "SAFE_TERMINAL_REPAIR",
      lifecycle_integrity: {
        valid: true,
        safe_terminal: true,
        historical_violation_repaired: true,
        activation_rejected_reason: normalized.lifecycle_integrity?.reason || "INVALID_RETROACTIVE_LIFECYCLE",
        effective_valid_from_paris: normalized.valid_from_paris || null,
        materialized_at_paris: normalized.materialized_at_paris || null,
        expires_at_paris: normalized.expires_at_paris || null,
        historical_triggered_at_paris: source.triggered_at_paris || source.triggered_at_utc || source.triggered_at || null,
      },
      updated_at: tick.utc,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
      lifecycle_repaired_at_utc: tick.utc,
      lifecycle_repaired_at_paris: tick.paris,
    };
    writes.push({ collection: C.deskSetups, documentId: repaired.setup_record_id, data: repaired, merge: true });
    events.push(lifecycleEvent(args, intervalTick, "PAPER_SETUP_RETROACTIVE_TRIGGER_REJECTED", {
      setup_record_id: repaired.setup_record_id,
      previous_status: sourceStatus || null,
      valid_from_paris: repaired.valid_from_paris,
      expires_at_paris: repaired.expires_at_paris,
      triggered_at_paris: source.triggered_at_paris || null,
    }));
  }

  if (openPosition) {
    const positionEvaluationFrom = laterInstant(
      fromParis,
      openPosition.opened_at_paris || openPosition.opened_at_utc,
    );
    const rows = await loadInstrumentRows(
      persistence,
      openPosition.instrument,
      positionEvaluationFrom,
      toParis,
      rowsCache,
      "M1",
    );
    const outcome = evaluatePositionOnRows(openPosition, rows, { tick: intervalTick });
    if (outcome.changed || outcome.updated) {
      const position = toLivePaperPosition(outcome.position, args);
      writes.push({ collection: C.deskPositions, documentId: position.position_id, data: position, merge: true });
      events.push(lifecycleEvent(args, intervalTick, isTerminalPaperPosition(position)
        ? "PAPER_POSITION_CLOSED"
        : "PAPER_POSITION_MANAGEMENT_UPDATED", {
        position_id: position.position_id,
        reason: outcome.reason,
        exit_price: position.exit_price ?? null,
      }));
    }
  } else {
    for (const setup of selectActiveReplaySetups(lifecycleSetups, {
      asOfParis: toParis,
      asOfUtc: intervalTick.utc,
    })) {
      portfolioArbitration.evaluated_setup_ids.push(setup.setup_id || setup.setup_record_id);
      const evaluationFrom = laterInstant(fromParis, setup.valid_from_paris || setup.created_at_paris);
      const dataSpecs = setupConditionDataSpecs(setup);
      const rowsByInstrument = {};
      for (const { instrument, timeframe } of dataSpecs) {
        const rows = await loadInstrumentRows(
          persistence,
          instrument,
          evaluationFrom,
          toParis,
          rowsCache,
          timeframe,
        );
        rowsByInstrument[instrument] = [
          ...(rowsByInstrument[instrument] || []),
          ...rows,
        ].sort((left, right) => Date.parse(left.timestamp_utc || left.timestamp_paris || "")
          - Date.parse(right.timestamp_utc || right.timestamp_paris || ""));
      }
      const primaryRows = (rowsByInstrument[canonicalInstrument(setup.instrument)] || [])
        .filter((row) => normalizeExecutionTimeframe(row.execution_timeframe || row.timeframe) === "M1");
      const outcome = evaluateReplaySetupOnRows(setup, primaryRows, {
        tick: intervalTick,
        rowsByInstrument,
      });
      const evaluatedSetup = toLiveSetup(outcome.setup, {
        ...args,
        monitor_id: setup.monitor_id,
        linked_master_analysis_id: setup.linked_master_analysis_id || setup.master_id,
        linked_active_thesis_id: setup.linked_active_thesis_id || setup.thesis_id,
      });
      writes.push({
        collection: C.deskSetups,
        documentId: evaluatedSetup.setup_record_id,
        data: evaluatedSetup,
        merge: true,
      });
      const sourceStatus = String(
        setup.status || setup.lifecycle_status || setup.setup_status || "",
      ).toUpperCase();
      const evaluatedStatus = String(
        evaluatedSetup.status
          || evaluatedSetup.lifecycle_status
          || evaluatedSetup.setup_status
          || "",
      ).toUpperCase();
      if (evaluatedStatus && evaluatedStatus !== sourceStatus
        && ["INVALIDATED", "EXPIRED"].includes(evaluatedStatus)) {
        events.push(lifecycleEvent(
          args,
          intervalTick,
          evaluatedStatus === "INVALIDATED"
            ? "PAPER_SETUP_INVALIDATED"
            : "PAPER_SETUP_EXPIRED",
          {
            setup_record_id: evaluatedSetup.setup_record_id,
            previous_status: sourceStatus || null,
            next_status: evaluatedStatus,
          },
        ));
      }
      if (!outcome.triggered) continue;
      portfolioArbitration.winner_setup_id = evaluatedSetup.setup_id || evaluatedSetup.setup_record_id;

      const replayPosition = buildPositionFromTriggeredSetup({
        setup: evaluatedSetup,
        run: liveRunShape(args),
        step: { step_id: args.monitor_id || `live_interval_${toParis}`, timestamp_paris: toParis },
        monitor: null,
        trigger: outcome,
        tick: intervalTick,
        makePositionId: (value) => stableVNextId("live_paper_position", args.run_id, value),
      });
      const positionScope = {
        ...args,
        linked_master_analysis_id: evaluatedSetup.linked_master_analysis_id,
        linked_active_thesis_id: evaluatedSetup.linked_active_thesis_id,
      };
      let position = toLivePaperPosition(replayPosition, positionScope);
      const triggerMs = Date.parse(outcome.trigger_row?.timestamp_utc || outcome.trigger_row?.timestamp_paris || "");
      const postTriggerRows = primaryRows.filter((row) => {
        const rowMs = Date.parse(row.timestamp_utc || row.timestamp_paris || "");
        return !Number.isFinite(triggerMs) || (Number.isFinite(rowMs) && rowMs > triggerMs);
      });
      const positionOutcome = evaluatePositionOnRows(position, postTriggerRows, { tick: intervalTick });
      if (positionOutcome.changed || positionOutcome.updated) {
        position = toLivePaperPosition(positionOutcome.position, positionScope);
      }
      writes.push({ collection: C.deskPositions, documentId: position.position_id, data: position, merge: true });
      events.push(lifecycleEvent(args, intervalTick, "PAPER_SETUP_TRIGGERED", {
        setup_record_id: evaluatedSetup.setup_record_id,
        position_id: position.position_id,
        trigger_price: outcome.trigger_price ?? null,
        position_status: position.status,
        execution_timeframe: primaryRows.execution_timeframe || null,
        execution_timeframe_fallback: primaryRows.execution_timeframe_fallback === true,
      }));
      break;
    }
    portfolioArbitration.deferred_setup_ids = selectActiveReplaySetups(lifecycleSetups, {
      asOfParis: toParis,
      asOfUtc: intervalTick.utc,
    })
      .map((setup) => setup.setup_id || setup.setup_record_id)
      .filter((setupId) => (
        setupId
        && setupId !== portfolioArbitration.winner_setup_id
        && !portfolioArbitration.evaluated_setup_ids.includes(setupId)
      ));
  }

  if (writes.length) await persistWrites(persistence, writes);
  if (events.length) {
    await persistWrites(persistence, events.map((event) => ({
      collection: C.deskDecisionJournal,
      documentId: event.event_id,
      data: event,
      merge: true,
    })));
  }
  return {
    ok: true,
    status: writes.length ? "UPDATED" : "UNCHANGED",
    execution_mode: "paper",
    broker_execution: false,
    cursor_id: cursorId,
    from_paris: fromParis,
    to_paris: toParis,
    setup_count: setups.length,
    thesis_count: theses.length,
    position_count: positions.length,
    portfolio_arbitration: portfolioArbitration,
    write_count: writes.length,
    execution_data_sources: [...rowsCache.entries()].map(([key, rows]) => ({
      key,
      timeframe: rows.execution_timeframe || null,
      fallback: rows.execution_timeframe_fallback === true,
      feed_ids: rows.execution_feed_ids || [],
      data_status: rows.execution_data_status || null,
      row_count: rows.length,
    })),
    events,
  };
}

function isPaperShadowPosition(position = {}) {
  if (position.broker_execution === true) return false;
  return !["BROKER", "LIVE_BROKER", "NINJATRADER", "NINJA_ADDON"]
    .includes(String(position.execution_mode || position.authority || "").toUpperCase());
}

function isTerminalPaperPosition(position = {}) {
  return ["CLOSED", "STOPPED", "CANCELLED", "CANCELED", "EXPIRED", "REVIEW_REQUIRED"]
    .includes(String(position.status || "").toUpperCase());
}

export async function materializeTriggeredLiveMonitor({ persistence, monitor, setups = [], tick }) {
  const decision = monitor?.monitor_decision || {};
  const action = String(decision.action || decision.decision || "").trim().toUpperCase();
  const explicitTrigger = decision.take_trade === true
    && decision.executable !== false
    && !["WAIT", "DO_NOT_TAKE", "NE_PAS_PRENDRE", "NO_ACTION"].includes(action);
  if (!explicitTrigger) {
    return { ok: true, status: "SKIPPED", reason: "MONITOR_DID_NOT_AUTHORIZE_ENTRY" };
  }
  return {
    ok: true,
    status: "DEFERRED_TO_DETERMINISTIC_ENGINE",
    reason: "GPT_MONITOR_CANNOT_CREATE_POSITION",
    requested_action: action || null,
    monitor_id: monitor.monitor_id || null,
    setup_count: setups.length,
    broker_execution: false,
  };
}

function toLiveSetup(source, scope) {
  const {
    backtest_id: _backtestId,
    replay_run_id: _replayRunId,
    step_id: _stepId,
    ...setup
  } = source;
  return {
    ...setup,
    strategy_id: scope.strategy_id || setup.strategy_id,
    trading_date: scope.trading_date || scope.date || setup.trading_date,
    session: scope.session || setup.session,
    run_id: scope.run_id || setup.run_id,
    mode: scope.mode || setup.mode || "live",
    pack_id: scope.pack_id || setup.pack_id || null,
    pack_build_id: scope.pack_build_id || setup.pack_build_id || null,
    monitor_id: scope.monitor_id || setup.monitor_id || null,
    linked_master_analysis_id: scope.linked_master_analysis_id || scope.master_id || setup.linked_master_analysis_id || setup.master_id || null,
    linked_active_thesis_id: scope.linked_active_thesis_id || scope.thesis_id || setup.linked_active_thesis_id || setup.thesis_id || null,
    analysis_id: scope.linked_master_analysis_id || scope.master_id || setup.analysis_id || setup.master_id || null,
    source_collection: C.deskSetups,
    source_monitor_collection: C.deskManualMonitors,
    paper_execution_enabled: true,
    broker_execution: false,
  };
}

function toLivePaperPosition(source, scope) {
  const {
    backtest_id: _backtestId,
    replay_run_id: _replayRunId,
    step_id: _stepId,
    ...position
  } = source;
  return {
    ...position,
    strategy_id: scope.strategy_id || position.strategy_id,
    trading_date: scope.trading_date || scope.date || position.trading_date,
    session: scope.session || position.session,
    run_id: scope.run_id || position.run_id,
    mode: scope.mode || position.mode || "live",
    execution_mode: "paper",
    paper_simulated: true,
    broker_execution: false,
    linked_master_analysis_id: scope.linked_master_analysis_id || scope.master_id || position.linked_master_analysis_id || null,
    linked_active_thesis_id: scope.linked_active_thesis_id || scope.thesis_id || position.linked_active_thesis_id || null,
    source: "live_closed_candle_shadow",
  };
}

function liveRunShape(scope) {
  return {
    backtest_id: scope.run_id,
    replay_run_id: scope.run_id,
    strategy_id: scope.strategy_id || null,
    trading_date: scope.trading_date || scope.date || null,
    date: scope.trading_date || scope.date || null,
    session: scope.session || null,
    resolved_scope: scope.resolved_scope || null,
    scope_hash: scope.scope_hash || null,
    pack_id: scope.pack_id || null,
    pack_build_id: scope.pack_build_id || null,
    source_manifest_hash: scope.source_manifest_hash || null,
  };
}

function liveDocumentMatchesScope(document, args) {
  return (document.trading_date || document.date) === args.trading_date
    && (document.run_id || document.replay_run_id) === args.run_id
    && String(document.mode || "live") === String(args.mode || "live");
}

async function queryScopedLiveDocuments(persistence, collection, args, limit) {
  if (typeof persistence.queryCollectionDocuments === "function" && args?.run_id) {
    return persistence.queryCollectionDocuments({
      collection,
      filters: [{ field: "run_id", operator: "==", value: args.run_id }],
      orderBy: [{ field: "updated_at_utc", direction: "desc" }],
      limit,
    }).catch(() => persistence.listDocuments(collection, limit).catch(() => []));
  }
  return persistence.listDocuments(collection, limit).catch(() => []);
}

function hasExecutableSetupGeometry(setup = {}) {
  const direction = String(setup.direction || "").toLowerCase();
  return Boolean(setup.setup_record_id)
    && ["long", "short"].includes(direction)
    && firstFinite(setup.stop_loss, setup.stop) !== null
    && setupTakeProfit(setup) !== null
    && setupEntryPrice(setup) !== null;
}

function setupEntryPrice(setup = {}) {
  const direct = firstFinite(setup.entry_price, setup.entry, setup.trigger_price);
  if (direct !== null) return direct;
  const zone = setup.entry_zone;
  const low = Array.isArray(zone)
    ? firstFinite(zone[0])
    : firstFinite(zone?.lower, zone?.low, zone?.from, zone?.min);
  const high = Array.isArray(zone)
    ? firstFinite(zone[1])
    : firstFinite(zone?.upper, zone?.high, zone?.to, zone?.max);
  if (low === null || high === null) return null;
  return String(setup.direction || "").toLowerCase() === "short"
    ? Math.min(low, high)
    : Math.max(low, high);
}

function setupTakeProfit(setup = {}) {
  const direct = firstFinite(setup.take_profit_1, setup.tp1, setup.target_1, setup.take_profit);
  if (direct !== null) return direct;
  const targets = setup.targets || setup.take_profits;
  const first = Array.isArray(targets) ? targets[0] : targets;
  return firstFinite(first?.price, first?.level, first?.target, first);
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function boundedMonitorTriggerAgeMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20 * 60 * 1000;
  return Math.max(5 * 60 * 1000, Math.min(parsed, 60 * 60 * 1000));
}

function normalizeLiveSetupForExecution(setup = {}) {
  const rawStatus = String(setup.status || setup.lifecycle_status || setup.setup_status || "").toUpperCase();
  const conditional = [
    "CONDITIONAL",
    "THESIS_CONDITIONAL",
    "SETUP_ARMED",
    "ARMED",
    "EXECUTABLE",
    "READY",
    "ACTIVE",
  ].includes(rawStatus);
  const sourceConditions = setup.conditions
    || setup.trigger_conditions
    || setup.execution_conditions
    || setup.trigger
    || setup.trigger_policy?.conditions
    || [];
  const conditions = normalizeLiveTriggerConditions(sourceConditions, setup);
  const geometryReady = hasExecutableSetupGeometry(setup);
  const requestedStatus = conditional && geometryReady ? "ARMED_CONDITIONAL" : rawStatus;
  const materializedAtParis = firstValidInstant(
    setup.materialized_at_paris,
    setup.saved_at_paris,
    setup.created_at_paris,
  );
  const validFromParis = laterInstant(
    setup.valid_from_paris || setup.valid_from,
    materializedAtParis,
  );
  const expiresAtParis = liveSetupExpiryParis(setup);
  const triggeredAtParis = firstValidInstant(
    setup.triggered_at_paris,
    setup.triggered_at_utc,
    setup.triggered_at,
  );
  const expiredBeforeActivation = Boolean(
    validFromParis
    && expiresAtParis
    && Date.parse(expiresAtParis) <= Date.parse(validFromParis),
  );
  const triggeredAfterExpiry = Boolean(
    triggeredAtParis
    && expiresAtParis
    && Date.parse(triggeredAtParis) > Date.parse(expiresAtParis),
  );
  const invalidRetroactiveLifecycle = expiredBeforeActivation || triggeredAfterExpiry;
  const status = invalidRetroactiveLifecycle ? "EXPIRED" : requestedStatus;
  const backendCanTrigger = !invalidRetroactiveLifecycle
    && status === "ARMED_CONDITIONAL"
    && geometryReady
    && conditions.length > 0
    && setup.backend_can_trigger !== false;
  return {
    ...setup,
    status,
    lifecycle_status: status,
    setup_status: status,
    conditions,
    valid_from_paris: validFromParis || null,
    expires_at_paris: expiresAtParis || null,
    materialized_at_paris: materializedAtParis || null,
    backend_can_trigger: backendCanTrigger,
    execution_geometry_ready: geometryReady,
    lifecycle_integrity_status: invalidRetroactiveLifecycle ? "INVALID_RETROACTIVE_LIFECYCLE" : "VALID",
    lifecycle_integrity: {
      valid: !invalidRetroactiveLifecycle,
      reason: expiredBeforeActivation
        ? "SETUP_EXPIRED_BEFORE_LIVE_ACTIVATION"
        : triggeredAfterExpiry
          ? "SETUP_TRIGGERED_AFTER_EXPIRY"
          : null,
      effective_valid_from_paris: validFromParis || null,
      materialized_at_paris: materializedAtParis || null,
      expires_at_paris: expiresAtParis || null,
      triggered_at_paris: triggeredAtParis || null,
    },
    trigger_policy: {
      ...(setup.trigger_policy || {}),
      min_score: normalizeReplayTriggerScore(setup.trigger_policy?.min_score, 1),
      allow_entry_only: false,
      backend_can_trigger: backendCanTrigger,
    },
  };
}

function liveSetupExpiryParis(setup = {}) {
  return firstValidInstant(
    setup.expires_at_paris,
    setup.expiry_paris,
    setup.setup_expiry_time,
    setup.expires_at,
    setup.valid_until_paris,
    setup.valid_until,
  );
}

function inheritLiveSetupThesisValidity(setup, theses = []) {
  const thesis = theses.find((candidate) => {
    const directThesisId = setup.linked_active_thesis_id || setup.thesis_id;
    if (directThesisId && candidate.thesis_id === directThesisId) return true;
    const linkedSetupId = candidate.linked_setup_id
      || candidate.triggered_setup?.setup_record_id
      || candidate.triggered_setup?.setup_id;
    if (linkedSetupId && [setup.setup_record_id, setup.setup_id].includes(linkedSetupId)) return true;
    const linkedMasterId = candidate.linked_master_analysis_id || candidate.master_id;
    const setupMasterId = setup.linked_master_analysis_id || setup.master_id || setup.analysis_id;
    return Boolean(linkedMasterId && setupMasterId && linkedMasterId === setupMasterId);
  });
  if (!thesis) return setup;
  return {
    ...setup,
    linked_active_thesis_id: setup.linked_active_thesis_id || thesis.thesis_id || null,
    valid_from_paris: setup.valid_from_paris || setup.valid_from || thesis.valid_from || null,
    expires_at_paris: liveSetupExpiryParis(setup)
      || firstValidInstant(thesis.setup_expiry_time, thesis.valid_until)
      || null,
    validity_inherited_from_thesis: true,
  };
}

function firstValidInstant(...values) {
  return values.find((value) => value && Number.isFinite(Date.parse(value))) || null;
}

function normalizeLiveTriggerConditions(value, setup) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  const parsed = source.flatMap((condition, index) => {
    if (condition && typeof condition === "object") return [{ ...condition }];
    const text = String(condition || "").trim();
    if (!text) return [];
    const instrument = (text.match(/\b(MNQ|MES|NQ|ES)\b/i)?.[1] || setup.instrument || "").toUpperCase();
    const numbers = [...text.matchAll(/(?<![A-Za-z])(\d{3,6}(?:[.,]\d+)?)/g)]
      .map((match) => Number(match[1].replace(",", ".")))
      .filter(Number.isFinite);
    const lower = text.toLowerCase();
    if ((lower.includes("rejet") || lower.includes("rejection")) && instrument === String(setup.instrument || "").toUpperCase()) {
      const zone = setup.entry_zone || {};
      const threshold = String(setup.direction || "").toLowerCase() === "short"
        ? firstFinite(zone.lower, zone.low, zone.from, zone.min, numbers[0])
        : firstFinite(zone.upper, zone.high, zone.to, zone.max, numbers.at(-1));
      if (threshold !== null) {
        return [{
          condition_id: `live_trigger_${index + 1}`,
          label: text,
          instrument,
          operator: String(setup.direction || "").toLowerCase() === "short" ? "REJECT_ABOVE" : "REJECT_BELOW",
          threshold,
          importance: "MANDATORY",
          required_for_trigger: true,
          status: "PENDING",
        }];
      }
    }
    const below = /\b(sous|below|inf[eé]rieur|en dessous)\b/i.test(text);
    const above = /\b(au-dessus|above|reprend|reprise|maintien au-dessus)\b/i.test(text);
    const threshold = numbers.at(-1);
    if (instrument && threshold !== undefined && (below || above)) {
      return [{
        condition_id: `live_trigger_${index + 1}`,
        label: text,
        instrument,
        operator: below && !above ? "CLOSE_BELOW" : "CLOSE_ABOVE",
        threshold,
        importance: "MANDATORY",
        required_for_trigger: true,
        status: "PENDING",
      }];
    }
    return [];
  });
  return parsed;
}

async function loadInstrumentRows(
  persistence,
  instrumentValue,
  fromParis,
  toParis,
  cache,
  timeframeValue = "M1",
) {
  const instrument = canonicalInstrument(instrumentValue);
  const timeframe = normalizeExecutionTimeframe(timeframeValue);
  const key = `${instrument}:${timeframe}:${fromParis}:${toParis}`;
  if (cache.has(key)) return cache.get(key);
  if (instrument === PREDICATE_EVENT_ROWS_INSTRUMENT_V1) {
    const eventRows = await loadMacroEventRows(persistence, fromParis, toParis);
    cache.set(key, eventRows);
    return eventRows;
  }
  const symbolCodes = instrumentSymbols(instrument);
  const feedIds = canonicalExecutionFeedIds(instrument, timeframe);
  let rows = await persistence.queryMarketCandles({
    symbolCodes,
    feedIds,
    timeframe: executionTimeframeMinutes(timeframe),
    fromUtc: new Date(fromParis).toISOString(),
    toUtc: new Date(toParis).toISOString(),
    closedOnly: true,
    limit: 5_000,
  }).catch(() => []);
  rows = filterRowsAvailableInLiveInterval(rows, {
    fromParis,
    toParis,
    timeframe,
  });
  let derivedFromM1 = false;
  let derivationLineage = null;
  if (!rows.length && timeframe !== "M1") {
    const sourceFeedIds = canonicalExecutionFeedIds(instrument, "M1");
    const sourceRows = await persistence.queryMarketCandles({
      symbolCodes,
      feedIds: sourceFeedIds,
      timeframe: "1",
      fromUtc: new Date(fromParis).toISOString(),
      toUtc: new Date(toParis).toISOString(),
      closedOnly: true,
      limit: 20_000,
    }).catch(() => []);
    const cutoffSafeSourceRows = filterRowsAvailableInLiveInterval(sourceRows, {
      fromParis,
      toParis,
      timeframe: "M1",
    });
    const derivation = deriveCanonicalTimeframeFromClosedM1(cutoffSafeSourceRows, {
      cutoffUtc: new Date(toParis).toISOString(),
      targetTimeframe: timeframe,
      asset: instrument,
      requestedSymbol: `${instrument}1!`,
      sourceDataset: sourceFeedIds[0] || null,
    });
    rows = derivation.rows;
    derivedFromM1 = true;
    derivationLineage = derivation.lineage;
  }
  rows = rows.map((row) => ({
    ...row,
    instrument,
    timeframe,
    execution_timeframe: timeframe,
    execution_timeframe_fallback: derivedFromM1,
    execution_derivation_lineage: derivationLineage,
  }));
  rows.execution_timeframe = rows.length ? timeframe : null;
  rows.execution_timeframe_fallback = derivedFromM1;
  rows.execution_feed_ids = feedIds;
  rows.execution_data_status = rows.length ? "AVAILABLE" : `CANONICAL_${timeframe}_UNAVAILABLE`;
  cache.set(key, rows);
  return rows;
}

function filterRowsAvailableInLiveInterval(rows, {
  fromParis,
  toParis,
  timeframe,
}) {
  const fromMs = Date.parse(fromParis || "");
  const toMs = Date.parse(toParis || "");
  return (rows || []).filter((row) => {
    const closeMs = liveRowCloseMs(row, timeframe);
    if (!Number.isFinite(closeMs)) return false;
    if (Number.isFinite(fromMs) && closeMs <= fromMs) return false;
    if (Number.isFinite(toMs) && closeMs > toMs) return false;
    return row?.is_closed !== false && row?.closed !== false;
  });
}

function liveRowCloseMs(row = {}, fallbackTimeframe = "M1") {
  const explicitCloseMs = Date.parse(
    row.candle_close_utc
      || row.bar_close_utc
      || row.close_timestamp_utc
      || row.closed_at_utc
      || "",
  );
  if (Number.isFinite(explicitCloseMs)) return explicitCloseMs;
  const openedAtMs = Date.parse(
    row.timestamp_utc || row.timestamp_paris || row.timestamp || row.time || "",
  );
  if (!Number.isFinite(openedAtMs)) return Number.NaN;
  return openedAtMs + executionTimeframeDurationMs(fallbackTimeframe);
}

function executionTimeframeDurationMs(timeframe) {
  return Number(executionTimeframeMinutes(timeframe)) * 60_000;
}

async function loadMacroEventRows(persistence, fromParis, toParis) {
  if (typeof persistence.queryCollectionDocuments !== "function") return [];
  const fromDate = offsetIsoDate(String(fromParis).slice(0, 10), -1);
  const toDate = offsetIsoDate(String(toParis).slice(0, 10), 1);
  const cutoffUtc = new Date(toParis).toISOString();
  const cutoffMs = Date.parse(cutoffUtc);
  const events = await persistence.queryCollectionDocuments({
    collection: C.macroCalendarEvents,
    filters: [
      { field: "date", operator: ">=", value: fromDate },
      { field: "date", operator: "<=", value: toDate },
    ],
    orderBy: [{ field: "timestamp_utc", direction: "asc" }],
    limit: 5_000,
  }).catch(() => []);
  const rows = sanitizeMacroActualsAtCutoff(
    events.filter((event) => macroEventKnownAtCutoff(event, cutoffMs)),
    cutoffUtc,
  ).map((event) => ({
    ...event,
    instrument: PREDICATE_EVENT_ROWS_INSTRUMENT_V1,
    timeframe: "EVENT",
    event_record: true,
    event_row_type: "MACRO_CALENDAR_EVENT",
    event_cutoff_utc: cutoffUtc,
  }));
  rows.execution_timeframe = "EVENT";
  rows.execution_timeframe_fallback = false;
  rows.execution_data_status = rows.length ? "AVAILABLE" : "MACRO_EVENT_WINDOW_UNAVAILABLE";
  return rows;
}

function offsetIsoDate(date, days) {
  const epochMs = Date.parse(String(date || "") + "T00:00:00Z");
  if (!Number.isFinite(epochMs)) return date;
  return new Date(epochMs + days * 86_400_000).toISOString().slice(0, 10);
}

function macroEventKnownAtCutoff(event, cutoffMs) {
  const knownAt = [event.first_seen_at_utc, event.created_at_utc, event.created_at]
    .map((value) => Date.parse(String(value || "")))
    .find(Number.isFinite);
  return knownAt === undefined || knownAt <= cutoffMs;
}

function setupConditionInstruments(setup) {
  const canonical = setupConditionInstrumentsV1(setup);
  const legacy = (setup.conditions || []).map((condition) => {
    const predicateType = String(condition.predicate_type || condition.type || "").toUpperCase();
    if (predicateType === "EVENT_BLACKOUT") return PREDICATE_EVENT_ROWS_INSTRUMENT_V1;
    return canonicalInstrument(condition.reference_instrument
      || condition.parameters?.reference_instrument
      || condition.instrument
      || condition.asset
      || condition.symbol
      || setup.instrument);
  });
  return [...new Set([...canonical, canonicalInstrument(setup.instrument), ...legacy].filter(Boolean))];
}

function setupConditionDataSpecs(setup) {
  const specs = new Map();
  const add = (instrumentValue, timeframeValue) => {
    const instrument = canonicalInstrument(instrumentValue);
    if (!instrument) return;
    const timeframe = instrument === PREDICATE_EVENT_ROWS_INSTRUMENT_V1
      ? "EVENT"
      : normalizeExecutionTimeframe(timeframeValue);
    specs.set(`${instrument}:${timeframe}`, { instrument, timeframe });
  };
  add(setup.instrument, "M1");
  for (const condition of setup.conditions || setup.trigger_policy?.conditions || []) {
    const predicateType = String(condition.predicate_type || condition.type || "").toUpperCase();
    add(
      predicateType === "EVENT_BLACKOUT"
        ? PREDICATE_EVENT_ROWS_INSTRUMENT_V1
        : condition.reference_instrument
          || condition.parameters?.reference_instrument
          || condition.instrument
          || setup.instrument,
      predicateType === "EVENT_BLACKOUT" ? "EVENT" : condition.timeframe || "M1",
    );
  }
  return [...specs.values()];
}

function canonicalInstrument(value) {
  const symbol = String(value || "").trim().toUpperCase().split(":").at(-1).replace(/1!$/, "");
  return symbol === "MCL" ? "CL" : symbol;
}

function canonicalExecutionFeedIds(instrument, timeframe = "M1") {
  const minutes = executionTimeframeMinutes(timeframe);
  return {
    MNQ: [`prod__tradingview__MNQ1!__${minutes}`],
    NQ: [`prod__tradingview__MNQ1!__${minutes}`],
    MES: [`prod__tradingview__MES1!__${minutes}`],
    ES: [`prod__tradingview__MES1!__${minutes}`],
  }[instrument] || [];
}

function normalizeExecutionTimeframe(value) {
  const normalized = String(value || "M1").trim().toUpperCase();
  if (["1", "1M", "M1"].includes(normalized)) return "M1";
  if (["5", "5M", "M5"].includes(normalized)) return "M5";
  if (["15", "15M", "M15"].includes(normalized)) return "M15";
  if (["60", "1H", "H1"].includes(normalized)) return "H1";
  if (["240", "4H", "H4"].includes(normalized)) return "H4";
  return "M1";
}

function executionTimeframeMinutes(timeframe) {
  return {
    M1: "1",
    M5: "5",
    M15: "15",
    H1: "60",
    H4: "240",
  }[normalizeExecutionTimeframe(timeframe)] || "1";
}

function instrumentSymbols(instrument) {
  const aliases = {
    MNQ: ["MNQ1!", "MNQ"],
    NQ: ["NQ1!", "NQ", "MNQ1!", "MNQ"],
    MES: ["MES1!", "MES"],
    ES: ["ES1!", "ES", "MES1!", "MES"],
    CL: ["CL1!", "CL"],
    GC: ["GC1!", "GC"],
  }[instrument] || [instrument];
  return [...new Set(aliases.filter(Boolean))];
}

function laterInstant(left, right) {
  if (!right || !Number.isFinite(Date.parse(right))) return left || null;
  if (!left || !Number.isFinite(Date.parse(left))) return right;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function lifecycleEvent(scope, tick, eventType, details) {
  const eventId = stableVNextId("live_paper_event", `${scope.run_id}_${tick.paris}`, `${eventType}_${details.position_id || details.setup_record_id || "state"}`);
  return {
    event_id: eventId,
    event_type: eventType,
    source: "live_paper_execution_engine",
    strategy_id: scope.strategy_id,
    trading_date: scope.trading_date,
    session: scope.session,
    run_id: scope.run_id,
    mode: scope.mode || "live",
    execution_mode: "paper",
    broker_execution: false,
    timestamp_paris: tick.paris,
    timestamp_utc: tick.utc,
    details,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

async function persistWrites(persistence, writes) {
  if (typeof persistence.writeDocuments === "function") {
    await persistence.writeDocuments(writes);
    return;
  }
  for (const write of writes) {
    await persistence.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
  }
}
