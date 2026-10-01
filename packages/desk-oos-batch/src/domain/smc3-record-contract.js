// Description of the deployed syntax validator, not a parser or a plan builder.
const field = (name, type, rules = {}) => ({ name, type, ...rules });
const identifier = name => field(name, "identifier", { pattern: "^[A-Za-z][A-Za-z0-9_-]{0,31}$" });
const price = (name, rules = {}) => field(name, "price", { exclusive_minimum: 0, maximum: 10000000, multiple_of: 0.25, ...rules });
const integer = (name, rules) => field(name, "integer", rules);
const clock = name => field(name, "time", { pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", timezone: "Europe/Paris" });
const enumeration = (name, values) => field(name, "enum", { values });
const scenarioId = () => identifier("scenario_id");
const zone = () => [price("lo"), price("hi")];
export const SMC3_ENUMS = Object.freeze({
  kind: ["SESSION", "DEMO"], side: ["LONG", "SHORT"], timeframe: ["15", "60", "240"],
  entry_type: ["NEXT_OPEN", "LIMIT"], entry_rule: ["CLOSE", "FIXED", "BODY_RETRACE", "RR_RETEST"],
  stop_rule: ["FIXED", "SEQUENCE_EXTREME", "CONFIRM_EXTREME", "RETEST_EXTREME", "ZONE_EDGE"],
  condition: ["TOUCH_ZONE", "TOUCH_GTE", "TOUCH_LTE", "CLOSE_GT", "CLOSE_GTE", "CLOSE_LT", "CLOSE_LTE",
    "CROSS_UP", "CROSS_DOWN", "SWEEP_HIGH", "SWEEP_LOW", "RETEST_UP", "RETEST_DOWN"],
  group_policy: ["INDEPENDENT", "SERIAL", "OCO_FILL"], exit_action: ["KEEP", "BE"],
  level_kind: ["HARD", "INFO", "MANAGE"], level_action: ["NONE", "BE"],
  link_event: ["ACTIVE", "INVALIDATED", "EXPIRED", "NON_ELIGIBLE", "CONFIRMED", "ARMED", "FILLED", "CLOSED", "CANCELLED_LINK"],
});
const condition = () => [enumeration("operator", SMC3_ENUMS.condition),
  enumeration("timeframe", [...SMC3_ENUMS.timeframe, "", "-"]), price("level", { absent: ["-"] }),
  price("lo", { absent: ["-"] }), price("hi", { absent: ["-"] }),
  integer("buffer_ticks", { minimum: 0, maximum: 100, blank_default: 1 }),
  integer("count", { minimum: 1, maximum: 4, blank_default: 1 }),
  integer("from_step", { minimum: 0, maximum: 100000, blank_default: 0 })];

export function describeSmc3Records() {
  const definitions = {
    PLAN: [enumeration("schema", ["SMC3"]), field("plan_id", "string", { min_length: 1, max_length: 96 }),
      enumeration("kind", SMC3_ENUMS.kind), enumeration("symbol", ["CME_MINI:MES1!"]),
      field("date", "date", { format: "YYYY-MM-DD", valid_civil_date: true, weekdays_only: true }), clock("known"), clock("effective")],
    SCN: [scenarioId(), field("name", "string", { min_length: 1, max_length: 96 }), enumeration("side", SMC3_ENUMS.side),
      integer("priority", { minimum: 1, maximum: 1000000000, blank_default: 1 }), clock("start"), clock("end"),
      integer("ttl_bars", { minimum: 1, maximum: 44, blank_default: 44 }),
      integer("order_bars", { minimum: 1, maximum: 16, blank_default: 4 }), enumeration("entry_type", SMC3_ENUMS.entry_type),
      enumeration("entry_rule", SMC3_ENUMS.entry_rule), price("entry", { absent: ["", "-"] }),
      field("body_retrace_ratio", "number", { blank_default: 0.5 }), enumeration("stop_rule", SMC3_ENUMS.stop_rule),
      price("stop", { absent: ["", "-"] }), integer("stop_buffer_ticks", { minimum: 2, maximum: 100, blank_default: 2 }),
      price("tp1"), price("tp2", { absent: ["", "-"] })],
    STEP: [scenarioId(), ...condition()], INV: [scenarioId(), ...condition()], GUARD: [scenarioId(), ...condition()],
    NOTICE: condition(), GROUP: [identifier("group_id"), enumeration("policy", SMC3_ENUMS.group_policy)],
    MEMBER: [scenarioId(), identifier("group_id")],
    REARM: [scenarioId(), integer("cooldown_bars", { minimum: 1, maximum: 44, blank_default: 2 }), ...zone(),
      integer("away_ticks", { minimum: 1, maximum: 100, blank_default: 2 }),
      integer("outside_bars", { minimum: 1, maximum: 10, blank_default: 2 }),
      integer("max_attempts", { minimum: 0, maximum: 1000000000, blank_default: 0, zero_means: "unbounded" })],
    ENTRY_ZONE: [scenarioId(), ...zone()], STOP_ZONE: [scenarioId(), ...zone()],
    FILTER: [scenarioId(), field("min_body_atr", "number", { minimum: 0, blank_default: 0 }),
      field("min_body_fraction", "number", { minimum: 0, maximum: 1, blank_default: 0 }),
      field("min_close_location", "number", { minimum: 0, maximum: 1, blank_default: 0 }),
      field("min_rvol", "number", { minimum: 0, blank_default: 0 }),
      field("max_extension_atr", "number", { minimum: 0, blank_default: 0 }), price("momentum_level", { absent: ["", "-"] })],
    EXIT: [scenarioId(), field("tp1_fraction", "number", { exclusive_minimum: 0, maximum: 1 }), enumeration("after_tp1", SMC3_ENUMS.exit_action)],
    LEVEL: [scenarioId(), enumeration("kind", SMC3_ENUMS.level_kind), price("price"), enumeration("action", SMC3_ENUMS.level_action)],
    DEP: [scenarioId(), identifier("parent_id"), enumeration("event", SMC3_ENUMS.link_event)],
    CANCEL: [scenarioId(), identifier("other_id"), enumeration("event", SMC3_ENUMS.link_event.filter(x => !["ARMED", "CONFIRMED"].includes(x)))],
    OBS: [scenarioId(), price("obstacle")],
    GAP: [field("start_date", "date", { format: "YYYY-MM-DD" }), clock("start_time"),
      field("end_date", "date", { format: "YYYY-MM-DD" }), clock("end_time"), field("reason", "string")],
  };
  return Object.fromEntries(Object.entries(definitions).map(([tag, fields]) => [tag, {
    field_count: fields.length + 1,
    fields: [enumeration("record_type", [tag]), ...fields].map((value, index) => ({ index, ...value })),
    rules: recordRules(tag),
  }]));
}

function recordRules(tag) {
  const rules = {
    PLAN: ["First non-empty record; exactly one header", "known <= effective; 08:45 <= effective < 20:00; effective aligned to 15 minutes"],
    SCN: ["IDs and numeric priorities are unique", "09:00 <= max(start,effective) < end <= 20:00; clipped start and end aligned 15m",
      "NEXT_OPEN: entry_rule=CLOSE, entry=-, ratio=-", "LIMIT FIXED: entry required, ratio=-",
      "LIMIT RR_RETEST: entry=-, ratio=-, ENTRY_ZONE required", "BODY_RETRACE: entry=-, 0<ratio<1 (blank defaults 0.5)",
      "FIXED stop requires price; every dynamic stop requires stop=-", "tp2 extends tp1 in scenario direction",
      "ZONE_EDGE requires STOP_ZONE; RETEST_EXTREME requires at least one RETEST_UP or RETEST_DOWN STEP",
      "When fixed entry exists: tp1 beyond entry; fixed stop on opposite side", "At least one STEP and one INV"],
    STEP: ["Appended in record order; from_step=0"], INV: ["from_step <= total STEP count; 0 watches immediately"],
    GUARD: ["Only CLOSE operators, count=1, from_step=0"], NOTICE: ["from_step=0; not a global HALT"],
    GROUP: ["Group ID unique; MEMBERS may forward-reference a group"], MEMBER: ["One membership per scenario; group must exist"],
    REARM: ["One per scenario; lo<=hi; max_attempts=0 means no attempt ceiling"],
    ENTRY_ZONE: ["One per scenario; lo<=hi"], STOP_ZONE: ["One per scenario; lo<=hi; required for ZONE_EDGE"],
    FILTER: ["One per scenario; momentum_level required only when max_extension_atr>0; 0 disables the respective filter"],
    EXIT: ["One per scenario; fraction<1 requires tp2; integer partial quantity is checked by ENGINE, not syntax"],
    LEVEL: ["Repeatable; MANAGE requires BE, HARD/INFO require NONE"],
    DEP: ["One parent per scenario; forward references allowed; no self-reference or cycle"],
    CANCEL: ["Repeatable; unique (scenario,other,event); no self-reference; ARMED/CONFIRMED forbidden for SMC3"],
    OBS: ["Repeatable; no uniqueness check for obstacle prices"],
    GAP: ["End strictly after start; duration <=4 days; endpoints aligned 15m; reason may be empty"],
  };
  const conditionRules = ["CLOSE/CROSS accept 15/60/240; all other operators require 15",
    "Only CLOSE allows count>1", "Zone operator: level=-, lo<=hi; level operator: lo=hi=-", "Blank timeframe defaults to 15"];
  const scenarioRules = !["PLAN", "GROUP", "NOTICE", "GAP", "SCN"].includes(tag) ? ["Referenced SCN must precede this record"] : [];
  return [...scenarioRules, ...(rules[tag] || []), ...(["STEP", "INV", "GUARD", "NOTICE"].includes(tag) ? conditionRules : [])];
}
