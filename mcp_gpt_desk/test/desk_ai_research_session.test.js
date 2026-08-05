import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertDeskAiResearchSessionAllowed,
  buildDeskAiContextResearchProgress,
  buildDeskAiResearchSession,
  classifyDeskAiDecisionIntent,
} from "../src/desk-ai-research-session.js";
import {
  buildDeskAiContextCapability,
  signDeskContextEvidenceReceipt,
} from "../src/desk-ai-context-capability.js";

const CONTEXT_PHASES = [
  ["CONTINUITY", "get_continuity_context"],
  ["CORE_MARKET", "get_market_context"],
  ["INDEX_CONFIRMATION", "get_market_context"],
  ["CROSS_ASSET", "get_market_context"],
  ["MEGACAPS", "get_market_context"],
  ["MACRO", "get_macro_context"],
  ["NEWS", "get_news_context"],
  ["THESIS_EVOLUTION", "get_thesis_evolution_context"],
];

test("backend accepts a fully evidenced analytical journey before save", () => {
  const output = analysisOutput({ setups: [] });
  const scopedEnvelope = envelope();
  const capability = contextCapability(scopedEnvelope);
  const session = buildDeskAiResearchSession({
    envelope: scopedEnvelope,
    analysisOutput: output,
    contextEvidenceReceipts: contextReceipts(capability),
    contextCapability: capability,
    startedAtUtc: "2026-08-02T12:00:00.000Z",
    completedAtUtc: "2026-08-02T12:01:00.000Z",
  });
  const allowed = assertDeskAiResearchSessionAllowed(session);

  assert.equal(allowed.progress.coverage.percent, 100);
  assert.equal(allowed.progress.status, "COMPLETE");
  assert.equal(allowed.validation.decision_allowed, true);
  assert.equal(allowed.decision_intent, "NO_RISK_CHANGE");
  assert.equal(allowed.progress.tool_calls_count, 8);
});

test("backend projects partial signed context evidence while Codex is still researching", () => {
  const scopedEnvelope = envelope();
  const capability = contextCapability(scopedEnvelope);
  const partial = buildDeskAiContextResearchProgress({
    envelope: scopedEnvelope,
    contextEvidenceReceipts: contextReceipts(capability).slice(0, 3),
    contextCapability: capability,
    startedAtUtc: "2026-08-02T12:00:00.000Z",
    updatedAtUtc: "2026-08-02T12:00:03.000Z",
  });

  assert.equal(partial.context_catalog_verified, true);
  assert.equal(partial.progress.status, "IN_PROGRESS");
  assert.equal(partial.progress.current_phase, "CORE_MARKET");
  assert.equal(partial.progress.coverage.complete, 2);
  assert.equal(partial.progress.coverage.percent, 20);
  assert.equal(partial.progress.tool_calls_count, 2);
});

test("backend rejects a model conclusion when one mandatory MCP phase was skipped", () => {
  const scopedEnvelope = envelope();
  const capability = contextCapability(scopedEnvelope);
  const session = buildDeskAiResearchSession({
    envelope: scopedEnvelope,
    analysisOutput: analysisOutput({ setups: [] }),
    contextEvidenceReceipts: resequenceReceipts(
      contextReceipts(capability).filter((receipt) => receipt.phase !== "NEWS"),
      capability,
    ),
    contextCapability: capability,
    startedAtUtc: "2026-08-02T12:00:00.000Z",
    completedAtUtc: "2026-08-02T12:01:00.000Z",
  });

  assert.equal(session.progress.coverage.percent < 100, true);
  assert.throws(
    () => assertDeskAiResearchSessionAllowed(session),
    (error) => (
      error.code === "AI_ANALYTICAL_RESEARCH_INCOMPLETE"
      && error.retryable === true
    ),
  );
});

test("backend rejects mandatory context calls executed out of analytical order", () => {
  const scopedEnvelope = envelope();
  const capability = contextCapability(scopedEnvelope);
  const receipts = contextReceipts(capability);
  [receipts[1], receipts[2]] = [receipts[2], receipts[1]];
  assert.throws(
    () => buildDeskAiResearchSession({
      envelope: scopedEnvelope,
      analysisOutput: analysisOutput({ setups: [] }),
      contextEvidenceReceipts: receipts,
      contextCapability: capability,
      startedAtUtc: "2026-08-02T12:00:00.000Z",
      completedAtUtc: "2026-08-02T12:01:00.000Z",
    }),
    (error) => (
      error.code === "AI_ANALYTICAL_CONTEXT_RECEIPT_SEQUENCE_INVALID"
    ),
  );
});

test("risk-increasing output is classified from a native execution plan", () => {
  assert.equal(
    classifyDeskAiDecisionIntent(analysisOutput({ setups: [{ setup_id: "setup-1" }] })),
    "RISK_INCREASING",
  );
});

function contextReceipts(capability) {
  const rows = [
    [null, "get_context_catalog", {}],
    ...CONTEXT_PHASES.map(([phase, tool]) => [
      phase,
      tool,
      phase === "CORE_MARKET" ? { domain: "core_market" }
        : phase === "INDEX_CONFIRMATION" ? { domain: "index_confirmation" }
          : phase === "CROSS_ASSET" ? { domain: "cross_asset" }
            : phase === "MEGACAPS" ? { domain: "megacaps" }
              : {},
    ]),
  ];
  return rows.map(([phase, tool, query], index) => {
    const unsigned = {
    schema_version: "desk_context_evidence_receipt_v1",
    receipt_id: `receipt-${index}`,
    recorded_at_utc: `2026-08-02T12:00:${String(index).padStart(2, "0")}.000Z`,
    capability_id: capability.capability_id,
    job_id: capability.job_id,
    envelope_hash: capability.envelope_hash,
    scope: capability.scope,
    workflow: capability.workflow,
    sequence: index + 1,
    phase,
    tool,
    query: { ...query, tool },
    status: "COMPLETE",
    result_sha256: createHash("sha256").update(`${phase}:${index}`).digest("hex"),
    evidence_count: 10,
    };
    return {
      ...unsigned,
      receipt_hmac: signDeskContextEvidenceReceipt(unsigned, capability),
    };
  });
}

function resequenceReceipts(receipts, capability) {
  return receipts.map((receipt, index) => {
    const { receipt_hmac: _ignored, ...unsigned } = receipt;
    unsigned.sequence = index + 1;
    return {
      ...unsigned,
      receipt_hmac: signDeskContextEvidenceReceipt(unsigned, capability),
    };
  });
}

function analysisOutput({ setups }) {
  return {
    schema_version: "desk_ai_analysis_output_v2",
    save_payload: {
      analysis_output: {
        execution_plan: {
          disposition: setups.length ? "SETUP_CONDITIONAL" : "MANAGEMENT_ONLY",
          primary_setup_id: setups[0]?.setup_id || null,
          setups,
          no_setup_proof: setups.length ? null : { reason: "No opportunity at cutoff." },
        },
      },
    },
    supplementary_writes: [],
    decision_summary: setups.length ? "Publish setup." : "Wait.",
    data_quality_status: "ready",
    warnings: [],
  };
}

function envelope() {
  return {
    job_id: "ai-run-1",
    envelope_hash: "b".repeat(64),
    scope: "replay",
    workflow: "REPLAY_MASTER",
    worker_id: "codex-replay-01",
    bundle_tool: "get_replay_master_bundle",
    bundle_args: {
      backtest_id: "replay-11",
      step_id: "step-1",
    },
    claim_handle: {
      work_item_id: "work-1",
      backtest_id: "replay-11",
      step_id: "step-1",
      worker_id: "codex-replay-01",
      lease_token: "secret-lease",
    },
    suggested_payload: {
      backtest_id: "replay-11",
      replay_run_id: "replay-11",
      step_id: "step-1",
      trading_date: "2026-06-11",
      session: "asia_open",
      mode: "replay",
      bundle_id: "bundle-1",
      pack_id: "pack-11",
      pack_build_id: "build-11",
    },
    bundle: {
      bundle_id: "bundle-1",
      bundle_type: "master",
      backtest_id: "replay-11",
      replay_run_id: "replay-11",
      step_id: "step-1",
      trading_date: "2026-06-11",
      session: "asia_open",
      mode: "replay",
      pack_id: "pack-11",
      pack_build_id: "build-11",
      source_bundle_hash: "sha256:replay-source-bundle-1",
      cutoff_utc: "2026-06-10T22:15:00.000Z",
      cutoff_paris: "2026-06-11T00:15:00+02:00",
    },
  };
}

function contextCapability(scopedEnvelope) {
  return buildDeskAiContextCapability(scopedEnvelope, {
    env: { DATABASE_URL: "postgresql://desk:secret@localhost/desk" },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });
}
