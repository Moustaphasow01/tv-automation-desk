import { requireFact } from "./batch-contract.js";
import { count, clock, id, oneOf, price, condition } from "./smc3-syntax-values.js";
import { scenario, extra } from "./smc3-syntax-records.js";

/** Syntax-only port of the observed V3.9.8 parser (TradingView script version 19.0).
 * No market observations, RR minimum, scoring, selection or plan rewriting exist here.
 * Engine capacities are explicit compatibility errors, never truncation or correction.
 */
export function validateSmc3Syntax(input) {
  const { plan_text: text, date, symbol, engine_version, schema, plan_sha256 } = input;
  requireFact(engine_version === "V3.9.8" && schema === "SMC3", "PLAN_VERSION_UNSUPPORTED");
  requireFact(symbol === "CME_MINI:MES1!", "PLAN_SYMBOL_UNSUPPORTED");
  requireFact(typeof text === "string" && text.isWellFormed() && text.trim().length > 0, "PLAN_TEXT_INVALID");
  requireFact(text.length <= 40960, "PLAN_ENGINE_TEXT_CAPACITY", { capacity: 40960, no_truncation: true });
  const records = text.split(";").filter(record => record.trim()).map(record => record.split("|").map(value => value.trim()));
  const header = records[0]; count(header, 8);
  requireFact(header[0] === "PLAN" && header[1] === "SMC3", "PLAN_HEADER_REQUIRED");
  requireFact(header[4] === symbol && header[5] === date, "PLAN_IDENTITY_MISMATCH");
  requireFact(header[2].length > 0 && header[2].length <= 96, "PLAN_ID_INVALID"); oneOf(header[3], ["SESSION", "DEMO"]);
  const known = clock(header[6]), effective = clock(header[7]);
  requireFact(known <= effective && effective >= 525 && effective < 1200 && effective % 15 === 0, "PLAN_EFFECTIVE_TIME");
  const stamp = new Date(`${date}T00:00:00Z`);
  requireFact(Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === date, "PLAN_DATE_INVALID");
  requireFact(![0, 6].includes(stamp.getUTCDay()), "PLAN_ENGINE_WEEKDAY_REQUIRED");
  const ctx = { scenarios: new Map(), groups: new Set(), ranks: new Set(), effective };
  records.slice(1).forEach((fields, index) => {
    try { record(fields, ctx); }
    catch (error) { error.details = { ...error.details, record: index + 2 }; throw error; }
  });
  references(ctx);
  return { syntax_valid: true, validation_scope: "SYNTAX_ONLY", date, symbol, engine_version, schema,
    plan_sha256, scenario_count: ctx.scenarios.size, validator_version: "smc3-v3.9.8-syntax/1" };
}

function record(fields, ctx) {
  const tag = fields[0];
  if (tag === "SCN") {
    const s = scenario(fields, ctx.effective);
    requireFact(!ctx.scenarios.has(s.sid) && !ctx.ranks.has(s.rank), "PLAN_ID_OR_PRIORITY_DUPLICATE");
    ctx.scenarios.set(s.sid, s); ctx.ranks.add(s.rank); return;
  }
  if (tag === "GROUP") {
    count(fields, 3); id(fields[1]); oneOf(fields[2], ["INDEPENDENT", "SERIAL", "OCO_FILL"]);
    requireFact(!ctx.groups.has(fields[1]), "PLAN_GROUP_DUPLICATE"); ctx.groups.add(fields[1]); return;
  }
  if (tag === "NOTICE") { count(fields, 9); condition(fields, 1, tag); return; }
  if (tag === "GAP") { gap(fields); return; }
  const s = ctx.scenarios.get(fields[1]); requireFact(s, "PLAN_SCENARIO_REFERENCE_UNKNOWN");
  if (["STEP", "INV", "GUARD"].includes(tag)) {
    count(fields, 10); const item = condition(fields, 2, tag);
    if (tag === "STEP") s.steps.push(item);
    if (tag === "INV") s.invalidations.push(item); return;
  }
  if (["DEP", "CANCEL"].includes(tag)) { link(fields, s); return; }
  if (tag === "OBS") { count(fields, 3); price(fields[2]); return; }
  oneOf(tag, ["MEMBER", "REARM", "ENTRY_ZONE", "STOP_ZONE", "FILTER", "EXIT", "LEVEL"]); extra(fields, s);
}
function link(fields, s) {
  count(fields, 4); id(fields[2]);
  oneOf(fields[3], ["ACTIVE", "INVALIDATED", "EXPIRED", "NON_ELIGIBLE", "CONFIRMED", "ARMED", "FILLED", "CLOSED", "CANCELLED_LINK"]);
  if (fields[0] === "DEP") { requireFact(!s.parent, "PLAN_DEP_DUPLICATE"); s.parent = fields[2]; }
  else requireFact(!["ARMED", "CONFIRMED"].includes(fields[3]), "PLAN_SMC3_CANCEL_UNSUPPORTED");
  requireFact(!s.links.some(item => item.tag === fields[0] && item.sid === fields[2] && item.event === fields[3]), "PLAN_LINK_DUPLICATE");
  s.links.push({ tag: fields[0], sid: fields[2], event: fields[3] });
}
function references({ scenarios, groups }) {
  for (const s of scenarios.values()) {
    requireFact(s.steps.length && s.invalidations.length, "PLAN_STEPS_INVALIDATIONS_REQUIRED");
    requireFact(!s.group || groups.has(s.group), "PLAN_GROUP_REFERENCE_UNKNOWN");
    requireFact(s.entryRule !== "RR_RETEST" || s.extras.has("ENTRY_ZONE"), "PLAN_ENTRY_ZONE_REQUIRED");
    requireFact(s.stopRule !== "ZONE_EDGE" || s.extras.has("STOP_ZONE"), "PLAN_STOP_ZONE_REQUIRED");
    requireFact(s.stopRule !== "RETEST_EXTREME" || s.steps.some(item => ["RETEST_UP", "RETEST_DOWN"].includes(item.op)), "PLAN_RETEST_REQUIRED");
    requireFact(s.invalidations.every(item => item.fromStep <= s.steps.length), "PLAN_STEP_REFERENCE_UNKNOWN");
    for (const item of s.links) requireFact(item.sid !== s.sid && scenarios.has(item.sid), "PLAN_LINK_REFERENCE_UNKNOWN");
    const seen = new Set([s.sid]); let parent = s.parent;
    while (parent) { requireFact(!seen.has(parent), "PLAN_DEP_CYCLE"); seen.add(parent); parent = scenarios.get(parent)?.parent; }
  }
}
function gap(fields) {
  count(fields, 6);
  for (const date of [fields[1], fields[3]]) {
    const value = new Date(`${date}T00:00:00Z`);
    requireFact(Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date, "PLAN_DATE_INVALID");
  }
  const a = Date.parse(`${fields[1]}T00:00:00Z`) + clock(fields[2]) * 60000;
  const b = Date.parse(`${fields[3]}T00:00:00Z`) + clock(fields[4]) * 60000;
  requireFact(b > a && b - a <= 4 * 86400000 && a % 900000 === 0 && b % 900000 === 0, "PLAN_GAP_INVALID");
}
