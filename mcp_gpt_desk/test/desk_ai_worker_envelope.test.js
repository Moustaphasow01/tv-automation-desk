import assert from "node:assert/strict";
import test from "node:test";

import {
  DESK_AI_DIRECT_OUTPUT_SCHEMA_VERSION,
  buildDeskAiAnalysisPrompt,
  buildDeskAiCodexOutputJsonSchema,
  buildDeskAiRepairPrompt,
  buildDeskAiJobEnvelope,
  materializeDeskAiWrites,
  normalizeCodexAnalysisOutput,
} from "../src/desk-ai-worker-envelope.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";
import {
  makeNativeMasterV5,
  makeNativeMonitorV2,
} from "./support/native-strategy-fixtures.js";

function assertStrictStructuredOutputSchema(node, path = "$") {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((value, index) => (
      assertStrictStructuredOutputSchema(value, `${path}[${index}]`)
    ));
    return;
  }
  if (node.type === "object") {
    assert.equal(
      node.additionalProperties,
      false,
      `${path} must forbid additional properties`,
    );
    assert.deepEqual(
      [...(node.required || [])].sort(),
      Object.keys(node.properties || {}).sort(),
      `${path} must require every declared property`,
    );
  }
  Object.entries(node).forEach(([key, value]) => (
    assertStrictStructuredOutputSchema(value, `${path}.${key}`)
  ));
}

test("AI envelope pins LIVE scope, contract and protected lease fields", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  assert.equal(envelope.scope, "live");
  assert.equal(envelope.workflow, "LIVE_M15_MONITOR");
  assert.equal(envelope.contract_context.contract_hash, "monitor-hash");
  assert.equal(envelope.envelope_hash.length, 64);
  assert.match(buildDeskAiAnalysisPrompt(envelope), /n'exécute aucune commande/);
  assert.match(buildDeskAiAnalysisPrompt(envelope), /monitor_output.*document JSON complet/);

  const output = nativeMonitorCodexOutput({
    decisionSummary: "WAIT",
    dataQualityStatus: "degraded",
    warnings: ["GC unavailable"],
  });
  const writes = materializeDeskAiWrites(envelope, output);
  assert.equal(writes.primary.tool, "save_manual_monitor");
  assert.equal(writes.primary.payload.strategy_id, "asia_open");
  assert.equal(writes.primary.payload.cursor_id, "livecur__2026-07-28");
  assert.equal(writes.primary.payload.worker_id, "codex-live-01");
  assert.equal(writes.primary.payload.lease_token, "lease-token-live");
  assert.equal(writes.primary.payload.monitor_output.command.requested_action, "NO_ACTION");
  assert.deepEqual(writes.supplementary, []);
});

test("AI envelope distinguishes a critical M1 event Monitor from scheduled M15 work", () => {
  const scheduled = buildDeskAiJobEnvelope(liveFixture());
  assert.deepEqual(scheduled.analytical_trigger, {
    type: "SCHEDULED_M15",
    reason: "SCHEDULED_CHECKPOINT",
    event_types: [],
  });

  const criticalFixture = liveFixture();
  criticalFixture.claim.event_monitor_context = {
    checkpoint: "2026-07-28T12:43:00+02:00",
    reason: "CRITICAL_ENGINE_EVENT",
    event_types: ["PAPER_SETUP_TRIGGERED"],
  };
  const critical = buildDeskAiJobEnvelope(criticalFixture);
  assert.deepEqual(critical.analytical_trigger, {
    type: "CRITICAL_ENGINE_EVENT",
    checkpoint: "2026-07-28T12:43:00+02:00",
    reason: "CRITICAL_ENGINE_EVENT",
    event_types: ["PAPER_SETUP_TRIGGERED"],
  });
});

test("agentic prompt mandates every scoped context phase while preserving host write authority", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  const prompt = buildDeskAiAnalysisPrompt(envelope, { agenticContext: true });

  assert.match(prompt, /MCP local de contexte en lecture seule nommé desk_context/);
  assert.match(prompt, /get_continuity_context/);
  assert.match(prompt, /domain=core_market/);
  assert.match(prompt, /domain=index_confirmation/);
  assert.match(prompt, /domain=cross_asset/);
  assert.match(prompt, /domain=megacaps/);
  assert.match(prompt, /get_macro_context/);
  assert.match(prompt, /get_news_context/);
  assert.match(prompt, /get_thesis_evolution_context/);
  assert.match(prompt, /Le service hôte possède seul le claim, le lease, les sauvegardes et la complétion/);
  assert.doesNotMatch(prompt, /N'appelle aucun outil/);
  assert.doesNotMatch(prompt, /lease-token-live/);
  assert.doesNotMatch(prompt, /"lease_token"/);
});

test("LIVE Master prompt pins nested JSON types and its mandatory thesis write", () => {
  const fixture = liveFixture();
  fixture.claim.claim_handle.workflow = "LIVE_MASTER";
  fixture.claim.bundle.bundle_tool = "get_master_cutoff_bundle";
  fixture.bundle.bundle_type = "master";
  fixture.bundle.contract_context = activeContractContext("LIVE_MASTER", "master-hash");
  fixture.bundle.save_target.tool = "save_master_analysis";
  fixture.bundle.save_target.suggested_payload = {
    ...fixture.bundle.save_target.suggested_payload,
      ...activeSavePins("LIVE_MASTER", "live"),
      contract_hash: "master-hash",
      analysis_id: "master-2026-07-28-0015",
      plan_id: "plan-2026-07-28-0015",
      thesis_id: "thesis-2026-07-28-0015",
      setup_id_candidates: ["setup-2026-07-28-0015-01"],
      date: "2026-07-28",
      created_at_paris: "2026-07-28T00:15:00+02:00",
  };
  fixture.contract = {
    contract_name: "DeskMasterAnalysisContract",
    schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
    hash: "master-hash",
    content_markdown: "Master contract",
  };
  const envelope = buildDeskAiJobEnvelope(fixture);
  const prompt = buildDeskAiAnalysisPrompt(envelope);
  assert.match(prompt, /analysis_output/);
  assert.match(prompt, /supplementary_writes vaut exactement \[\]/);
  assert.match(prompt, /active_thesis est obligatoire/);
  assert.match(prompt, /DeskMasterAnalysisContract",version:"5\.4\.0/);
  assert.equal(
    envelope.normative_runtime.primary_schema_file,
    "master-analysis-v5-4.schema.json",
  );
  assert.equal(
    envelope.normative_runtime.condition_catalog.catalog.catalog_id,
    "condition_catalog_v1_2",
  );
  assert.equal(
    envelope.normative_runtime.protected_contract_bindings["analysis_output.source"].analysis_id,
    "master-2026-07-28-0015",
  );
  const continuedPrompt = buildDeskAiAnalysisPrompt(envelope, {
    reuseImmutableContext: true,
  });
  assert.doesNotMatch(continuedPrompt, /content_markdown/);
  assert.doesNotMatch(continuedPrompt, /Master contract/);
  assert.doesNotMatch(continuedPrompt, /normative_schemas/);
  assert.match(continuedPrompt, /immutable_context_receipt/);
  assert.match(continuedPrompt, /SAME_RUN_SEEN_ARTIFACT_ONLY/);
  assert.match(continuedPrompt, /master-analysis-v5-4\.schema\.json/);

  const repair = buildDeskAiRepairPrompt(envelope, {
    save_payload: { analysis_output: "encoded by mistake" },
    supplementary_writes: [],
    decision_summary: "WAIT",
    data_quality_status: "degraded",
    warnings: [],
  }, Object.assign(new Error("full_analysis must be an object"), {
    code: "AI_SAVE_PAYLOAD_VALIDATION_FAILED",
  }));
  assert.match(repair, /MODE_REPARATION_STRUCTURELLE_BORNEE=1/);
  assert.match(repair, /AI_SAVE_PAYLOAD_VALIDATION_FAILED/);
  assert.match(repair, /ENVELOPPE_SHA256=/);
});

test("Codex inference schema uses direct workflow-specific objects and dereferenced structural contracts", () => {
  const fixture = liveFixture();
  fixture.claim.claim_handle.workflow = "LIVE_MASTER";
  fixture.claim.bundle.bundle_tool = "get_master_cutoff_bundle";
  fixture.bundle.bundle_type = "master";
  fixture.bundle.contract_context = activeContractContext("LIVE_MASTER", "master-hash");
  fixture.bundle.save_target = {
    tool: "save_master_analysis",
    suggested_payload: {
      ...fixture.bundle.save_target.suggested_payload,
      ...activeSavePins("LIVE_MASTER", "live"),
      contract_hash: "master-hash",
      analysis_id: "master-2026-07-28-0015",
      plan_id: "plan-2026-07-28-0015",
      thesis_id: "thesis-2026-07-28-0015",
      setup_id_candidates: ["setup-2026-07-28-0015-01"],
      date: "2026-07-28",
      created_at_paris: "2026-07-28T00:15:00+02:00",
    },
  };
  fixture.contract = {
    contract_name: "DeskMasterAnalysisContract",
    schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
    hash: "master-hash",
    content_markdown: "Master contract",
  };
  const envelope = buildDeskAiJobEnvelope(fixture);
  const schema = buildDeskAiCodexOutputJsonSchema(envelope);
  const encoded = JSON.stringify(schema);

  assert.equal(
    schema.properties.schema_version.const,
    DESK_AI_DIRECT_OUTPUT_SCHEMA_VERSION,
  );
  assert.deepEqual(
    schema.properties.save_payload.required,
    ["analysis_output"],
  );
  assert.equal(
    schema.properties.save_payload.properties.analysis_output
      .properties.contract.properties.name.const,
    "DeskMasterAnalysisContract",
  );
  assert.doesNotMatch(encoded, /"\$ref"/);
  assert.doesNotMatch(encoded, /"contains"/);
  assert.doesNotMatch(encoded, /"minContains"/);
  assert.doesNotMatch(encoded, /"format"/);
  assert.doesNotMatch(encoded, /"uniqueItems"/);
  assert.doesNotMatch(encoded, /"allOf"/);
  assert.doesNotMatch(encoded, /"oneOf"/);
  assertStrictStructuredOutputSchema(schema);
});

test("Codex direct output V2 is normalized without nested JSON strings while V1 remains compatible", () => {
  const analysisOutput = makeNativeMasterV5();
  const direct = normalizeCodexAnalysisOutput({
    schema_version: DESK_AI_DIRECT_OUTPUT_SCHEMA_VERSION,
    save_payload: { analysis_output: analysisOutput },
    supplementary_writes: [],
    decision_summary: "WAIT",
    data_quality_status: "ready",
    warnings: [],
  });
  assert.equal(direct.save_payload.analysis_output.contract.version, "5.4.0");
  assert.deepEqual(direct.supplementary_writes, []);

  const compatible = normalizeCodexAnalysisOutput({
    schema_version: "desk_ai_analysis_output_v1",
    save_payload_json: JSON.stringify({ analysis_output: analysisOutput }),
    supplementary_writes_json: "[]",
    decision_summary: "WAIT",
    data_quality_status: "ready",
    warnings: [],
  });
  assert.equal(compatible.save_payload.analysis_output.contract.version, "5.4.0");
});

test("native V5/V2 executed prompt preserves opportunity tolerance and hard-risk boundaries", () => {
  const fixture = liveFixture();
  fixture.bundle.contract_context = activeContractContext("LIVE_M15_MONITOR", "monitor-v2-hash");
  fixture.bundle.save_target.suggested_payload = {
    ...fixture.bundle.save_target.suggested_payload,
    ...activeSavePins("LIVE_M15_MONITOR", "live"),
    contract_hash: "monitor-v2-hash",
    expected_revision: 7,
  };
  fixture.contract = {
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    hash: "monitor-v2-hash",
    content_markdown: "Monitor V2 contract",
  };
  const envelope = buildDeskAiJobEnvelope(fixture);
  const prompt = buildDeskAiAnalysisPrompt(envelope);
  assert.match(prompt, /jusqu’à cinq candidats distincts classés/);
  assert.match(prompt, /risque demandé strictement positif et <=0\.25 % de NET_EQUITY/);
  assert.match(prompt, /max_rounding_excess_pct/);
  assert.match(prompt, /EVENT_BLACKOUT requis et indécidable reste UNKNOWN/);
  assert.match(prompt, /uniquement à leur phase/);
  assert.match(prompt, /phrase libre documente mais n'est jamais une condition/);
  assert.match(prompt, /REQUIRE_CONFIRMATION exige une condition Catalog V1\.2 explicite/);
  assert.match(prompt, /REDUCE_RISK ne change pas le plan courant/);
  assert.match(prompt, /VETO temporaire=LATEST_ONLY/);
  assert.match(prompt, /INVALIDATION structurelle=INVALIDATE_TERMINAL/);
  assert.match(prompt, /LATCH interdit à BLOCK_IF_TRUE/);
  assert.match(prompt, /expected_revision est un compare-and-swap/);
  assert.match(prompt, /confirmation n'autorise jamais le same-bar/);
  assert.match(prompt, /GPT analyse aux checkpoints M15 planifies et sur evenement critique/);

  const repair = buildDeskAiRepairPrompt(envelope, {
    schema_version: "desk_ai_analysis_output_v1",
    save_payload_json: "{}",
    supplementary_writes_json: "[]",
    decision_summary: "repair",
    data_quality_status: "degraded",
    warnings: [],
  }, Object.assign(new Error("invalid monitor output"), {
    code: "DETERMINISTIC_MONITOR_COMMAND_INVALID",
    details: {
      errors: [{
        code: "STATE_TRANSITION_REJECTED",
        evidence: {
          domain: "setup",
          reason: "TERMINAL_SETUP_IMMUTABLE",
          previous_state: "INVALIDATED",
          command: "INVALIDATE",
        },
      }],
    },
  }));
  assert.match(repair, /jusqu’à cinq candidats classés/);
  assert.match(repair, /Conserve expected_revision exactement/);
  assert.match(repair, /RÈGLE TERMINALE STRICTE/);
  assert.match(repair, /setup_command\.type doit être exactement NOOP/);
  assert.match(repair, /ne répète jamais la commande rejetée/);
  assert.match(repair, /DIRECTIVE_TRANSITION_OBLIGATOIRE=/);
  assert.match(repair, /"required_command":\{"setup_command":\{"type":"NOOP"\}\}/);
  assert.match(repair, /SORTIE_PRECEDENTE=\{"omitted":true,"reason":"TERMINAL_STATE_TRANSITION_REPAIR"\}/);
});

test("AI envelope rejects a LIVE session mismatch before Codex analysis", () => {
  const fixture = liveFixture();
  fixture.bundle.session = "ny_open";
  assert.throws(
    () => buildDeskAiJobEnvelope(fixture),
    (error) => error.code === "AI_SCOPE_INTEGRITY_FAILED",
  );
});

test("AI output cannot replace backend-owned scope or pack identifiers", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  assert.throws(
    () => materializeDeskAiWrites(envelope, normalizeCodexAnalysisOutput({
      schema_version: "desk_ai_analysis_output_v1",
      save_payload_json: JSON.stringify({
        pack_build_id: "invented-pack",
        monitor_decision: { action: "WAIT" },
      }),
      supplementary_writes_json: "[]",
      decision_summary: "WAIT",
      data_quality_status: "ready",
      warnings: [],
    })),
    (error) => error.code === "AI_PROTECTED_FIELD_OVERRIDE",
  );
});

test("LIVE Monitor rejects a flattened legacy decision before persistence", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  assert.throws(
    () => materializeDeskAiWrites(envelope, normalizeCodexAnalysisOutput({
      schema_version: "desk_ai_analysis_output_v1",
      save_payload_json: JSON.stringify({
        monitor_decision: {
          action: "ARM_SETUP",
          summary: "Arm the short setup.",
        },
      }),
      supplementary_writes_json: "[]",
      decision_summary: "ARM_SETUP",
      data_quality_status: "ready",
      warnings: [],
    })),
    (error) => error.code === "AI_MONITOR_CONTRACT_OUTPUT_REQUIRED",
  );
});

test("LIVE Monitor accepts a complete native V2.2 contract output", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  const writes = materializeDeskAiWrites(envelope, nativeMonitorCodexOutput());

  assert.equal(
    writes.primary.payload.monitor_output.contract.version,
    ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
  );
  assert.equal(
    writes.primary.payload.monitor_output.command.contract.version,
    ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  );
  assert.equal(writes.primary.payload.monitor_output.command.requested_action, "NO_ACTION");
});

test("LIVE Monitor rejects a native V2.2 document whose command is missing", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  const monitorOutput = nativeMonitorOutput();
  delete monitorOutput.command;
  assert.throws(
    () => materializeDeskAiWrites(envelope, nativeMonitorCodexOutput({ monitorOutput })),
    (error) => error.code === "AI_MONITOR_COMMAND_REQUIRED",
  );
});

test("LIVE Monitor refuses a native monitor document under the wrong container", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  const monitorOutput = nativeMonitorOutput();
  assert.throws(
    () => materializeDeskAiWrites(envelope, normalizeCodexAnalysisOutput({
      schema_version: "desk_ai_analysis_output_v1",
      save_payload_json: JSON.stringify({
        analysis_output: monitorOutput,
      }),
      supplementary_writes_json: "[]",
      decision_summary: "WAIT",
      data_quality_status: "ready",
      warnings: [],
    })),
    (error) => error.code === "AI_MONITOR_CONTRACT_OUTPUT_REQUIRED",
  );
});

test("LIVE Monitor rejects direct GPT trigger authority", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  const monitorOutput = nativeMonitorOutput();
  monitorOutput.command.requested_action = "TRIGGERED";
  assert.throws(
    () => materializeDeskAiWrites(envelope, nativeMonitorCodexOutput({
      monitorOutput,
      decisionSummary: "TRIGGERED",
    })),
    (error) => error.code === "AI_DIRECT_TRIGGER_FORBIDDEN",
  );
});

test("LIVE Monitor refuses a legacy cancellation alias outside monitor_output", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  const monitorOutput = nativeMonitorOutput();
  assert.throws(
    () => materializeDeskAiWrites(envelope, normalizeCodexAnalysisOutput({
      schema_version: "desk_ai_analysis_output_v1",
      save_payload_json: JSON.stringify({
        native_monitor_document: monitorOutput,
        monitor_decision: { action: "CANCEL_SETUP" },
      }),
      supplementary_writes_json: "[]",
      decision_summary: "CANCEL_SETUP",
      data_quality_status: "ready",
      warnings: [],
    })),
    (error) => error.code === "AI_MONITOR_CONTRACT_OUTPUT_REQUIRED",
  );
});

test("LIVE Master carries its active thesis atomically inside the native output", () => {
  const fixture = liveFixture();
  fixture.claim.claim_handle.workflow = "LIVE_MASTER";
  fixture.claim.bundle.bundle_tool = "get_master_cutoff_bundle";
  fixture.bundle.bundle_type = "master";
  fixture.bundle.contract_context = activeContractContext("LIVE_MASTER", "master-hash");
  fixture.bundle.save_target = {
    tool: "save_master_analysis",
    suggested_payload: {
      ...fixture.bundle.save_target.suggested_payload,
      ...activeSavePins("LIVE_MASTER", "live"),
      contract_hash: "master-hash",
      analysis_id: "master-2026-07-28-0015",
    },
  };
  fixture.contract = {
    contract_name: "DeskMasterAnalysisContract",
    schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
    hash: "master-hash",
    content_markdown: "Master contract",
  };
  const envelope = buildDeskAiJobEnvelope(fixture);
  const analysisOutput = makeNativeMasterV5({
    mode: "LIVE",
    tradingDate: "2026-07-28",
    session: "asia_open",
    runId: "front_live_2026-07-28",
    cutoffParis: "2026-07-28T00:15:00+02:00",
    analysisId: "master-2026-07-28-0015",
    bundleId: "monitor-bundle-1245",
    packId: "pack-live-1245",
    packBuildId: "packbuild-live-1245",
    planId: "plan-master-2026-07-28-0015",
    thesisId: "thesis-master-2026-07-28-0015",
  });
  const output = normalizeCodexAnalysisOutput({
    schema_version: "desk_ai_analysis_output_v1",
    save_payload_json: JSON.stringify({
      analysis_output: analysisOutput,
    }),
    supplementary_writes_json: "[]",
    decision_summary: "WAIT",
    data_quality_status: "ready",
    warnings: [],
  });
  const writes = materializeDeskAiWrites(envelope, output);
  assert.equal(writes.supplementary.length, 0);
  assert.equal(
    writes.primary.payload.analysis_output.active_thesis.thesis_id,
    "thesis-master-2026-07-28-0015",
  );
  assert.equal(writes.primary.payload.run_id, "front_live_2026-07-28");
});

test("LIVE Monitor rejects a native document moved to the legacy monitor_decision key", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  const monitorOutput = nativeMonitorOutput();
  assert.throws(
    () => materializeDeskAiWrites(envelope, normalizeCodexAnalysisOutput({
      schema_version: "desk_ai_analysis_output_v1",
      save_payload_json: JSON.stringify({ monitor_decision: monitorOutput }),
      supplementary_writes_json: "[]",
      decision_summary: "WAIT",
      data_quality_status: "ready",
      warnings: [],
    })),
    (error) => error.code === "AI_MONITOR_CONTRACT_OUTPUT_REQUIRED",
  );
});

test("LIVE Monitor rejects a non-object monitor_output container", () => {
  const envelope = buildDeskAiJobEnvelope(liveFixture());
  assert.throws(
    () => materializeDeskAiWrites(envelope, normalizeCodexAnalysisOutput({
      schema_version: "desk_ai_analysis_output_v1",
      save_payload_json: JSON.stringify({ monitor_output: JSON.stringify(nativeMonitorOutput()) }),
      supplementary_writes_json: "[]",
      decision_summary: "WAIT",
      data_quality_status: "ready",
      warnings: [],
    })),
    (error) => error.code === "AI_MONITOR_CONTRACT_OUTPUT_REQUIRED",
  );
});

test("AI output cannot invent backend-owned document identifiers", () => {
  const fixture = liveFixture();
  delete fixture.bundle.save_target.suggested_payload.monitor_id;
  const envelope = buildDeskAiJobEnvelope(fixture);
  assert.throws(
    () => materializeDeskAiWrites(envelope, normalizeCodexAnalysisOutput({
      schema_version: "desk_ai_analysis_output_v1",
      save_payload_json: JSON.stringify({
        monitor_id: "invented-monitor",
        monitor_decision: { action: "WAIT" },
      }),
      supplementary_writes_json: "[]",
      decision_summary: "WAIT",
      data_quality_status: "ready",
      warnings: [],
    })),
    (error) => error.code === "AI_PROTECTED_FIELD_INJECTION",
  );
});

test("Replay envelope preserves revision, idempotency and work lease", () => {
  const envelope = buildDeskAiJobEnvelope(replayFixture());
  const writes = materializeDeskAiWrites(envelope, nativeReplayMonitorCodexOutput());
  assert.equal(writes.primary.tool, "save_replay_monitor");
  assert.equal(writes.primary.payload.expected_revision, 14);
  assert.equal(writes.primary.payload.idempotency_key, "save-replay-monitor-14");
  assert.equal(writes.primary.payload.work_item_id, "deskwork__14");
  assert.equal(writes.primary.payload.worker_id, "codex-replay-01");
  assert.equal(writes.primary.payload.monitor_output.scope.mode, "REPLAY");
});

function nativeMonitorOutput() {
  return makeNativeMonitorV2({
    mode: "LIVE",
    tradingDate: "2026-07-28",
    session: "asia_open",
    runId: "front_live_2026-07-28",
    cutoffParis: "2026-07-28T12:45:00+02:00",
    monitorId: "monitor-1245",
    bundleId: "monitor-bundle-1245",
    packId: "pack-live-1245",
    packBuildId: "packbuild-live-1245",
    masterId: "master-live-0015",
    planId: "plan-live-0015",
    thesisId: "thesis-live-0015",
    commandId: "command-live-1245",
    expectedRevision: 1,
  });
}

function nativeMonitorCodexOutput({
  monitorOutput = nativeMonitorOutput(),
  decisionSummary = "WAIT",
  dataQualityStatus = "ready",
  warnings = [],
} = {}) {
  return normalizeCodexAnalysisOutput({
    schema_version: "desk_ai_analysis_output_v1",
    save_payload_json: JSON.stringify({ monitor_output: monitorOutput }),
    supplementary_writes_json: "[]",
    decision_summary: decisionSummary,
    data_quality_status: dataQualityStatus,
    warnings,
  });
}

function nativeReplayMonitorCodexOutput() {
  return normalizeCodexAnalysisOutput({
    schema_version: "desk_ai_analysis_output_v1",
    save_payload_json: JSON.stringify({
      monitor_output: makeNativeMonitorV2({
        mode: "REPLAY",
        tradingDate: "2026-06-11",
        session: "asia_open",
        runId: "replay-2026-06-11",
        cutoffParis: "2026-06-11T12:45:00+02:00",
        monitorId: "replay-monitor-14",
        bundleId: "replay-monitor-14",
        packId: "pack-replay",
        packBuildId: "packbuild-replay",
        masterId: "replay-master-1",
        planId: "replay-plan-1",
        thesisId: "replay-thesis-1",
        commandId: "replay-command-14",
        expectedRevision: 14,
      }),
    }),
    supplementary_writes_json: "[]",
    decision_summary: "KEEP",
    data_quality_status: "ready",
    warnings: [],
  });
}

function liveFixture() {
  const claim = {
    scope: "live",
    claim_handle: {
      cursor_id: "livecur__2026-07-28",
      trading_date: "2026-07-28",
      run_id: "front_live_2026-07-28",
      session: "asia_open",
      workflow: "LIVE_M15_MONITOR",
      checkpoint: "2026-07-28T12:45:00+02:00",
      lease_token: "lease-token-live",
    },
    bundle: {
      bundle_tool: "get_manual_monitor_bundle",
      bundle_args: { bundle_id: "monitor-bundle-1245" },
    },
    execution_prompt: "Analyze the monitor.",
    prompt_hash: "prompt-hash",
  };
  const bundle = {
    bundle_id: "monitor-bundle-1245",
    bundle_type: "monitor",
    strategy_id: "asia_open",
    trading_date: "2026-07-28",
    session: "asia_open",
    mode: "live",
    run_id: "front_live_2026-07-28",
    as_of_utc: "2026-07-28T10:45:00.000Z",
    pack_build_id: "packbuild-live-1245",
    contract_context: activeContractContext("LIVE_M15_MONITOR", "monitor-hash"),
    anti_lookahead_policy: { compliant: true },
    save_target: {
      tool: "save_manual_monitor",
      suggested_payload: {
        monitor_id: "monitor-1245",
        ...activeSavePins("LIVE_M15_MONITOR", "live"),
        contract_hash: "monitor-hash",
        bundle_id: "monitor-bundle-1245",
        strategy_id: "asia_open",
        trading_date: "2026-07-28",
        session: "asia_open",
        mode: "live",
        run_id: "front_live_2026-07-28",
        as_of_utc: "2026-07-28T10:45:00.000Z",
        timezone: "Europe/Paris",
        timestamp_paris: "2026-07-28T12:45:00+02:00",
        pack_id: "pack-live-1245",
        pack_build_id: "packbuild-live-1245",
      },
    },
  };
  return {
    claim,
    bundle,
    contract: {
      contract_name: "DeskHourlyThesisMonitorContract",
      schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      hash: "monitor-hash",
      content_markdown: "Monitor contract",
    },
    workerId: "codex-live-01",
  };
}

function replayFixture() {
  return {
    claim: {
      scope: "replay",
      workflow: "REPLAY_MONITOR",
      claim_handle: {
        work_item_id: "deskwork__14",
        backtest_id: "replay-2026-06-11",
        step_id: "step-14",
        lease_token: "lease-token-replay",
      },
      bundle: {
        bundle_tool: "get_replay_monitor_bundle",
        bundle_args: { backtest_id: "replay-2026-06-11", step_id: "step-14" },
      },
    },
    bundle: {
      bundle_id: "replay-monitor-14",
      bundle_type: "monitor",
      mode: "replay",
      backtest_id: "replay-2026-06-11",
      step_id: "step-14",
      pack_build_id: "packbuild-replay",
      contract_context: activeContractContext("REPLAY_MONITOR", "monitor-hash"),
      anti_lookahead_policy: { compliant: true },
      save_target: {
        tool: "save_replay_monitor",
        suggested_payload: {
          backtest_id: "replay-2026-06-11",
          step_id: "step-14",
          expected_revision: 14,
          idempotency_key: "save-replay-monitor-14",
          ...activeSavePins("REPLAY_MONITOR", "replay"),
          contract_hash: "monitor-hash",
          pack_build_id: "packbuild-replay",
          monitor_id: "replay-monitor-14",
          master_id: "replay-master-1",
          thesis_id: "replay-thesis-1",
          sequence: 14,
          scheduled_for_utc: "2026-06-11T10:45:00.000Z",
          as_of_utc: "2026-06-11T10:45:00.000Z",
        },
      },
    },
    contract: {
      contract_name: "DeskHourlyThesisMonitorContract",
      schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      hash: "monitor-hash",
      content_markdown: "Monitor contract",
    },
    workerId: "codex-replay-01",
  };
}

function activeContractContext(workflow, contractHash) {
  const master = workflow.endsWith("MASTER");
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    contract_hash: contractHash,
    execution_policy: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy },
    execution_plan: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan },
    monitor_command: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command },
    condition_catalog: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog },
  };
}

function activeSavePins(workflow, mode) {
  const master = workflow.endsWith("MASTER");
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    ...(mode === "replay"
      ? { replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy }
      : { execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy }),
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
  };
}
