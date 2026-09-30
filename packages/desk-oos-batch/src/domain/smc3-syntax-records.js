import { requireFact } from "./batch-contract.js";
import { numeric, integer, price, clock, id, count, oneOf, zone } from "./smc3-syntax-values.js";

export function scenario(fields, effective) {
  count(fields, 18);
  const [, sid, name, side, priority, start, end, ttl, bars, entryType, entryRule, entry, ratio, stopRule, stop, ticks, tp1, tp2] = fields;
  id(sid); requireFact(name.length > 0 && name.length <= 96, "PLAN_NAME_INVALID");
  oneOf(side, ["LONG", "SHORT"]);
  const rank = integer(priority, { fallback: 1, min: 1, max: 1e9 });
  const from = clock(start), until = clock(end);
  requireFact(Math.max(from, effective) >= 540 && until <= 1200 && Math.max(from, effective) < until
    && Math.max(from, effective) % 15 === 0 && until % 15 === 0, "PLAN_ENGINE_TIME_WINDOW");
  integer(ttl, { fallback: 44, min: 1, max: 44 }); integer(bars, { fallback: 4, min: 1, max: 16 });
  integer(ticks, { fallback: 2, min: 2, max: 100 });
  const entryPrice = price(entry, "optional"), stopPrice = price(stop, "optional");
  const ratioValue = numeric(ratio, 0.5), target = price(tp1), target2 = price(tp2, "optional");
  validateEntry({ entryType, entryRule, entry, ratio, entryPrice, ratioValue });
  oneOf(stopRule, ["FIXED", "SEQUENCE_EXTREME", "CONFIRM_EXTREME", "RETEST_EXTREME", "ZONE_EDGE"]);
  requireFact(stopRule === "FIXED" ? stopPrice !== null : stop === "-", "PLAN_STOP_SYNTAX");
  const direction = side === "LONG" ? 1 : -1;
  requireFact(target2 === null || direction * (target2 - target) > 0, "PLAN_TARGET_ORDER");
  requireFact(entryPrice === null || direction * (target - entryPrice) > 0, "PLAN_TARGET_SIDE");
  requireFact(entryPrice === null || stopPrice === null || direction * (entryPrice - stopPrice) > 0, "PLAN_STOP_SIDE");
  return { sid, rank, entryRule, stopRule, target2, steps: [], invalidations: [], extras: new Set(), links: [] };
}
function validateEntry({ entryType, entryRule, entry, ratio, entryPrice, ratioValue }) {
  oneOf(entryType, ["NEXT_OPEN", "LIMIT"]);
  if (entryType === "NEXT_OPEN") {
    requireFact(entryRule === "CLOSE" && entry === "-" && ratio === "-", "PLAN_NEXT_OPEN_SYNTAX"); return;
  }
  oneOf(entryRule, ["FIXED", "BODY_RETRACE", "RR_RETEST"]);
  if (entryRule === "FIXED") requireFact(entryPrice !== null && ratio === "-", "PLAN_FIXED_SYNTAX");
  if (entryRule === "RR_RETEST") requireFact(entry === "-" && ratio === "-", "PLAN_RR_RETEST_SYNTAX");
  if (entryRule === "BODY_RETRACE") requireFact(entry === "-" && ratioValue > 0 && ratioValue < 1, "PLAN_RETRACE_SYNTAX");
}

export function extra(fields, scenario) {
  const tag = fields[0];
  requireFact(tag === "LEVEL" || !scenario.extras.has(tag), "PLAN_RECORD_DUPLICATE"); scenario.extras.add(tag);
  if (tag === "MEMBER") { count(fields, 3); scenario.group = id(fields[2]); }
  if (tag === "REARM") {
    count(fields, 8); zone(fields[3], fields[4]);
    integer(fields[2], { fallback: 2, min: 1, max: 44 }); integer(fields[5], { fallback: 2, min: 1, max: 100 });
    integer(fields[6], { fallback: 2, min: 1, max: 10 }); integer(fields[7], { fallback: 0, min: 0, max: 1e9 });
  }
  if (["ENTRY_ZONE", "STOP_ZONE"].includes(tag)) { count(fields, 4); zone(fields[2], fields[3]); }
  if (tag === "FILTER") filter(fields);
  if (tag === "EXIT") {
    count(fields, 4); const fraction = numeric(fields[2]);
    requireFact(fraction > 0 && fraction <= 1, "PLAN_EXIT_FRACTION"); oneOf(fields[3], ["KEEP", "BE"]);
    requireFact(fraction === 1 || scenario.target2 !== null, "PLAN_EXIT_TARGET_REQUIRED");
  }
  if (tag === "LEVEL") {
    count(fields, 5); oneOf(fields[2], ["HARD", "INFO", "MANAGE"]); price(fields[3]);
    requireFact(fields[4] === (fields[2] === "MANAGE" ? "BE" : "NONE"), "PLAN_LEVEL_ACTION");
  }
}
function filter(fields) {
  count(fields, 8);
  const values = fields.slice(2, 7).map(value => numeric(value, 0));
  requireFact(values.every(value => value >= 0) && values[1] <= 1 && values[2] <= 1, "PLAN_FILTER_RANGE");
  price(fields[7], values[4] > 0 ? "required" : "optional");
}
