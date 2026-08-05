import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_COMPATIBILITY_ADAPTER_VERSION,
  adaptLegacyMonitorDecision,
  adaptLegacyObject,
  adaptLegacyPosition,
  adaptLegacySetup,
  detectLegacyEntityType,
} from "../src/legacy-compatibility-adapter.js";
import { legacyCompatibilityCorpus } from "./fixtures/legacy-compatibility-corpus.js";

for (const example of legacyCompatibilityCorpus) {
  test(`legacy compatibility corpus: ${example.name}`, () => {
    const sourceBefore = structuredClone(example.source);
    const result = adaptLegacyObject(example.source, {
      entityType: example.entityType,
      sourceVersion: "historical_replay_corpus",
    });

    assert.deepEqual(example.source, sourceBefore, "the adapter must never mutate the source payload");
    assert.equal(result.audit.adapter_version, LEGACY_COMPATIBILITY_ADAPTER_VERSION);
    assert.equal(result.audit.entity_type, example.entityType);
    assert.equal(result.audit.source_version, "historical_replay_corpus");

    for (const [path, expected] of Object.entries(example.expected.paths || {})) {
      assert.deepEqual(readPath(result, path), expected, `${path} should match the corpus expectation`);
    }
    for (const code of example.expected.conflictCodes || []) {
      assert.ok(
        result.audit.conflicts.some((item) => item.code === code),
        `expected conflict ${code}; got ${result.audit.conflicts.map((item) => item.code).join(", ")}`,
      );
    }
    for (const code of example.expected.warningCodes || []) {
      assert.ok(
        result.audit.warnings.some((item) => item.code === code),
        `expected warning ${code}; got ${result.audit.warnings.map((item) => item.code).join(", ")}`,
      );
    }
    assert.equal(result.ok, !result.audit.requires_review);
    assert.deepEqual(result.audit.counts, {
      aliases: result.audit.aliases.length,
      conflicts: result.audit.conflicts.length,
      warnings: result.audit.warnings.length,
    });
  });
}

test("entity detection separates setup, thesis, position, condition and monitor decision payloads", () => {
  assert.equal(detectLegacyEntityType({ setup_id: "s", entry_zone: [1, 2] }), "setup");
  assert.equal(detectLegacyEntityType({ thesis_id: "t", dominant_scenario: "range" }), "thesis");
  assert.equal(detectLegacyEntityType({ position_id: "p", exit_price: 1 }), "position");
  assert.equal(detectLegacyEntityType({
    condition_id: "c",
    operator: "above",
    importance: "required",
  }), "condition");
  assert.equal(detectLegacyEntityType({ monitor_decision: { action: "WAIT_MORE" } }), "monitor_decision");
  assert.equal(detectLegacyEntityType({ action: "WAIT_MORE" }), "monitor_decision");
  assert.equal(detectLegacyEntityType({ unrelated: true }), "unknown");
});

test("adapter output and audit are deterministic", () => {
  const source = {
    setup_id: "deterministic",
    status: "ready",
    instrument: "MNQ1!",
    direction: "buy",
    entry_price: 100,
    stop_loss: 95,
    take_profit_1: 110,
    conditions: [{
      condition_id: "activation",
      instrument: "MNQ",
      timeframe: "M5",
      operator: "close_above",
      threshold: 99,
      importance: "must",
      status: "ok",
      required_for_trigger: true,
    }],
  };
  assert.deepEqual(adaptLegacySetup(source), adaptLegacySetup(source));
});

test("unknown setup status never becomes executable", () => {
  const result = adaptLegacySetup({
    setup_id: "unknown_status",
    status: "MAGIC_GO_NOW",
    instrument: "MNQ",
    direction: "long",
    entry_price: 100,
    stop_loss: 95,
    take_profit_1: 110,
    conditions: [{
      condition_id: "activation",
      instrument: "MNQ",
      timeframe: "M5",
      operator: "CLOSE_ABOVE",
      threshold: 99,
      importance: "MANDATORY",
      status: "PASSED",
      required_for_trigger: true,
    }],
  });

  assert.equal(result.canonical.status, "WAIT_NO_SETUP");
  assert.equal(result.canonical.backend_can_trigger, false);
  assert.equal(result.audit.requires_review, true);
  assert.ok(result.audit.conflicts.some((item) => item.code === "UNKNOWN_SETUP_STATUS"));
});

test("conflicting R aliases are preserved in source and surfaced for review", () => {
  const result = adaptLegacyPosition({
    position_id: "position_conflicting_r",
    status: "closed",
    instrument: "MES",
    direction: "short",
    result_r: 1,
    result_R: -1,
  });

  assert.equal(result.canonical.result_r, 1);
  assert.equal(result.canonical.result_R, -1);
  assert.equal(result.audit.requires_review, true);
  assert.ok(result.audit.conflicts.some((item) => item.code === "CONFLICTING_RESULT_R_FIELDS"));
});

test("nested monitor records retain their envelope while adapting only the decision namespace", () => {
  const result = adaptLegacyMonitorDecision({
    monitor_id: "monitor_legacy",
    monitor_decision: {
      action: "CREATE_PRE_ARMED",
      reason_summary: "Préparer sans déclencher",
    },
    pack_build_id: "packbuild_1",
  });

  assert.equal(result.canonical.monitor_id, "monitor_legacy");
  assert.equal(result.canonical.pack_build_id, "packbuild_1");
  assert.equal(result.canonical.monitor_decision.action, "ARM_SETUP");
  assert.equal(result.canonical.monitor_decision.requested_setup_status, "PRE_ARMED");
});

test("adapter rejects non-object input instead of inventing a record", () => {
  assert.throws(
    () => adaptLegacyObject("WAIT_MORE"),
    /legacy_compatibility_source_must_be_an_object/,
  );
});

function readPath(value, path) {
  return String(path)
    .split(".")
    .reduce((current, part) => current?.[part], value);
}
