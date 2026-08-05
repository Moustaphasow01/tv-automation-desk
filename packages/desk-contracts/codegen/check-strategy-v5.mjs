#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = async (...parts) => JSON.parse(await readFile(join(packageRoot, ...parts), "utf8"));
const enums = await readJson("enums", "enums.json");
const catalog = await readJson("catalogs", "condition-catalog-v1-2.json");
const planSchema = await readJson("schemas", "entities", "execution-plan-v1-3.schema.json");
const compiledPlanSchema = await readJson("schemas", "entities", "compiled-execution-plan-v1-3.schema.json");
const compiledCommandSchema = await readJson("schemas", "entities", "compiled-monitor-command-v1-3.schema.json");

assert.equal(catalog.schema_version, "1.2.0");
assert.equal(catalog.catalog_id, "condition_catalog_v1_2");
assert.equal(planSchema.version, "1.3.0");
assert.equal(planSchema.properties.monitoring.properties.gpt_cadence.const, "M15");
assert.equal(planSchema.properties.setups.maxItems, 5);
assert.equal(planSchema.$defs.setupProposal.properties.rank.maximum, 5);
assert.equal(compiledPlanSchema.properties.schema_version.const, "deterministic_execution_plan_v1_3");
assert.equal(compiledPlanSchema.properties.compiler_version.const, "1.3.0");
assert.equal(compiledPlanSchema.properties.ranked_setups.maxItems, 5);
assert.equal(compiledPlanSchema.$defs.policy.properties.policy_version.const, "1.2.0");
assert.equal(compiledPlanSchema.$defs.gateEvaluation.properties.schema_version.const, "opportunity_policy_evaluation_v1_2");
assert.equal(compiledPlanSchema.$defs.gateEvaluation.properties.policy_version.const, "1.2.0");
assert.equal(compiledCommandSchema.properties.schema_version.const, "desk_monitor_command_v1_3");
assert.equal(compiledCommandSchema.properties.compiler_version.const, "1.3.0");
assert.equal(compiledCommandSchema.$defs.policy.properties.policy_version.const, "1.2.0");

const operatorCodes = catalog.operators.map((entry) => entry.code);
const predicateCodes = catalog.predicate_types.map((entry) => entry.code);
const hardGateCodes = catalog.hard_gates.map((entry) => entry.code);
const softGateCodes = catalog.soft_gates.map((entry) => entry.code);
assert.deepEqual(operatorCodes, enums.CONDITION_OPERATORS_V2);
assert.deepEqual(predicateCodes, enums.PREDICATE_TYPES_V1);
assert.deepEqual(hardGateCodes, enums.HARD_GATE_CODES_V5);
assert.deepEqual(softGateCodes, enums.SOFT_GATE_CODES_V5);
assert.deepEqual(catalog.setup_patterns, enums.SETUP_PATTERN_CODES);
assert.equal(new Set(predicateCodes).size, 11);
assert.equal(new Set(catalog.predicate_types.map((entry) => entry.backend_evaluator)).size, 11);

for (const predicate of catalog.predicate_types) {
  assert.deepEqual(
    predicate.parameter_definitions.map((entry) => entry.name),
    predicate.required_parameters,
    `${predicate.code}: parameter definitions must exactly match required_parameters`,
  );
  assert.ok(predicate.allowed_operators.length > 0, `${predicate.code}: operators missing`);
  assert.ok(predicate.allowed_operators.every((operator) => operatorCodes.includes(operator)), `${predicate.code}: operator outside catalog`);
  assert.ok(predicate.source_requirements.length > 0, `${predicate.code}: source requirements missing`);
  assert.ok(predicate.source_requirements.some((source) => source.required === true), `${predicate.code}: no required source`);
  assert.equal(predicate.enforcement_phase, "ENTRY_TRIGGER", `${predicate.code}: wrong enforcement phase`);
  assert.ok(enums.PREDICATE_EVALUATION_FIELDS.includes(predicate.evaluation_field), `${predicate.code}: evaluation field outside enums`);
}

assert.deepEqual(
  catalog.predicate_types.find((entry) => entry.code === "BREAK_RETEST_SEQUENCE").required_parameters,
  ["break_condition_id", "retest_level", "tolerance_points", "max_bars", "require_rejection_confirmation"],
);
assert.deepEqual(
  catalog.predicate_types.find((entry) => entry.code === "VWAP_RELATION").required_parameters,
  ["reference_code"],
);
assert.deepEqual(
  catalog.predicate_types.find((entry) => entry.code === "INTERMARKET_CONFIRMATION").required_parameters,
  ["reference_instrument"],
);
assert.deepEqual(
  catalog.predicate_types.find((entry) => entry.code === "EVENT_BLACKOUT").required_parameters,
  ["event_window_ref"],
);

const expectedGatePhases = {
  ANTI_LOOKAHEAD_FAILED: "PLAN_COMPILE",
  SCOPE_CONTRACT_MISMATCH: "PLAN_COMPILE",
  CANONICAL_TRIGGER_DATA_MISSING: "ENTRY_TRIGGER",
  GEOMETRY_INVALID: "SETUP_ARM",
  RR_BELOW_MINIMUM: "SETUP_ARM",
  STOP_INVALID: "SETUP_ARM",
  TARGET_INVALID: "SETUP_ARM",
  SETUP_EXPIRED_OR_TERMINAL: "ENTRY_TRIGGER",
  DETERMINISTIC_VETO_ACTIVE: "ENTRY_TRIGGER",
  BROKER_SAFETY_FAILED: "BROKER_SUBMIT",
  MAJOR_EVENT_ENTRY_BLOCK: "ENTRY_TRIGGER",
  MANDATORY_INDICATOR_MISSING: "ENTRY_TRIGGER",
};
assert.deepEqual(Object.fromEntries(catalog.hard_gates.map((gate) => [gate.code, gate.enforcement_phase])), expectedGatePhases);
assert.ok(catalog.hard_gates.every((gate) => gate.pass_semantics === "FAILURE_ABSENT"));

assert.equal(
  catalog.memory_policy_semantics.LATCH_UNTIL_TRIGGER,
  "REQUIRE_TRUE activation or confirmation only; forbidden for BLOCK_IF_TRUE.",
);
assert.match(catalog.memory_policy_semantics.LATEST_ONLY, /Temporary VETO/);
assert.match(catalog.memory_policy_semantics.INVALIDATE_TERMINAL, /structural INVALIDATION/);
const conditionRules = planSchema.$defs.condition.allOf;
const vetoMemoryRule = conditionRules.find((rule) => rule.if?.properties?.role?.const === "VETO");
const invalidationMemoryRule = conditionRules.find((rule) => rule.if?.properties?.role?.const === "INVALIDATION");
const blockerMemoryRule = conditionRules.find((rule) =>
  rule.if?.properties?.effect?.const === "BLOCK_IF_TRUE"
  && Array.isArray(rule.then?.properties?.memory_policy?.enum));
assert.equal(vetoMemoryRule?.then?.properties?.memory_policy?.const, "LATEST_ONLY");
assert.equal(invalidationMemoryRule?.then?.properties?.memory_policy?.const, "INVALIDATE_TERMINAL");
assert.deepEqual(blockerMemoryRule?.then?.properties?.memory_policy?.enum, ["LATEST_ONLY", "INVALIDATE_TERMINAL"]);

assert.ok(planSchema.required.includes("plan_id"));
assert.ok(compiledPlanSchema.required.includes("plan_id"));
assert.ok(compiledCommandSchema.required.includes("plan_id"));
assert.equal(
  planSchema.allOf.some((rule) => rule.if?.properties?.gates && rule.then?.properties?.disposition),
  false,
  "Plan schema must not globally block setup dispositions for a hard gate from a future phase",
);

console.log(JSON.stringify({
  ok: true,
  predicates: predicateCodes.length,
  hard_gates: hardGateCodes.length,
  soft_gates: softGateCodes.length,
  plan_id_required: true,
  phase_aware: true,
  memory_policy_semantics: true,
}));
