import { requireFact } from "./batch-contract.js";

export const blank = text => text === "" || text === "-";
export function numeric(text, fallback = null) {
  if (blank(text)) return fallback;
  requireFact(/^-?\d+(\.\d+)?$/.test(text) && Math.abs(Number(text)) <= 1e12, "PLAN_NUMBER_INVALID");
  return Number(text);
}
export function integer(text, { fallback, min, max }) {
  const value = numeric(text, fallback);
  requireFact(Number.isInteger(value) && value >= min && value <= max, "PLAN_INTEGER_INVALID"); return value;
}
export function price(text, presence = "required") {
  const value = numeric(text);
  requireFact(value !== null || presence === "optional", "PLAN_PRICE_REQUIRED");
  if (value !== null) requireFact(value > 0 && value <= 1e7 && Number.isInteger(value * 4), "PLAN_PRICE_TICK_INVALID");
  return value;
}
export function clock(text) {
  requireFact(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text), "PLAN_TIME_INVALID");
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
}
export function id(text) { requireFact(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(text), "PLAN_ID_INVALID"); return text; }
export function count(fields, size) { requireFact(fields.length === size, "PLAN_FIELD_COUNT", { record: fields[0], expected: size, actual: fields.length }); }
export function oneOf(value, values) { requireFact(values.includes(value), "PLAN_ENUM_INVALID", { value, supported: values }); }
export function zone(low, high) { requireFact(price(low) <= price(high), "PLAN_ZONE_REVERSED"); }

export function condition(fields, offset, role) {
  const [op, inputTf, level, lo, hi, buffer, countText, from] = fields.slice(offset);
  const close = ["CLOSE_GT", "CLOSE_GTE", "CLOSE_LT", "CLOSE_LTE"].includes(op);
  const cross = ["CROSS_UP", "CROSS_DOWN"].includes(op);
  const zoned = ["TOUCH_ZONE", "SWEEP_HIGH", "SWEEP_LOW", "RETEST_UP", "RETEST_DOWN"].includes(op);
  requireFact(close || cross || zoned || ["TOUCH_GTE", "TOUCH_LTE"].includes(op), "PLAN_CONDITION_UNSUPPORTED");
  const tf = blank(inputTf) ? "15" : inputTf;
  oneOf(tf, ["15", "60", "240"]);
  requireFact(close || cross || tf === "15", "PLAN_CONDITION_TIMEFRAME");
  if (zoned) { zone(lo, hi); requireFact(level === "-", "PLAN_ZONE_LEVEL_INVALID"); }
  else { price(level); requireFact(lo === "-" && hi === "-", "PLAN_LEVEL_ZONE_INVALID"); }
  integer(buffer, { fallback: 1, min: 0, max: 100 });
  const n = integer(countText, { fallback: 1, min: 1, max: 4 });
  const fromStep = integer(from, { fallback: 0, min: 0, max: 100000 });
  requireFact(close || n === 1, "PLAN_CONDITION_COUNT");
  requireFact(role === "INV" || fromStep === 0, "PLAN_FROM_STEP_ROLE");
  requireFact(role !== "GUARD" || (close && n === 1), "PLAN_GUARD_INVALID");
  return { op, fromStep };
}
