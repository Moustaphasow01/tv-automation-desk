export const MCP_TOOL_SLICES = Object.freeze([
  {
    key: "platform.contracts",
    owner: "@trading-desk/platform",
    purpose: "Health checks and immutable contract registry access.",
    tools: {
      autopilot_v4: [
        "desk_ping",
        "get_active_contracts",
        "get_contract",
        "list_contract_versions",
      ],
      internal_legacy: [
        "save_contract",
        "activate_contract_version",
        "archive_contract_version",
      ],
    },
  },
  {
    key: "market-data.context",
    owner: "@trading-desk/market-data",
    purpose: "Point-in-time data pack, dataset and context reads.",
    tools: {
      autopilot_v4: [
        "get_latest_asia_open_pack",
        "list_available_exports",
        "get_desk_pack",
        "get_dataset",
        "get_market_levels",
        "get_macro_calendar",
        "get_news_digest",
      ],
      internal_legacy: [
        "get_condition_status",
        "get_raw_window",
      ],
    },
  },
  {
    key: "live.analysis-bundles",
    owner: "@trading-desk/agents",
    purpose: "Live Master and Monitor bundle preparation/read path.",
    tools: {
      autopilot_v4: [
        "get_master_analysis_bundle",
        "prepare_master_cutoff_bundle_job",
        "prepare_due_live_master_bundle_job",
        "get_master_cutoff_bundle",
        "get_monitor_context_bundle",
        "get_manual_monitor_bundle",
        "prepare_m15_monitor_bundle_job",
        "prepare_due_live_m15_bundle_job",
      ],
      internal_legacy: [
        "prepare_nyopen_master_bundle",
        "get_nyopen_strategy_state",
        "mark_nyopen_strategy_event",
      ],
    },
  },
  {
    key: "front.projections",
    owner: "@trading-desk/operations",
    purpose: "Read models consumed by the transitional operator front.",
    tools: {
      autopilot_v4: [
        "get_live_desk_state",
        "get_front_master_state",
        "get_front_monitor_state",
        "get_replay_state",
      ],
      internal_legacy: [
        "get_strategy_performance",
        "get_strategy_calendar",
        "get_strategy_day_detail",
        "get_live_timeline_event_detail",
        "recompute_strategy_performance",
      ],
    },
  },
  {
    key: "gpt-work.lifecycle",
    owner: "@trading-desk/agents",
    purpose: "Claim, heartbeat, complete and fail lifecycle for AI work items.",
    tools: {
      autopilot_v4: [
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
      ],
      internal_legacy: [],
    },
  },
  {
    key: "agent-runtime.admin",
    owner: "@trading-desk/agents",
    purpose: "Controlled runtime administration for tasks, metrics and dead-letter recovery.",
    tools: {
      autopilot_v4: [
        "get_agent_runtime_overview",
        "list_agent_runtime_tasks",
        "get_agent_runtime_task",
        "list_agent_runtime_dead_letters",
        "list_agent_runtime_metrics",
        "get_agent_runtime_pool_overview",
        "get_agent_runtime_scheduler_plan",
        "requeue_agent_runtime_dead_letter",
        "cancel_agent_runtime_task",
      ],
      internal_legacy: [],
    },
  },
  {
    key: "replay.autopilot",
    owner: "@trading-desk/simulation",
    purpose: "Replay V4 configuration, bundles, automation and deterministic interval simulation.",
    tools: {
      autopilot_v4: [
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
      ],
      internal_legacy: [
        "prepare_replay_monitor_bundles",
        "get_desk_setups",
        "replay_desk_setups",
      ],
    },
  },
  {
    key: "backtest.legacy",
    owner: "@trading-desk/simulation",
    purpose: "Legacy deterministic backtest and feature-engine compatibility surface.",
    tools: {
      autopilot_v4: [
        "get_backtest_results",
        "get_backtest_timeline",
      ],
      internal_legacy: [
        "create_backtest_run",
        "get_backtest_run",
        "list_backtest_runs",
        "run_next_backtest_step",
        "run_backtest_until_done",
        "cancel_backtest_run",
        "get_audit_state",
        "run_feature_engine",
      ],
    },
  },
  {
    key: "analysis.legacy-documents",
    owner: "@trading-desk/legacy-mcp-host",
    purpose: "Legacy thesis, report, context transmission and decision write tools pending vertical extraction.",
    tools: {
      autopilot_v4: [
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
      ],
      internal_legacy: [
        "archive_expired_theses",
        "save_desk_decision",
        "save_desk_analysis",
        "save_desk_report",
        "save_monitor_alert",
        "save_context_transmission",
        "save_monitor_context_transmission",
        "update_position_management",
        "update_desk_decision_status",
      ],
    },
  },
  {
    key: "desk-jobs.legacy",
    owner: "@trading-desk/operations",
    purpose: "Legacy operator job CRUD retained for compatibility until workflow registry replacement.",
    tools: {
      autopilot_v4: [],
      internal_legacy: [
        "create_desk_job",
        "get_desk_job",
        "list_desk_jobs",
        "update_desk_job_status",
        "cancel_desk_job",
      ],
    },
  },
]);

export const AUTOPILOT_V4_MCP_TOOL_NAMES = Object.freeze(
  MCP_TOOL_SLICES.flatMap((slice) => slice.tools.autopilot_v4 || []),
);

export const MCP_TOOL_SLICE_TOOL_NAMES = Object.freeze(
  MCP_TOOL_SLICES.flatMap((slice) => allSliceToolNames(slice)),
);

export const MCP_TOOL_SLICE_BY_TOOL = Object.freeze(
  Object.fromEntries(
    MCP_TOOL_SLICES.flatMap((slice) => (
      allSliceToolNames(slice).map((toolName) => [toolName, slice.key])
    )),
  ),
);

export function getMcpToolSlice(toolName) {
  return MCP_TOOL_SLICE_BY_TOOL[toolName] || null;
}

export function listMcpToolSliceSummaries() {
  return MCP_TOOL_SLICES.map((slice) => ({
    key: slice.key,
    owner: slice.owner,
    purpose: slice.purpose,
    autopilot_v4: slice.tools.autopilot_v4?.length || 0,
    internal_legacy: slice.tools.internal_legacy?.length || 0,
    total: allSliceToolNames(slice).length,
  }));
}

export function assertMcpToolSliceCoverage(actualToolNames) {
  const actual = [...new Set(actualToolNames)].sort();
  const assignedEntries = MCP_TOOL_SLICES.flatMap((slice) => (
    allSliceToolNames(slice).map((toolName) => ({ toolName, slice: slice.key }))
  ));
  const assigned = assignedEntries.map((entry) => entry.toolName).sort();
  const assignedSet = new Set(assigned);
  const actualSet = new Set(actual);
  const duplicateAssignments = assignedEntries
    .filter((entry, index) => assignedEntries.findIndex((candidate) => candidate.toolName === entry.toolName) !== index)
    .map((entry) => `${entry.toolName}:${entry.slice}`)
    .sort();

  return {
    ok: actual.every((toolName) => assignedSet.has(toolName))
      && assigned.every((toolName) => actualSet.has(toolName))
      && duplicateAssignments.length === 0,
    actual_count: actual.length,
    assigned_count: assigned.length,
    slice_count: MCP_TOOL_SLICES.length,
    missing_assignments: actual.filter((toolName) => !assignedSet.has(toolName)),
    stale_assignments: assigned.filter((toolName) => !actualSet.has(toolName)),
    duplicate_assignments: duplicateAssignments,
    summaries: listMcpToolSliceSummaries(),
  };
}

function allSliceToolNames(slice) {
  return Object.values(slice.tools).flat();
}
