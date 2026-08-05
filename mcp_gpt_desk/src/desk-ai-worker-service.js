import { createHash, randomUUID } from "node:crypto";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";

import { callDeskTool, createDeskToolRegistry } from "./tools.js";
import {
  buildDeskAiAnalysisPrompt,
  buildDeskAiCodexOutputJsonSchema,
  buildDeskAiRepairPrompt,
  buildDeskAiJobEnvelope,
  materializeDeskAiWrites,
} from "./desk-ai-worker-envelope.js";
import { selectDeskAiAnalysisPolicy } from "./desk-ai-analysis-policy.js";
import {
  assertMasterV5ContractOutput,
  assertMonitorV2ContractOutput,
} from "./strategy-contract-validator.js";
import {
  buildDeskAiContextCapability,
  DESK_AI_CONTEXT_REQUIRED_TOOL_NAMES,
  DESK_AI_CONTEXT_TOOL_NAMES,
} from "./desk-ai-context-capability.js";
import {
  assertDeskAiResearchSessionAllowed,
  buildDeskAiContextResearchProgress,
  buildDeskAiResearchSession,
} from "./desk-ai-research-session.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "./strategy-runtime-versioning.js";

const ALLOWED_BUNDLE_READ_TOOLS = new Set([
  "get_master_cutoff_bundle",
  "get_manual_monitor_bundle",
  "get_replay_master_bundle",
  "get_replay_monitor_bundle",
  "get_replay_bundle_section",
  "get_replay_snapshot",
]);

const ALLOWED_REPLAY_FOLLOWUP_READ_TOOLS = new Set([
  "get_replay_bundle_section",
  "get_replay_snapshot",
]);
const REPLAY_LINEAGE_COMPONENTS = new Set([
  "replay_master_analysis",
  "replay_active_thesis",
  "replay_setups",
  "previous_replay_monitor",
  "replay_position",
]);

const LOCAL_REPLAY_BUNDLE_BUDGET_BYTES = 512_000;
const DEFAULT_REPLAY_CONTEXT_BUDGET_BYTES = 4_000_000;
const MAX_REPLAY_CONTEXT_BUDGET_BYTES = 16_000_000;
const DEFAULT_REPLAY_TRANSPORT_READS = 64;
const MAX_BOUNDED_CONVERSATION_TURNS = 12;
const BOUNDED_CONVERSATION_REUSE_POLICY = "BOUNDED_RUN_CONTINUITY";

export async function replayAdmissionAgainstLiveCursor(persistence, tradingDate) {
  const result = await persistence.pool.query(
    `SELECT data->>'cursor_status' AS status
     FROM desk_documents
     WHERE collection = 'desk_live_run_cursor'
       AND data->>'trading_date' = $1
       AND (
         data->>'cursor_status' IN ('DUE', 'RETRY')
         OR (
           data->>'cursor_status' = 'LEASED'
           AND NULLIF(data#>>'{attempt,lease_expires_at_utc}', '')::timestamptz > now()
         )
       )
     LIMIT 1`,
    [tradingDate],
  ).catch(() => ({ rows: [] }));
  return result.rows.length
    ? { allowed: false, reason: `live_${String(result.rows[0].status || "pending").toLowerCase()}` }
    : { allowed: true };
}

export class LocalDeskWorkerFacade {
  constructor(store, options = {}) {
    this.store = store;
    this.tools = options.tools || createDeskToolRegistry(store);
    this.maxFollowupReads = boundedInteger(options.maxFollowupReads, 20, 0, 50);
    this.maxReplayTransportReads = boundedInteger(
      options.maxReplayTransportReads
        ?? process.env.DESK_AI_REPLAY_MAX_TRANSPORT_READS,
      DEFAULT_REPLAY_TRANSPORT_READS,
      1,
      200,
    );
    this.replayContextBudgetBytes = boundedInteger(
      options.replayContextBudgetBytes
        ?? process.env.DESK_AI_REPLAY_CONTEXT_BUDGET_BYTES,
      DEFAULT_REPLAY_CONTEXT_BUDGET_BYTES,
      LOCAL_REPLAY_BUNDLE_BUDGET_BYTES,
      MAX_REPLAY_CONTEXT_BUDGET_BYTES,
    );
  }

  async claim(scope, { workerId, leaseSeconds = undefined } = {}) {
    if (scope === "live") {
      return this.call("claim_next_live_work", {
        worker_id: workerId,
        lease_seconds: leaseSeconds || 660,
        retry_attempts: 1,
        retry_delay_seconds: 30,
      });
    }
    const start = await this.call("start_or_resume_replay_autopilot", {
      mode: process.env.DESK_AI_REPLAY_SELECTOR_MODE || "next_ready_config",
      worker_group: process.env.DESK_AI_REPLAY_WORKER_GROUP || "replay-v4",
      worker_id: workerId,
      max_transitions: boundedInteger(process.env.DESK_AI_REPLAY_MAX_TRANSITIONS, 6, 1, 12),
      recover_failed: true,
    });
    if (start.status !== "WAITING_GPT") return start;
    const claimArgs = start.gpt_claim?.args || {};
    if (claimArgs.worker_id && claimArgs.worker_id !== workerId) {
      throw workerError(
        "AI_REPLAY_WORKER_SCOPE_MISMATCH",
        "Replay autopilot returned claim arguments owned by another worker.",
      );
    }
    return this.call("claim_next_replay_work", {
      ...claimArgs,
      worker_id: workerId,
      lease_seconds: leaseSeconds || claimArgs.lease_seconds || 720,
    });
  }

  async readClaimContext(claim, {
    agenticContext = false,
  } = {}) {
    const tool = claim?.bundle?.bundle_tool;
    if (!ALLOWED_BUNDLE_READ_TOOLS.has(tool)) {
      throw workerError("AI_BUNDLE_TOOL_FORBIDDEN", `Unsupported bundle read tool: ${tool || "missing"}.`);
    }
    const bundleArgs = localBundleReadArgs(tool, claim.bundle.bundle_args || {});
    if (agenticContext) {
      return this.readAgenticBootstrapContext(claim, tool, bundleArgs);
    }
    if (isReplayBundleTool(tool)) {
      return this.readReplayClaimContext(claim, tool, bundleArgs);
    }
    const bundle = await this.call(tool, bundleArgs);
    const followupReads = [];
    const reads = Array.isArray(bundle.required_followup_reads)
      ? bundle.required_followup_reads.slice(0, this.maxFollowupReads)
      : [];
    for (const read of reads) {
      const followupTool = read?.tool || read?.name;
      const args = read?.arguments || read?.args || {};
      if (!ALLOWED_BUNDLE_READ_TOOLS.has(followupTool)) {
        throw workerError("AI_FOLLOWUP_TOOL_FORBIDDEN", `Unsupported follow-up read tool: ${followupTool || "missing"}.`);
      }
      const result = await this.call(followupTool, args);
      if (result?.complete === false) {
        throw workerError(
          "AI_REPLAY_CONTEXT_INCOMPLETE",
          `Replay follow-up read remained incomplete: ${followupTool}.`,
          { tool: followupTool, args },
        );
      }
      followupReads.push({
        tool: followupTool,
        args,
        result,
      });
    }
    const context = bundle.contract_context || {};
    const contract = context.contract_name && context.schema_version
      ? await this.call("get_contract", {
          contract_name: context.contract_name,
          schema_version: context.schema_version,
        })
      : null;
    return { bundle, contract, followupReads };
  }

  async readAgenticBootstrapContext(claim, tool, bundleArgs) {
    const args = {
      ...bundleArgs,
      view: "compact",
      include_sections: [
        "contract",
        "save_target",
        "quality",
        "pack",
        "dataset_integrity",
        "market_availability",
        "instructions",
      ],
      include_raw_refs: false,
      max_response_bytes: LOCAL_REPLAY_BUNDLE_BUDGET_BYTES,
    };
    const rawBundle = await this.call(tool, args);
    const runtimeStateHint = await this.readCanonicalRuntimeStateHint(claim, rawBundle);
    const bundle = {
      ...rawBundle,
      runtime_state_hint: runtimeStateHint,
    };
    if (bundle?.complete === false) {
      throw workerError(
        "AI_AGENTIC_BOOTSTRAP_INCOMPLETE",
        "The bounded analytical bootstrap could not expose its contract and save target.",
        {
          tool,
          transport: bundle?.transport || null,
          omitted_sections: bundle?.omitted_sections || null,
        },
        true,
      );
    }
    if (isReplayBundleTool(tool)) {
      const expected = replayExpectedIdentity(claim, bundle, tool);
      assertReplayPrimaryScope(args, expected);
      assertReplayReadResultScope(bundle, expected, {
        tool,
        primary: true,
      });
    }
    const context = bundle.contract_context || {};
    const contract = context.contract_name && context.schema_version
      ? await this.call("get_contract", {
          contract_name: context.contract_name,
          schema_version: context.schema_version,
        })
      : null;
    return {
      bundle,
      contract,
      followupReads: [],
      transportTelemetry: isReplayBundleTool(tool)
        ? {
            mode: "agentic_bootstrap",
            tool_calls: 2,
            response_bytes: jsonValueBytes(bundle),
            contract_bytes: jsonValueBytes(contract),
            followup_reads_completed: 0,
          }
        : null,
    };
  }

  async readCanonicalRuntimeStateHint(claim, bundle) {
    const replay = isReplayBundleTool(claim?.bundle?.bundle_tool);
    const persistence = this.store?.persistence;
    if (typeof persistence?.queryCollectionDocuments !== "function") {
      return {
        source: "CANONICAL_POSTGRES",
        scope: replay ? "replay" : "live",
        state: "STATE_SOURCE_UNAVAILABLE",
        setups: [],
        active_position: null,
      };
    }
    const scopeField = replay ? "backtest_id" : "run_id";
    const scopeValue = replay
      ? claim?.claim_handle?.backtest_id || bundle?.backtest_id
      : claim?.claim_handle?.run_id || bundle?.run_id;
    const setupCollection = replay
      ? DESK_COLLECTIONS.deskReplaySetups
      : DESK_COLLECTIONS.deskSetups;
    const positionCollection = replay
      ? DESK_COLLECTIONS.deskReplayPositions
      : DESK_COLLECTIONS.deskPositions;
    if (!scopeValue) {
      return {
        source: "CANONICAL_POSTGRES",
        scope: replay ? "replay" : "live",
        state: "SCOPE_UNAVAILABLE",
        setups: [],
        active_position: null,
      };
    }
    const query = (collection) => persistence.queryCollectionDocuments({
      collection,
      filters: [{ field: scopeField, operator: "==", value: scopeValue }],
      limit: 200,
    }).catch(() => []);
    const [setups, positions] = await Promise.all([
      query(setupCollection),
      query(positionCollection),
    ]);
    const activePosition = [...positions]
      .filter((position) => !["CLOSED", "CANCELLED", "CANCELED", "FLAT"]
        .includes(String(position.status || position.state || "").toUpperCase()))
      .sort(compareLatestDocument)[0] || null;
    return {
      source: "CANONICAL_POSTGRES",
      scope: replay ? "replay" : "live",
      scope_id: String(scopeValue),
      state: "AVAILABLE",
      setups: setups
        .sort(compareLatestDocument)
        .slice(0, 10)
        .map((setup) => ({
          setup_id: setup.setup_id || setup.setup_record_id || null,
          status: setup.status || setup.state || setup.lifecycle_state || null,
          instrument: setup.instrument || null,
          direction: setup.direction || null,
          expires_at_paris: setup.expires_at_paris || setup.valid_until_paris || null,
        })),
      active_position: activePosition ? {
        position_id: activePosition.position_id || null,
        status: activePosition.status || activePosition.state || null,
        instrument: activePosition.instrument || null,
        direction: activePosition.direction || activePosition.side || null,
      } : null,
    };
  }

  async readReplayClaimContext(claim, tool, bundleArgs) {
    const telemetry = createReplayTransportTelemetry({
      contextBudgetBytes: this.replayContextBudgetBytes,
      maxTransportReads: this.maxReplayTransportReads,
    });
    const read = async (readTool, args) => {
      if (telemetry.tool_calls >= this.maxReplayTransportReads) {
        throw replayTransportExhausted(
          "Replay context exceeded the bounded number of transport reads.",
          telemetry,
          {
            reason: "transport_read_limit",
            tool: readTool,
          },
        );
      }
      const result = await this.call(readTool, args);
      recordReplayTransportRead(telemetry, readTool, args, result);
      if (telemetry.response_bytes > this.replayContextBudgetBytes) {
        throw replayTransportExhausted(
          "Replay context exceeded its global transport budget.",
          telemetry,
          {
            reason: "global_context_budget",
            tool: readTool,
          },
        );
      }
      return result;
    };

    const bundle = await read(tool, bundleArgs);
    const expected = replayExpectedIdentity(claim, bundle, tool);
    assertReplayPrimaryScope(bundleArgs, expected);
    assertReplayReadResultScope(bundle, expected, {
      tool,
      primary: true,
    });

    const requestedReads = Array.isArray(bundle.required_followup_reads)
      ? bundle.required_followup_reads
      : [];
    if (bundle.complete === false && requestedReads.length === 0) {
      throw replayTransportExhausted(
        "The replay bundle exceeded its response budget without replay-scoped follow-up reads.",
        telemetry,
        { reason: "missing_followup_reads" },
      );
    }
    if (requestedReads.length > this.maxFollowupReads) {
      throw replayTransportExhausted(
        "The replay bundle requires more follow-up sections than the bounded reader permits.",
        telemetry,
        {
          reason: "followup_descriptor_limit",
          required_reads: requestedReads.length,
          max_followup_reads: this.maxFollowupReads,
        },
      );
    }

    const followupReads = [];
    const knownInstruments = replayKnownInstruments(bundle);
    for (const descriptor of requestedReads) {
      const followupTool = descriptor?.tool || descriptor?.name;
      const rawArgs = descriptor?.arguments || descriptor?.args || {};
      if (!ALLOWED_REPLAY_FOLLOWUP_READ_TOOLS.has(followupTool)) {
        throw workerError(
          "AI_FOLLOWUP_TOOL_FORBIDDEN",
          `Unsupported replay follow-up read tool: ${followupTool || "missing"}.`,
        );
      }
      assertReplayFollowupScope(rawArgs, expected, followupTool);
      const args = replayFollowupArgs(rawArgs);
      const result = followupTool === "get_replay_bundle_section"
        ? await readReplaySectionFully({
            read,
            args,
            expected,
            manifest: bundle.section_manifest,
            telemetry,
          })
        : await readReplaySnapshotFully({
            read,
            args,
            expected,
            knownInstruments: [...knownInstruments],
            telemetry,
          });
      replayKnownInstruments(result).forEach((instrument) => knownInstruments.add(instrument));
      followupReads.push({
        tool: followupTool,
        args,
        result,
      });
    }

    const context = bundle.contract_context || {};
    const contract = context.contract_name && context.schema_version
      ? await this.call("get_contract", {
          contract_name: context.contract_name,
          schema_version: context.schema_version,
        })
      : null;
    telemetry.contract_bytes = jsonValueBytes(contract);
    telemetry.followup_reads_completed = followupReads.length;
    telemetry.materialized_context_bytes = jsonValueBytes({
      bundle,
      contract,
      followupReads,
    });
    if (telemetry.materialized_context_bytes > this.replayContextBudgetBytes) {
      throw replayTransportExhausted(
        "The reconstructed replay context exceeded its global materialization budget.",
        telemetry,
        { reason: "materialized_context_budget" },
      );
    }
    return {
      bundle,
      contract,
      followupReads,
      transportTelemetry: finalizeReplayTransportTelemetry(telemetry),
    };
  }

  async heartbeat(scope, handle) {
    return this.call(scope === "live" ? "heartbeat_live" : "heartbeat_replay", lifecyclePayload(scope, handle));
  }

  async save(tool, payload) {
    return this.call(tool, payload);
  }

  validate(tool, payload) {
    const definition = this.tools.find((candidate) => candidate.name === tool);
    if (!definition?.validator) {
      throw workerError(
        "AI_SAVE_TOOL_VALIDATOR_MISSING",
        `No local validator is registered for analytical save tool: ${tool || "missing"}.`,
      );
    }
    try {
      const parsed = definition.validator.parse(payload);
      validateNativeContractOutput(tool, parsed);
      return parsed;
    } catch (error) {
      throw workerError(
        "AI_SAVE_PAYLOAD_VALIDATION_FAILED",
        `Analytical payload failed local validation for ${tool}.`,
        {
          tool,
          issues: compactValidationIssues(error, {
            pathPrefix: nativeContractOutputPath(tool),
          }),
        },
      );
    }
  }

  async validateForSave(tool, payload) {
    const parsed = this.validate(tool, payload);
    if (
      tool === "save_replay_master_analysis"
      && typeof this.store?.validateReplayMasterStrategyPayload === "function"
    ) {
      await this.store.validateReplayMasterStrategyPayload(parsed);
    }
    if (
      tool === "save_replay_monitor"
      && typeof this.store?.validateReplayMonitorStrategyPayload === "function"
    ) {
      await this.store.validateReplayMonitorStrategyPayload(parsed);
    }
    return parsed;
  }

  async complete(scope, handle, telemetry = undefined) {
    return this.call(scope === "live" ? "complete_live" : "complete_replay", {
      ...lifecyclePayload(scope, handle),
      ...(telemetry ? { telemetry: compatibleTelemetry(telemetry) } : {}),
    });
  }

  async fail(scope, handle, error) {
    const retryable = error?.retryable === true;
    return this.call(scope === "live" ? "fail_live" : "fail_replay", {
      ...lifecyclePayload(scope, handle),
      error_code: String(error?.code || "AI_WORKER_FAILED").slice(0, 120),
      error_message: String(error?.message || error || "AI worker failure").slice(0, 2_000),
      ...(scope === "live"
        ? { error_class: retryable ? "transient" : "deterministic" }
        : { retryable }),
    });
  }

  async recordRun(document) {
    const collection = "desk_ai_worker_runs";
    await this.store.persistence.setDocument(collection, document.ai_run_id, document, { merge: true });
  }

  async getConversationSession(envelope) {
    const identity = deskAiConversationIdentity(envelope);
    const runtimeHash = deskAiConversationRuntimeHash(envelope);
    const artifactHash = deskAiConversationArtifactHash(envelope);
    const currentCutoff = deskAiConversationCutoff(envelope);
    try {
      const document = await this.store.persistence.getDocument(
        "desk_ai_conversation_sessions",
        identity.session_key,
      );
      const sameScope = (
        document?.scope !== identity.scope
        || document?.scope_id !== identity.scope_id
      ) === false;
      const monotonicCutoff = (
        Date.parse(String(document?.last_cutoff_utc || document?.last_cutoff_paris || ""))
        < Date.parse(String(currentCutoff || ""))
      );
      const reusable = (
        sameScope
        && document?.disabled !== true
        && document?.reuse_policy === BOUNDED_CONVERSATION_REUSE_POLICY
        && document?.runtime_hash === runtimeHash
        && Boolean(document?.last_thread_id || document?.thread_id)
        && Number(document?.turn_count || 0) < MAX_BOUNDED_CONVERSATION_TURNS
        && monotonicCutoff
      );
      const seenArtifactHashes = Array.isArray(document?.seen_artifact_hashes)
        ? document.seen_artifact_hashes.map(String)
        : [];
      if (!reusable) {
        return {
          ...identity,
          thread_id: null,
          resume_thread_id: null,
          last_thread_id: document?.last_thread_id || document?.thread_id || null,
          turn_count: 0,
          conversation_generation: Number(document?.conversation_generation || 1) + 1,
          reuse_policy: BOUNDED_CONVERSATION_REUSE_POLICY,
          runtime_hash: runtimeHash,
          artifact_hash: artifactHash,
          reuse_immutable_context: false,
        };
      }
      const threadId = String(document.last_thread_id || document.thread_id);
      return {
        ...identity,
        thread_id: threadId,
        resume_thread_id: threadId,
        last_thread_id: threadId,
        turn_count: Number(document.turn_count || 0),
        conversation_generation: Number(document.conversation_generation || 1),
        reuse_policy: BOUNDED_CONVERSATION_REUSE_POLICY,
        runtime_hash: runtimeHash,
        artifact_hash: artifactHash,
        reuse_immutable_context: seenArtifactHashes.includes(artifactHash),
      };
    } catch (error) {
      if (String(error?.message || "").includes("document_not_found")) {
        return {
          ...identity,
          thread_id: null,
          resume_thread_id: null,
          last_thread_id: null,
          turn_count: 0,
          conversation_generation: 1,
          reuse_policy: BOUNDED_CONVERSATION_REUSE_POLICY,
          runtime_hash: runtimeHash,
          artifact_hash: artifactHash,
          reuse_immutable_context: false,
        };
      }
      throw error;
    }
  }

  async recordConversationSession(envelope, telemetry = {}) {
    if (!telemetry.thread_id) return null;
    const identity = deskAiConversationIdentity(envelope);
    const nowUtc = new Date().toISOString();
    const runtimeHash = deskAiConversationRuntimeHash(envelope);
    const artifactHash = deskAiConversationArtifactHash(envelope);
    let persisted = null;
    try {
      persisted = await this.store.persistence.getDocument(
        "desk_ai_conversation_sessions",
        identity.session_key,
      );
    } catch (error) {
      if (!String(error?.message || "").includes("document_not_found")) throw error;
    }
    const sameRuntime = (
      persisted?.scope === identity.scope
      && persisted?.scope_id === identity.scope_id
      && persisted?.runtime_hash === runtimeHash
    );
    const seenArtifactHashes = sameRuntime && Array.isArray(persisted?.seen_artifact_hashes)
      ? persisted.seen_artifact_hashes.map(String)
      : [];
    if (!seenArtifactHashes.includes(artifactHash)) seenArtifactHashes.push(artifactHash);
    const turnCount = sameRuntime ? Number(persisted?.turn_count || 0) : 0;
    const conversationGeneration = sameRuntime
      ? Number(persisted?.conversation_generation || 1)
      : Number(persisted?.conversation_generation || 0) + 1;
    const document = {
      schema_version: "desk_ai_conversation_session_v2",
      session_key: identity.session_key,
      scope: identity.scope,
      scope_id: identity.scope_id,
      thread_id: String(telemetry.thread_id),
      last_thread_id: String(telemetry.thread_id),
      reuse_policy: BOUNDED_CONVERSATION_REUSE_POLICY,
      continuity_source: "CANONICAL_BACKEND_AT_CUTOFF",
      runtime_hash: runtimeHash,
      seen_artifact_hashes: seenArtifactHashes,
      conversation_generation: conversationGeneration,
      conversation_mode: telemetry.conversation_mode || "CREATED",
      turn_count: turnCount + 1,
      last_workflow: envelope.workflow,
      last_envelope_hash: envelope.envelope_hash,
      last_bundle_id: envelope.suggested_payload?.bundle_id || envelope.bundle?.bundle_id || null,
      last_pack_build_id: envelope.suggested_payload?.pack_build_id || envelope.bundle?.pack_build_id || null,
      last_cutoff_paris: envelope.suggested_payload?.cutoff_paris
        || envelope.bundle?.cutoff_paris
        || envelope.bundle?.checkpoint
        || null,
      last_cutoff_utc: envelope.suggested_payload?.as_of_utc
        || envelope.bundle?.cutoff_utc
        || envelope.bundle?.as_of_utc
        || null,
      updated_at_utc: nowUtc,
      ...(persisted?.created_at_utc ? {} : { created_at_utc: nowUtc }),
    };
    await this.store.persistence.setDocument(
      "desk_ai_conversation_sessions",
      identity.session_key,
      document,
      { merge: true },
    );
    return document;
  }

  async call(tool, args) {
    const result = await callDeskTool(this.tools, tool, args);
    if (result?.isError || result?.structuredContent?.ok === false) {
      const data = result?.structuredContent || {};
      throw workerError(
        data.code || "AI_DESK_TOOL_FAILED",
        data.error || `Desk tool failed: ${tool}`,
        data.details,
        isTransientToolFailure(data.code),
      );
    }
    return result?.structuredContent ?? result;
  }
}

function localBundleReadArgs(tool, args = {}) {
  if (!isReplayBundleTool(tool)) return args;
  return {
    ...args,
    include_raw_refs: false,
    max_response_bytes: LOCAL_REPLAY_BUNDLE_BUDGET_BYTES,
  };
}

function isReplayBundleTool(tool) {
  return tool === "get_replay_master_bundle" || tool === "get_replay_monitor_bundle";
}

function replayExpectedIdentity(claim, bundle, tool) {
  const handle = claim?.claim_handle || {};
  const bundleType = tool === "get_replay_monitor_bundle" ? "monitor" : "master";
  const expected = {
    backtest_id: handle.backtest_id || bundle.backtest_id || null,
    step_id: handle.step_id || bundle.step_id || null,
    bundle_type: bundle.bundle_type || bundleType,
    canonical_bundle_hash: bundle.canonical_bundle_hash || null,
    source_bundle_hash: bundle.source_bundle_hash || null,
  };
  if (!expected.source_bundle_hash) {
    throw workerError(
      "AI_REPLAY_CONTEXT_SOURCE_HASH_MISSING",
      "Replay context must expose the immutable source bundle hash.",
      {
        backtest_id: expected.backtest_id,
        step_id: expected.step_id,
        bundle_type: expected.bundle_type,
      },
      true,
    );
  }
  assertSameReplayScope("backtest_id", handle.backtest_id, bundle.backtest_id);
  assertSameReplayScope("step_id", handle.step_id, bundle.step_id);
  assertSameReplayScope("bundle_type", bundleType, expected.bundle_type);
  if (bundle.mode && !["replay", "backtest"].includes(String(bundle.mode))) {
    throw workerError(
      "AI_REPLAY_CONTEXT_SCOPE_MISMATCH",
      `Replay context returned a non-replay mode: ${bundle.mode}.`,
      { field: "mode", expected: ["replay", "backtest"], actual: bundle.mode },
    );
  }
  return expected;
}

function assertReplayPrimaryScope(args, expected) {
  assertSameReplayScope("backtest_id", expected.backtest_id, args.backtest_id, true);
  assertSameReplayScope("step_id", expected.step_id, args.step_id, true);
  if (args.bundle_type !== undefined) {
    assertSameReplayScope("bundle_type", expected.bundle_type, args.bundle_type, true);
  }
}

function assertReplayFollowupScope(args, expected, tool) {
  assertSameReplayScope("backtest_id", expected.backtest_id, args.backtest_id, true);
  assertSameReplayScope("step_id", expected.step_id, args.step_id, true);
  assertSameReplayScope("bundle_type", expected.bundle_type, args.bundle_type, true);
  if (tool === "get_replay_bundle_section" && Number(args.offset || 0) !== 0) {
    throw workerError(
      "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
      "A replay follow-up section must start at offset zero for lossless reconstruction.",
      { field: "offset", expected: 0, actual: args.offset },
    );
  }
}

function assertReplayReadResultScope(result, expected, {
  tool,
  args = {},
  primary = false,
} = {}) {
  assertSameReplayScope("backtest_id", expected.backtest_id, result?.backtest_id, true);
  assertSameReplayScope("step_id", expected.step_id, result?.step_id, true);
  assertSameReplayScope("bundle_type", expected.bundle_type, result?.bundle_type, true);
  if (result?.mode && !["replay", "backtest"].includes(String(result.mode))) {
    throw workerError(
      "AI_REPLAY_CONTEXT_SCOPE_MISMATCH",
      `Replay follow-up returned a non-replay mode: ${result.mode}.`,
      { field: "mode", expected: ["replay", "backtest"], actual: result.mode, tool },
    );
  }
  if (!primary && expected.source_bundle_hash) {
    assertSameReplayHash(
      "source_bundle_hash",
      expected.source_bundle_hash,
      result?.source_bundle_hash,
      tool,
    );
  }
  if (tool === "get_replay_bundle_section") {
    assertSameReplayScope("section", args.section, result?.section, true);
  }
  if (tool === "get_replay_snapshot") {
    assertSameReplayScope("window", args.window, result?.window, true);
  }
}

function assertSameReplayScope(field, expected, actual, requireActual = false) {
  if (expected === undefined || expected === null || expected === "") return;
  if ((!requireActual && (actual === undefined || actual === null || actual === ""))
    || String(expected) === String(actual)) {
    return;
  }
  throw workerError(
    "AI_REPLAY_CONTEXT_SCOPE_MISMATCH",
    `Replay context scope mismatch for ${field}.`,
    { field, expected, actual: actual ?? null },
  );
}

function assertSameReplayHash(field, expected, actual, tool) {
  if (expected && actual && String(expected) === String(actual)) return;
  throw workerError(
    "AI_REPLAY_CONTEXT_HASH_MISMATCH",
    `Replay context hash mismatch for ${field}.`,
    { field, expected: expected || null, actual: actual || null, tool },
  );
}

function replayFollowupArgs(args = {}) {
  return {
    ...args,
    include_raw_refs: false,
    max_response_bytes: LOCAL_REPLAY_BUNDLE_BUDGET_BYTES,
  };
}

async function readReplaySectionFully({
  read,
  args,
  expected,
  manifest,
  telemetry,
}) {
  let limit = boundedInteger(args.limit, 100, 1, 500);
  let offset = 0;
  let firstPage = null;
  let firstData = null;
  let collectionField = null;
  let total = null;
  let sectionHash = null;
  let accumulated = [];
  let pageCount = 0;
  let pageBaseHash = null;
  const budgetRetriesBefore = telemetry.budget_retries;

  while (true) {
    let page;
    while (true) {
      page = await read("get_replay_bundle_section", {
        ...args,
        offset,
        limit,
      });
      assertReplayReadResultScope(page, expected, {
        tool: "get_replay_bundle_section",
        args,
      });
      if (page?.complete !== false) break;
      if (
        args.section === "replay_lineage"
        && !args.component
        && page.component_manifest
      ) {
        const sectionHash = assertReplaySectionTransportHash({
          response: page,
          section: args.section,
          manifest,
        });
        telemetry.budget_retries += 1;
        return readReplayLineageByComponents({
          read,
          args,
          expected,
          initial: page,
          sectionHash,
          telemetry,
        });
      }
      telemetry.budget_retries += 1;
      if (limit <= 1) {
        throw replayTransportExhausted(
          `Replay section ${args.section} cannot fit within the per-response budget.`,
          telemetry,
          {
            reason: "minimum_page_budget_exceeded",
            section: args.section,
            offset,
            limit,
          },
        );
      }
      limit = Math.max(1, Math.floor(limit / 2));
    }

    const pagination = normalizeReplayPagination(page.pagination, {
      expectedOffset: offset,
      expectedLimit: limit,
      section: args.section,
    });
    if (!page.section_sha256) {
      throw workerError(
        "AI_REPLAY_CONTEXT_HASH_MISMATCH",
        `Replay section ${args.section} did not return its full-section hash.`,
        { section: args.section, field: "section_sha256" },
      );
    }
    if (sectionHash && sectionHash !== page.section_sha256) {
      throw workerError(
        "AI_REPLAY_CONTEXT_HASH_MISMATCH",
        `Replay section ${args.section} changed while it was being paginated.`,
        {
          section: args.section,
          expected: sectionHash,
          actual: page.section_sha256,
        },
      );
    }
    sectionHash ||= page.section_sha256;
    const manifestHash = manifest?.[args.section]?.sha256;
    if (manifestHash) {
      assertSameReplayHash(
        `section_manifest.${args.section}.sha256`,
        manifestHash,
        sectionHash,
        "get_replay_bundle_section",
      );
    }

    if (!pagination) {
      if (offset !== 0) {
        throw workerError(
          "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
          `Replay section ${args.section} stopped returning pagination metadata.`,
          { section: args.section, offset },
        );
      }
      assertReplayDataHash(page.data, sectionHash, {
        section: args.section,
        tool: "get_replay_bundle_section",
      });
      return page;
    }

    const pageSlice = replayPageSlice(page.data, pagination, args.section);
    const currentPageBaseHash = stableReplayHash(
      replayPageBase(page.data, pagination.field),
    );
    if (pageCount === 0) {
      firstPage = page;
      firstData = page.data;
      collectionField = pagination.field || null;
      total = pagination.total;
      pageBaseHash = currentPageBaseHash;
    } else {
      if ((pagination.field || null) !== collectionField || pagination.total !== total) {
        throw workerError(
          "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
          `Replay section ${args.section} changed pagination shape between pages.`,
          {
            section: args.section,
            expected_field: collectionField,
            actual_field: pagination.field || null,
            expected_total: total,
            actual_total: pagination.total,
          },
        );
      }
      if (currentPageBaseHash !== pageBaseHash) {
        throw workerError(
          "AI_REPLAY_CONTEXT_HASH_MISMATCH",
          `Replay section ${args.section} metadata changed between pages.`,
          {
            section: args.section,
            expected: pageBaseHash,
            actual: currentPageBaseHash,
          },
        );
      }
    }
    if (pageSlice.length === 0 && pagination.has_more) {
      throw workerError(
        "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
        `Replay section ${args.section} returned an empty non-terminal page.`,
        { section: args.section, offset, limit },
      );
    }
    accumulated.push(...pageSlice);
    pageCount += 1;
    telemetry.pages += 1;
    if (!pagination.has_more) break;
    offset += pageSlice.length;
    if (offset !== accumulated.length || offset >= total) {
      throw workerError(
        "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
        `Replay section ${args.section} returned a non-contiguous page sequence.`,
        { section: args.section, offset, accumulated: accumulated.length, total },
      );
    }
  }

  if (accumulated.length !== total) {
    throw workerError(
      "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
      `Replay section ${args.section} pagination did not reconstruct every item.`,
      {
        section: args.section,
        expected_total: total,
        actual_total: accumulated.length,
      },
    );
  }
  const data = materializeReplayPages(firstData, collectionField, accumulated);
  assertReplayDataHash(data, sectionHash, {
    section: args.section,
    tool: "get_replay_bundle_section",
  });
  const fragmented = pageCount > 1
    || telemetry.budget_retries > budgetRetriesBefore;
  if (fragmented) telemetry.fragmented_reads += 1;
  return {
    ...firstPage,
    complete: true,
    budget_exceeded: false,
    data,
    pagination: {
      ...(collectionField ? { field: collectionField } : {}),
      offset: 0,
      limit,
      total,
      has_more: false,
      pages: pageCount,
      fragmented,
    },
    fragmentation: {
      mode: "offset_limit",
      pages: pageCount,
      final_page_limit: limit,
      section_sha256: sectionHash,
    },
  };
}

function assertReplaySectionTransportHash({
  response,
  section,
  manifest,
}) {
  const sectionHash = response?.section_sha256;
  if (!sectionHash) {
    throw workerError(
      "AI_REPLAY_CONTEXT_HASH_MISMATCH",
      `Replay section ${section} did not return its full-section hash.`,
      { section, field: "section_sha256" },
    );
  }
  const manifestHash = manifest?.[section]?.sha256;
  if (manifestHash) {
    assertSameReplayHash(
      `section_manifest.${section}.sha256`,
      manifestHash,
      sectionHash,
      "get_replay_bundle_section",
    );
  }
  return sectionHash;
}

async function readReplayLineageByComponents({
  read,
  args,
  expected,
  initial,
  sectionHash,
  telemetry,
}) {
  const componentManifest = initial.component_manifest;
  const componentNames = Object.keys(componentManifest || {});
  if (
    componentNames.length === 0
    || componentNames.some((component) => !REPLAY_LINEAGE_COMPONENTS.has(component))
  ) {
    throw workerError(
      "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
      "Replay lineage returned an invalid component manifest.",
      { components: componentNames },
    );
  }

  const componentEntries = [];
  const receipts = [];
  for (const component of componentNames) {
    const descriptor = componentManifest[component] || {};
    if (!descriptor.sha256) {
      throw workerError(
        "AI_REPLAY_CONTEXT_HASH_MISMATCH",
        `Replay lineage component ${component} is missing its SHA-256.`,
        { component },
      );
    }
    const result = await readReplayLineageSelectionFully({
      read,
      args,
      expected,
      sectionHash,
      component,
      componentHash: descriptor.sha256,
      selectionHash: descriptor.sha256,
      valueType: descriptor.value_type,
      telemetry,
    });
    componentEntries.push([component, result.value]);
    receipts.push({
      component,
      component_sha256: descriptor.sha256,
      mode: result.mode,
      pages: result.pages,
      fields: result.fields,
    });
    telemetry.components += 1;
  }

  const data = Object.fromEntries(componentEntries);
  assertReplayDataHash(data, sectionHash, {
    section: "replay_lineage",
    tool: "get_replay_bundle_section",
    mode: "component_reassembly",
  });
  telemetry.fragmented_reads += 1;
  return {
    ...initial,
    complete: true,
    budget_exceeded: false,
    data,
    pagination: null,
    fragmentation: {
      mode: "component_fields",
      components: receipts,
      section_sha256: sectionHash,
    },
  };
}

async function readReplayLineageSelectionFully({
  read,
  args,
  expected,
  sectionHash,
  component,
  componentHash,
  field = null,
  selectionHash,
  valueType,
  telemetry,
}) {
  let limit = 100;
  let offset = 0;
  let accumulated = [];
  let pageCount = 0;

  while (true) {
    let response;
    while (true) {
      const selectionArgs = {
        ...args,
        component,
        ...(field ? { field } : {}),
        offset,
        limit,
      };
      response = await read("get_replay_bundle_section", selectionArgs);
      assertReplayReadResultScope(response, expected, {
        tool: "get_replay_bundle_section",
        args: selectionArgs,
      });
      assertSameReplayHash(
        "replay_lineage.section_sha256",
        sectionHash,
        response?.section_sha256,
        "get_replay_bundle_section",
      );
      assertSameReplayScope("component", component, response?.component, true);
      assertSameReplayHash(
        `replay_lineage.${component}.sha256`,
        componentHash,
        response?.component_sha256,
        "get_replay_bundle_section",
      );
      if (field) {
        assertSameReplayScope("field", field, response?.field, true);
        assertSameReplayHash(
          `replay_lineage.${component}.${field}.sha256`,
          selectionHash,
          response?.field_sha256,
          "get_replay_bundle_section",
        );
      }
      if (response?.complete !== false) break;

      telemetry.budget_retries += 1;
      if (!field && response.field_manifest) {
        const value = await readReplayLineageComponentFields({
          read,
          args,
          expected,
          sectionHash,
          component,
          componentHash,
          fieldManifest: response.field_manifest,
          telemetry,
        });
        return {
          value,
          mode: "fields",
          pages: 0,
          fields: Object.keys(response.field_manifest).length,
        };
      }
      if (valueType !== "array" || limit <= 1) {
        throw replayTransportExhausted(
          `Replay lineage ${component}${field ? `.${field}` : ""} cannot fit within the response budget.`,
          telemetry,
          {
            reason: "minimum_lineage_fragment_budget_exceeded",
            component,
            field,
            value_type: valueType || null,
            offset,
            limit,
          },
        );
      }
      limit = Math.max(1, Math.floor(limit / 2));
    }

    const selectedPath = field ? [component, field] : [component];
    const pagination = normalizeReplayPagination(response.pagination, {
      expectedOffset: offset,
      expectedLimit: limit,
      expectedPath: selectedPath,
      section: `replay_lineage.${selectedPath.join(".")}`,
    });
    const selectedValue = replayValueAtPath(response.data, selectedPath);
    if (!pagination) {
      if (offset !== 0) {
        throw workerError(
          "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
          `Replay lineage ${selectedPath.join(".")} stopped returning pagination metadata.`,
          { component, field, offset },
        );
      }
      assertReplayDataHash(selectedValue, selectionHash, {
        component,
        field,
        tool: "get_replay_bundle_section",
      });
      return {
        value: selectedValue,
        mode: field ? "field" : "component",
        pages: 1,
        fields: field ? 1 : 0,
      };
    }
    if (!Array.isArray(selectedValue)) {
      throw workerError(
        "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
        `Replay lineage ${selectedPath.join(".")} pagination does not contain an array.`,
        { component, field, path: pagination.path },
      );
    }
    accumulated.push(...selectedValue);
    pageCount += 1;
    telemetry.pages += 1;
    if (!pagination.has_more) break;
    offset += selectedValue.length;
    if (offset !== accumulated.length || offset >= pagination.total) {
      throw workerError(
        "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
        `Replay lineage ${selectedPath.join(".")} returned a non-contiguous page sequence.`,
        {
          component,
          field,
          offset,
          accumulated: accumulated.length,
          total: pagination.total,
        },
      );
    }
  }

  assertReplayDataHash(accumulated, selectionHash, {
    component,
    field,
    tool: "get_replay_bundle_section",
    mode: "page_reassembly",
  });
  return {
    value: accumulated,
    mode: "pages",
    pages: pageCount,
    fields: field ? 1 : 0,
  };
}

async function readReplayLineageComponentFields({
  read,
  args,
  expected,
  sectionHash,
  component,
  componentHash,
  fieldManifest,
  telemetry,
}) {
  const fields = Object.keys(fieldManifest || {});
  if (!fields.length || fields.some((field) => !field || field.length > 160)) {
    throw workerError(
      "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
      `Replay lineage component ${component} returned an invalid field manifest.`,
      { component, fields },
    );
  }
  const entries = [];
  for (const field of fields) {
    const descriptor = fieldManifest[field] || {};
    if (!descriptor.sha256) {
      throw workerError(
        "AI_REPLAY_CONTEXT_HASH_MISMATCH",
        `Replay lineage field ${component}.${field} is missing its SHA-256.`,
        { component, field },
      );
    }
    const result = await readReplayLineageSelectionFully({
      read,
      args,
      expected,
      sectionHash,
      component,
      componentHash,
      field,
      selectionHash: descriptor.sha256,
      valueType: descriptor.value_type,
      telemetry,
    });
    entries.push([field, result.value]);
    telemetry.fields += 1;
  }
  const value = Object.fromEntries(entries);
  assertReplayDataHash(value, componentHash, {
    component,
    tool: "get_replay_bundle_section",
    mode: "field_reassembly",
  });
  return value;
}

function replayValueAtPath(value, path) {
  return path.reduce((cursor, field) => cursor?.[field], value);
}

async function readReplaySnapshotFully({
  read,
  args,
  expected,
  knownInstruments,
  telemetry,
}) {
  const initial = await read("get_replay_snapshot", args);
  assertReplayReadResultScope(initial, expected, {
    tool: "get_replay_snapshot",
    args,
  });
  if (initial?.complete !== false) {
    assertReplayDataHash(initial.data, initial.section_sha256, {
      window: args.window,
      tool: "get_replay_snapshot",
    });
    return initial;
  }

  telemetry.budget_retries += 1;
  const instruments = [...new Set(
    (args.instruments?.length ? args.instruments : knownInstruments)
      .map(String)
      .filter(Boolean),
  )];
  if (instruments.length < 2 || !initial.section_sha256) {
    throw replayTransportExhausted(
      `Replay snapshot ${args.window} cannot be fragmented losslessly.`,
      telemetry,
      {
        reason: instruments.length < 2
          ? "snapshot_instruments_unavailable"
          : "snapshot_hash_missing",
        window: args.window,
        known_instruments: instruments.length,
      },
    );
  }

  const queue = bisectReplayInstruments(instruments);
  const fragments = [];
  while (queue.length) {
    const fragmentInstruments = queue.shift();
    const fragmentArgs = {
      ...args,
      instruments: fragmentInstruments,
    };
    const fragment = await read("get_replay_snapshot", fragmentArgs);
    assertReplayReadResultScope(fragment, expected, {
      tool: "get_replay_snapshot",
      args: fragmentArgs,
    });
    if (fragment?.complete === false) {
      telemetry.budget_retries += 1;
      if (fragmentInstruments.length <= 1) {
        throw replayTransportExhausted(
          `Replay snapshot ${args.window} contains an instrument larger than the response budget.`,
          telemetry,
          {
            reason: "minimum_snapshot_fragment_budget_exceeded",
            window: args.window,
            instruments: fragmentInstruments,
          },
        );
      }
      queue.unshift(...bisectReplayInstruments(fragmentInstruments));
      continue;
    }
    assertReplayDataHash(fragment.data, fragment.section_sha256, {
      window: args.window,
      instruments: fragmentInstruments,
      tool: "get_replay_snapshot",
    });
    fragments.push(fragment);
    telemetry.fragments += 1;
  }

  const data = mergeReplaySnapshotFragments(fragments, args.window);
  const assembledHash = stableReplayHash(data);
  if (assembledHash !== initial.section_sha256) {
    throw replayTransportExhausted(
      `Replay snapshot ${args.window} fragments do not cover the original section.`,
      telemetry,
      {
        reason: "snapshot_fragment_hash_mismatch",
        window: args.window,
        expected: initial.section_sha256,
        actual: assembledHash,
        instruments,
      },
    );
  }
  telemetry.fragmented_reads += 1;
  return {
    ...initial,
    complete: true,
    budget_exceeded: false,
    data,
    fragmentation: {
      mode: "instrument_groups",
      fragments: fragments.length,
      instruments,
      section_sha256: initial.section_sha256,
    },
  };
}

function normalizeReplayPagination(pagination, {
  expectedOffset,
  expectedLimit,
  expectedPath = null,
  section,
}) {
  if (pagination === null || pagination === undefined) return null;
  const offset = Number(pagination.offset);
  const limit = Number(pagination.limit);
  const total = Number(pagination.total);
  const path = Array.isArray(pagination.path)
    ? pagination.path.map(String)
    : pagination.field
      ? String(pagination.field).split(".").filter(Boolean)
      : [];
  if (
    !Number.isInteger(offset)
    || offset !== expectedOffset
    || !Number.isInteger(limit)
    || limit !== expectedLimit
    || !Number.isInteger(total)
    || total < 0
    || typeof pagination.has_more !== "boolean"
    || (
      expectedPath
      && (
        path.length !== expectedPath.length
        || path.some((field, index) => field !== expectedPath[index])
      )
    )
  ) {
    throw workerError(
      "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
      `Replay section ${section} returned invalid pagination metadata.`,
      {
        section,
        expected_offset: expectedOffset,
        expected_limit: expectedLimit,
        ...(expectedPath ? { expected_path: expectedPath } : {}),
        pagination,
      },
    );
  }
  return {
    field: pagination.field ? String(pagination.field) : null,
    path,
    offset,
    limit,
    total,
    has_more: pagination.has_more,
  };
}

function replayPageSlice(data, pagination, section) {
  const value = pagination.field ? data?.[pagination.field] : data;
  if (!Array.isArray(value)) {
    throw workerError(
      "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
      `Replay section ${section} pagination does not point to an array.`,
      { section, field: pagination.field },
    );
  }
  return value;
}

function replayPageBase(data, collectionField) {
  if (!collectionField || Array.isArray(data)) return null;
  const {
    [collectionField]: _collection,
    ...base
  } = data || {};
  return base;
}

function materializeReplayPages(firstData, collectionField, accumulated) {
  if (!collectionField) return accumulated;
  return {
    ...firstData,
    [collectionField]: accumulated,
  };
}

function bisectReplayInstruments(instruments) {
  const midpoint = Math.ceil(instruments.length / 2);
  return [
    instruments.slice(0, midpoint),
    instruments.slice(midpoint),
  ].filter((group) => group.length);
}

function mergeReplaySnapshotFragments(fragments, window) {
  if (!fragments.length) return {};
  let snapshotBase = null;
  const instruments = {};
  for (const fragment of fragments) {
    const snapshot = fragment?.data?.[window];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw workerError(
        "AI_REPLAY_CONTEXT_PAGINATION_INVALID",
        `Replay snapshot fragment is missing window ${window}.`,
        { window },
      );
    }
    const {
      instruments: fragmentInstruments = {},
      ...base
    } = snapshot;
    if (snapshotBase && stableReplayHash(snapshotBase) !== stableReplayHash(base)) {
      throw workerError(
        "AI_REPLAY_CONTEXT_HASH_MISMATCH",
        `Replay snapshot ${window} metadata changed between fragments.`,
        { window },
      );
    }
    snapshotBase ||= base;
    for (const [instrument, block] of Object.entries(fragmentInstruments)) {
      if (
        Object.prototype.hasOwnProperty.call(instruments, instrument)
        && stableReplayHash(instruments[instrument]) !== stableReplayHash(block)
      ) {
        throw workerError(
          "AI_REPLAY_CONTEXT_HASH_MISMATCH",
          `Replay snapshot ${window} returned conflicting instrument fragments.`,
          { window, instrument },
        );
      }
      instruments[instrument] = block;
    }
  }
  return {
    [window]: {
      ...snapshotBase,
      instruments,
    },
  };
}

function replayKnownInstruments(value) {
  const instruments = new Set();
  const candidates = [
    value?.data?.market_availability?.instruments,
    value?.data?.instruments,
    value?.market_availability?.instruments,
    value?.instruments,
  ];
  for (const candidate of candidates) {
    Object.keys(candidate || {}).forEach((instrument) => instruments.add(instrument));
  }
  const snapshots = value?.data?.rolling_snapshots
    || value?.rolling_snapshots
    || (value?.window ? value?.data : null);
  for (const snapshot of Object.values(snapshots || {})) {
    Object.keys(snapshot?.instruments || {}).forEach((instrument) => instruments.add(instrument));
  }
  return instruments;
}

function assertReplayDataHash(data, expectedHash, details = {}) {
  if (!expectedHash || stableReplayHash(data) !== expectedHash) {
    throw workerError(
      "AI_REPLAY_CONTEXT_HASH_MISMATCH",
      "Replay context data does not match its declared SHA-256.",
      {
        ...details,
        expected: expectedHash || null,
        actual: stableReplayHash(data),
      },
    );
  }
}

function createReplayTransportTelemetry({
  contextBudgetBytes,
  maxTransportReads,
}) {
  return {
    schema_version: "replay_context_transport_v1",
    response_budget_bytes: LOCAL_REPLAY_BUNDLE_BUDGET_BYTES,
    context_budget_bytes: contextBudgetBytes,
    max_transport_reads: maxTransportReads,
    tool_calls: 0,
    response_bytes: 0,
    materialized_context_bytes: 0,
    followup_reads_completed: 0,
    budget_retries: 0,
    pages: 0,
    fragments: 0,
    fragmented_reads: 0,
    components: 0,
    fields: 0,
    reads: [],
  };
}

function recordReplayTransportRead(telemetry, tool, args, result) {
  const responseBytes = jsonValueBytes(result);
  telemetry.tool_calls += 1;
  telemetry.response_bytes += responseBytes;
  telemetry.reads.push({
    tool,
    ...(args.section ? { section: args.section } : {}),
    ...(args.component ? { component: args.component } : {}),
    ...(args.field ? { field: args.field } : {}),
    ...(args.window ? { window: args.window } : {}),
    ...(Number.isInteger(args.offset) ? { offset: args.offset } : {}),
    ...(Number.isInteger(args.limit) ? { limit: args.limit } : {}),
    ...(Array.isArray(args.instruments) ? { instrument_count: args.instruments.length } : {}),
    complete: result?.complete !== false,
    budget_exceeded: result?.budget_exceeded === true
      || result?.transport?.budget_exceeded === true,
    response_bytes: responseBytes,
  });
}

function finalizeReplayTransportTelemetry(telemetry) {
  return structuredClone(telemetry);
}

function replayTransportExhausted(message, telemetry, details = {}) {
  return workerError(
    "AI_REPLAY_CONTEXT_TRANSPORT_EXHAUSTED",
    message,
    {
      ...details,
      transport_telemetry: finalizeReplayTransportTelemetry(telemetry),
    },
    true,
  );
}

function jsonValueBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null));
}

function stableReplayHash(value) {
  return createHash("sha256").update(stableReplayJson(value)).digest("hex");
}

function stableReplayJson(value) {
  const chunks = [];
  appendStableReplayJson(value, chunks);
  return chunks.join("");
}

function appendStableReplayJson(value, chunks) {
  if (Array.isArray(value)) {
    chunks.push("[");
    for (let index = 0; index < value.length; index += 1) {
      if (index) chunks.push(",");
      appendStableReplayJson(value[index], chunks);
    }
    chunks.push("]");
    return;
  }
  if (value && typeof value === "object") {
    chunks.push("{");
    const keys = Object.keys(value).sort();
    for (let index = 0; index < keys.length; index += 1) {
      if (index) chunks.push(",");
      const key = keys[index];
      chunks.push(JSON.stringify(key), ":");
      appendStableReplayJson(value[key], chunks);
    }
    chunks.push("}");
    return;
  }
  chunks.push(JSON.stringify(value ?? null));
}

export class DeskAiWorkerService {
  constructor({
    facade,
    adapter,
    scope,
    workerId,
    mode = "shadow",
    leaseSeconds = undefined,
    heartbeatIntervalMs = 60_000,
    claimGuard = null,
    now = () => new Date(),
    agenticContextEnabled = String(
      process.env.DESK_AI_AGENTIC_CONTEXT_ENABLED || "false",
    ).toLowerCase() === "true",
    contextCapabilityEnv = process.env,
    contextCapabilityTtlMs = boundedInteger(
      process.env.DESK_AI_CONTEXT_CAPABILITY_TTL_MS,
      15 * 60_000,
      60_000,
      30 * 60_000,
    ),
  } = {}) {
    if (!facade) throw new Error("desk_ai_worker_facade_required");
    if (!adapter) throw new Error("desk_ai_worker_adapter_required");
    if (!["live", "replay"].includes(scope)) throw new Error("desk_ai_worker_scope_invalid");
    if (!workerId) throw new Error("desk_ai_worker_id_required");
    this.facade = facade;
    this.adapter = adapter;
    this.scope = scope;
    this.workerId = workerId;
    this.mode = mode;
    this.leaseSeconds = leaseSeconds;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.claimGuard = claimGuard;
    this.now = now;
    this.agenticContextEnabled = agenticContextEnabled === true;
    this.contextCapabilityEnv = contextCapabilityEnv;
    this.contextCapabilityTtlMs = contextCapabilityTtlMs;
  }

  async runOnce() {
    if (this.mode !== "active") {
      return {
        ok: true,
        status: this.mode === "disabled" ? "DISABLED" : "SHADOW_STANDBY",
        scope: this.scope,
        worker_id: this.workerId,
      };
    }
    if (this.claimGuard) {
      const admission = await this.claimGuard({ scope: this.scope, workerId: this.workerId });
      if (admission?.allowed === false) {
        return {
          ok: true,
          status: "PRIORITY_STANDBY",
          reason: admission.reason || "claim_guard",
          scope: this.scope,
          worker_id: this.workerId,
        };
      }
    }

    const claim = await this.facade.claim(this.scope, {
      workerId: this.workerId,
      leaseSeconds: this.leaseSeconds,
    });
    if (claim.status !== "WORK_CLAIMED") {
      return {
        ok: true,
        status: claim.status || "NO_WORK",
        reason: claim.reason || null,
        scope: this.scope,
        worker_id: this.workerId,
      };
    }

    const startedAt = this.now().toISOString();
    const aiRunId = `ai_run_${randomUUID()}`;
    const handle = { ...claim.claim_handle, worker_id: this.workerId };
    let heartbeatTimer = null;
    let heartbeatError = null;
    let repairAttempts = 0;
    let contextTransportTelemetry = null;
    let researchSession = null;
    let partialResearchSession = null;
    try {
      const context = await this.facade.readClaimContext(claim, {
        agenticContext: this.agenticContextEnabled,
      });
      contextTransportTelemetry = context.transportTelemetry || null;
      const envelope = buildDeskAiJobEnvelope({
        claim: { ...claim, claim_handle: handle },
        ...context,
        workerId: this.workerId,
        createdAtUtc: startedAt,
        jobId: aiRunId,
      });
      const conversation = typeof this.facade.getConversationSession === "function"
        ? await this.facade.getConversationSession(envelope)
        : null;
      const runtimeSettings = typeof this.adapter.getRuntimeSettings === "function"
        ? await this.adapter.getRuntimeSettings()
        : null;
      const analysisPolicy = selectDeskAiAnalysisPolicy(envelope, {
        configuredReasoningEffort: runtimeSettings?.reasoningEffort,
      });
      const contextCapability = this.agenticContextEnabled
          ? buildDeskAiContextCapability(envelope, {
              env: this.contextCapabilityEnv,
              now: this.now,
              ttlMs: this.contextCapabilityTtlMs,
              allowedTools: analysisPolicy.optional_context_deepening
                ? DESK_AI_CONTEXT_TOOL_NAMES
                : DESK_AI_CONTEXT_REQUIRED_TOOL_NAMES,
            })
        : null;
      await this.safeRecord({
        ai_run_id: aiRunId,
        status: "ANALYZING",
        scope: this.scope,
        worker_id: this.workerId,
        workflow: envelope.workflow,
        envelope_hash: envelope.envelope_hash,
        analytical_context_mode: this.agenticContextEnabled ? "agentic_mcp" : "embedded",
        analysis_policy: analysisPolicy,
        claim_handle: redactHandle(handle),
        ...(contextTransportTelemetry
          ? { replay_context_transport: contextTransportTelemetry }
          : {}),
        started_at_utc: startedAt,
        updated_at_utc: this.now().toISOString(),
      });
      heartbeatTimer = setInterval(() => {
        void this.facade.heartbeat(this.scope, handle).catch((error) => {
          heartbeatError = error;
        });
      }, this.heartbeatIntervalMs);
      heartbeatTimer.unref?.();

      const onContextEvidence = this.agenticContextEnabled
        ? async (contextEvidenceReceipts) => {
            partialResearchSession = buildDeskAiContextResearchProgress({
              envelope,
              contextEvidenceReceipts,
              contextCapability,
              startedAtUtc: startedAt,
              updatedAtUtc: this.now().toISOString(),
            });
            await this.safeRecord({
              ai_run_id: aiRunId,
              status: "ANALYZING",
              scope: this.scope,
              worker_id: this.workerId,
              workflow: envelope.workflow,
              envelope_hash: envelope.envelope_hash,
              claim_handle: redactHandle(handle),
              analytical_context_mode: "agentic_mcp",
              research_progress: partialResearchSession.progress,
              analytical_journey: partialResearchSession.journey,
              started_at_utc: startedAt,
              updated_at_utc: this.now().toISOString(),
            });
          }
        : undefined;
      let analysis = await this.adapter.analyze({
        prompt: buildDeskAiAnalysisPrompt(envelope, {
          agenticContext: this.agenticContextEnabled,
          analysisPolicy,
          reuseImmutableContext: conversation?.reuse_immutable_context === true,
        }),
        outputSchema: buildDeskAiCodexOutputJsonSchema(envelope),
        contextCapability,
        sessionId: conversation?.resume_thread_id || null,
        reasoningEffort: analysisPolicy.effective_reasoning_effort,
        ...(onContextEvidence ? { onContextEvidence } : {}),
      });
      if (typeof this.facade.recordConversationSession === "function") {
        await this.facade.recordConversationSession(envelope, analysis.telemetry);
      }
      if (heartbeatError) throw heartbeatError;
      let writes;
      try {
        writes = materializeDeskAiWrites(envelope, analysis.output);
        await validateMaterializedWrites(this.facade, envelope, writes);
      } catch (error) {
        if (!isRepairableAnalysisFailure(error)) throw error;
        repairAttempts = 1;
        await this.safeRecord({
          ai_run_id: aiRunId,
          status: "REPAIRING_OUTPUT",
          scope: this.scope,
          worker_id: this.workerId,
          workflow: envelope.workflow,
          envelope_hash: envelope.envelope_hash,
          claim_handle: redactHandle(handle),
          repair_attempts: repairAttempts,
          validation_error: compactWorkerError(error),
          started_at_utc: startedAt,
          updated_at_utc: this.now().toISOString(),
        });
        const repaired = await this.adapter.analyze({
          prompt: buildDeskAiRepairPrompt(envelope, analysis.output, error, {
            agenticContext: this.agenticContextEnabled,
            analysisPolicy,
            reuseImmutableContext: true,
          }),
          outputSchema: buildDeskAiCodexOutputJsonSchema(envelope),
          contextCapability,
          sessionId: analysis.telemetry?.thread_id || conversation?.thread_id || null,
          reasoningEffort: analysisPolicy.effective_reasoning_effort,
          ...(onContextEvidence ? { onContextEvidence } : {}),
        });
        if (typeof this.facade.recordConversationSession === "function") {
          await this.facade.recordConversationSession(envelope, repaired.telemetry);
        }
        analysis = {
          output: normalizeIdempotentTerminalSetupRepair(repaired.output, error),
          telemetry: mergeTelemetry(analysis.telemetry, repaired.telemetry),
          context_evidence_receipts: repaired.context_evidence_receipts || [],
        };
        if (heartbeatError) throw heartbeatError;
        writes = materializeDeskAiWrites(envelope, analysis.output);
        try {
          await validateMaterializedWrites(this.facade, envelope, writes);
        } catch (repairedValidationError) {
          const normalizedOutput = normalizeIdempotentTerminalSetupRepair(
            analysis.output,
            repairedValidationError,
          );
          if (normalizedOutput === analysis.output) throw repairedValidationError;
          analysis = {
            ...analysis,
            output: normalizedOutput,
          };
          writes = materializeDeskAiWrites(envelope, analysis.output);
          await validateMaterializedWrites(this.facade, envelope, writes);
        }
      }
      if (this.agenticContextEnabled) {
        researchSession = buildDeskAiResearchSession({
          envelope,
          analysisOutput: analysis.output,
          contextEvidenceReceipts: analysis.context_evidence_receipts || [],
          contextCapability,
          startedAtUtc: startedAt,
          completedAtUtc: this.now().toISOString(),
        });
        researchSession = assertDeskAiResearchSessionAllowed(researchSession);
        analysis = {
          ...analysis,
          telemetry: {
            ...(analysis.telemetry || {}),
            analytical_journey_id: researchSession.journey.journey_id,
            analytical_coverage_percent: researchSession.progress.coverage.percent,
            analytical_decision_status: researchSession.validation.status,
          },
        };
      }
      const primaryResult = await this.facade.save(writes.primary.tool, writes.primary.payload);
      const supplementaryResults = [];
      for (const write of writes.supplementary) {
        const payload = hydrateSupplementaryPayload({
          scope: this.scope,
          workflow: envelope.workflow,
          write,
          primaryResult,
        });
        supplementaryResults.push({
          tool: write.tool,
          result: await this.facade.save(write.tool, payload),
        });
      }
      const completion = await this.facade.complete(this.scope, handle, analysis.telemetry);
      const completedAt = this.now().toISOString();
      await this.safeRecord({
        ai_run_id: aiRunId,
        status: "COMPLETED",
        scope: this.scope,
        worker_id: this.workerId,
        workflow: envelope.workflow,
        envelope_hash: envelope.envelope_hash,
        claim_handle: redactHandle(handle),
        decision_summary: writes.summary.decision_summary,
        data_quality_status: writes.summary.data_quality_status,
        warnings: writes.summary.warnings,
        repair_attempts: repairAttempts,
        telemetry: analysis.telemetry,
        analysis_policy: {
          ...analysisPolicy,
          sla_breached: Number(analysis.telemetry?.analysis_duration_ms || 0)
            > analysisPolicy.target_analysis_ms,
        },
        ...((researchSession || partialResearchSession) ? {
          research_progress: (researchSession || partialResearchSession).progress,
          analytical_journey: (researchSession || partialResearchSession).journey,
          ...(researchSession ? { analytical_validation: researchSession.validation } : {}),
        } : {}),
        ...(contextTransportTelemetry
          ? { replay_context_transport: contextTransportTelemetry }
          : {}),
        primary_result: primaryResult,
        supplementary_results: supplementaryResults,
        completion,
        started_at_utc: startedAt,
        completed_at_utc: completedAt,
        updated_at_utc: completedAt,
      });
      return {
        ok: true,
        status: "COMPLETED",
        scope: this.scope,
        worker_id: this.workerId,
        workflow: envelope.workflow,
        ai_run_id: aiRunId,
        decision_summary: writes.summary.decision_summary,
        repair_attempts: repairAttempts,
        ...(researchSession ? {
          research_progress: researchSession.progress,
          analytical_validation_status: researchSession.validation.status,
        } : {}),
        completion,
      };
    } catch (error) {
      const failureError = repairAttempts > 0 && isRepairableAnalysisFailure(error)
        ? markRetryableAfterExhaustedRepair(error)
        : error;
      const reportedFailure = compactSafeWorkerFailure(failureError);
      const failure = await this.facade.fail(this.scope, handle, reportedFailure).catch((failError) => ({
        ok: false,
        error: sanitizeDiagnosticText(failError?.message || String(failError)).slice(0, 2_000),
      }));
      const failedAt = this.now().toISOString();
      await this.safeRecord({
        ai_run_id: aiRunId,
        status: "FAILED",
        scope: this.scope,
        worker_id: this.workerId,
        workflow: claim.claim_handle?.workflow || claim.workflow || null,
        claim_handle: redactHandle(handle),
        error: reportedFailure,
        ...((contextTransportTelemetry || failureError?.details?.transport_telemetry)
          ? {
              replay_context_transport: contextTransportTelemetry
                || failureError.details.transport_telemetry,
            }
          : {}),
        repair_attempts: repairAttempts,
        ...((researchSession || partialResearchSession) ? {
          research_progress: (researchSession || partialResearchSession).progress,
          analytical_journey: (researchSession || partialResearchSession).journey,
          ...(researchSession ? { analytical_validation: researchSession.validation } : {}),
        } : {}),
        lifecycle_failure: failure,
        started_at_utc: startedAt,
        completed_at_utc: failedAt,
        updated_at_utc: failedAt,
      });
      return {
        ok: false,
        status: "FAILED",
        scope: this.scope,
        worker_id: this.workerId,
        ai_run_id: aiRunId,
        error: reportedFailure,
        ...((contextTransportTelemetry || failureError?.details?.transport_telemetry)
          ? {
              replay_context_transport: contextTransportTelemetry
                || failureError.details.transport_telemetry,
            }
          : {}),
        repair_attempts: repairAttempts,
        ...((researchSession || partialResearchSession)
          ? { research_progress: (researchSession || partialResearchSession).progress }
          : {}),
        lifecycle_failure: failure,
      };
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  async safeRecord(document) {
    await this.facade.recordRun(document).catch(() => undefined);
  }
}

function lifecyclePayload(scope, handle = {}) {
  return scope === "live"
    ? {
        cursor_id: handle.cursor_id,
        checkpoint: handle.checkpoint,
        worker_id: handle.worker_id,
        lease_token: handle.lease_token,
      }
    : {
        work_item_id: handle.work_item_id,
        worker_id: handle.worker_id,
        lease_token: handle.lease_token,
      };
}

function deskAiConversationIdentity(envelope = {}) {
  const suggested = envelope.suggested_payload || {};
  const bundle = envelope.bundle || {};
  const handle = envelope.claim_handle || {};
  const scope = envelope.scope;
  const scopeId = scope === "replay"
    ? suggested.backtest_id
      || suggested.replay_run_id
      || bundle.backtest_id
      || bundle.replay_run_id
      || handle.backtest_id
    : suggested.run_id
      || bundle.run_id
      || handle.run_id
      || suggested.trading_date
      || bundle.trading_date
      || handle.trading_date;
  if (!scopeId) {
    throw workerError(
      "AI_CONVERSATION_SCOPE_MISSING",
      "A persistent Codex conversation requires a canonical run identity.",
      { scope: scope || null, workflow: envelope.workflow || null },
    );
  }
  return {
    scope,
    scope_id: String(scopeId),
    session_key: `ai_conversation_${createHash("sha256")
      .update(`${scope}:${String(scopeId)}`)
      .digest("hex")
      .slice(0, 40)}`,
  };
}

function deskAiConversationRuntimeHash(envelope = {}) {
  const context = envelope.contract_context || {};
  const runtime = envelope.normative_runtime || {};
  const suggested = envelope.suggested_payload || {};
  return createHash("sha256")
    .update(JSON.stringify({
      strategy_version: suggested.strategy_version
        || ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
      autopilot_version: suggested.autopilot_version
        || ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
      master_contract: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
      monitor_contract: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      execution_policy: suggested.execution_policy_version
        || suggested.replay_execution_policy_version
        || context.execution_policy?.schema_version
        || ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
      execution_plan: suggested.execution_plan_version
        || context.execution_plan?.schema_version
        || ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
      monitor_command: suggested.monitor_command_version
        || context.monitor_command?.schema_version
        || ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
      condition_catalog: suggested.condition_catalog_version
        || context.condition_catalog?.schema_version
        || ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
      deterministic_compiler: suggested.deterministic_compiler_version
        || ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
      condition_engine: suggested.condition_engine_version
        || ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
      condition_catalog_sha256: runtime.condition_catalog?.catalog_sha256 || null,
      validation_authority: runtime.validation_authority || null,
    }))
    .digest("hex");
}

function deskAiConversationArtifactHash(envelope = {}) {
  const context = envelope.contract_context || {};
  const runtime = envelope.normative_runtime || {};
  return createHash("sha256")
    .update(JSON.stringify({
      contract_name: context.contract_name || null,
      schema_version: context.schema_version || null,
      contract_hash: context.contract_hash || null,
      primary_schema_file: runtime.primary_schema_file || null,
      normative_schemas: runtime.normative_schemas || null,
      condition_catalog_sha256: runtime.condition_catalog?.catalog_sha256 || null,
      validation_authority: runtime.validation_authority || null,
    }))
    .digest("hex");
}

function deskAiConversationCutoff(envelope = {}) {
  return envelope.suggested_payload?.as_of_utc
    || envelope.bundle?.cutoff_utc
    || envelope.bundle?.as_of_utc
    || envelope.suggested_payload?.cutoff_paris
    || envelope.bundle?.cutoff_paris
    || envelope.bundle?.checkpoint
    || null;
}

function compatibleTelemetry(telemetry = {}) {
  return {
    provider: "openai",
    ...(telemetry.model ? { model: telemetry.model } : {}),
    ...(Number.isFinite(telemetry.input_tokens) ? { input_tokens: telemetry.input_tokens } : {}),
    ...(Number.isFinite(telemetry.output_tokens) ? { output_tokens: telemetry.output_tokens } : {}),
    ...(Number.isFinite(telemetry.reasoning_output_tokens) ? { reasoning_tokens: telemetry.reasoning_output_tokens } : {}),
    ...(telemetry.reasoning_effort ? { reasoning_effort: telemetry.reasoning_effort } : {}),
    ...(Number.isFinite(telemetry.runtime_settings_revision)
      ? { runtime_settings_revision: telemetry.runtime_settings_revision }
      : {}),
  };
}

function compareLatestDocument(left = {}, right = {}) {
  return String(
    right.updated_at_utc
      || right.created_at_utc
      || right.timestamp_paris
      || "",
  ).localeCompare(String(
    left.updated_at_utc
      || left.created_at_utc
      || left.timestamp_paris
      || "",
  ));
}

function validateNativeContractOutput(tool, payload = {}) {
  if (["save_master_analysis", "save_replay_master_analysis"].includes(tool)
    && String(payload.schema_version || "") === "5.4.0") {
    assertMasterV5ContractOutput(payload.analysis_output, payload);
  }
  if (["save_manual_monitor", "save_replay_monitor"].includes(tool)
    && String(payload.schema_version || "") === "2.4.0") {
    assertMonitorV2ContractOutput(payload.monitor_output, payload);
  }
}

function nativeContractOutputPath(tool) {
  if (["save_master_analysis", "save_replay_master_analysis"].includes(tool)) {
    return ["analysis_output"];
  }
  if (["save_manual_monitor", "save_replay_monitor"].includes(tool)) {
    return ["monitor_output"];
  }
  return [];
}

function hydrateSupplementaryPayload({
  scope,
  workflow,
  write,
  primaryResult,
}) {
  if (scope !== "live" || workflow !== "LIVE_MASTER" || write.tool !== "save_active_thesis") {
    return write.payload;
  }
  const analysisId = primaryResult?.analysis_id;
  if (!analysisId) {
    throw workerError(
      "AI_MASTER_RESULT_ID_MISSING",
      "The saved LIVE Master did not return the analysis_id required by its active thesis.",
    );
  }
  return {
    ...write.payload,
    linked_master_analysis_id: analysisId,
  };
}

async function validateMaterializedWrites(facade, envelope, writes) {
  if (typeof facade.validate !== "function") {
    throw workerError(
      "AI_SAVE_TOOL_VALIDATOR_MISSING",
      "The worker facade cannot validate analytical writes before persistence.",
    );
  }
  const validate = typeof facade.validateForSave === "function"
    ? facade.validateForSave.bind(facade)
    : facade.validate.bind(facade);
  await validate(writes.primary.tool, writes.primary.payload);
  for (const write of writes.supplementary) {
    const validationPayload = hydrateSupplementaryPayload({
      scope: envelope.scope,
      workflow: envelope.workflow,
      write,
      primaryResult: {
        analysis_id: writes.primary.payload.analysis_id || "pending-master-analysis",
      },
    });
    await validate(write.tool, validationPayload);
  }
}

function redactHandle(handle = {}) {
  return {
    ...handle,
    lease_token: handle.lease_token ? "[REDACTED]" : null,
  };
}

function isTransientToolFailure(code) {
  return [
    "DATA_NOT_READY",
    "TOOL_TIMEOUT",
    "DATABASE_UNAVAILABLE",
    "LIVE_LEASE_HARD_CAP",
  ].includes(String(code || ""));
}

function isRepairableAnalysisFailure(error) {
  return new Set([
    "AI_SAVE_PAYLOAD_INVALID",
    "AI_SUPPLEMENTARY_WRITES_INVALID",
    "AI_SUPPLEMENTARY_WRITE_INVALID",
    "AI_SUPPLEMENTARY_WRITE_FORBIDDEN",
    "AI_LIVE_MASTER_THESIS_REQUIRED",
    "AI_LIVE_MASTER_THESIS_COUNT_INVALID",
    "AI_LIVE_SETUP_TRANSITION_REQUIRED",
    "AI_LIVE_SETUP_TARGET_REQUIRED",
    "AI_LIVE_SETUP_GEOMETRY_INCOMPLETE",
    "AI_LIVE_SETUP_RISK_GEOMETRY_INVALID",
    "AI_MASTER_CONTRACT_OUTPUT_REQUIRED",
    "AI_MASTER_EXECUTION_PLAN_REQUIRED",
    "AI_MONITOR_CONTRACT_OUTPUT_REQUIRED",
    "AI_MONITOR_COMMAND_REQUIRED",
    "AI_SAVE_PAYLOAD_VALIDATION_FAILED",
    "DETERMINISTIC_EXECUTION_PLAN_INVALID",
    "DETERMINISTIC_MONITOR_COMMAND_INVALID",
  ]).has(String(error?.code || ""));
}

function compactValidationIssues(error, { pathPrefix = [] } = {}) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  if (issues.length) {
    return issues.slice(0, 30).map((issue) => ({
      path: Array.isArray(issue.path)
        ? issue.path.map(String).slice(0, 20)
        : [],
      code: issue.code || null,
      message: String(issue.message || "Invalid value").slice(0, 500),
    }));
  }
  const contractIssues = Array.isArray(error?.details?.validation_errors)
    ? error.details.validation_errors
    : [];
  if (contractIssues.length) {
    return contractIssues.slice(0, 50).map((issue) => {
      const missingProperty = issue.keyword === "required"
        ? issue.params?.missingProperty
        : null;
      return {
        path: [
          ...pathPrefix,
          ...jsonPointerPath(issue.instance_path),
          ...(missingProperty ? [String(missingProperty)] : []),
        ],
        code: issue.keyword || error.code || null,
        message: String(issue.message || "Invalid contract value").slice(0, 500),
        schema_path: issue.schema_path || null,
        params: issue.params || {},
      };
    });
  }
  const field = error?.details?.field;
  return [{
    path: [
      ...pathPrefix,
      ...(field ? String(field).split(".").filter(Boolean) : []),
    ],
    code: error?.code || null,
    message: String(error?.message || "Payload validation failed").slice(0, 500),
    ...(error?.details && typeof error.details === "object"
      ? { details: error.details }
      : {}),
  }];
}

function jsonPointerPath(pointer) {
  if (!pointer || pointer === "/") return [];
  return String(pointer).split("/").slice(1).map((part) => (
    part.replaceAll("~1", "/").replaceAll("~0", "~")
  ));
}

function compactWorkerError(error) {
  return {
    code: error?.code || "AI_WORKER_FAILED",
    message: String(error?.message || error),
    ...(error?.details && typeof error.details === "object" ? { details: error.details } : {}),
  };
}

function compactSafeWorkerFailure(error) {
  const diagnostic = compactSafeFailureDiagnostic(error?.details);
  return {
    code: String(error?.code || "AI_WORKER_FAILED").slice(0, 120),
    message: sanitizeDiagnosticText(error?.message || error || "AI worker failure").slice(0, 2_000),
    retryable: error?.retryable === true,
    ...(diagnostic ? { diagnostic } : {}),
  };
}

const SAFE_FAILURE_DETAIL_KEYS = new Set([
  "code",
  "exit_code",
  "missing_phases",
  "missing_tools",
  "omitted_sections",
  "phase",
  "reason",
  "signal",
  "status",
  "stderr",
  "stdout",
  "tool",
]);

const SENSITIVE_DIAGNOSTIC_KEYS = /(authorization|cookie|credential|database_url|dsn|hmac|lease|pass(word|wd)?|private|secret|token)/i;

function compactSafeFailureDiagnostic(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const selected = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_FAILURE_DETAIL_KEYS.has(key)) continue;
    selected[key] = sanitizeDiagnosticValue(value, key, 0);
  }
  if (!Object.keys(selected).length) return null;
  const serialized = JSON.stringify(selected);
  if (Buffer.byteLength(serialized, "utf8") <= 4_000) return selected;
  return {
    truncated: true,
    summary: sanitizeDiagnosticText(serialized).slice(-3_800),
  };
}

function sanitizeDiagnosticValue(value, key, depth) {
  if (SENSITIVE_DIAGNOSTIC_KEYS.test(String(key || ""))) return "[REDACTED]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return sanitizeDiagnosticText(value).slice(-2_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeDiagnosticValue(entry, "", depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([childKey, entry]) => [
          childKey,
          sanitizeDiagnosticValue(entry, childKey, depth + 1),
        ]),
    );
  }
  return sanitizeDiagnosticText(String(value)).slice(-2_000);
}

function sanitizeDiagnosticText(value) {
  return String(value || "")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi,
      "$1[REDACTED]@",
    )
    .replace(
      /\b(bearer\s+)[a-z0-9._~+/=-]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(authorization|cookie|credential|database_url|dsn|hmac|lease_token|password|passwd|private_key|secret|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    );
}

export function normalizeIdempotentTerminalSetupRepair(output, validationError) {
  const transition = terminalSetupRepeat(validationError);
  if (!transition) return output;
  const copy = structuredClone(output);
  const setupTransition = copy?.save_payload?.monitor_output?.command?.setup_transition;
  if (!setupTransition || typeof setupTransition !== "object" || Array.isArray(setupTransition)) {
    return output;
  }
  if (String(setupTransition.command || "").toUpperCase() !== transition.command) {
    return output;
  }
  copy.save_payload.monitor_output.command.setup_transition = {
    ...setupTransition,
    command: "NOOP",
    replaces_setup_id: null,
    setup: null,
  };
  const warning = `IDEMPOTENT_TERMINAL_SETUP_${transition.command}_NORMALIZED_TO_NOOP`;
  copy.warnings = [...new Set([
    ...(Array.isArray(copy.warnings) ? copy.warnings : []),
    warning,
  ])];
  return copy;
}

function terminalSetupRepeat(error) {
  const diagnostics = Array.isArray(error?.details?.errors)
    ? error.details.errors
    : [];
  const terminalStates = new Set([
    "TRIGGERED",
    "CANCELLED",
    "EXPIRED",
    "INVALIDATED",
    "REPLACED",
  ]);
  const terminalizationCommands = new Set(["CANCEL", "EXPIRE", "INVALIDATE"]);
  for (const entry of diagnostics) {
    if (
      entry?.code !== "STATE_TRANSITION_REJECTED"
      || entry?.evidence?.domain !== "setup"
      || entry?.evidence?.reason !== "TERMINAL_SETUP_IMMUTABLE"
    ) {
      continue;
    }
    const previousState = String(entry.evidence.previous_state || "").toUpperCase();
    const command = String(entry.evidence.command || "").toUpperCase();
    if (terminalStates.has(previousState) && terminalizationCommands.has(command)) {
      return { previousState, command };
    }
  }
  return null;
}

function mergeTelemetry(first = {}, second = {}) {
  const sum = (field) => {
    const values = [first?.[field], second?.[field]].filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    provider: second.provider || first.provider || "openai",
    ...(second.model || first.model ? { model: second.model || first.model } : {}),
    ...(second.reasoning_effort || first.reasoning_effort
      ? { reasoning_effort: second.reasoning_effort || first.reasoning_effort }
      : {}),
    ...(second.configured_reasoning_effort || first.configured_reasoning_effort
      ? {
          configured_reasoning_effort:
            second.configured_reasoning_effort || first.configured_reasoning_effort,
        }
      : {}),
    runtime_settings_revision: Math.max(
      Number(first.runtime_settings_revision || 0),
      Number(second.runtime_settings_revision || 0),
    ),
    repair_attempts: 1,
    input_tokens: sum("input_tokens"),
    cached_input_tokens: sum("cached_input_tokens"),
    output_tokens: sum("output_tokens"),
    reasoning_output_tokens: sum("reasoning_output_tokens"),
    event_count: sum("event_count"),
    analysis_duration_ms: sum("analysis_duration_ms"),
    context_tool_call_count: sum("context_tool_call_count"),
    inference_runs: [
      {
        thread_id: first.thread_id || null,
        input_tokens: first.input_tokens ?? null,
        output_tokens: first.output_tokens ?? null,
      },
      {
        thread_id: second.thread_id || null,
        input_tokens: second.input_tokens ?? null,
        output_tokens: second.output_tokens ?? null,
      },
    ],
  };
}

function workerError(code, message, details = undefined, retryable = false) {
  return Object.assign(new Error(message), { code, details, retryable });
}

function markRetryableAfterExhaustedRepair(error) {
  return Object.assign(error instanceof Error ? error : new Error(String(error)), {
    code: error?.code || "AI_OUTPUT_VALIDATION_FAILED",
    details: error?.details,
    retryable: true,
  });
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}
