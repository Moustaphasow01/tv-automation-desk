const REPLAY_NEXT_ACTION_BY_STATUS = Object.freeze({
  CREATED: "prepare_replay_master_bundle",
  MASTER_DATA_PREPARING: "prepare_replay_master_bundle",
  MASTER_DATA_READY: "copy_master_prompt_for_chatgpt",
  WAITING_GPT_MASTER: "copy_master_prompt_then_gpt_reads_bundle_and_saves_replay_master_analysis",
  MASTER_RUNNING_MANUAL: "save_replay_master_analysis",
  MASTER_SAVED: "materialize_replay_master",
  MASTER_MATERIALIZED: "advance_replay_clock",
  READY_FOR_NEXT_MONITOR: "advance_replay_clock",
  ADVANCING_CLOCK: "prepare_replay_monitor_bundle",
  MONITOR_DATA_PREPARING: "prepare_replay_monitor_bundle",
  MONITOR_DATA_READY: "copy_monitor_prompt_for_chatgpt",
  WAITING_GPT_MONITOR: "copy_monitor_prompt_then_gpt_reads_bundle_and_saves_replay_monitor",
  MONITOR_RUNNING_MANUAL: "save_replay_monitor",
  MONITOR_SAVED: "apply_replay_monitor_result",
  MONITOR_APPLIED: "apply_replay_monitor_result",
  SIMULATION_UPDATED: "advance_replay_clock",
  WAITING_NEXT_STEP: "advance_replay_clock",
  REPLAN_REQUIRED: "prepare_replay_master_bundle",
  DAY_END: "review_replay_report",
  COMPLETED: "review_replay_report",
  FAILED: "inspect_replay_error",
  CANCELLED: "start_new_replay",
});

export function replayNextAction(status) {
  return REPLAY_NEXT_ACTION_BY_STATUS[status] || "refresh_replay_state";
}

export { REPLAY_NEXT_ACTION_BY_STATUS };
