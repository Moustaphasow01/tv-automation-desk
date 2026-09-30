import test from "node:test";
import assert from "node:assert/strict";
import { validateSmc3Syntax } from "../src/domain/smc3-syntax.js";
import { sha256 } from "../src/adapter/artifact-archive.js";

// Synthetic grammar fixtures only. Never observations or plans for a real market run.
const header = "PLAN|SMC3|TEST_ONLY|DEMO|CME_MINI:MES1!|2026-07-30|09:00|09:15";
const branch = (id = "S1", rank = 1) => [
  `SCN|${id}|Synthetic fixture|LONG|${rank}|09:15|20:00|44|4|LIMIT|FIXED|100|-|FIXED|90|2|101|102`,
  `STEP|${id}|CLOSE_GTE|15|100|-|-|1|1|0`, `INV|${id}|CLOSE_LT|15|90|-|-|1|1|0`,
];
const validate = records => {
  const plan_text = [header, ...records].join(";\r\n") + ";";
  return validateSmc3Syntax({ plan_text, date: "2026-07-30", symbol: "CME_MINI:MES1!", schema: "SMC3",
    engine_version: "V3.9.8", plan_sha256: sha256(plan_text) });
};
test("18-field SCN accepts 18 branches without RR minimum or branch truncation", () => {
  const receipt = validate(Array.from({ length: 18 }, (_, i) => branch(`S${i + 1}`, i + 1)).flat());
  assert.equal(receipt.scenario_count, 18); assert.equal(receipt.validation_scope, "SYNTAX_ONLY");
});
test("V3.9.8 extension grammar is checked but never evaluated or optimised", () => {
  const b = branch();
  const records = ["GROUP|G1|OCO_FILL", ...b, "MEMBER|S1|G1", "REARM|S1|2|90|100|2|2|0",
    "ENTRY_ZONE|S1|90|100", "STOP_ZONE|S1|88|89", "FILTER|S1|0|0|0|0|0|-",
    "EXIT|S1|0.5|BE", "LEVEL|S1|MANAGE|100.25|BE", "OBS|S1|101",
    ...branch("S2", 2), "DEP|S2|S1|INVALIDATED", "CANCEL|S1|S2|FILLED"];
  assert.equal(validate(records).syntax_valid, true);
});
test("RR_RETEST and RETEST_EXTREME require their actual companion records", () => {
  const b = branch(); b[0] = b[0].replace("FIXED|100|-|FIXED|90", "RR_RETEST|-|-|RETEST_EXTREME|-");
  assert.throws(() => validate(b), { code: "PLAN_ENTRY_ZONE_REQUIRED" });
  b.push("ENTRY_ZONE|S1|99|100");
  assert.throws(() => validate(b), { code: "PLAN_RETEST_REQUIRED" });
  b.push("STEP|S1|RETEST_UP|15|-|99|100|1|1|0");
  assert.equal(validate(b).syntax_valid, true);
});
test("wrong field count, ticks, IDs, references and cycles fail explicitly", () => {
  assert.throws(() => validate([branch()[0] + "|EXTRA"]), { code: "PLAN_FIELD_COUNT" });
  assert.throws(() => validate(branch().map(x => x.replace("|101|102", "|101.1|102"))), { code: "PLAN_PRICE_TICK_INVALID" });
  assert.throws(() => validate([...branch(), ...branch()]), { code: "PLAN_ID_OR_PRIORITY_DUPLICATE" });
  assert.throws(() => validate([...branch(), "MEMBER|S1|MISSING"]), { code: "PLAN_GROUP_REFERENCE_UNKNOWN" });
  assert.throws(() => validate([...branch(), "DEP|S1|MISSING|FILLED"]), { code: "PLAN_LINK_REFERENCE_UNKNOWN" });
  assert.throws(() => validate([...branch(), ...branch("S2", 2), "DEP|S1|S2|FILLED", "DEP|S2|S1|FILLED"]), { code: "PLAN_DEP_CYCLE" });
});
