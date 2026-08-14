import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getEntitySchema } from "../../desk-contracts/index.js";
import {
  strategyDefinitionHashV1,
  strategyVersionHashV1,
  validateStrategyDefinitionV1,
  validateStrategyInstanceTransitionV1,
  validateStrategyInstanceV1,
  validateStrategyVersionTransitionV1,
  validateStrategyVersionV1,
} from "../index.js";

const STRATEGY_DEFINITION_ID = "8f14e45f-ceea-467e-add4-8c1f9f0d2a1b";
const STRATEGY_VERSION_ID = "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11";
const STRATEGY_INSTANCE_ID = "d4e5f6a7-8b9c-4d1e-9f2a-3b4c5d6e7f80";
const METRICS_REF = "6c1a3e00-1111-4a2b-9c3d-abcdef012345";

function sha256Text(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function definition(overrides = {}) {
  return {
    id: STRATEGY_DEFINITION_ID,
    external_key: "breakout-retest-mnq",
    name: "Breakout Retest MNQ",
    description: "Retest de cassure avec confirmation M1",
    owner: "operator@desk",
    asset_class: "futures",
    default_instruments: ["mnq", "MNQ", "mes"],
    tags: ["US Open", "us open"],
    created_at: "2026-08-07T09:00:00Z",
    metadata: { desk: "preprod" },
    ...overrides,
  };
}

function version(overrides = {}) {
  const dslSource = "strategy breakout_retest_mnq { entry: retest; risk: 0.25%; }";
  return {
    id: STRATEGY_VERSION_ID,
    strategy_definition_id: STRATEGY_DEFINITION_ID,
    version_label: "1.2.0",
    status: "VALIDATED",
    dsl_source: dslSource,
    dsl_source_hash: sha256Text(dslSource),
    compiled_artifact_ref: "artifacts/strategy-versions/3b2f1a90.plan.json",
    compiled_artifact: { rules: [{ type: "BREAK_RETEST_SEQUENCE", instrument: "MNQ" }] },
    validated_metrics_ref: METRICS_REF,
    runtime_contract_bundle_version: "engine=5.4.0,catalog=v1-2",
    created_at: "2026-08-07T09:10:00Z",
    metadata: { compiler: "strategy-dsl-v1" },
    ...overrides,
  };
}

function instance(overrides = {}) {
  return {
    id: STRATEGY_INSTANCE_ID,
    strategy_version_id: STRATEGY_VERSION_ID,
    runtime_state: "RUNNING",
    execution_mode: "PAPER",
    account_scope: "paper-sim-001",
    instrument_scope: ["mnq", "MNQ"],
    session_scope: ["ny_open"],
    risk_budget_ref: null,
    triple_lock_validated: false,
    created_at: "2026-08-07T09:20:00Z",
    started_at: "2026-08-07T09:21:00Z",
    last_heartbeat_at: "2026-08-07T09:22:00Z",
    metadata: { lane: "paper" },
    ...overrides,
  };
}

describe("Strategy registry V1 validators", () => {
  it("normalizes Strategy Definitions and produces a stable canonical hash", () => {
    const result = validateStrategyDefinitionV1(definition({
      metadata: { b: 2, a: 1 },
    }));
    const same = validateStrategyDefinitionV1({
      ...definition({ metadata: { a: 1, b: 2 } }),
      strategy_definition_id: STRATEGY_DEFINITION_ID,
    });

    assert.equal(result.ok, true);
    assert.equal(result.normalized.schema_version, "strategy_definition_v1");
    assert.deepEqual(result.normalized.default_instruments, ["MNQ", "MES"]);
    assert.deepEqual(result.normalized.tags, ["us open"]);
    assert.match(result.evidence.content_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(strategyDefinitionHashV1(result.normalized), strategyDefinitionHashV1(same.normalized));
  });

  it("validates Strategy Versions with reproducible source and artifact hashes before publication", () => {
    const result = validateStrategyVersionV1(version());
    const brokenPublication = validateStrategyVersionV1(version({
      status: "PUBLISHED",
      validated_metrics_ref: null,
      published_at: null,
    }));
    const brokenHash = validateStrategyVersionV1(version({
      dsl_source_hash: sha256Text("other source"),
    }));

    assert.equal(result.ok, true);
    assert.match(result.normalized.dsl_source_hash, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.normalized.compiled_artifact_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(strategyVersionHashV1(result.normalized), result.evidence.content_hash);
    assert.equal(brokenPublication.ok, false);
    assert.ok(brokenPublication.reasons.includes("STRATEGY_VERSION_VALIDATED_METRICS_REQUIRED"));
    assert.ok(brokenPublication.reasons.includes("STRATEGY_VERSION_PUBLISHED_AT_REQUIRED"));
    assert.equal(brokenHash.ok, false);
    assert.ok(brokenHash.reasons.includes("STRATEGY_HASH_MISMATCH"));
  });

  it("blocks invalid Strategy Version transitions and immutable published-version mutations", () => {
    const draftToPublished = validateStrategyVersionTransitionV1(
      version({ status: "DRAFT", validated_metrics_ref: null }),
      version({ status: "PUBLISHED", published_at: "2026-08-07T10:00:00Z" }),
    );
    const published = version({
      status: "PUBLISHED",
      published_at: "2026-08-07T10:00:00Z",
    });
    const mutatedPublished = validateStrategyVersionTransitionV1(published, {
      ...published,
      compiled_artifact_ref: "artifacts/strategy-versions/mutated.plan.json",
    });
    const deprecated = validateStrategyVersionTransitionV1(published, {
      ...published,
      status: "DEPRECATED",
      deprecated_at: "2026-08-08T10:00:00Z",
    });

    assert.equal(draftToPublished.ok, false);
    assert.ok(draftToPublished.reasons.includes("STRATEGY_VERSION_TRANSITION_FORBIDDEN"));
    assert.equal(mutatedPublished.ok, false);
    assert.ok(mutatedPublished.reasons.includes("STRATEGY_VERSION_IMMUTABLE"));
    assert.equal(deprecated.ok, true);
  });

  it("keeps Strategy Instance runtime state and execution mode independent but guarded", () => {
    const pausedLive = validateStrategyInstanceV1(instance({
      runtime_state: "PAUSED",
      execution_mode: "LIVE",
      account_scope: "sim101",
      triple_lock_validated: false,
    }));
    const missingAccount = validateStrategyInstanceV1(instance({
      execution_mode: "PAPER",
      account_scope: null,
    }));
    const conflictedLive = validateStrategyInstanceV1(instance({
      execution_mode: "LIVE",
      account_scope: "sim101",
      triple_lock_validated: false,
    }), { liveAccountConflict: true });

    assert.equal(pausedLive.ok, true);
    assert.equal(pausedLive.normalized.runtime_state, "PAUSED");
    assert.equal(pausedLive.normalized.execution_mode, "LIVE");
    assert.equal(missingAccount.ok, false);
    assert.ok(missingAccount.reasons.includes("STRATEGY_INSTANCE_ACCOUNT_SCOPE_REQUIRED"));
    assert.equal(conflictedLive.ok, false);
    assert.ok(conflictedLive.reasons.includes("STRATEGY_INSTANCE_TRIPLE_LOCK_REQUIRED"));
  });

  it("requires explicit operator approval for PAPER to LIVE and rejects direct SHADOW to LIVE", () => {
    const paperToLiveWithoutApproval = validateStrategyInstanceTransitionV1(
      instance({ execution_mode: "PAPER" }),
      instance({ execution_mode: "LIVE", account_scope: "sim101", triple_lock_validated: true }),
    );
    const shadowToLive = validateStrategyInstanceTransitionV1(
      instance({ execution_mode: "SHADOW", account_scope: null }),
      instance({
        execution_mode: "LIVE",
        account_scope: "sim101",
        triple_lock_validated: true,
        operator_approval_id: "approval-1",
      }),
    );
    const approved = validateStrategyInstanceTransitionV1(
      instance({ execution_mode: "PAPER" }),
      instance({
        execution_mode: "LIVE",
        account_scope: "sim101",
        triple_lock_validated: true,
        operator_approval_id: "approval-1",
      }),
    );

    assert.equal(paperToLiveWithoutApproval.ok, false);
    assert.ok(paperToLiveWithoutApproval.reasons.includes("STRATEGY_INSTANCE_LIVE_OPERATOR_APPROVAL_REQUIRED"));
    assert.equal(shadowToLive.ok, false);
    assert.ok(shadowToLive.reasons.includes("STRATEGY_INSTANCE_EXECUTION_MODE_TRANSITION_FORBIDDEN"));
    assert.equal(approved.ok, true);
  });

  it("requires explicit operator approval for SHADOW to PAPER promotion", () => {
    const withoutApproval = validateStrategyInstanceTransitionV1(
      instance({ execution_mode: "SHADOW", account_scope: null }),
      instance({ execution_mode: "PAPER", account_scope: "sim101" }),
    );
    const approved = validateStrategyInstanceTransitionV1(
      instance({ execution_mode: "SHADOW", account_scope: null }),
      instance({
        execution_mode: "PAPER",
        account_scope: "sim101",
        operator_approval_id: "approval-paper-1",
      }),
    );

    assert.equal(withoutApproval.ok, false);
    assert.ok(withoutApproval.reasons.includes("STRATEGY_INSTANCE_PAPER_OPERATOR_APPROVAL_REQUIRED"));
    assert.equal(approved.ok, true);
  });

  it("registers the Strategy entity schemas in desk-contracts", () => {
    assert.equal(getEntitySchema("strategy-definition-v1.schema.json").title, "DeskStrategyDefinition");
    assert.equal(getEntitySchema("strategy-version-v1.schema.json").properties.status.enum.includes("PUBLISHED"), true);
    assert.equal(getEntitySchema("strategy-instance-v1.schema.json").properties.execution_mode.enum.includes("LIVE"), true);
  });
});
