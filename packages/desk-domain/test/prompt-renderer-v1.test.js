import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROMPT_RENDER_SNAPSHOT_SCHEMA_VERSION_V1,
  normalizePromptTemplateTextV1,
  promptCompositionHashV1,
  redactPromptVariablesV1,
  renderPromptCompositionV1,
  validatePromptVariablesV1,
} from "../index.js";

describe("prompt renderer V1", () => {
  it("renders deterministic prompt snapshots with stable hashes", () => {
    const first = renderPromptCompositionV1(renderInput());
    const second = renderPromptCompositionV1(renderInput({ composition: shuffledComposition() }));

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.snapshot.schema_version, PROMPT_RENDER_SNAPSHOT_SCHEMA_VERSION_V1);
    assert.equal(first.snapshot.rendered_prompt, second.snapshot.rendered_prompt);
    assert.equal(first.snapshot.rendered_sha256, second.snapshot.rendered_sha256);
    assert.equal(first.snapshot.variables_redacted.api_token, "[REDACTED]");
    assert.match(first.snapshot.composition_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(promptCompositionHashV1(composition()), promptCompositionHashV1(shuffledComposition()));
  });

  it("fails before execution when required variables are missing", () => {
    const result = renderPromptCompositionV1(renderInput({ variables: { lane: "live" } }));

    assert.equal(result.ok, false);
    assert.equal(result.snapshot, null);
    assert.ok(result.reasons.includes("VARIABLE_REQUIRED:worker_id"));
    assert.ok(result.reasons.includes("VARIABLE_REQUIRED:session.date"));
  });

  it("validates variable types and normalizes whitespace", () => {
    const validation = validatePromptVariablesV1(schema(), { worker_id: 42, lane: "live", session: { date: "2026-08-09" } });

    assert.equal(validation.ok, false);
    assert.ok(validation.reasons.includes("VARIABLE_TYPE_INVALID:worker_id:string"));
    assert.equal(normalizePromptTemplateTextV1("  hello  \r\nworld  \n"), "hello\nworld");
  });

  it("redacts sensitive nested values without mutating benign values", () => {
    const redacted = redactPromptVariablesV1({ api_key: "secret", nested: { pin: "1234", label: "ok" } });

    assert.equal(redacted.api_key, "[REDACTED]");
    assert.equal(redacted.nested.pin, "[REDACTED]");
    assert.equal(redacted.nested.label, "ok");
  });

  it("detects composition item hash drift", () => {
    const result = renderPromptCompositionV1(renderInput({ composition: driftedComposition() }));

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("ITEM_HASH_DRIFT:root"));
  });
});

function renderInput(overrides = {}) {
  return {
    composition: overrides.composition || composition(),
    variables: overrides.variables || {
      worker_id: "gpt-live-pool-01",
      lane: "live",
      api_token: "not-persisted",
      session: { date: "2026-08-09" },
    },
    binding_key: "live-default",
    created_at_utc: "2026-08-09T10:00:00.000Z",
  };
}

function composition() {
  return {
    composition_key: "live-worker-v1",
    prompt_key: "CHATGPT_LIVE_WORKER_FALLBACK",
    semantic_version: "2.4.0",
    variables_schema: schema(),
    items: [
      { ordinal: 1, item_kind: "PROMPT", item_key: "root", template: "Worker {{worker_id}}\nLane {{lane}}" },
      { ordinal: 2, item_kind: "INSTRUCTION", item_key: "session", template: "Session date {{session.date}}" },
    ],
  };
}

function shuffledComposition() {
  return { ...composition(), items: [...composition().items].reverse() };
}

function driftedComposition() {
  return {
    ...composition(),
    items: [{ ...composition().items[0], content_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
  };
}

function schema() {
  return {
    required: ["worker_id", "lane", "session.date"],
    properties: {
      worker_id: { type: "string" },
      lane: { type: "string" },
      api_token: { type: "string", secret: true },
      session: { type: "object" },
    },
  };
}
