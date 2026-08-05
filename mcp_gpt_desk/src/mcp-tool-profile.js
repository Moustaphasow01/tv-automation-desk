export const AUTOPILOT_V4_MCP_TOOL_NAMES = Object.freeze([
  "desk_ping",
  "get_active_contracts",
  "get_contract",
  "list_contract_versions",
  "get_latest_asia_open_pack",
  "list_available_exports",
  "get_desk_pack",
  "get_dataset",
  "get_market_levels",
  "get_macro_calendar",
  "get_news_digest",
  "get_master_analysis_bundle",
  "prepare_master_cutoff_bundle_job",
  "prepare_due_live_master_bundle_job",
  "get_master_cutoff_bundle",
  "get_monitor_context_bundle",
  "get_manual_monitor_bundle",
  "prepare_m15_monitor_bundle_job",
  "prepare_due_live_m15_bundle_job",
  "get_live_desk_state",
  "get_front_master_state",
  "get_front_monitor_state",
  "get_replay_state",
  "claim_next_live_work",
  "claim_next_replay_work",
  "claim_next_desk_work",
  "claim_next_live",
  "heartbeat_live",
  "complete_live",
  "fail_live",
  "claim_next_replay",
  "heartbeat_replay",
  "complete_replay",
  "fail_replay",
  "get_desk_work_item",
  "peek_next_desk_work",
  "heartbeat_desk_work",
  "complete_desk_work",
  "fail_desk_work",
  "upsert_replay_autopilot_config",
  "set_replay_autopilot_window",
  "start_or_resume_replay_autopilot",
  "set_replay_automation",
  "drive_replay_automation",
  "create_orchestrated_replay_day",
  "prepare_replay_master_bundle",
  "get_replay_master_bundle",
  "save_replay_master_analysis",
  "advance_replay_clock",
  "prepare_replay_monitor_bundle",
  "get_replay_monitor_bundle",
  "get_replay_bundle_manifest",
  "get_replay_bundle_section",
  "get_replay_snapshot",
  "save_replay_monitor",
  "apply_replay_monitor_result",
  "simulate_replay_interval",
  "get_replay_timeline",
  "get_backtest_results",
  "get_backtest_timeline",
  "get_active_thesis",
  "get_latest_master_analysis",
  "get_latest_hourly_monitor",
  "get_level_map",
  "get_technical_events",
  "save_master_analysis",
  "save_active_thesis",
  "update_active_thesis",
  "save_hourly_monitor",
  "save_manual_monitor",
]);

const AUTOPILOT_V4_MCP_TOOL_SET = new Set(AUTOPILOT_V4_MCP_TOOL_NAMES);

export function normalizeMcpToolProfile(value) {
  const profile = String(value || "autopilot_v4").trim().toLowerCase();
  if (["autopilot_v4", "v4", "autopilot-v4"].includes(profile)) return "autopilot_v4";
  if (["all", "compatibility"].includes(profile)) {
    throw new Error("MCP_LEGACY_PROFILE_REMOVED:autopilot_v4_required");
  }
  throw new Error(`MCP_TOOL_PROFILE_INVALID:${value}`);
}

export function filterMcpTools(tools, profile = "autopilot_v4") {
  normalizeMcpToolProfile(profile);
  return tools.filter((tool) => AUTOPILOT_V4_MCP_TOOL_SET.has(tool.name));
}

export function isMcpToolExposed(name, profile = "autopilot_v4") {
  normalizeMcpToolProfile(profile);
  return AUTOPILOT_V4_MCP_TOOL_SET.has(name);
}
