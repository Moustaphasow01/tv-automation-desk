import { AUTOPILOT_V4_MCP_TOOL_NAMES } from "./mcp-tool-slices.js";

export { AUTOPILOT_V4_MCP_TOOL_NAMES };

const AUTOPILOT_V4_MCP_TOOL_SET = new Set(AUTOPILOT_V4_MCP_TOOL_NAMES);
const commonTools = ["desk_ping", "get_active_contracts", "get_contract", "list_contract_versions"];
const liveWorkerTools = Object.freeze([...commonTools, "list_available_exports", "get_desk_pack", "get_dataset", "get_market_levels", "get_macro_calendar", "get_news_digest", "get_master_analysis_bundle", "prepare_master_cutoff_bundle_job", "prepare_due_live_master_bundle_job", "get_master_cutoff_bundle", "get_monitor_context_bundle", "get_manual_monitor_bundle", "prepare_m15_monitor_bundle_job", "prepare_due_live_m15_bundle_job", "claim_next_live_work", "claim_next_live", "heartbeat_live", "complete_live", "fail_live", "get_live_desk_state", "get_front_master_state", "get_front_monitor_state", "get_active_thesis", "get_latest_master_analysis", "get_latest_hourly_monitor", "get_level_map", "get_technical_events", "save_master_analysis", "save_active_thesis", "update_active_thesis", "save_hourly_monitor", "save_manual_monitor"]);
const replayWorkerTools = Object.freeze([...commonTools, "start_or_resume_replay_autopilot", "set_replay_automation", "drive_replay_automation", "create_orchestrated_replay_day", "set_replay_autopilot_window", "upsert_replay_autopilot_config", "prepare_replay_master_bundle", "get_replay_master_bundle", "save_replay_master_analysis", "advance_replay_clock", "prepare_replay_monitor_bundle", "get_replay_monitor_bundle", "get_replay_bundle_manifest", "get_replay_bundle_section", "get_replay_snapshot", "save_replay_monitor", "apply_replay_monitor_result", "simulate_replay_interval", "get_replay_timeline", "claim_next_replay_work", "claim_next_replay", "heartbeat_replay", "complete_replay", "fail_replay", "get_replay_state"]);
const researchWorkerTools = Object.freeze([...commonTools, "get_dataset", "get_market_levels", "get_macro_calendar", "get_news_digest", "get_replay_snapshot", "get_replay_timeline", "get_backtest_results", "get_backtest_timeline"]);
const executionGatewayTools = Object.freeze(commonTools);

export const MCP_STRICT_ROLE_SURFACES = Object.freeze({
  live_worker: { role: "live_worker", tools: liveWorkerTools, denied_patterns: ["replay", "backtest", "execution"] },
  replay_worker: { role: "replay_worker", tools: replayWorkerTools, denied_patterns: ["live", "manual_monitor_bundle", "master_cutoff"] },
  research_worker: { role: "research_worker", tools: researchWorkerTools, denied_patterns: ["save_", "claim_", "complete_", "fail_"] },
  execution_gateway: { role: "execution_gateway", tools: executionGatewayTools, denied_patterns: ["live", "replay", "save_", "claim_", "complete_", "fail_"] },
});

export function normalizeMcpToolProfile(value) {
  const profile = String(value || "autopilot_v4").trim().toLowerCase();
  if (["autopilot_v4", "v4", "autopilot-v4"].includes(profile)) return "autopilot_v4";
  if (["live", "live_worker", "live-worker"].includes(profile)) return "live_worker";
  if (["replay", "replay_worker", "replay-worker"].includes(profile)) return "replay_worker";
  if (["research", "research_worker", "research-worker"].includes(profile)) return "research_worker";
  if (["execution", "execution_gateway", "execution-gateway"].includes(profile)) return "execution_gateway";
  if (["all", "compatibility"].includes(profile)) {
    throw new Error("MCP_LEGACY_PROFILE_REMOVED:autopilot_v4_required");
  }
  throw new Error(`MCP_TOOL_PROFILE_INVALID:${value}`);
}

export function filterMcpTools(tools, profile = "autopilot_v4") {
  const normalized = normalizeMcpToolProfile(profile);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return toolNamesForProfile(normalized).map((name) => byName.get(name)).filter(Boolean);
}

export function isMcpToolExposed(name, profile = "autopilot_v4") {
  return toolSetForProfile(normalizeMcpToolProfile(profile)).has(name);
}

export function getMcpToolProfileSummary(profile = "autopilot_v4") {
  const normalized = normalizeMcpToolProfile(profile);
  const surface = MCP_STRICT_ROLE_SURFACES[normalized] || { role: "autopilot_v4_compat", tools: AUTOPILOT_V4_MCP_TOOL_NAMES, denied_patterns: [] };
  return { profile: normalized, role: surface.role, tool_count: surface.tools.length, denied_patterns: surface.denied_patterns };
}

function toolSetForProfile(profile) {
  return new Set(toolNamesForProfile(profile));
}

function toolNamesForProfile(profile) {
  return MCP_STRICT_ROLE_SURFACES[profile]?.tools || AUTOPILOT_V4_MCP_TOOL_NAMES;
}
