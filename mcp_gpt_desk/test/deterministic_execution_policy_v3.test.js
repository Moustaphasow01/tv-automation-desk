import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";

const Ajv2020 = Ajv2020Module.default || Ajv2020Module;
const schemaUrl = new URL(
  "../../packages/desk-contracts/schemas/entities/deterministic-execution-setup-v3.schema.json",
  import.meta.url,
);
const schema = JSON.parse(await readFile(schemaUrl, "utf8"));

function validator() {
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}

function validSetup() {
  return {
    setup_id: "mnq_retest_short",
    status: "ARMED_CONDITIONAL",
    instrument: "MNQ",
    direction: "short",
    entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
    entry_zone: { lower: 100, upper: 101 },
    stop_loss: 103,
    take_profit_1: 95,
    rr_minimum: 2,
    valid_from_paris: "2026-06-11T00:15:00+02:00",
    expires_at_paris: "2026-06-11T02:15:00+02:00",
    conditions: [
      {
        condition_id: "activation",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M5",
        operator: "REJECT_ABOVE",
        threshold: 101,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
      },
      {
        condition_id: "invalidation",
        role: "INVALIDATION",
        effect: "BLOCK_IF_TRUE",
        instrument: "MNQ",
        timeframe: "M5",
        operator: "CLOSE_ABOVE",
        threshold: 103,
        importance: "HARD_BLOCKER",
        required_for_trigger: false,
        memory_policy: "INVALIDATE_TERMINAL",
      },
    ],
    trigger_policy: {
      min_score: 0.7,
      allow_entry_only: false,
      backend_can_trigger: true,
    },
    management_policy: {
      break_even_at_r: 0.7,
      tp1_close_fraction: 0.5,
    },
  };
}

test("deterministic execution V3 schema accepts a complete canonical setup", () => {
  const validate = validator();
  assert.equal(validate(validSetup()), true, JSON.stringify(validate.errors));
});

test("deterministic execution V3 schema rejects percentage scores and contradictory blockers", () => {
  const validate = validator();
  const candidate = validSetup();
  candidate.trigger_policy.min_score = 70;
  candidate.conditions[1].required_for_trigger = true;

  assert.equal(validate(candidate), false);
  assert.ok(validate.errors.some((error) => error.instancePath === "/trigger_policy/min_score"));
  assert.ok(validate.errors.some((error) => error.instancePath === "/conditions/1/required_for_trigger"));
});
