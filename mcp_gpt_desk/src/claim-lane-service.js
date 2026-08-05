import { createHash } from "node:crypto";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { deskError } from "./desk-errors.js";

const CONTROL_COLLECTION = DESK_COLLECTIONS.deskClaimLaneControls;
const LIVE_CURSOR_COLLECTION = "desk_live_run_cursor";
const REPLAY_CONFIG_COLLECTION = "desk_replay_autopilot_configs";
const LANES = new Set(["live", "replay"]);

export class ClaimLaneService {
  constructor({ persistence, clock }) {
    this.persistence = persistence;
    this.clock = clock;
  }

  async isEnabled(lane) {
    assertLane(lane);
    const control = await this.persistence.getDocument(CONTROL_COLLECTION, lane).catch(() => null);
    return control?.enabled !== false;
  }

  async overview() {
    const [controls, cursors, workItems, configs, preparations, events] = await Promise.all([
      this.persistence.listDocuments(CONTROL_COLLECTION, 10).catch(() => []),
      this.persistence.listDocuments(LIVE_CURSOR_COLLECTION, 500).catch(() => []),
      this.persistence.listDocuments(DESK_COLLECTIONS.deskAgentWorkItems, 1000).catch(() => []),
      this.persistence.listDocuments(REPLAY_CONFIG_COLLECTION, 500).catch(() => []),
      this.persistence.listDocuments(DESK_COLLECTIONS.deskReplayPreparationJobs, 500).catch(() => []),
      this.persistence.listDocuments(DESK_COLLECTIONS.deskAgentWorkEvents, 500).catch(() => []),
    ]);
    const controlsByLane = new Map(controls.map((item) => [item.lane, item]));
    const liveControl = projectControl(controlsByLane.get("live"), "live");
    const replayControl = projectControl(controlsByLane.get("replay"), "replay");
    const liveStatuses = countBy(cursors, "cursor_status");
    const replayItems = workItems.filter((item) => item.automation_scope === "replay" || String(item.workflow || "").startsWith("REPLAY_"));
    const replayStatuses = countBy(replayItems, "status");
    const configStatuses = countBy(configs, "status");
    const preparationStatuses = countBy(preparations, "status");
    const activity = events
      .filter((event) => String(event.scope || event.automation_scope || "").toLowerCase() === "replay"
        || String(event.workflow || "").startsWith("REPLAY_")
        || String(event.cursor_id || "").startsWith("livecur__"))
      .sort((left, right) => String(right.created_at_utc || right.timestamp_utc || "").localeCompare(String(left.created_at_utc || left.timestamp_utc || "")))
      .slice(0, 30)
      .map(projectActivityItem);
    return {
      ok: true,
      generated_at_utc: this.clock.now().utc,
      lanes: {
        live: {
          ...liveControl,
          counts: {
            total_cursors: cursors.length,
            due: Number(liveStatuses.DUE || 0),
            leased: Number(liveStatuses.LEASED || 0),
            retry: Number(liveStatuses.RETRY || 0),
            blocked: Number(liveStatuses.BLOCKED || 0),
            degraded: Number(liveStatuses.DEGRADED || 0),
            idle: Number(liveStatuses.IDLE || 0),
            closed: Number(liveStatuses.CLOSED || 0),
          },
          statuses: liveStatuses,
          items: cursors
            .sort((left, right) => String(right.updated_at_utc || "").localeCompare(String(left.updated_at_utc || "")))
            .slice(0, 20)
            .map(projectLiveItem),
        },
        replay: {
          ...replayControl,
          counts: {
            work_items: replayItems.length,
            ready: Number(replayStatuses.READY || 0),
            claimed: Number(replayStatuses.CLAIMED || 0),
            failed: Number(replayStatuses.FAILED || 0),
            completed: Number(replayStatuses.COMPLETED || 0),
            ready_configs: configs.filter((config) => config.enabled !== false && config.status === "READY").length,
            preparations_waiting: preparations.filter((item) => ["QUEUED", "DATA_CHECK", "PACK_BUILDING", "AWAITING_CONFIRMATION"].includes(item.status)).length,
          },
          statuses: replayStatuses,
          config_statuses: configStatuses,
          preparation_statuses: preparationStatuses,
          items: replayItems
            .sort((left, right) => String(right.updated_at_utc || right.created_at_utc || "").localeCompare(String(left.updated_at_utc || left.created_at_utc || "")))
            .slice(0, 20)
            .map(projectReplayItem),
        },
      },
      activity,
    };
  }

  async action({ lane, action, expected_revision, reason, actor = {} } = {}) {
    assertLane(lane);
    if (!["pause", "resume"].includes(action)) {
      throw deskError("CLAIM_LANE_ACTION_INVALID", `Unsupported claim lane action: ${action}.`);
    }
    const existing = await this.persistence.getDocument(CONTROL_COLLECTION, lane).catch(() => null);
    const current = projectControl(existing, lane);
    if (Number(expected_revision) !== current.revision) {
      throw deskError("REVISION_CONFLICT", `Claim lane ${lane} revision changed.`, {
        expected_revision,
        actual_revision: current.revision,
      });
    }
    const tick = this.clock.now();
    const enabled = action === "resume";
    const next = {
      lane,
      enabled,
      status: enabled ? "RUNNING" : "PAUSED",
      revision: current.revision + 1,
      reason,
      changed_by: actor.email || actor.uid || actor.kind || "operator",
      created_at_utc: existing?.created_at_utc || tick.utc,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    };
    await this.persistence.setDocument(CONTROL_COLLECTION, lane, next);
    const eventId = `laneevt__${createHash("sha256").update(`${lane}:${next.revision}:${tick.utc}`).digest("hex").slice(0, 24)}`;
    await this.persistence.setDocument(DESK_COLLECTIONS.deskOperationsEvents, eventId, {
      event_id: eventId,
      event_type: enabled ? "CLAIM_LANE_RESUMED" : "CLAIM_LANE_PAUSED",
      lane,
      status: next.status,
      revision: next.revision,
      reason,
      actor: next.changed_by,
      created_at_utc: tick.utc,
      created_at_paris: tick.paris,
    });
    return { ok: true, status: next.status, control: projectControl(next, lane) };
  }
}

function assertLane(lane) {
  if (!LANES.has(lane)) throw deskError("CLAIM_LANE_INVALID", `Unknown claim lane: ${lane}.`);
}

function projectControl(control, lane) {
  return {
    lane,
    enabled: control?.enabled !== false,
    status: control?.enabled === false ? "PAUSED" : "RUNNING",
    revision: Number(control?.revision || 0),
    reason: control?.reason || null,
    changed_by: control?.changed_by || null,
    updated_at_utc: control?.updated_at_utc || null,
  };
}

function countBy(items, field) {
  return items.reduce((output, item) => {
    const value = String(item?.[field] || "UNKNOWN").toUpperCase();
    output[value] = Number(output[value] || 0) + 1;
    return output;
  }, {});
}

function projectLiveItem(item) {
  return {
    cursor_id: item.cursor_id,
    cursor_status: item.cursor_status,
    trading_date: item.trading_date,
    session: item.session,
    strategy_id: item.strategy_id,
    data_quality: item.data_quality,
    target_checkpoint: item.target_checkpoint,
    last_completed_checkpoint: item.last_completed_checkpoint,
    updated_at_utc: item.updated_at_utc,
  };
}

function projectReplayItem(item) {
  return {
    work_item_id: item.work_item_id,
    status: item.status,
    workflow: item.workflow,
    backtest_id: item.backtest_id || item.run_id,
    session: item.session,
    sequence: item.sequence,
    cutoff_paris: item.cutoff_paris,
    worker_id: item.worker_id || item.claimed_by || null,
    attempt_count: Number(item.attempt_count || 0),
    failure_count: Number(item.failure_count || 0),
    updated_at_utc: item.updated_at_utc || item.created_at_utc,
  };
}

function projectActivityItem(item) {
  return {
    event_id: item.event_id,
    event_type: item.event_type,
    workflow: item.workflow,
    scope: item.scope || item.automation_scope,
    cursor_id: item.cursor_id,
    work_item_id: item.work_item_id,
    backtest_id: item.backtest_id || item.run_id,
    status: item.status,
    created_at_utc: item.created_at_utc || item.timestamp_utc,
  };
}
