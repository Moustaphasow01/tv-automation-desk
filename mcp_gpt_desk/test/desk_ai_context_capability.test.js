import assert from "node:assert/strict";
import test from "node:test";

import {
  DESK_ANALYTICAL_PHASES,
  DESK_AI_CONTEXT_REQUIRED_TOOL_NAMES,
  buildDeskAiContextCapability,
  phaseForDeskContextCall,
  publicDeskAiContextCapability,
  readOnlyPostgresUrl,
  validateDeskAiContextCapability,
} from "../src/desk-ai-context-capability.js";

test("context capability pins one replay claim and keeps PostgreSQL credentials private", () => {
  const capability = buildDeskAiContextCapability(replayEnvelope(), {
    env: {
      DATABASE_URL: "postgresql://desk:secret@127.0.0.1:5432/desk",
      DESK_OBJECT_ROOT: "/desk/objects",
      DESK_OPERATOR_ADMIN_PIN: "must-not-leak",
    },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });

  assert.equal(capability.scope, "replay");
  assert.equal(capability.claim_scope.backtest_id, "replay-11");
  assert.equal(capability.claim_scope.step_id, "step-73");
  assert.equal(capability.bootstrap_manifest.source_bundle_hash, "source-bundle-hash");
  assert.match(capability.runtime_env.DATABASE_URL, /default_transaction_read_only/);
  assert.equal(capability.runtime_env.DESK_OPERATOR_ADMIN_PIN, undefined);
  assert.deepEqual(capability.mandatory_phases, DESK_ANALYTICAL_PHASES);
  assert.equal(validateDeskAiContextCapability(capability, {
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  }), capability);

  const publicCapability = publicDeskAiContextCapability(capability);
  assert.equal(publicCapability.runtime_env, undefined);
  assert.equal(JSON.stringify(publicCapability).includes("secret"), false);
});

test("context capability expires and cannot be used after its deadline", () => {
  const capability = buildDeskAiContextCapability(replayEnvelope(), {
    env: { DATABASE_URL: "postgresql://desk:secret@localhost/desk" },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
    ttlMs: 60_000,
  });

  assert.throws(
    () => validateDeskAiContextCapability(capability, {
      now: () => new Date("2026-08-02T12:01:00.000Z"),
    }),
    (error) => error.code === "AI_CONTEXT_CAPABILITY_EXPIRED",
  );
});

test("context capability can forbid optional deep reads while preserving every mandatory phase", () => {
  const capability = buildDeskAiContextCapability(replayEnvelope(), {
    env: { DATABASE_URL: "postgresql://desk:secret@localhost/desk" },
    allowedTools: DESK_AI_CONTEXT_REQUIRED_TOOL_NAMES,
  });

  assert.deepEqual(capability.allowed_tools, DESK_AI_CONTEXT_REQUIRED_TOOL_NAMES);
  assert.equal(capability.allowed_tools.includes("get_market_dataset"), false);
  assert.equal(capability.allowed_tools.includes("get_replay_section_page"), false);
  assert.equal(validateDeskAiContextCapability(capability), capability);
});

test("Replay Master capability derives its cutoff from the immutable compact pack", () => {
  const envelope = replayEnvelope();
  delete envelope.bundle.cutoff_utc;
  delete envelope.suggested_payload.as_of_utc;
  envelope.workflow = "REPLAY_MASTER";
  envelope.bundle.bundle_type = "master";
  envelope.bundle.pack = {
    pack_id: "pack-11",
    pack_build_id: "build-11",
    cutoff_utc: "2026-06-11T01:55:00.000Z",
    cutoff_paris: "2026-06-11T03:55:00+02:00",
  };

  const capability = buildDeskAiContextCapability(envelope, {
    env: { DATABASE_URL: "postgresql://desk:secret@localhost/desk" },
  });

  assert.equal(capability.claim_scope.cutoff_utc, "2026-06-11T01:55:00.000Z");
  assert.equal(capability.claim_scope.pack_build_id, "build-11");
});

test("Replay capability uses the backend save target UTC when the compact bundle omits it", () => {
  const envelope = replayEnvelope();
  delete envelope.bundle.cutoff_utc;
  envelope.bundle.cutoff_paris = "2026-06-11T03:55:00+02:00";
  envelope.suggested_payload.as_of_utc = "2026-06-11T01:55:00.000Z";

  const capability = buildDeskAiContextCapability(envelope, {
    env: { DATABASE_URL: "postgresql://desk:secret@localhost/desk" },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });

  assert.equal(capability.claim_scope.cutoff_utc, "2026-06-11T01:55:00.000Z");
  assert.equal(capability.claim_scope.cutoff_paris, "2026-06-11T03:55:00+02:00");
  assert.equal(validateDeskAiContextCapability(capability, {
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  }), capability);
});

test("capability construction fails before Codex when canonical cutoff scope is incomplete", () => {
  const envelope = replayEnvelope();
  delete envelope.bundle.cutoff_utc;
  delete envelope.bundle.cutoff_paris;
  delete envelope.suggested_payload.as_of_utc;

  assert.throws(
    () => buildDeskAiContextCapability(envelope, {
      env: { DATABASE_URL: "postgresql://desk:secret@localhost/desk" },
    }),
    (error) => (
      error.code === "AI_CONTEXT_CAPABILITY_SCOPE_INCOMPLETE"
      && error.details?.missing?.includes("cutoff_utc")
      && error.details?.missing?.includes("cutoff_paris")
    ),
  );
});

test("context capability rejects a suggested future cutoff or foreign immutable pack", () => {
  const cutoffDrift = replayEnvelope();
  cutoffDrift.suggested_payload.as_of_utc = "2026-06-11T03:55:00.000Z";
  assert.throws(
    () => buildDeskAiContextCapability(cutoffDrift, {
      env: { DATABASE_URL: "postgresql://desk:secret@localhost/desk" },
    }),
    (error) => (
      error.code === "AI_CONTEXT_CAPABILITY_SCOPE_MISMATCH"
      && error.details?.field === "cutoff_utc"
    ),
  );

  const packDrift = replayEnvelope();
  packDrift.suggested_payload.pack_build_id = "foreign-build";
  assert.throws(
    () => buildDeskAiContextCapability(packDrift, {
      env: { DATABASE_URL: "postgresql://desk:secret@localhost/desk" },
    }),
    (error) => (
      error.code === "AI_CONTEXT_CAPABILITY_SCOPE_MISMATCH"
      && error.details?.field === "pack_build_id"
    ),
  );
});

test("market calls map to mandatory analytical phases", () => {
  assert.equal(
    phaseForDeskContextCall("get_market_context", { domain: "core_market" }),
    "CORE_MARKET",
  );
  assert.equal(
    phaseForDeskContextCall("get_market_dataset", { domain: "cross_asset" }),
    "CROSS_ASSET",
  );
  assert.equal(phaseForDeskContextCall("get_macro_context"), "MACRO");
});

test("read-only PostgreSQL URL preserves existing connection options", () => {
  const value = readOnlyPostgresUrl(
    "postgresql://desk:secret@localhost/desk?sslmode=require&options=-c%20search_path%3Dpublic",
  );
  const parsed = new URL(value);
  assert.equal(parsed.searchParams.get("sslmode"), "require");
  assert.match(parsed.searchParams.get("options"), /search_path=public/);
  assert.match(parsed.searchParams.get("options"), /default_transaction_read_only=on/);
});

function replayEnvelope() {
  return {
    job_id: "ai-run-1",
    envelope_hash: "a".repeat(64),
    scope: "replay",
    workflow: "REPLAY_MONITOR",
    worker_id: "codex-replay-01",
    claim_handle: {
      work_item_id: "work-73",
      backtest_id: "replay-11",
      step_id: "step-73",
    },
    bundle_tool: "get_replay_monitor_bundle",
    bundle_args: {
      backtest_id: "replay-11",
      step_id: "step-73",
    },
    suggested_payload: {
      backtest_id: "replay-11",
      replay_run_id: "replay-11",
      step_id: "step-73",
      pack_id: "pack-11",
      pack_build_id: "build-11",
    },
    bundle: {
      bundle_id: "bundle-73",
      bundle_type: "monitor",
      backtest_id: "replay-11",
      step_id: "step-73",
      trading_date: "2026-06-11",
      session: "asia_open",
      cutoff_utc: "2026-06-11T01:55:00.000Z",
      cutoff_paris: "2026-06-11T03:55:00+02:00",
      pack_id: "pack-11",
      pack_build_id: "build-11",
      source_bundle_hash: "source-bundle-hash",
      canonical_bundle_hash: "bundle-hash",
    },
  };
}
