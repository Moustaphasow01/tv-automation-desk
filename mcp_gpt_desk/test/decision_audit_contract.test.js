import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import { getEntitySchema } from "@tv-automation/desk-contracts";

// ajv/dist/2020 is CJS; resolve the class whether exposed as default or namespace.
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const schema = getEntitySchema("decision-audit.schema.json");

function compile() {
  // A fresh instance per validator avoids "$id already exists" across tests.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function baseValid() {
  return {
    decision_timestamp_paris: "2026-07-02T10:15:00+02:00",
    data_cutoff_paris: "2026-07-02T10:15:00+02:00",
    available_data_until: "2026-07-02T10:15:00+02:00",
    future_data_used: false,
    entry_sl_tp_frozen: true,
    datasets_used: ["MNQ_M5"],
    macro_actuals_visible: [],
    macro_actuals_blocked: [],
    source_pack_id: "2026-07-02_asia_open",
  };
}

async function loadExample() {
  const url = new URL(
    "../../packages/desk-contracts/examples/decision-audit.example.json",
    import.meta.url,
  );
  return JSON.parse(await readFile(url, "utf8"));
}

test("decision audit example validates against the contract", async () => {
  const validate = compile();
  const example = await loadExample();
  const ok = validate(example);
  assert.equal(ok, true, JSON.stringify(validate.errors));
});

test("minimal anti-lookahead envelope validates", () => {
  const validate = compile();
  assert.equal(validate(baseValid()), true, JSON.stringify(validate.errors));
});

test("rejects a missing cutoff (required anti-lookahead field)", () => {
  const validate = compile();
  const bad = baseValid();
  delete bad.data_cutoff_paris;
  assert.equal(validate(bad), false);
});

test("rejects a missing entry_sl_tp_frozen flag", () => {
  const validate = compile();
  const bad = baseValid();
  delete bad.entry_sl_tp_frozen;
  assert.equal(validate(bad), false);
});

test("rejects a non-boolean future_data_used", () => {
  const validate = compile();
  assert.equal(validate({ ...baseValid(), future_data_used: "false" }), false);
});

test("rejects an empty datasets_used list", () => {
  const validate = compile();
  assert.equal(validate({ ...baseValid(), datasets_used: [] }), false);
});

test("rejects unknown top-level fields (strict envelope)", () => {
  const validate = compile();
  assert.equal(validate({ ...baseValid(), injected_hint: "leak" }), false);
});

test("records a violation: future_data_used true stays representable", () => {
  const validate = compile();
  // The schema allows recording a violation; the guard (T12) is what rejects it downstream.
  assert.equal(validate({ ...baseValid(), future_data_used: true }), true);
});

test("blocked macro actual may omit published_at_paris", () => {
  const validate = compile();
  const payload = {
    ...baseValid(),
    macro_actuals_blocked: [{ event: "US ISM Services PMI", importance: "high" }],
  };
  assert.equal(validate(payload), true, JSON.stringify(validate.errors));
});
