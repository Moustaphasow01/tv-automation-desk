import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getEntitySchema } from "../index.js";

const requireFromMcpWorkspace = createRequire(
  new URL("../../../mcp_gpt_desk/package.json", import.meta.url),
);
const Ajv2020Module = requireFromMcpWorkspace("ajv/dist/2020.js");
const Ajv2020 = Ajv2020Module.default || Ajv2020Module;
const addFormatsModule = requireFromMcpWorkspace("ajv-formats");
const addFormats = addFormatsModule.default || addFormatsModule;
const schema = getEntitySchema("analytical-research-progress-v1.schema.json");

function compile(root = schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  if (root !== schema) ajv.addSchema(schema);
  return ajv.compile(root);
}

function compileDefinition(name) {
  return compile({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $ref: `${schema.$id}#/$defs/${name}`,
  });
}

async function loadExample() {
  return JSON.parse(await readFile(
    new URL("../examples/analytical-research-progress.example.json", import.meta.url),
    "utf8",
  ));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("analytical research progress example validates", async () => {
  const validate = compile();
  const example = await loadExample();
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
});

test("the progress schema pins the exact ordered ten-phase protocol", async () => {
  const validate = compile();
  const example = await loadExample();
  const expected = [
    "CONTINUITY",
    "CORE_MARKET",
    "INDEX_CONFIRMATION",
    "CROSS_ASSET",
    "MEGACAPS",
    "MACRO",
    "NEWS",
    "THESIS_EVOLUTION",
    "OPPORTUNITY",
    "CONCLUSION",
  ];
  assert.deepEqual(example.phases.map((phase) => phase.phase), expected);

  const reordered = clone(example);
  [reordered.phases[1], reordered.phases[2]] = [reordered.phases[2], reordered.phases[1]];
  assert.equal(validate(reordered), false);

  const incomplete = clone(example);
  incomplete.phases.pop();
  assert.equal(validate(incomplete), false);
});

test("states, mandatory flags, timestamps and counters are strict", async () => {
  const validate = compile();
  const example = await loadExample();

  assert.equal(validate({ ...clone(example), status: "WAITING" }), false);

  const optionalPhase = clone(example);
  optionalPhase.phases[6].required = false;
  assert.equal(validate(optionalPhase), false);

  const dirtyNotStarted = clone(example);
  dirtyNotStarted.phases[6].started_at_utc = "2026-06-10T22:15:09.000Z";
  assert.equal(validate(dirtyNotStarted), false);

  assert.equal(validate({ ...clone(example), evidence_receipts_count: -1 }), false);
  assert.equal(validate({ ...clone(example), tool_calls_count: 1.5 }), false);
});

test("backend evidence receipt definition rejects forged issuer and bad phase ordinal", () => {
  const validate = compileDefinition("evidence_receipt");
  const receipt = {
    schema_version: "desk_analytical_evidence_receipt_v1",
    issuer: "DESK_BACKEND",
    journey_id: "journey-replay-2026-06-11",
    phase: "CORE_MARKET",
    phase_ordinal: 2,
    evidence_kind: "CANONICAL_MARKET",
    source: {
      source_type: "MCP_TOOL_RESULT",
      source_id: "get_market_context",
      source_version: "packbuild-1",
      source_ref: "pack:packbuild-1/MNQ_M5"
    },
    availability: "AVAILABLE",
    effective_at_utc: "2026-06-10T22:15:00.000Z",
    cutoff_utc: "2026-06-10T22:15:00.000Z",
    content_hash: "a".repeat(64),
    content_hash_origin: "IMMUTABLE_SOURCE_HASH",
    quality_flags: [],
    reason_codes: [],
    metadata: {},
    issued_at_utc: "2026-08-02T10:00:00.000Z",
    receipt_id: `analytical_evidence_${"b".repeat(32)}`,
    receipt_hash: "c".repeat(64)
  };
  assert.equal(validate(receipt), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...receipt, issuer: "MODEL" }), false);
  assert.equal(validate({ ...receipt, phase_ordinal: 4 }), false);
  assert.equal(validate({
    ...receipt,
    availability: "DEGRADED",
    reason_codes: [],
  }), false);
});

test("claim scopes are mutually exclusive between live and replay", () => {
  const validate = compileDefinition("claim_scope");
  const common = {
    worker_id: "codex-live-01",
    lease_bound: true,
    trading_date: "2026-08-03",
    session: "ny_open",
    cutoff_utc: "2026-08-03T13:30:00.000Z",
    pack_id: "pack-2026-08-03",
    pack_build_id: "packbuild-2026-08-03-01",
    bundle_id: "bundle-live-01"
  };
  const live = {
    ...common,
    mode: "live",
    workflow: "LIVE_M5_MONITOR",
    cursor_id: "livecur-2026-08-03",
    checkpoint: "2026-08-03T13:30:00.000Z",
    run_id: "front-live-2026-08-03"
  };
  assert.equal(validate(live), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...live, work_item_id: "replay-work" }), false);

  const replay = {
    ...common,
    worker_id: "codex-replay-01",
    mode: "replay",
    workflow: "REPLAY_MONITOR",
    work_item_id: "replay-work-01",
    backtest_id: "replay-2026-06-11",
    replay_run_id: "replay-2026-06-11-run-02",
    step_id: "replay-step-0013"
  };
  assert.equal(validate(replay), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...replay, cursor_id: "livecur-forged" }), false);
});

test("context policy is claim-scoped and strictly read-only", () => {
  const validate = compileDefinition("read_only_tool_policy");
  const policy = {
    access_mode: "READ_ONLY",
    claim_scoped: true,
    write_tools_allowed: false,
    allowed_tools: [
      "get_context_catalog",
      "get_continuity_context",
      "get_market_context",
      "get_macro_context",
      "get_news_context",
      "get_thesis_evolution_context",
      "get_replay_section_page",
      "get_market_dataset"
    ]
  };
  assert.equal(validate(policy), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...policy, access_mode: "READ_WRITE" }), false);
  assert.equal(validate({ ...policy, write_tools_allowed: true }), false);
});

test("parity and anti-lookahead definitions reject scope drift and future-data flags", () => {
  const validateParity = compileDefinition("live_replay_parity");
  const validateCutoff = compileDefinition("anti_lookahead_envelope");
  const parity = {
    scope: "replay",
    protocol_version: "desk_analytical_research_progress_v1",
    same_phase_order: true,
    same_evidence_rules: true,
    same_completion_rules: true,
    data_origin: "REPLAY_IMMUTABLE_CUTOFF"
  };
  assert.equal(validateParity(parity), true, JSON.stringify(validateParity.errors));
  assert.equal(validateParity({
    ...parity,
    data_origin: "LIVE_SETTLED_ROLLING_CUTOFF",
  }), false);

  const antiLookahead = {
    cutoff_utc: "2026-06-10T22:15:00.000Z",
    available_data_until_utc: "2026-06-10T22:15:00.000Z",
    future_data_used: false,
    source_pack_id: "pack-2026-06-11",
    pack_build_id: "packbuild-2026-06-11-01",
    claim_scope_hash: "d".repeat(64)
  };
  assert.equal(validateCutoff(antiLookahead), true, JSON.stringify(validateCutoff.errors));
  assert.equal(validateCutoff({ ...antiLookahead, future_data_used: true }), false);
});
