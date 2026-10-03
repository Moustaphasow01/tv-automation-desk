import { z } from "zod";
import { registerOosTool } from "./oos-mcp-tool.js";

const date = z.string().regex(/^2026-(07|08)-\d{2}$/), month = z.string().regex(/^2026-(07|08)$/);
const id = z.string().min(1).max(128), time = z.string().datetime({ offset: true });
const page = { cursor: z.string().max(4000).optional(), limit: z.number().int().min(1).max(200).optional() };
const day = { date }, scenario = { date, scenario_id: id }, episode = { ...scenario, attempt: z.number().int().min(0) };
const window = { date, start_time: time, end_time: time };
const filters = { scenario_id: id.optional(), attempt: z.number().int().min(0).optional(),
  start_time: time.optional(), end_time: time.optional() };
const months = { months: z.array(month).max(2).optional() };
const artifact = z.enum(["5m_final", "15m_final", "dashboard_final", "positions_final", "audit_json", "run_meta_json", "logs_txt"]);
const picture = z.enum(["5m_final", "15m_final", "dashboard_final", "positions_final"]);

export const FORENSIC_TOOL_INPUTS = {
  get_forensic_capabilities: {},
  get_forensic_index: { date: date.optional(), month: month.optional(), state: id.optional(),
    sample_purpose: id.optional(), scorable: z.boolean().optional(), ...page },
  get_frozen_plan: day,
  list_forensic_scenarios: { ...day, ...page },
  get_plan_scenario: scenario,
  list_scenario_attempts: { ...scenario, ...page },
  get_scenario_forensic_packet: { ...scenario, attempt: z.number().int().min(0).optional() },
  get_forensic_events: { ...day, ...filters, event_types: z.array(id).max(50).optional(), ...page },
  get_condition_timeline: episode,
  get_decision_snapshot: { ...episode, event_id: id.optional(), timestamp: time.optional() },
  get_ticket_snapshot: episode, get_refusal_detail: episode, get_rearm_history: scenario,
  get_group_history: { ...day, group_id: id }, get_portfolio_timeline: day,
  list_trades: { ...day, ...page }, get_trade_forensics: { ...day, trade_id: id },
  get_counterfactual_audit: { date: date.optional(), trade_id: id.optional(), scenario_id: id.optional(), ...page },
  get_persisted_market_bars: { ...window, timeframe: z.enum(["1m", "5m", "15m"]), ...page },
  get_market_window: { ...window, timeframes: z.array(z.enum(["1m", "5m", "15m"])).min(1).max(3), ...page },
  get_level_interactions: { ...window, levels: z.array(z.object({ id, price: z.number().finite() }).strict()).max(100).optional(),
    zones: z.array(z.object({ id, lo: z.number().finite(), hi: z.number().finite() }).strict()).max(100).optional() },
  get_replay_artifact: { ...day, artifact },
  get_artifact_crop: { ...day, artifact: picture, x: z.number().int().min(0).optional(), y: z.number().int().min(0).optional(),
    width: z.number().int().min(1).max(16000).optional(), height: z.number().int().min(1).max(16000).optional(),
    start_time: time.optional(), end_time: time.optional() },
  get_structured_panel: { ...day, view: z.enum(["AUDIT", "POSITIONS"]) },
  get_audit_json: day, get_run_meta_json: day,
  get_logs_slice: { ...day, ...filters, event: id.optional(), ...page },
  search_forensic_events: { ...months, event: id.optional(), reason_code: id.optional(), scenario_pattern: id.optional(),
    direction: z.enum(["LONG", "SHORT"]).optional(), confirmed: z.boolean().optional(), admitted: z.boolean().optional(),
    filled: z.boolean().optional(), attempt_min: z.number().int().min(0).optional(), attempt_max: z.number().int().min(0).optional(),
    terminal_state: id.optional(), ...page },
  search_forensic_scenarios: { ...months, reason_code: id.optional(), filled: z.boolean().optional(),
    wins: z.boolean().optional(), losses: z.boolean().optional(), direction: z.enum(["LONG", "SHORT"]).optional(),
    entry_rule: id.optional(), stop_rule: id.optional(), has_rearm: z.boolean().optional(), group_policy: id.optional(),
    step_count: z.number().int().min(0).optional(), terminal_state: id.optional(), ...page },
  verify_forensic_integrity: day, get_forensic_provenance: { ref: id },
};

const descriptions = {
  get_forensic_capabilities: "Inventory of actually persisted OOS evidence. Explicit NOT_PERSISTED limitations; no assumptions.",
  get_forensic_index: "Light paginated July/August day index: frozen hashes, coverage, scorable/smoke classification and artifact availability.",
  get_frozen_plan: "Exact frozen PLAN_SMC3 text, rehashed before response. Never reconstructs or repairs a plan.",
  get_plan_scenario: "All associated frozen SMC3 records verbatim with byte offsets, shared records and plan provenance.",
  get_scenario_forensic_packet: "T3 entry point: one scenario/episode, timeline references, ticket, trade and artifact references. No bulk images/logs.",
  get_condition_timeline: "Frozen STEP/INV/GUARD definitions and published STEP completion evidence. Unpublished evaluations stay NOT_PERSISTED.",
  get_decision_snapshot: "Exact historical ENGINE event snapshot by event_id or unambiguous timestamp. Never re-evaluates filters with future data.",
  get_persisted_market_bars: "Only already persisted continuous native OHLC series. NOT_PERSISTED if unavailable; never downloads market history.",
  get_market_window: "Bounded existing OHLC window, per timeframe availability. Never substitutes sparse events for continuous bars.",
  get_level_interactions: "Local deterministic level interactions only when complete persisted bars exist. No interpretation; otherwise NOT_PERSISTED.",
  get_replay_artifact: "Existing replay PNG pixels or exact UTF-8 JSON/TXT, SHA-256 checked before response. No capture/replay command.",
  get_artifact_crop: "Lossless in-memory crop of an existing PNG, parent SHA preserved. Time crop requires a persisted pixel mapping.",
  get_structured_panel: "Existing native AUDIT/POSITIONS table cells and presentation evidence. No OCR or invented table values.",
  search_forensic_events: "Cross-day filtered ENGINE event references only; paginated and provenance-linked. No financial aggregate.",
  search_forensic_scenarios: "Cross-day frozen scenario references matched to observed episodes/events/trades. No trading interpretation.",
  verify_forensic_integrity: "Rehash original sources and verify frozen identity against the read-only business registry.",
};

export function registerForensicTools({ server, auth, forensic }) {
  for (const [name, input] of Object.entries(FORENSIC_TOOL_INPUTS)) registerOosTool(server, auth, {
    name, mode: "read", forensic: true, input: z.object(input).strict(),
    description: descriptions[name] ?? `Read-only ${name} from persisted OOS evidence with provenance. Missing facts return NOT_PERSISTED. No trading changes.`,
    run: args => forensic.call(name, args),
  });
}
