/* Generated from packages/desk-contracts/schemas. Do not edit manually. */



export const SESSION_VALUES = ["asia_open","asia_to_london","ny_open","custom"] as const;
export type SESSION_VALUESValue = typeof SESSION_VALUES[number];

export const VNEXT_SESSIONS = ["asia_open","london_session","ny_open","work_forward","post_event_replan"] as const;
export type VNEXT_SESSIONSValue = typeof VNEXT_SESSIONS[number];

export const DECISION_SESSIONS = ["asia_open","asia_to_london","ny_open"] as const;
export type DECISION_SESSIONSValue = typeof DECISION_SESSIONS[number];

export const DESK_INSTRUMENTS = ["MNQ","NQ","MES","ES","WAIT"] as const;
export type DESK_INSTRUMENTSValue = typeof DESK_INSTRUMENTS[number];

export const TRADE_INSTRUMENTS = ["MNQ","NQ","MES","ES"] as const;
export type TRADE_INSTRUMENTSValue = typeof TRADE_INSTRUMENTS[number];

export const THESIS_STATUSES = ["NO_ACTIVE_THESIS","THESIS_ACTIVE","THESIS_CONDITIONAL","WAIT_MONITORED","THESIS_WEAKENED","THESIS_AT_RISK","THESIS_INVALIDATED","SETUP_ARMED","SETUP_TRIGGERED","REPLAN_REQUIRED","EXPIRED"] as const;
export type THESIS_STATUSESValue = typeof THESIS_STATUSES[number];

export const ANALYSIS_TYPES = ["asia_open","london_session","ny_open","work_forward","live_position","post_event_replan","position_monitor","weekly_brief","daily_brief"] as const;
export type ANALYSIS_TYPESValue = typeof ANALYSIS_TYPES[number];

export const DATASETS = ["MNQ_M5","MES_M5","NQ_M15","NQ_H1","ES_M15","ES_H1","MNQ_H4","MES_H4","NQ_H4","ES_H4","US10Y_US02Y","US10Y_US02Y_H4","DXY_CL_GC_VIX","DXY_CL_GC_VIX_H4","indices_asie_europe","indices_asie_europe_H4","ny_close_mega_caps","mega_caps_premarket","mega_caps_premarket_H4","macro_calendar","news_digest"] as const;
export type DATASETSValue = typeof DATASETS[number];



export type ActiveThesisUpdate = {
  "thesis_id": string;
  "status"?: "NO_ACTIVE_THESIS" | "THESIS_ACTIVE" | "THESIS_CONDITIONAL" | "WAIT_MONITORED" | "THESIS_WEAKENED" | "THESIS_AT_RISK" | "THESIS_INVALIDATED" | "SETUP_ARMED" | "SETUP_TRIGGERED" | "REPLAN_REQUIRED" | "EXPIRED";
  "health_score"?: number;
  "confidence_pct"?: number;
  "last_monitor_id"?: string;
  "dominant_scenario"?: string;
  "secondary_scenario"?: string;
  "notes"?: string;
  [key: string]: unknown;
};

export type ActiveThesis = {
  "thesis_id"?: string;
  "linked_master_analysis_id": string;
  "status": "NO_ACTIVE_THESIS" | "THESIS_ACTIVE" | "THESIS_CONDITIONAL" | "WAIT_MONITORED" | "THESIS_WEAKENED" | "THESIS_AT_RISK" | "THESIS_INVALIDATED" | "SETUP_ARMED" | "SETUP_TRIGGERED" | "REPLAN_REQUIRED" | "EXPIRED";
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "direction": "long" | "short" | "neutral" | "wait";
  "dominant_scenario": string;
  "secondary_scenario"?: string;
  "confidence_pct": number;
  "health_score": number;
  "valid_from": string;
  "valid_until"?: string;
  "setup_expiry_time"?: string;
  "requires_replan_after"?: string;
  "key_levels"?: unknown[];
  "wait_to_go_conditions"?: unknown[];
  "invalidation_conditions"?: unknown[];
  "expected_path"?: {
  [key: string]: unknown;
};
  "failure_path"?: {
  [key: string]: unknown;
};
  "scenario_transformation_map"?: unknown[];
  "monitoring_playbook"?: unknown[];
  "last_monitor_id"?: string;
  [key: string]: unknown;
};

export type Analysis = {
  "schema_version": "1.0.0" | "1.1.0";
  "contract_name": "DeskFuturesAnalysisContract";
  "analysis_id": string;
  "created_at_paris": string;
  "mode": "live" | "backtest" | "replay" | "paper";
  "analysis_type": "asia_open" | "london_session" | "ny_open" | "work_forward" | "live_position" | "post_event_replan" | "position_monitor" | "weekly_brief" | "daily_brief";
  "pack_id": string;
  "report_id"?: string;
  "decision_id"?: string;
  "created_at"?: string;
  "session": "asia_open" | "asia_to_london" | "ny_open";
  "date": string;
  "timezone": "Europe/Paris";
  "title"?: string;
  "status"?: "draft" | "generated" | "ready" | "sent" | "archived";
  "scope": {
  [key: string]: unknown;
};
  "source_pack": {
  [key: string]: unknown;
};
  "executive_summary": {
  "summary": string;
  "final_decision": "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "final_instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "final_direction": "long" | "short" | "neutral" | "wait";
  "primary_setup_id"?: string;
  [key: string]: unknown;
};
  "context": {
  [key: string]: unknown;
};
  "market_funnel": {
  [key: string]: unknown;
};
  "levels": {
  [key: string]: unknown;
};
  "strategic_brief": {
  [key: string]: unknown;
};
  "decision_gates": {
  [key: string]: unknown;
};
  "summary"?: string;
  "primary_setup_id"?: string;
  "final_decision"?: "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "final_instrument"?: "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "final_direction"?: "long" | "short" | "neutral" | "wait";
  "setups": ({
  "setup_id": string;
  "label": string;
  "rank"?: number;
  "priority"?: number;
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "decision"?: "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "direction": "long" | "short" | "neutral" | "wait";
  "setup_type": "buy_limit_pullback" | "sell_limit_pullback" | "buy_stop_breakout" | "sell_stop_breakdown" | "sell_stop_breakdown_retest" | "buy_stop_breakout_retest" | "wait" | "wait_only" | "no_trade" | "management_only";
  "order_type"?: "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop" | "sell_stop_or_retest" | "buy_stop_or_retest" | "market" | "conditional" | "wait" | "cancel";
  "status"?: "active" | "secondary" | "inactive" | "cancelled" | "wait" | "management_only";
  "entry_zone"?: {
  "from": number;
  "to": number;
};
  "entry_trigger"?: string | {
  [key: string]: unknown;
};
  "stop_loss"?: number;
  "take_profits"?: ({
  "name": string;
  "target": number | {
  "from": number;
  "to": number;
};
  "condition"?: string;
  "action"?: string;
})[];
  "extension_target"?: number | {
  "from": number;
  "to": number;
};
  "invalidation": string | {
  [key: string]: unknown;
};
  "risk_pct": number;
  "confidence_pct": number;
  "rr_minimum"?: number;
  "reason": string;
  "conditions"?: string[];
  "management_rules"?: string[];
  "management"?: {
  [key: string]: unknown;
};
  "executable"?: boolean;
  [key: string]: unknown;
})[];
  "executable_decision": {
  "decision_id"?: string;
  "pack_id"?: string;
  "report_id"?: string;
  "analysis_id"?: string;
  "created_at"?: string;
  "session": "asia_open" | "asia_to_london" | "ny_open";
  "date": string;
  "timezone"?: "Europe/Paris";
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "asset_class"?: "futures";
  "decision": "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "direction": "long" | "short" | "neutral" | "wait";
  "setup_id"?: string;
  "setup_type": "buy_limit_pullback" | "sell_limit_pullback" | "buy_stop_breakout" | "sell_stop_breakdown" | "sell_stop_breakdown_retest" | "buy_stop_breakout_retest" | "wait" | "wait_only" | "no_trade" | "management_only";
  "order_type"?: string;
  "confidence_pct": number;
  "risk_pct": number;
  "rr_minimum": number;
  "entry_zone"?: {
  "from": number;
  "to": number;
};
  "entry_trigger"?: string;
  "stop_loss"?: number;
  "take_profits"?: {
  "tp1"?: number | {
  "from": number;
  "to": number;
};
  "tp2"?: number | {
  "from": number;
  "to": number;
};
  "tp3"?: number | {
  "from": number;
  "to": number;
};
};
  "extension_target"?: number | {
  "from": number;
  "to": number;
};
  "invalidation": string;
  "action_now"?: string;
  "no_trade_condition"?: string;
  "management_rules"?: string[];
  "time_rules"?: {
  "earliest_entry_time"?: string;
  "latest_entry_time"?: string;
  "reduce_before"?: string;
  "flatten_before"?: string;
};
  "macro_bias"?: string;
  "technical_bias"?: string;
  "cross_asset_bias"?: string;
  "reason_summary": string;
  "detailed_reason"?: string;
  "status"?: "draft" | "active" | "triggered" | "cancelled" | "tp1_hit" | "tp2_hit" | "tp3_hit" | "stopped" | "expired" | "archived";
  "decision_audit": {
  "contract_name"?: "DeskDecisionAuditContract";
  "schema_version"?: "1.0.0";
  "timezone"?: "Europe/Paris";
  "decision_timestamp_paris": string;
  "data_cutoff_paris": string;
  "available_data_until": string;
  "future_data_used": false;
  "entry_sl_tp_frozen": true;
  "datasets_used": string[];
  "macro_actuals_visible": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "macro_actuals_blocked": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "source_pack_id": string;
  "simulation_id"?: string | null;
  "mission_id"?: string | null;
  "decision_id"?: string;
  "thesis_id"?: string;
  "decision_timestamp_utc"?: string;
  "data_cutoff_utc"?: string;
  "available_data_until_utc"?: string;
  "entry_sl_tp_frozen_at_paris"?: string;
  "notes"?: string;
};
};
  "session_matrix": {
  [key: string]: unknown;
}[];
  "authorized_windows_summary": {
  [key: string]: unknown;
}[];
  "update_agenda": {
  [key: string]: unknown;
}[];
  "risk_management": {
  [key: string]: unknown;
};
  "monitoring_rules": {
  [key: string]: unknown;
};
  "final_sections": {
  "decision_executable": string;
  "regle_finale": string;
  [key: string]: unknown;
};
  "markdown"?: string;
};

export type ContextTransmission = {
  "context_id"?: string;
  "linked_analysis_id"?: string;
  "linked_monitor_id"?: string;
  "date"?: string;
  "session"?: string;
  [key: string]: unknown;
};

export type ContractActivation = {
  "contract_name": "DeskMasterAnalysisContract" | "DeskHourlyThesisMonitorContract" | "DeskFrontProjectionContract";
  "schema_version": string;
};

export type ContractList = {
  "contract_name": "DeskMasterAnalysisContract" | "DeskHourlyThesisMonitorContract" | "DeskFrontProjectionContract";
};

export type ContractLookup = {
  "contract_name": "DeskMasterAnalysisContract" | "DeskHourlyThesisMonitorContract" | "DeskFrontProjectionContract";
  "schema_version": string;
};

export type ContractRegistry = {
  "registry_version": "2.0.0";
  "active_contracts": {
  "master_contract": {
  [key: string]: unknown;
};
  "monitor_contract": {
  [key: string]: unknown;
};
  "front_projection_contract": {
  [key: string]: unknown;
};
  [key: string]: unknown;
};
  "entity_contracts": {
  "decision_audit_contract": {
  [key: string]: unknown;
};
  "simulation_run_contract": {
  [key: string]: unknown;
};
  "simulation_step_contract": {
  [key: string]: unknown;
};
  "worker_mission_contract": {
  [key: string]: unknown;
};
  "dashboard_state_contract": {
  [key: string]: unknown;
};
  "front_projection_contract": {
  [key: string]: unknown;
};
  [key: string]: unknown;
};
  "lifecycle_policy": {
  "statuses": ("draft" | "active" | "archived")[];
  "runtime_exposed": "master_monitor_only" | "entity_contracts_planned" | "all_active_contracts";
  "breaking_change_rule": string;
};
};

export type Contract = {
  "contract_id"?: string;
  "contract_name": "DeskMasterAnalysisContract" | "DeskHourlyThesisMonitorContract" | "DeskFrontProjectionContract";
  "schema_version": string;
  "status"?: "draft" | "active" | "archived";
  "content_markdown": string;
  "schema_json"?: {
  [key: string]: unknown;
};
  "hash"?: string;
  "is_active"?: boolean;
  "replaced_by"?: string | null;
  "force"?: boolean;
  [key: string]: unknown;
};

export type DashboardState = {
  "contract_name"?: "DeskDashboardState";
  "schema_version"?: "1.0.0";
  "state_id": string;
  "screen_id": "live_desk" | "session_matrix" | "master_analysis" | "setup_validation" | "management_console" | "decision_journal" | "simulation_lab" | "paper_trading" | "mission_control" | "review_center" | "system_health" | "settings" | "audit_view";
  "as_of_paris": string;
  "source_modules": string[];
  "required_data_status": ({
  "name": string;
  "status": "available" | "missing" | "stale" | "blocked" | "error";
  "source": string;
})[];
  "empty_state"?: string;
  "error_state"?: string;
  "blocked_state"?: string;
  "audit_requirement": "none" | "optional" | "required" | "blocking";
  "refresh_rule": string;
  "payload"?: {
  [key: string]: unknown;
};
};

export type DecisionAudit = {
  "contract_name"?: "DeskDecisionAuditContract";
  "schema_version"?: "1.0.0";
  "timezone"?: "Europe/Paris";
  "decision_timestamp_paris": string;
  "data_cutoff_paris": string;
  "available_data_until": string;
  "future_data_used": boolean;
  "entry_sl_tp_frozen": boolean;
  "datasets_used": string[];
  "macro_actuals_visible": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "macro_actuals_blocked": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "source_pack_id": string;
  "simulation_id"?: string | null;
  "mission_id"?: string | null;
  "decision_id"?: string;
  "thesis_id"?: string;
  "decision_timestamp_utc"?: string;
  "data_cutoff_utc"?: string;
  "available_data_until_utc"?: string;
  "entry_sl_tp_frozen_at_paris"?: string;
  "notes"?: string;
};

export type Decision = {
  "schema_version"?: "decision_v2";
  "decision_model"?: "single_decision_chain_v1";
  "source_type"?: "dashboard" | "gpt" | "strategy" | "worker" | "manual" | "system";
  "source_role"?: "proposer";
  "source_ref"?: string;
  "proposer_id"?: string;
  "gate_status"?: "green" | "audit_required" | "review_required" | "blocked";
  "domain_status"?: "accepted" | "rejected" | "review_required";
  "thesis_id"?: string;
  "mission_id"?: string;
  "position_id"?: string;
  "outcome_id"?: string;
  "audit_id"?: string;
  "chain"?: {
  "thesis_id"?: string;
  "mission_id"?: string;
  "gate_status"?: "green" | "audit_required" | "review_required" | "blocked";
  "decision_id"?: string;
  "position_id"?: string;
  "outcome_id"?: string;
  "audit_id"?: string;
};
  "source_payload"?: {
  [key: string]: unknown;
};
  "decision_id"?: string;
  "pack_id"?: string;
  "report_id"?: string;
  "analysis_id"?: string;
  "created_at"?: string;
  "session": "asia_open" | "asia_to_london" | "ny_open";
  "date": string;
  "timezone"?: "Europe/Paris";
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "asset_class"?: "futures";
  "decision": "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "direction": "long" | "short" | "neutral" | "wait";
  "setup_id"?: string;
  "setup_type": "buy_limit_pullback" | "sell_limit_pullback" | "buy_stop_breakout" | "sell_stop_breakdown" | "sell_stop_breakdown_retest" | "buy_stop_breakout_retest" | "wait" | "wait_only" | "no_trade" | "management_only";
  "order_type"?: string;
  "confidence_pct": number;
  "risk_pct": number;
  "rr_minimum": number;
  "entry_zone"?: {
  "from": number;
  "to": number;
};
  "entry_trigger"?: string;
  "stop_loss"?: number;
  "take_profits"?: {
  "tp1"?: number | {
  "from": number;
  "to": number;
};
  "tp2"?: number | {
  "from": number;
  "to": number;
};
  "tp3"?: number | {
  "from": number;
  "to": number;
};
};
  "extension_target"?: number | {
  "from": number;
  "to": number;
};
  "invalidation": string;
  "action_now"?: string;
  "no_trade_condition"?: string;
  "management_rules"?: string[];
  "time_rules"?: {
  "earliest_entry_time"?: string;
  "latest_entry_time"?: string;
  "reduce_before"?: string;
  "flatten_before"?: string;
};
  "macro_bias"?: string;
  "technical_bias"?: string;
  "cross_asset_bias"?: string;
  "reason_summary": string;
  "detailed_reason"?: string;
  "status"?: "draft" | "active" | "triggered" | "cancelled" | "tp1_hit" | "tp2_hit" | "tp3_hit" | "stopped" | "expired" | "archived";
  "decision_audit": {
  "contract_name"?: "DeskDecisionAuditContract";
  "schema_version"?: "1.0.0";
  "timezone"?: "Europe/Paris";
  "decision_timestamp_paris": string;
  "data_cutoff_paris": string;
  "available_data_until": string;
  "future_data_used": false;
  "entry_sl_tp_frozen": true;
  "datasets_used": string[];
  "macro_actuals_visible": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "macro_actuals_blocked": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "source_pack_id": string;
  "simulation_id"?: string | null;
  "mission_id"?: string | null;
  "decision_id"?: string;
  "thesis_id"?: string;
  "decision_timestamp_utc"?: string;
  "data_cutoff_utc"?: string;
  "available_data_until_utc"?: string;
  "entry_sl_tp_frozen_at_paris"?: string;
  "notes"?: string;
};
};

export type DeskFrontProjection = {
  "contractName": "DeskFrontProjectionContract";
  "schemaVersion": "1.0.0";
  "source": {
  "sourceType": "MASTER" | "MONITOR";
  "sourceId": string;
  "masterId": string;
  "monitorId": string | null;
  "thesisId": string;
  "strategyId": "asia_open" | "ny_open_1530";
  "session": "asia_open" | "ny_open";
  "mode": "live" | "paper";
  "tradingDate": string;
  "runId": string;
  "timestampParis": string;
  "asOfUtc": string;
  "sequence": number;
  "revision": number;
};
  "status": {
  "deskStatus": string;
  "decision": string;
  "actionCode": string;
  "alertLevel": "info" | "watch" | "warning" | "action" | "critical" | "positive";
  "thesisStatus": string;
  "setupStatus": string;
  "positionStatus": string;
  "confidencePct": number;
  "healthScore": number;
  "riskPct": number;
};
  "briefs": {
  "headline": string;
  "oneLiner": string;
  "marketBrief": string;
  "thesisBrief": string;
  "deltaBrief": string;
  "whyNow": string;
  "actionNow": string;
  "nextFocus": string;
};
  "latestChange": {
  "stateTransition": {
  "from": string;
  "to": string;
};
  "scoreTransition": {
  "from": number;
  "to": number;
  "delta": number;
};
  "validatedElements": string[];
  "weakenedElements": string[];
  "invalidatedElements": string[];
};
  "expectedVsRealized": {
  "label": string;
  "expected": string;
  "realized": string;
  "verdict": string;
  "impact": string;
}[];
  "conditions": {
  "go": {
  [key: string]: unknown;
}[];
  "invalidations": {
  [key: string]: unknown;
}[];
};
  "setup": {
  [key: string]: unknown;
};
  "position": {
  [key: string]: unknown;
};
  "marketContext": {
  [key: string]: unknown;
};
  "timelineEvent": {
  [key: string]: unknown;
};
  "drilldownRefs": {
  [key: string]: unknown;
};
};

export type HourlyMonitor = {
  "monitor_id"?: string;
  "contract_name"?: "DeskHourlyThesisMonitorContract";
  "schema_version"?: "1.0.0";
  "contract_hash": string;
  "timestamp_paris": string;
  "linked_master_analysis_id": string;
  "linked_active_thesis_id": string;
  "linked_previous_monitor_id"?: string;
  "monitor_decision": {
  [key: string]: unknown;
};
  "thesis_health_score": {
  [key: string]: unknown;
};
  "expected_vs_realized"?: unknown[];
  "macro_update"?: {
  [key: string]: unknown;
};
  "cross_asset_delta"?: {
  [key: string]: unknown;
};
  "technical_delta"?: {
  [key: string]: unknown;
};
  "wait_to_go_check"?: unknown[];
  "invalidation_check"?: unknown[];
  "weak_signals"?: unknown[];
  "monitor_context_transmission"?: {
  [key: string]: unknown;
};
  "front_projection"?: unknown;
  [key: string]: unknown;
};

export type MasterAnalysis = {
  "analysis_id"?: string;
  "contract_name"?: "DeskMasterAnalysisContract";
  "schema_version"?: "4.0.0";
  "contract_hash": string;
  "pack_id": string;
  "date": string;
  "session": "asia_open" | "london_session" | "ny_open" | "work_forward" | "post_event_replan";
  "active_thesis_id"?: string;
  "report_id"?: string;
  "decision_id"?: string;
  "status"?: "ready" | "archived";
  "created_at_paris": string;
  "full_analysis": {
  [key: string]: unknown;
};
  "context_transmission"?: {
  [key: string]: unknown;
};
  "decision_journal"?: {
  [key: string]: unknown;
};
  "front_projection"?: unknown;
  [key: string]: unknown;
};

export type MonitorAlert = {
  "alert_id"?: string;
  "timestamp_paris"?: string;
  "alert_level": "info" | "watch" | "warning" | "action" | "critical";
  "title": string;
  "message": string;
  "linked_monitor_id"?: string;
  "linked_thesis_id"?: string;
  "action_required"?: string;
  "send_to_telegram"?: boolean;
  [key: string]: unknown;
};

export type PositionManagement = {
  "position_id"?: string;
  "instrument"?: "MNQ" | "NQ" | "MES" | "ES";
  "direction"?: "long" | "short";
  "entry_price"?: number;
  "stop_loss"?: number;
  "take_profits"?: unknown[];
  "risk_pct"?: number;
  "status"?: "active" | "protected" | "partial_taken" | "closed" | "cancelled";
  "linked_thesis_id"?: string;
  "linked_decision_id"?: string;
  "management_action"?: "create" | "update" | "break_even" | "partial" | "reduce" | "exit" | "cancel";
  "notes"?: string;
  [key: string]: unknown;
};

export type Report = {
  "report_id"?: string;
  "pack_id"?: string;
  "decision_id"?: string;
  "date": string;
  "session": "asia_open" | "asia_to_london" | "ny_open";
  "timezone"?: "Europe/Paris";
  "title": string;
  "markdown": string;
  "summary"?: string;
  "sections"?: {
  [key: string]: unknown;
};
  "status"?: "generated" | "sent" | "archived";
};

export type Setup = {
  "setup_id": string;
  "label": string;
  "rank"?: number;
  "priority"?: number;
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "decision"?: "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "direction": "long" | "short" | "neutral" | "wait";
  "setup_type": "buy_limit_pullback" | "sell_limit_pullback" | "buy_stop_breakout" | "sell_stop_breakdown" | "sell_stop_breakdown_retest" | "buy_stop_breakout_retest" | "wait" | "wait_only" | "no_trade" | "management_only";
  "order_type"?: "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop" | "sell_stop_or_retest" | "buy_stop_or_retest" | "market" | "conditional" | "wait" | "cancel";
  "status"?: "active" | "secondary" | "inactive" | "cancelled" | "wait" | "management_only";
  "entry_zone"?: {
  "from": number;
  "to": number;
};
  "entry_trigger"?: string | {
  [key: string]: unknown;
};
  "stop_loss"?: number;
  "take_profits"?: ({
  "name": string;
  "target": number | {
  "from": number;
  "to": number;
};
  "condition"?: string;
  "action"?: string;
})[];
  "extension_target"?: number | {
  "from": number;
  "to": number;
};
  "invalidation": string | {
  [key: string]: unknown;
};
  "risk_pct": number;
  "confidence_pct": number;
  "rr_minimum"?: number;
  "reason": string;
  "conditions"?: string[];
  "management_rules"?: string[];
  "management"?: {
  [key: string]: unknown;
};
  "executable"?: boolean;
  [key: string]: unknown;
};

export type SimulationRun = {
  "contract_name"?: "DeskSimulationRun";
  "schema_version"?: "1.0.0";
  "simulation_id": string;
  "date": string;
  "session": "asia_open" | "asia_to_london" | "ny_open" | "custom";
  "timezone": "Europe/Paris";
  "mode": "backtest" | "replay" | "simulation" | "paper";
  "status": "draft" | "running" | "paused" | "completed" | "failed" | "archived";
  "source_pack_id": string;
  "initial_cutoff_paris": string;
  "current_cutoff_paris": string;
  "created_at_paris": string;
  "completed_at_paris"?: string | null;
  "step_ids": string[];
  "decision_ids": string[];
  "audit_ids": string[];
  "outcome_ids"?: string[];
  "review_id"?: string | null;
  "notes"?: string;
};

export type SimulationStep = {
  "contract_name"?: "DeskSimulationStep";
  "schema_version"?: "1.0.0";
  "step_id": string;
  "simulation_id": string;
  "step_index": number;
  "step_type": "next_5m" | "next_15m" | "next_hour" | "next_event" | "end_session";
  "status": "pending" | "applied" | "blocked" | "failed";
  "started_at_paris": string;
  "ended_at_paris": string;
  "data_cutoff_paris": string;
  "available_data_until": string;
  "visible_dataset_refs": {
  "dataset_id": string;
  "source": string;
  "available_until_paris"?: string;
}[];
  "blocked_dataset_refs": {
  "dataset_id": string;
  "source": string;
  "blocked_reason": string;
}[];
  "decision_id"?: string | null;
  "audit_id": string;
  "outcome_id"?: string | null;
  "action": {
  "type": "generate_master" | "generate_monitor" | "validate_setup" | "wait" | "replay_outcome" | "review" | "none";
  "summary"?: string;
};
  "notes"?: string;
};

export type WorkerMission = {
  "contract_name"?: "DeskWorkerMission";
  "schema_version"?: "1.0.0";
  "mission_id": string;
  "objective": string;
  "allowed_window": {
  "start_paris": string;
  "end_paris": string;
  "timezone": "Europe/Paris";
};
  "required_gates": string[];
  "dod": string[];
  "forbidden_actions": string[];
  "risk_rules": string[];
  "escalation_rules": string[];
  "expires_at_paris": string;
  "status": "draft" | "active" | "waiting" | "completed" | "expired" | "cancelled" | "escalated" | "failed";
  "result_schema_version"?: string;
  "audit_id"?: string | null;
};

