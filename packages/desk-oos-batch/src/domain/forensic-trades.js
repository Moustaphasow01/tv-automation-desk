import { absentEvidence, publishedNumber, publishedTime } from "./forensic-evidence.js";

// Existing f_clean publication may blank lower-case 'r'. Recognise its labels; never repair source text.
const LABELS = { prix: "(?:prix|p ix)", risqueUSD: "(?:risqueUSD|isqueUSD)", q: "q" };
const number = (text, key) => publishedNumber(new RegExp(`(?:^|\\s)${LABELS[key]}=(-?[\\d.]+)`).exec(text)?.[1]);
function auditSegment(text, key, next) {
  const start = text.indexOf(`${key}=`);
  if (start < 0) return null;
  const body = text.slice(start + key.length + 1).split(/[ |]O\/H\/L\/C=/)[0], end = next ? body.indexOf(`/${next}=`) : -1;
  return (end < 0 ? body : body.slice(0, end)).replaceAll("N/D", "NOT_DEFINED").split("/").map(publishedNumber);
}

const SEGMENTS = ["Rn/Rp", "USD", "C/O/F/M/X", "E/S/T1/T2", "MFEp/n", "MAEp/n", "TTM/MX", "GBp/n", "BE", "P1"];
const FIELDS = {
  real_R: ["Rn/Rp", 0], real_gross_R: ["Rn/Rp", 1], real_USD: ["USD", 0],
  confirmation_time: ["C/O/F/M/X", 0], armed_time: ["C/O/F/M/X", 1], fill_time: ["C/O/F/M/X", 2],
  mfe_time: ["C/O/F/M/X", 3], exit_time: ["C/O/F/M/X", 4], entry: ["E/S/T1/T2", 0],
  stop_initial: ["E/S/T1/T2", 1], tp1: ["E/S/T1/T2", 2], tp2: ["E/S/T1/T2", 3],
  mfe_rp: ["MFEp/n", 0], mfe_rn: ["MFEp/n", 1], mae_rp: ["MAEp/n", 0], mae_rn: ["MAEp/n", 1],
  time_to_mfe: ["TTM/MX", 0], mfe_to_exit: ["TTM/MX", 1], giveback_rp: ["GBp/n", 0], giveback_rn: ["GBp/n", 1],
  cf_BE_0_5: ["BE", 0], cf_BE_1: ["BE", 1], cf_BE_1_5: ["BE", 2], cf_P1_at_1R: ["P1", 0],
};

/** Parse labelled values actually published by A395. Never reconstruct financial metrics. */
export function publishedTradeAudit(detail) {
  if (!detail.startsWith("A395/")) return null;
  const segments = Object.fromEntries(SEGMENTS.map((key, i) => [key, auditSegment(detail, key, SEGMENTS[i + 1])]));
  const values = Object.fromEntries(Object.entries(FIELDS).map(([name, [key, offset]]) => {
    const value = segments[key]?.[offset] ?? null;
    return [name, name.endsWith("_time") ? publishedTime(value) : value];
  }));
  return { native_trade_id: detail.slice(5, detail.indexOf("/Rn/Rp=")), ...values };
}

export function forensicTrades({ events, scenarios, identity, fingerprint }) {
  return events.filter(e => e.event === "FILLED").map(fill => {
    const nativeId = /(?:trade|t ade)=(.*?)\s+(?:prix|p ix)=/.exec(fill.detail)?.[1] ?? null;
    const related = events.filter(e => e.episode_id === fill.episode_id);
    const exit = related.find(e => e.event === "TRADE_EXIT" && publishedTradeAudit(e.detail)?.native_trade_id === nativeId);
    const audit = exit ? publishedTradeAudit(exit.detail) : null;
    return tradeProjection({ fill, exit, audit, nativeId, related, scenarios, identity, fingerprint });
  });
}

function tradeProjection({ fill, exit, audit, nativeId, related, scenarios, identity, fingerprint }) {
  const time = audit ? audit.fill_time : fill.event_from;
  const scenario = scenarios.find(s => s.scenario_id === fill.scenario_id);
  const closed = related.filter(e => e.event === "CLOSED").at(-1);
  return { trade_id: fingerprint(`${identity.date}|${fill.scenario_id}|${fill.attempt}|${time}|${identity.plan_sha256}`),
    ...audit, native_trade_id: nativeId, scenario_id: fill.scenario_id, attempt: fill.attempt, episode_id: fill.episode_id,
    direction: scenario ? scenario.direction : null, fill_time: time, entry_time: time, entry: audit ? audit.entry : number(fill.detail, "prix"),
    risk_usd: number(fill.detail, "risqueUSD"), qty: number(fill.detail, "q"), fill_event_id: fill.event_id,
    exit_event_id: exit ? exit.event_id : null, exit_reason: closed ? closed.reason_codes : [],
    exit_legs: related.filter(e => e.event === "EXIT_LEG"), stop_changes: related.filter(e => e.event === "STOP_SCHEDULED"),
    management_levels_hit: related.filter(e => e.event === "LEVEL_MANAGE"), source: "ENGINE_PUBLISHED_ONLY", recalculated: false,
    provenance: exit || fill, derived_fields: ["trade_id", "episode_id", "event_references"],
    missing_fields: ["mfe_price", "mae_price", "tp1_state", "tp2_state", "duration"].map(absentEvidence) };
}
