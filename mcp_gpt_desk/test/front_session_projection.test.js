import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  applyFrontProjection,
  loadFrontDeskSession,
  loadFrontMarketSnapshot,
  normalizeFrontApiScope,
  projectDeskSession,
  sessionSummary,
} from "../src/front-session-projection.js";
import { PersistentDeskStore } from "../src/store.js";

test("front session projection keeps canonical setup and execution position separate", () => {
  const session = projectDeskSession({
    live: {
      trading_date: "2026-07-13",
      strategy_id: "ny_open_1530",
      session: "ny_open",
      mode: "live",
      desk_status: "POSITION_PROTECTED",
      desk_color: "orange",
      as_of_utc: "2026-07-13T16:10:00.000Z",
      action_now: {
        decision: "HOLD",
        message: "Conserver la position protégée.",
        next_condition: "Surveiller TP1.",
      },
      active_thesis: {
        thesis_id: "thesis-1",
        instrument: "MNQ",
        direction: "short",
        status: "POSITION_PROTECTED",
        confidence_pct: 68,
        health_score: 72,
        dominant_scenario: "Poursuite sous VWAP.",
        valid_until: "2026-07-13T18:00:00+02:00",
      },
      active_position: {
        status: "protected",
        instrument: "MNQ",
        direction: "short",
        entry_price: 22450,
        current_price: 22420,
        unrealized_R: 0.8,
      },
      key_levels: [{ price: 22400, label: "TP1", status: "active" }],
      jobs: [{ job_id: "job-1", job_type: "HOURLY_MONITOR", status: "DONE", updated_at_paris: "2026-07-13T18:00:00+02:00" }],
      contracts: {
        master: { contract_name: "DeskMasterAnalysisContract", schema_version: "4.0.0", status: "active" },
      },
      data_readiness: { pack: "ready", level_map: "ready" },
      next_live_checkpoint: {
        cursor_id: "livecur__2026-07-13",
        cursor_status: "DUE",
        workflow: "LIVE_M15_MONITOR",
        target_checkpoint: "2026-07-13T18:15:00+02:00",
        task_status: "WAITING",
        last_claimed_at_utc: "2026-07-13T16:08:00.000Z",
        last_claimed_at_paris: "2026-07-13T18:08:00+02:00",
        last_claimed_worker_id: "gpt-live-pool-02",
      },
      live_checkpoint_schedule: {
        cadence_minutes: 15,
        last_completed_checkpoint: "2026-07-13T18:00:00+02:00",
        due_checkpoint: "2026-07-13T18:15:00+02:00",
        due_workflow: "LIVE_M15_MONITOR",
        due_completed: false,
        next_checkpoint: "2026-07-13T18:30:00+02:00",
        next_workflow: "LIVE_M15_MONITOR",
        next_monitor_checkpoint: "2026-07-13T18:30:00+02:00",
        ready_at_utc: "2026-07-13T16:07:30.000Z",
        claimed_at_utc: "2026-07-13T16:08:00.000Z",
        claim_latency_seconds: 30,
        claim_latency_target_seconds: 120,
        claim_latency_status: "on_target",
      },
    },
    masterAnalysis: {
      analysis_id: "master-1",
      created_at_paris: "2026-07-13T15:35:00+02:00",
      full_analysis: {
        executive_summary: {
          final_decision: "WAIT",
          final_instrument: "MNQ",
          final_direction: "short",
          confidence_pct: 66,
          summary: "Plan initial baissier.",
        },
        macro_thesis: "Contexte risk-off.",
      },
    },
    monitors: [{
      monitor_id: "monitor-1",
      timestamp_paris: "2026-07-13T18:05:00+02:00",
      monitor_decision: {
        action: "HOLD",
        reason_summary: "Le scénario reste confirmé.",
      },
      thesis_health_score: {
        previous_score: 70,
        current_score: 72,
        score_drivers_positive: ["Position protégée"],
      },
      active_thesis_update: { status: "POSITION_PROTECTED" },
    }],
    setups: [{
      setup_id: "setup-1",
      label: "Rejet VWAP",
      instrument: "MNQ",
      direction: "short",
      status: "TRIGGERED",
      entry_zone: { from: 22445, to: 22455 },
      stop_loss: 22480,
      take_profit_1: 22400,
      risk_pct: 0.5,
    }],
    marketSnapshot: {
      timestamp_paris: "2026-07-13T18:09:00+02:00",
      anti_lookahead_compliant: true,
      instruments: { MNQ: {
        latest_close: 22420,
        latest_timestamp_paris: "2026-07-13T18:09:00+02:00",
        series_timeframe: "M1",
        intraday_series: [
          { timestamp_paris: "2026-07-13T18:08:00+02:00", open: 22418, high: 22422, low: 22417, close: 22419 },
          { timestamp_paris: "2026-07-13T18:09:00+02:00", open: 22419, high: 22423, low: 22418, close: 22420 },
        ],
      } },
    },
    macro: { events: [{ time_paris: "2026-07-13T20:00:00+02:00", title: "Budget balance", impact: "medium" }] },
    news: { items: [{ timestamp_paris: "2026-07-13T18:00:00+02:00", title: "Risk-off", source: "Desk feed" }] },
    audit: {
      anti_lookahead: { pack_cutoff_ok: true, no_actual_j_jplus1: true, no_post_cutoff_candles: true },
      errors: [],
      data_quality: { warnings: [] },
    },
  });

  assert.equal(session.id, "ny_open");
  assert.equal(session.setup.entryFrom, 22445);
  assert.equal(session.setup.entryLower, 22445);
  assert.equal(session.setup.entryUpper, 22455);
  assert.equal(session.setup.executionEntry, 22445);
  assert.equal(session.position.entry, 22450);
  assert.equal(session.position.current, 22420);
  assert.equal(session.position.active, true);
  assert.equal(session.lastDataAt, "18:09");
  assert.equal(session.market[0].seriesTimeframe, "M1");
  assert.equal(session.market[0].series.length, 2);
  assert.equal(session.market[0].series[1].close, 22420);
  assert.equal(session.lastMonitorAt, "18:05");
  assert.equal(session.claim.lastClaimAt, "18:08");
  assert.equal(session.claim.workerId, "gpt-live-pool-02");
  assert.equal(session.claim.nextTaskStatus, "waiting");
  assert.equal(session.claim.nextTaskStatusLabel, "En attente");
  assert.equal(session.claim.nextTaskLabel, "Monitor GPT M15");
  assert.equal(session.claim.nextTaskCheckpoint, "18:15");
  assert.equal(session.claim.followingTaskCheckpoint, "18:30");
  assert.equal(session.claim.latencySeconds, 30);
  assert.equal(session.lastCompletedCheckpointAt, "18:00");
  assert.equal(session.currentCheckpointAt, "18:15");
  assert.equal(session.nextCheckpointAt, "18:30");
  assert.equal(session.nextMonitorAt, "18:30");
  assert.equal(session.dataQuality.status, "ready");
  assert.equal(session.monitors[0].healthAfter, 72);
  assert.equal(session.timeline.some((event) => event.type === "MONITOR"), true);
  assert.equal(session.operationalTimeline.at(-1).plannedTime, "18:30");
  assert.equal(session.deskReading.interpretation.length > 0, true);
  assert.deepEqual(sessionSummary(session), {
    id: "ny_open",
    label: "NY Open",
    shortLabel: "NY",
    status: "POSITION_PROTECTED",
    severity: "warning",
    decision: "HOLD",
    health: 72,
    lastMonitorAt: "18:05",
  });
});

test("front projection exposes missing canonical values without fabricating prices", () => {
  const session = projectDeskSession({
    live: {
      date: "2026-07-13",
      session: "asia_open",
      desk_status: "NO_ACTIVE_THESIS",
      data_readiness: { pack: "missing" },
    },
  });

  assert.equal(session.setup.entryFrom, null);
  assert.equal(session.setup.stop, null);
  assert.equal(session.setup.risk, null);
  assert.equal(session.position.active, false);
  assert.equal(session.market.length, 0);
  assert.equal(session.lastDataAt, "—");
  assert.equal(session.crossAssetBrief.verdict, "Donnée indisponible");
  assert.equal(session.dataQuality.status, "degraded");
  assert.match(session.dataQuality.warnings[0], /pack: missing/);
});

test("front projection exposes an incomplete requested arm without borrowing thesis fields", () => {
  const session = projectDeskSession({
    live: {
      date: "2026-07-13",
      session: "asia_open",
      desk_status: "ARMED_CONDITIONAL",
      active_thesis: {
        instrument: "MNQ",
        direction: "short",
      },
    },
    setups: [{
      setup_id: "placeholder-monitor-1",
      status: "PRE_ARMED",
      requested_status: "ARMED_CONDITIONAL",
      execution_geometry_ready: false,
      backend_can_trigger: false,
    }],
  });

  assert.equal(session.setup.status, "PRE_ARMED");
  assert.equal(session.setup.statusLabel, "Armement incomplet");
  assert.equal(session.setup.instrument, "—");
  assert.equal(session.setup.direction, "wait");
  assert.equal(session.setup.geometryReady, false);
  assert.equal(session.setup.backendCanTrigger, false);
  assert.deepEqual(session.setup.missingFields, [
    "instrument",
    "direction",
    "entry",
    "stop_loss",
    "take_profit_1",
  ]);
  assert.match(session.setup.reason, /moteur ne peut pas déclencher/);
});

test("front projection honors a backend RR rejection instead of displaying the minimum as achieved", () => {
  const session = projectDeskSession({
    live: {
      date: "2026-07-29",
      session: "ny_open",
      desk_status: "WAIT_MONITORED",
    },
    setups: [{
      setup_id: "mnq_rr_rejected",
      status: "PRE_ARMED",
      requested_status: "ARMED_CONDITIONAL",
      instrument: "MNQ",
      direction: "short",
      entry_zone: { min: 27844.75, max: 27856 },
      stop_loss: 27882,
      take_profit_1: 27790,
      computed_rr: 1.4698,
      rr_minimum: 2,
      risk_geometry_status: "RR_BELOW_MINIMUM",
      execution_geometry_ready: false,
      backend_can_trigger: false,
    }],
  });

  assert.equal(session.setup.geometryReady, false);
  assert.equal(session.setup.backendCanTrigger, false);
  assert.equal(session.setup.statusLabel, "Armement incomplet");
  assert.equal(session.setup.rr, 1.4698);
  assert.equal(session.setup.minimumRr, 2);
  assert.deepEqual(session.setup.missingFields, ["risk_reward"]);
  assert.match(session.setup.reason, /RR 1.47 inférieur au minimum 2.00/);
});

test("front projection never marks sub-minimum RR geometry ready even when a legacy document says true", () => {
  const session = projectDeskSession({
    live: {
      date: "2026-07-29",
      session: "ny_open",
      desk_status: "WAIT_MONITORED",
    },
    setups: [{
      setup_id: "legacy-armed-setup",
      instrument: "MNQ",
      direction: "short",
      status: "PRE_ARMED",
      entry_zone_lower: 27844.75,
      entry_zone_upper: 27856,
      stop_loss: 27882,
      take_profit_1: 27790,
      computed_rr: 1.4697986577181208,
      rr_minimum: 2,
      execution_geometry_ready: true,
      backend_can_trigger: false,
    }],
  });

  assert.equal(session.setup.geometryReady, false);
  assert.equal(session.setup.backendCanTrigger, false);
  assert.deepEqual(session.setup.missingFields, ["risk_reward"]);
  assert.equal(session.setup.rr, 1.4697986577181208);
  assert.equal(session.setup.minimumRr, 2);
});

test("optional context gaps are visible without falsely degrading the execution feed", () => {
  const session = projectDeskSession({
    live: {
      date: "2026-07-13",
      session: "asia_open",
      desk_status: "WAIT",
      pack: { quality: { status: "degraded_context", warnings: ["optional_dataset_stale: GDELT"] } },
      data_readiness: {
        pack: "degraded_context",
        market_triggers: "ready",
        market_context: "last_known",
        level_map: "ready",
        technical_events: "missing",
        cross_asset_delta: "missing",
      },
    },
    audit: {
      anti_lookahead: { pack_cutoff_ok: true, no_actual_j_jplus1: true, no_post_cutoff_candles: true },
      errors: [],
    },
  });

  assert.equal(session.dataQuality.status, "context_limited");
  assert.equal(session.dataQuality.label, "Contexte partiel");
  assert.equal(session.dataQuality.executionReady, true);
});

test("front projection renders numeric thesis levels and deterministic level zones", () => {
  const session = projectDeskSession({
    live: {
      date: "2026-07-29",
      session: "asia_open",
      desk_status: "WAIT_MONITORED",
      key_levels: [
        27884,
        {
          instrument: "MNQ",
          level_from: 27944.5,
          level_to: 27980.75,
          type: "support",
          actionability: "actionable",
        },
        {
          instrument: "MES",
          mid: 7458.5,
          type: "resistance",
          status: "watched",
        },
      ],
      data_readiness: { pack: "ready", level_map: "ready" },
    },
  });

  assert.deepEqual(session.levels, [
    { price: "27 884", role: "Niveau clé", state: "observed" },
    { price: "27 944,5 – 27 980,75", role: "MNQ · support", state: "actionable" },
    { price: "7 458,5", role: "MES · resistance", state: "watched" },
  ]);
});

test("front projection reads the canonical V4 Master decision without a legacy executive summary", () => {
  const session = projectDeskSession({
    live: {
      trading_date: "2026-07-27",
      strategy_id: "asia_open",
      session: "asia_open",
      mode: "live",
      desk_status: "WAIT_MONITORED",
      active_thesis: {
        thesis_id: "thesis-live",
        instrument: "WAIT",
        direction: "wait",
        status: "WAIT_MONITORED",
      },
    },
    masterAnalysis: {
      analysis_id: "master-live",
      created_at_paris: "2026-07-27T13:35:00+02:00",
      full_analysis: {
        decision: {
          action: "WAIT",
          instrument: "WAIT",
          direction: "wait",
          confidence_pct: 48,
          reason: "La première impulsion n'est pas encore acceptée.",
          execution_allowed: false,
        },
        market_regime: { label: "OPENING_RANGE_ROTATION" },
      },
    },
  });

  assert.equal(session.master.id, "master-live");
  assert.equal(session.master.decision, "WAIT");
  assert.equal(session.master.direction, "wait");
  assert.equal(session.master.confidence, 48);
  assert.equal(session.master.summary, "La première impulsion n'est pas encore acceptée.");
  assert.equal(session.liveBrief.summary, "La première impulsion n'est pas encore acceptée.");
});

test("front projection reads the production V4 executable decision shape", () => {
  const session = projectDeskSession({
    live: {
      trading_date: "2026-07-27",
      strategy_id: "ny_open_1530",
      session: "ny_open",
      mode: "live",
      desk_status: "WAIT_MONITORED",
      active_thesis: {
        thesis_id: "thesis-master-1530-wait",
        instrument: "WAIT",
        direction: "wait",
        status: "WAIT_MONITORED",
        confidence_pct: 64,
      },
    },
    masterAnalysis: {
      analysis_id: "master-1530",
      created_at_paris: "2026-07-27T15:30:00+02:00",
      full_analysis: {
        executable_decision: {
          decision: "WAIT",
          take_trade: false,
          instrument: "WAIT",
          direction: "wait",
          reason: "Attendre une acceptation M15 et un retest.",
        },
      },
    },
  });

  assert.equal(session.master.id, "master-1530");
  assert.equal(session.master.decision, "WAIT");
  assert.equal(session.master.instrument, "WAIT");
  assert.equal(session.master.direction, "wait");
  assert.equal(session.master.summary, "Attendre une acceptation M15 et un retest.");
});

test("front projection keeps the latest expired thesis and Monitor visible without treating them as active", () => {
  const session = projectDeskSession({
    live: {
      trading_date: "2026-07-27",
      strategy_id: "asia_open",
      session: "asia_open",
      mode: "live",
      desk_status: "EXPIRED",
      active_thesis: null,
      latest_thesis: {
        thesis_id: "thesis-expired",
        instrument: "MNQ",
        direction: "wait",
        status: "REPLAN_REQUIRED",
        dominant_scenario: "Le plan doit être recalculé.",
        valid_until: "2026-07-27T06:00:00+02:00",
      },
    },
    monitors: [{
      monitor_id: "monitor-replan",
      timestamp_paris: "2026-07-27T13:45:00+02:00",
      linked_active_thesis_id: "thesis-expired",
      monitor_decision: {
        action: "REPLAN_FULL",
        reason: "Le contexte a trop évolué depuis le Master initial.",
      },
      active_thesis_update: { status: "REPLAN_REQUIRED" },
    }],
  });

  assert.equal(session.status, "EXPIRED");
  assert.equal(session.thesis.id, "thesis-expired");
  assert.equal(session.thesis.status, "REPLAN_REQUIRED");
  assert.equal(session.monitors.length, 1);
  assert.equal(session.monitors[0].id, "monitor-replan");
  assert.equal(session.monitors[0].summary, "Le contexte a trop évolué depuis le Master initial.");
  assert.equal(session.monitors[0].detailedReason, "Le contexte a trop évolué depuis le Master initial.");
  assert.equal(session.lastMonitorAt, "13:45");
  assert.equal(session.position.active, false);
});

test("front projection fills Delta Monitor and setup cards from the current production shapes", () => {
  const session = projectDeskSession({
    live: {
      trading_date: "2026-07-28",
      strategy_id: "asia_open",
      session: "asia_open",
      mode: "live",
      desk_status: "WAIT_MONITORED",
      active_thesis: {
        thesis_id: "thesis-live-asia",
        instrument: "MNQ",
        direction: "long",
        status: "WAIT_MONITORED",
        confidence_pct: 59,
      },
    },
    masterAnalysis: {
      analysis_id: "master-live-0545",
      created_at_paris: "2026-07-28T05:46:00+02:00",
      full_analysis: {
        decision: { action: "WAIT", instrument: "MNQ", direction: "long" },
      },
    },
    monitors: [{
      monitor_id: "monitor-live-0615",
      timestamp_paris: "2026-07-28T06:15:00+02:00",
      linked_active_thesis_id: "thesis-live-asia",
      monitor_decision: {
        action: "WAIT",
        rationale: "Le scénario reste valide mais le déclencheur n'est pas confirmé.",
        setup_assessment: {
          realized_delta: {
            MNQ: "Retest de la zone sans clôture de confirmation",
            MES: "Confirmation relative absente",
          },
        },
      },
      thesis_update: {
        health_score: 36,
        dominant_scenario: "Attendre une réintégration confirmée.",
      },
    }],
    setups: [{
      setup_record_id: "master-live-0545-setup-1",
      setup_id: "mnq-long-retest",
      analysis_id: "master-live-0545",
      label: "Retest acheteur MNQ",
      instrument: "MNQ",
      direction: "long",
      status: "CONDITIONAL",
      entry_zone: { low: 28020, high: 28035 },
      stop_loss: 27970,
      take_profit: [28145, 28195],
      rr_min: 2,
      trigger: ["Réintégration puis maintien au-dessus de 28035"],
    }],
    frontProjection: {
      contractName: "DeskFrontProjectionContract",
      schemaVersion: "1.0.0",
      source: {
        sourceType: "MONITOR",
        sourceId: "monitor-live-0615",
        monitorId: "monitor-live-0615",
        strategyId: "asia_open",
        tradingDate: "2026-07-28",
        session: "asia_open",
        timestampParis: "2026-07-28T06:15:00+02:00",
      },
      latestChange: {
        validatedElements: [],
        weakenedElements: [],
        invalidatedElements: [],
      },
    },
  });

  assert.equal(session.setup.entryFrom, 28020);
  assert.equal(session.setup.entryTo, 28035);
  assert.equal(session.setup.tp1, 28145);
  assert.equal(session.setup.tp2, 28195);
  assert.equal(session.setup.rr, null);
  assert.equal(session.setup.minimumRr, 2);
  assert.equal(session.setup.label, "Retest acheteur MNQ");
  assert.match(session.setup.reason, /Réintégration/);
  assert.match(session.latestChange.consequence, /scénario reste valide/);
  assert.equal(session.latestChange.items.length, 2);
  assert.match(session.latestChange.items[0].text, /MNQ/);
});

test("front projection explains an empty Delta Monitor after a fresh replan Master", () => {
  const session = projectDeskSession({
    live: {
      trading_date: "2026-07-28",
      strategy_id: "asia_open",
      session: "asia_open",
      mode: "live",
      desk_status: "WAIT_MONITORED",
      next_revalidation_time: "2026-07-28T07:30:00+02:00",
      risk_order: { rr_min: 2, current_risk_pct: 0 },
      active_thesis: {
        thesis_id: "thesis-live-replan",
        instrument: "WAIT",
        direction: "wait",
        status: "WAIT_MONITORED",
      },
    },
    masterAnalysis: {
      analysis_id: "master-live-replan",
      created_at_paris: "2026-07-28T07:00:00+02:00",
      full_analysis: {
        decision: { action: "WAIT", instrument: "WAIT", direction: "wait" },
      },
    },
    monitors: [],
  });

  assert.equal(session.latestChange.title, "Nouveau plan à 07:00");
  assert.equal(session.latestChange.items.length, 1);
  assert.match(session.latestChange.items[0].text, /attend son premier Monitor/);
  assert.equal(session.latestChange.consequence, "Premier delta attendu au prochain checkpoint, à 07:30.");
  assert.equal(session.setup.label, "Aucun setup matérialisé");
  assert.equal(session.setup.rr, null);
});

test("front API scope is stable and session-specific", () => {
  const scope = normalizeFrontApiScope(
    { session: "ny_open", trading_date: "2026-07-10" },
    new Date("2026-07-13T10:00:00.000Z"),
  );
  assert.equal(scope.strategy_id, "ny_open_1530");
  assert.equal(scope.run_id, "front_live_2026-07-10");
  assert.equal(scope.timezone, "Europe/Paris");
});

test("materialized front projection enriches narrative state without overriding canonical execution", () => {
  const base = projectDeskSession({
    live: {
      date: "2026-07-14",
      trading_date: "2026-07-14",
      strategy_id: "asia_open",
      session: "asia_open",
      mode: "live",
      desk_status: "THESIS_ACTIVE",
      active_position: { status: "protected", instrument: "MNQ", entry_price: 22400 },
      active_thesis: { thesis_id: "thesis-1", status: "THESIS_ACTIVE", health_score: 60, confidence_pct: 62 },
    },
    monitors: [{
      monitor_id: "monitor-2",
      timestamp_paris: "2026-07-14T08:15:00+02:00",
      monitor_decision: { action: "WAIT" },
      thesis_health_score: { previous_score: 60, current_score: 61 },
    }],
    setups: [{ setup_id: "setup-canonical", status: "TRIGGERED", entry_zone: { from: 22390, to: 22400 } }],
  });
  const enriched = applyFrontProjection(base, projectionFixture());

  assert.equal(enriched.liveBrief.headline, "Attente de confirmation");
  assert.equal(enriched.liveBrief.decision, "WAIT", "canonical Monitor decision keeps priority");
  assert.equal(enriched.thesis.health, 61, "canonical thesis health keeps priority");
  assert.equal(enriched.monitors[0].expectedVsRealized[0].element, "Support");
  assert.equal(enriched.setup.id, "setup-canonical", "canonical setup must keep priority");
  assert.equal(enriched.position.entry, 22400, "canonical execution position must keep priority");
});

test("BFF loader reads the materialized current projection and keeps its canonical fallback path", async () => {
  let projectionReads = 0;
  const session = await loadFrontDeskSession({
    async getLiveDeskState(scope) {
      return {
        ...scope,
        resolved_scope: scope,
        desk_status: "NO_ACTIVE_THESIS",
        data_readiness: {},
      };
    },
    async getLatestMasterAnalysis() { return { analysis: null }; },
    async getAuditState() { return {}; },
    async getSessionSnapshot() { return {}; },
    async getFrontProjectionCurrent() {
      projectionReads += 1;
      return { projection: projectionFixture() };
    },
  }, {
    session: "asia_open",
    strategy_id: "asia_open",
    trading_date: "2026-07-14",
    run_id: "front_live_2026-07-14_asia_open",
    as_of_utc: "2026-07-14T06:15:00.000Z",
  });

  assert.equal(projectionReads, 1);
  assert.equal(session.liveBrief.headline, "Attente de confirmation");
  assert.equal(session.liveBrief.decision, "NO_ACTIVE_THESIS");
  assert.equal(session.position.active, false, "a projection cannot create an execution position");
  assert.equal(session.position.entry, null);
});

test("BFF critical shell defers secondary resources to their independent front endpoints", async () => {
  const secondaryReads = {
    audit: 0,
    market: 0,
    macro: 0,
    news: 0,
  };
  const session = await loadFrontDeskSession({
    async getLiveDeskState(scope) {
      return {
        ...scope,
        resolved_scope: scope,
        desk_status: "NO_ACTIVE_THESIS",
        data_readiness: { pack: "ready" },
      };
    },
    async getLatestMasterAnalysis() { return { analysis: null }; },
    async getAuditState() {
      secondaryReads.audit += 1;
      return {};
    },
    async getSessionSnapshot() {
      secondaryReads.market += 1;
      return {};
    },
    async getMacroCalendar() {
      secondaryReads.macro += 1;
      return { events: [] };
    },
    async getNewsDigest() {
      secondaryReads.news += 1;
      return { items: [] };
    },
  }, {
    session: "asia_open",
    strategy_id: "asia_open",
    trading_date: "2026-07-14",
    run_id: "front_live_2026-07-14",
    as_of_utc: "2026-07-14T08:00:00.000Z",
    mode: "live",
    defer_secondary_resources: true,
  });

  assert.deepEqual(secondaryReads, { audit: 0, market: 0, macro: 0, news: 0 });
  assert.equal(session.status, "NO_ACTIVE_THESIS");
  assert.deepEqual(session.market, []);
  assert.deepEqual(session.macro, []);
  assert.deepEqual(session.news.headlines, []);
});

test("BFF aggregate exposes daily macro and news without a session pack", async () => {
  const session = await loadFrontDeskSession({
    async getLiveDeskState(scope) {
      return { ...scope, resolved_scope: scope, desk_status: "NO_ACTIVE_THESIS", data_readiness: { pack: "missing" } };
    },
    async getLatestMasterAnalysis() { return { analysis: null }; },
    async getAuditState() { return {}; },
    async getSessionSnapshot() { return {}; },
    async getMacroCalendar(input) {
      assert.equal(input.pack_id, undefined);
      assert.equal(input.as_of_utc, undefined);
      return { events: [{ scheduled_at_paris: "2026-07-14T10:45:00+02:00", title: "CPI US", importance: "high", impact_text: "Volatilité attendue." }] };
    },
    async getNewsDigest(input) {
      assert.equal(input.pack_id, undefined);
      assert.equal(input.as_of_utc, undefined);
      return {
        updated_at_paris: "2026-07-14T10:00:00+02:00",
        digest: "Digest quotidien autonome.",
        items: [{ published_at_paris: "2026-07-14T09:55:00+02:00", headline: "Futures stables", source: "Desk News", impact: "Neutre" }],
      };
    },
  }, {
    session: "asia_open",
    strategy_id: "asia_open",
    trading_date: "2026-07-14",
    run_id: "front_live_2026-07-14_asia_open",
    as_of_utc: "2026-07-14T08:00:00.000Z",
    mode: "live",
  });

  assert.equal(session.macro[0].title, "CPI US");
  assert.equal(session.news.digest, "Digest quotidien autonome.");
  assert.equal(session.news.headlines[0].title, "Futures stables");
  assert.equal(session.status, "NO_ACTIVE_THESIS");
});

test("BFF aggregate exposes the complete daily macro calendar as honest news fallback", async () => {
  const session = projectDeskSession({
    live: { session: "asia_open", trading_date: "2026-07-14", desk_status: "NO_ACTIVE_THESIS" },
    news: { status: "not_configured", empty_ok: true, items: [] },
    macro: {
      events: [
        { timestamp_paris: "2026-07-14T14:30:00+02:00", title: "CPI y/y", importance: "high" },
        { timestamp_paris: "2026-07-14T10:45:00+02:00", title: "Discours BOE", importance: "medium" },
      ],
    },
  });

  assert.equal(session.news.headlines.length, 2);
  assert.equal(session.news.headlines[0].source, "Calendrier macro");
  assert.match(session.news.digest, /indépendant du Master et des workers/);
});

test("PostgreSQL live market reader prefers M1 and computes the evolving Paris-day OHLC", async () => {
  const rowsByParent = new Map([
    ["market_feeds/prod__tradingview__MNQ1!__1", [
      { timestamp_utc: "2026-07-14T07:00:00+00:00", open: 100, high: 102, low: 99, close: 101 },
      { timestamp_utc: "2026-07-14T08:20:00+00:00", open: 101, high: 104, low: 100, close: 103 },
    ]],
    ["market_feeds/prod__tradingview__MES1!__1", [
      { timestamp_utc: "2026-07-14T08:20:00+00:00", open: 50, high: 51, low: 49, close: 50.5 },
    ]],
    ["market_feeds/prod__tradingview__CL1!__5", [
      { timestamp_utc: "2026-07-14T08:15:00+00:00", open: 80, high: 81, low: 79, close: 80.5 },
    ]],
    ["market_feeds/prod__tradingview__NVDA__5", [
      { timestamp_utc: "2026-07-13T19:55:00+00:00", open: 200, high: 205, low: 198, close: 203 },
    ]],
  ]);
  const persistence = {
    async queryDocuments({ parentPath }) { return rowsByParent.get(parentPath) || []; },
  };
  const store = new PersistentDeskStore(new FixedClock(Date.parse("2026-07-14T08:21:00.000Z")), persistence);

  const snapshot = await store.getFrontLiveMarketSnapshot({ date: "2026-07-14" });

  assert.equal(snapshot.instruments.MNQ.timeframe, "M1");
  assert.equal(snapshot.instruments.MNQ.latest_close, 103);
  assert.deepEqual(snapshot.instruments.MNQ.day_ohlc, { open: 100, high: 104, low: 99, close: 103 });
  assert.equal(snapshot.instruments.MNQ.latest_timestamp_paris, "2026-07-14T10:20:00.000+02:00");
  assert.equal(snapshot.instruments.MCL.timeframe, "M5");
  assert.equal(snapshot.instruments.NVDA.market_date, "2026-07-13");
});

test("PostgreSQL live market reader batches all feed candidates into one persistence query", async () => {
  let batchReads = 0;
  let legacyReads = 0;
  const persistence = {
    async queryFrontMarketCandles(input) {
      batchReads += 1;
      assert.equal(input.feed_ids.includes("prod__tradingview__MNQ1!__1"), true);
      assert.equal(input.limit_per_feed, 1500);
      return [
        {
          feed_id: "prod__tradingview__MNQ1!__1",
          data: { timestamp_utc: "2026-07-14T07:00:00.000Z", open: 100, high: 102, low: 99, close: 101 },
        },
        {
          feed_id: "prod__tradingview__MNQ1!__1",
          data: { timestamp_utc: "2026-07-14T08:20:00.000Z", open: 101, high: 104, low: 100, close: 103 },
        },
      ];
    },
    async queryDocuments() {
      legacyReads += 1;
      return [];
    },
  };
  const store = new PersistentDeskStore(new FixedClock(Date.parse("2026-07-14T08:21:00.000Z")), persistence);

  const snapshot = await store.getFrontLiveMarketSnapshot({ date: "2026-07-14" });

  assert.equal(batchReads, 1);
  assert.equal(legacyReads, 0);
  assert.equal(snapshot.instruments.MNQ.latest_close, 103);
  assert.deepEqual(snapshot.instruments.MNQ.day_ohlc, { open: 100, high: 104, low: 99, close: 103 });
});

test("PostgreSQL live market reader exposes the last closed session on a non-trading day", async () => {
  const requestedDirections = [];
  const persistence = {
    async queryDocuments({ parentPath, direction }) {
      requestedDirections.push(direction);
      if (!parentPath.includes("MNQ1!") && !parentPath.includes("MES1!")) return [];
      return [{
        timestamp_utc: "2026-07-24T20:59:00+00:00",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      }];
    },
  };
  const store = new PersistentDeskStore(new FixedClock(Date.parse("2026-07-25T10:00:00.000Z")), persistence);

  const snapshot = await store.getFrontLiveMarketSnapshot({ date: "2026-07-25" });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.requested_date, "2026-07-25");
  assert.equal(snapshot.effective_market_date, "2026-07-24");
  assert.equal(snapshot.market_closed, true);
  assert.equal(snapshot.availability, "last_closed_session");
  assert.equal(snapshot.instruments.MNQ.availability, "last_closed_session");
  assert.equal(requestedDirections.every((direction) => direction === "desc"), true);
});

test("BFF market projection gives direct PostgreSQL candles priority over canonical snapshots", async () => {
  const result = await loadFrontMarketSnapshot({
    async getSessionSnapshot() {
      return { session_snapshot: { instruments: { MNQ: { latest_close: 100, rsi_14: 48 } } } };
    },
    async getFrontLiveMarketSnapshot() {
      return {
        timestamp_paris: "2026-07-14T10:20:00+02:00",
        instruments: {
          MNQ: {
            latest_close: 103,
            latest_timestamp_paris: "2026-07-14T10:20:00+02:00",
            day_ohlc: { open: 100, high: 104, low: 99, close: 103 },
            source: "market_feeds/prod__tradingview__MNQ1!__1/candles",
          },
        },
      };
    },
  }, { date: "2026-07-14", session: "asia_open", instrument: "MNQ" });

  assert.equal(result.session_snapshot.instruments.MNQ.latest_close, 103);
  assert.equal(result.session_snapshot.instruments.MNQ.rsi_14, 48);
  assert.equal(result.session_snapshot.source, "canonical_snapshot+postgres_market_feeds");
});

test("BFF market projection labels a closed market without fabricating a current session", async () => {
  const result = await loadFrontMarketSnapshot({
    async getSessionSnapshot() { return {}; },
    async getFrontLiveMarketSnapshot() {
      return {
        requested_date: "2026-07-25",
        effective_market_date: "2026-07-24",
        market_closed: true,
        availability: "last_closed_session",
        timestamp_paris: "2026-07-24T22:59:00+02:00",
        instruments: {
          MNQ: {
            latest_close: 101,
            latest_timestamp_paris: "2026-07-24T22:59:00+02:00",
            market_date: "2026-07-24",
            availability: "last_closed_session",
          },
        },
      };
    },
  }, { date: "2026-07-25", session: "asia_open", instrument: "MNQ" });
  const projected = projectDeskSession({
    live: { trading_date: "2026-07-25", session: "asia_open", desk_status: "NO_ACTIVE_THESIS" },
    marketSnapshot: result.session_snapshot,
  });

  assert.equal(result.session_snapshot.market_closed, true);
  assert.equal(projected.status, "NO_ACTIVE_THESIS");
  assert.equal(projected.marketBrief.headline, "Marché fermé · dernière séance");
  assert.equal(projected.market[0].marketDate, "2026-07-24");
  assert.match(projected.market[0].note, /Dernière séance/);
});

function projectionFixture() {
  return {
    contractName: "DeskFrontProjectionContract",
    schemaVersion: "1.0.0",
    source: {
      sourceType: "MONITOR", sourceId: "monitor-2", masterId: "master-1", monitorId: "monitor-2",
      thesisId: "thesis-1", strategyId: "asia_open", session: "asia_open", mode: "live",
      tradingDate: "2026-07-14", runId: "front_live_2026-07-14_asia_open",
      timestampParis: "2026-07-14T08:15:00+02:00", asOfUtc: "2026-07-14T06:15:00.000Z",
      sequence: 2, revision: 2,
    },
    status: {
      deskStatus: "THESIS_ACTIVE", decision: "MAINTAIN", actionCode: "WATCH", alertLevel: "watch",
      thesisStatus: "THESIS_ACTIVE", setupStatus: "ARMED", positionStatus: "NO_POSITION",
      confidencePct: 68, healthScore: 72, riskPct: 0.5,
    },
    briefs: {
      headline: "Attente de confirmation", oneLiner: "Support tenu.", marketBrief: "Marché stable.",
      thesisBrief: "Thèse confirmée.", deltaBrief: "Score en hausse.", whyNow: "Le support tient.",
      actionNow: "Surveiller.", nextFocus: "Cassure de résistance.",
    },
    latestChange: {
      stateTransition: { from: "WATCH", to: "WATCH" },
      scoreTransition: { from: 60, to: 72, delta: 12 },
      validatedElements: ["Support"], weakenedElements: [], invalidatedElements: [],
    },
    expectedVsRealized: [{ label: "Support", expected: "Tenue", realized: "Tenu", verdict: "confirm", impact: "positive" }],
    conditions: { go: [], invalidations: [] },
    setup: { setup_id: "setup-projected", status: "ARMED" },
    position: { status: "active", entry_price: 999 },
    marketContext: {},
    timelineEvent: { type: "MONITOR", title: "Monitor M15", summary: "Support tenu", severity: "watch" },
    drilldownRefs: { monitorId: "monitor-2" },
  };
}
