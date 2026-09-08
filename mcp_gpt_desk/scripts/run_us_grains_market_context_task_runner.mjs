#!/usr/bin/env node
import process from "node:process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAINS_DATA_POLICIES, normalizeGrainsDataPolicy, requiredGrainsTimeframes } from "@tv-automation/desk-domain";
import { grainsDataPolicyFromEnvironment } from "../src/runtime-config.js";

async function runTask({ store, input }) {
  const { task, bundle, timeContract } = validateRunnerInput(input);
  const [{ canonicalSha256 }, { CodexExecAdapter }, { loadCodexRuntimeSettings }] = await Promise.all([
    import("@tv-automation/desk-domain"),
    import("../src/codex-exec-adapter.js"),
    import("../src/codex-runtime-settings.js"),
  ]);
  const adapter = new CodexExecAdapter({
    cwd: resolve(process.env.DESK_AGENT_SUPERVISOR_PROJECT_ROOT || process.cwd()),
    runtimeSettingsProvider: () => loadCodexRuntimeSettings(store.persistence),
  });
  const analysis = await adapter.analyze({
    prompt: buildPrompt(bundle, timeContract),
    outputSchema: OUTPUT_SCHEMA,
    outputNormalizer: (value) => value,
    sessionId: input?.conversation?.conversation?.external_conversation_ref || null,
    reasoningEffort: input?.execution_policy?.reasoning_effort || "high",
    timeoutMs: input?.execution_policy?.timeout_ms || 780_000,
  });
  const persisted = await persistOutput({ store, input, bundle, timeContract,
    output: analysis.output, canonicalSha256 });
  return {
    ok: true,
    status: "MARKET_CONTEXT_PUBLISHED",
    output_ref: `market-context-snapshot://${persisted.snapshot.marketContextSnapshotId}`,
    result: persisted,
    conversation: { external_conversation_ref: analysis.telemetry?.thread_id || null },
    usage: analysis.telemetry,
    telemetry: { ...analysis.telemetry, runner: "us-grains-market-context-analyst", authority: "ADVISORY_ONLY" },
  };
}

function validateRunnerInput(input) {
  const task = input?.task || {};
  if (task.task_type !== "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH")
    throw coded("US_GRAINS_CONTEXT_TASK_TYPE_UNSUPPORTED", false);
  const bundle = task.payload?.bundle;
  if (normalizeGrainsDataPolicy(bundle?.dataPolicy) === GRAINS_DATA_POLICIES.M5_FALLBACK
    && grainsDataPolicyFromEnvironment() !== GRAINS_DATA_POLICIES.M5_FALLBACK)
    throw coded("GRAIN_M5_FALLBACK_DISABLED", false);
  return { task, bundle, timeContract: assertBundle(bundle) };
}

async function persistOutput({ store, input, bundle, timeContract, output, canonicalSha256 }) {
  assertOutput(output);
  const task = input.task;
  const createdAt = store.clock.now().utc;
  const { validFrom, validUntil } = marketContextValidityWindow({
    analysisAsOfUtc: timeContract.analysisAsOfUtc,
    marketState: bundle.canonicalMarketSession.marketState,
    publishedAtUtc: createdAt,
  });
  const digest = canonicalSha256({ task: task.task_id,
    analysisAsOfUtc: timeContract.analysisAsOfUtc,
    marketDataCutoffUtc: timeContract.marketDataCutoffUtc,
    publishedAtUtc: validFrom, output });
  const requiredReady = requiredSourcesReady(bundle.sourceStates, {
    ...timeContract,
    dataPolicy: bundle.dataPolicy,
    marketState: bundle.canonicalMarketSession.marketState,
  });
  const status = requiredReady ? "AVAILABLE" : "PARTIAL";
  const enforcedReasons = [...marketTimeReasonCodes({
    ...timeContract,
    marketState: bundle.canonicalMarketSession.marketState,
  }), ...(bundle.dataPolicy === GRAINS_DATA_POLICIES.M5_FALLBACK ? ["US_GRAINS_M5_FALLBACK_POLICY_ACTIVE"] : [])];
  const snapshotId = `market-context-${digest.slice(0, 24)}`;
  const snapshot = {
    marketContextSnapshotId: snapshotId,
    universe: "US_GRAINS_CBOT",
    createdAt,
    validFrom,
    validUntil,
    sourceDataCutoff: timeContract.analysisAsOfUtc,
    analysisAsOfUtc: timeContract.analysisAsOfUtc,
    marketDataCutoffUtc: timeContract.marketDataCutoffUtc,
    marketState: bundle.canonicalMarketSession.marketState,
    marketSession: bundle.canonicalMarketSession.marketSession,
    marketRegime: output.marketRegime,
    volatilityRegime: output.volatilityRegime,
    globalBias: output.globalBias,
    instrumentViews: output.instrumentViews,
    preferredStrategyFamilies: output.preferredStrategyFamilies,
    discouragedStrategyFamilies: output.discouragedStrategyFamilies,
    opportunityZones: output.opportunityZones,
    noTradeZones: output.noTradeZones,
    invalidationConditions: output.invalidationConditions,
    riskMultiplier: Math.min(1, Number(output.riskMultiplier)),
    sourceStates: bundle.sourceStates,
    reasonCodes: [...new Set([...output.reasonCodes, ...enforcedReasons, ...(requiredReady ? [] : ["REQUIRED_SOURCE_NOT_READY"])])],
    provenance: [{ source: "agent-runtime", taskId: task.task_id,
      analysisAsOfUtc: timeContract.analysisAsOfUtc,
      marketDataCutoffUtc: timeContract.marketDataCutoffUtc,
      dataCutoff: timeContract.marketDataCutoffUtc }],
    workerId: input.lease?.worker_id || task.assigned_worker_id || null,
    taskId: task.task_id,
    modelPolicyVersion: input.execution_policy_snapshot?.policy_hash || input.execution_policy?.model || "runtime-policy",
    promptVersion: "us_grains_market_context_prompt_v1",
    supersedesSnapshotId: bundle.previousSnapshot?.marketContextSnapshotId || null,
    invalidationReason: null,
    status,
  };
  const brief = {
    marketDeskBriefId: `market-brief-${digest.slice(0, 24)}`,
    marketContextSnapshotId: snapshotId,
    universe: "US_GRAINS_CBOT",
    createdAt,
    validFrom,
    validUntil,
    sourceDataCutoff: timeContract.analysisAsOfUtc,
    analysisAsOfUtc: timeContract.analysisAsOfUtc,
    marketDataCutoffUtc: timeContract.marketDataCutoffUtc,
    status,
    headline: output.headline,
    operatorSummary: output.operatorSummary,
    marketInterpretation: output.marketInterpretation,
    deskIntent: output.deskIntent,
    whyNoTrade: output.whyNoTrade,
    whatDeskWants: output.whatDeskWants,
    whatDeskAvoids: output.whatDeskAvoids,
    opportunityZones: output.opportunityZones,
    noTradeZones: output.noTradeZones,
    invalidationConditions: output.invalidationConditions,
    currentCatalysts: output.currentCatalysts,
    nextExpectedEvents: output.nextExpectedEvents,
    instrumentViews: output.instrumentViews,
    riskPosture: { multiplier: Math.min(1, Number(output.riskMultiplier)), authority: "ADVISORY_ONLY" },
    sourceStates: bundle.sourceStates,
    reasonCodes: snapshot.reasonCodes,
    provenance: snapshot.provenance,
    workerId: snapshot.workerId,
    taskId: task.task_id,
    modelPolicyVersion: snapshot.modelPolicyVersion,
    promptVersion: snapshot.promptVersion,
    supersedesBriefId: bundle.previousBrief?.marketDeskBriefId || null,
    invalidationReason: null,
  };
  return store.marketContext.persistAnalysis({ snapshot, brief });
}

export function buildPrompt(bundle, timeContract) {
  return [
    "You are US_GRAINS_MARKET_CONTEXT_ANALYST. Analyze market context; do not find or execute a trade.",
    "Authority is advisory only. Never create ProviderCommand, alter Risk, confirm HumanGate, enable AUTO/LIVE, or change post-Risk terms.",
    "Use only the bounded bundle below. Respect sourceDataCutoff and source availability. Empty agri events only mean no event when the manifest is AVAILABLE and covers the cutoff.",
    `Knowledge is bounded at analysisAsOfUtc=${timeContract.analysisAsOfUtc}. Price bars are bounded independently at marketDataCutoffUtc=${timeContract.marketDataCutoffUtc}; every included bar is closed by that instant.`,
    "When the canonical market is not OPEN, describe prices as last-known closed bars. Do not present them as a current quote or extend their coverage to analysisAsOfUtc.",
    "Write headline, operatorSummary, marketInterpretation, deskIntent, whyNoTrade, and other human-facing narrative text in French. Keep enum values, reason codes, identifiers, and schema keys unchanged.",
    "When the canonical market is not OPEN, include the exact UTC date and time of marketDataCutoffUtc in the headline, operator summary, or market interpretation so the last-known price date is explicit.",
    "Produce strict JSON matching the schema. Keep ZC and ZW instrument views distinct. Opportunity zones are context framing, not orders.",
    "If sources are incomplete, say so in reasonCodes and narrative; never invent availability, news, weather, macro facts or prices.",
    ...(bundle.dataPolicy === GRAINS_DATA_POLICIES.M5_FALLBACK ? [
      "M5_FALLBACK policy is active for the four existing deterministic grain families in SHADOW only. M1 is diagnostic and optional; M5, agri calendar and canonical session remain required. Never infer or reconstruct M1 bars. Explain in French that M5 continuity does not repair a stale M1 feed or remove TradingView's subscription delay. Missing or stale M1 alone is not a global no-trade reason for these M5 families; report it as degraded data quality.",
    ] : []),
    JSON.stringify(bundle),
  ].join("\n\n");
}

export function requiredSourcesReady(states, timeInput) {
  const time = normalizeTimeInput(timeInput);
  const timeframes = requiredGrainsTimeframes({ policy: time.dataPolicy, instruments: ["ZC", "ZW"] });
  const required = [...["ZC", "ZW"].flatMap((instrument) => timeframes.map((timeframe) => `${instrument}_${timeframe}`)),
    "market_agri_events", "canonical_grains_session"];
  return required.every((id) => {
    const source = states.find((item) => item.sourceId === id);
    if (!source || source.status !== "AVAILABLE") return false;
    const cutoff = id === "ZC_1" || id === "ZC_5" || id === "ZW_1" || id === "ZW_5"
      ? time.marketDataCutoffUtc
      : time.analysisAsOfUtc;
    return source.coverageStart && source.coverageEnd
      && Date.parse(source.coverageStart) <= Date.parse(cutoff)
      && Date.parse(source.coverageEnd) >= Date.parse(cutoff);
  });
}

function assertBundle(bundle) {
  if (!bundle || bundle.schemaVersion !== "us_grains_market_context_bundle_v1") throw coded("US_GRAINS_CONTEXT_BUNDLE_INVALID", false);
  if (bundle.universe !== "US_GRAINS_CBOT" || !bundle.cutoff || !bundle.canonicalMarketSession) throw coded("US_GRAINS_CONTEXT_BUNDLE_SCOPE_INVALID", false);
  if (!Array.isArray(bundle.sourceStates)) throw coded("US_GRAINS_CONTEXT_SOURCE_STATES_REQUIRED", false);
  return resolveBundleTimeContract(bundle);
}

export function resolveBundleTimeContract(bundle = {}) {
  if (bundle.timeContractVersion !== "us_grains_market_context_time_v2")
    throw coded("US_GRAINS_CONTEXT_TIME_CONTRACT_VERSION_UNSUPPORTED", false);
  const analysisAsOfUtc = isoOrNull(bundle.analysisAsOfUtc);
  const marketDataCutoffUtc = isoOrNull(bundle.marketDataCutoffUtc);
  const sourceDataCutoffUtc = isoOrNull(bundle.sourceDataCutoff);
  const compatibilityCutoffUtc = isoOrNull(bundle.cutoff);
  if (!analysisAsOfUtc || !marketDataCutoffUtc || !sourceDataCutoffUtc || !compatibilityCutoffUtc)
    throw coded("US_GRAINS_CONTEXT_TIME_CONTRACT_REQUIRED", false);
  if (analysisAsOfUtc !== sourceDataCutoffUtc || analysisAsOfUtc !== compatibilityCutoffUtc)
    throw coded("US_GRAINS_CONTEXT_CUTOFF_ALIAS_MISMATCH", false);
  if (Date.parse(marketDataCutoffUtc) > Date.parse(analysisAsOfUtc))
    throw coded("US_GRAINS_CONTEXT_MARKET_DATA_LOOKAHEAD", false);
  return { analysisAsOfUtc, marketDataCutoffUtc };
}

export function marketContextValidityWindow({ analysisAsOfUtc, marketState, publishedAtUtc } = {}) {
  const analysisAt = isoOrNull(analysisAsOfUtc);
  const validFrom = isoOrNull(publishedAtUtc);
  if (!analysisAt || !validFrom) throw coded("US_GRAINS_CONTEXT_ANALYSIS_AS_OF_REQUIRED", false);
  const validityMinutes = marketState === "OPEN" ? 30 : 60;
  const validUntil = new Date(Date.parse(analysisAt) + validityMinutes * 60_000).toISOString();
  if (Date.parse(validFrom) < Date.parse(analysisAt))
    throw coded("US_GRAINS_CONTEXT_PUBLICATION_BEFORE_ANALYSIS", false);
  if (Date.parse(validFrom) >= Date.parse(validUntil))
    throw coded("US_GRAINS_CONTEXT_ANALYSIS_EXPIRED_BEFORE_PUBLICATION", false);
  return { validFrom, validUntil };
}

function marketTimeReasonCodes({ analysisAsOfUtc, marketDataCutoffUtc, marketState }) {
  if (marketState === "OPEN" || Date.parse(marketDataCutoffUtc) >= Date.parse(analysisAsOfUtc)) return [];
  return ["MARKET_PRICES_LAST_KNOWN_WHILE_MARKET_NOT_OPEN"];
}

function normalizeTimeInput(value) {
  if (typeof value === "string") return { analysisAsOfUtc: value, marketDataCutoffUtc: value };
  return value || {};
}

function isoOrNull(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function assertOutput(output) {
  if (!output || output.schemaVersion !== "us_grains_market_context_analysis_v1") throw coded("US_GRAINS_CONTEXT_OUTPUT_INVALID", false);
  if (!Array.isArray(output.instrumentViews) || !["ZC", "ZW"].every((instrument) => output.instrumentViews.some((item) => item.instrument === instrument))) throw coded("US_GRAINS_CONTEXT_INSTRUMENT_VIEWS_REQUIRED", false);
}

async function readJsonStdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); const raw = Buffer.concat(chunks).toString("utf8").trim(); if (!raw) throw coded("US_GRAINS_CONTEXT_RUNNER_INPUT_REQUIRED", false); return JSON.parse(raw); }
function failure(error) { return { ok: false, status: "FAILED", error_code: error?.code || "US_GRAINS_CONTEXT_RUNNER_FAILED", error_message: String(error?.message || error).slice(0, 2000), retryable: error?.retryable === true }; }
function coded(code, retryable = false) { return Object.assign(new Error(code), { code, retryable }); }

const CONDITION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    code: { type: "string" }, state: { type: "string" }, detail: { type: "string" },
    source: { type: "string" }, asOf: { type: ["string", "null"] },
  },
  required: ["code", "state", "detail", "source", "asOf"],
};

const CATALYST_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    catalystId: { type: "string" }, title: { type: "string" }, eventKind: { type: "string" },
    importance: { type: "string" }, eventTimestamp: { type: ["string", "null"] },
    source: { type: "string" }, status: { type: "string" }, reasonCodes: { type: "array", items: { type: "string" } },
  },
  required: ["catalystId", "title", "eventKind", "importance", "eventTimestamp", "source", "status", "reasonCodes"],
};

const INVALIDATION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    conditionId: { type: "string" }, code: { type: "string" }, state: { type: "string" },
    instrument: { type: ["string", "null"] }, threshold: { type: ["number", "null"] },
    operator: { type: ["string", "null"] }, reasonCodes: { type: "array", items: { type: "string" } },
  },
  required: ["conditionId", "code", "state", "instrument", "threshold", "operator", "reasonCodes"],
};

const ZONE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    zoneId: { type: "string" }, instrument: { type: "string", enum: ["ZC", "ZW"] },
    minPrice: { type: ["number", "null"] }, maxPrice: { type: ["number", "null"] },
    direction: { type: ["string", "null"] }, priority: { type: ["string", "null"] },
    preferredFamilies: { type: "array", items: { type: "string" } },
    requiredConditions: { type: "array", items: CONDITION_SCHEMA },
    forbiddenConditions: { type: "array", items: CONDITION_SCHEMA },
    validFrom: { type: ["string", "null"] }, validUntil: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }, reasonCodes: { type: "array", items: { type: "string" } },
  },
  required: ["zoneId", "instrument", "minPrice", "maxPrice", "direction", "priority", "preferredFamilies", "requiredConditions", "forbiddenConditions", "validFrom", "validUntil", "confidence", "reasonCodes"],
};

const INSTRUMENT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    instrument: { type: "string", enum: ["ZC", "ZW"] }, bias: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
    allowedSides: { type: "array", items: { type: "string", enum: ["LONG", "SHORT"] } },
    preferredFamilies: { type: "array", items: { type: "string" } }, discouragedFamilies: { type: "array", items: { type: "string" } },
    ownReturn: { type: ["number", "null"] }, peerReturn: { type: ["number", "null"] }, regime: { type: ["string", "null"] }, volatilityRegime: { type: ["string", "null"] },
    zones: { type: "array", items: ZONE_SCHEMA }, reasonCodes: { type: "array", items: { type: "string" } },
  },
  required: ["instrument", "bias", "confidence", "allowedSides", "preferredFamilies", "discouragedFamilies", "ownReturn", "peerReturn", "regime", "volatilityRegime", "zones", "reasonCodes"],
};

const OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", const: "us_grains_market_context_analysis_v1" },
    marketRegime: { type: "string" }, volatilityRegime: { type: "string" }, globalBias: { type: "string" },
    instrumentViews: { type: "array", minItems: 2, maxItems: 2, items: INSTRUMENT_SCHEMA },
    preferredStrategyFamilies: { type: "array", items: { type: "string" } }, discouragedStrategyFamilies: { type: "array", items: { type: "string" } },
    opportunityZones: { type: "array", items: ZONE_SCHEMA }, noTradeZones: { type: "array", items: ZONE_SCHEMA },
    invalidationConditions: { type: "array", items: INVALIDATION_SCHEMA }, riskMultiplier: { type: "number", minimum: 0, maximum: 1 },
    headline: { type: "string" }, operatorSummary: { type: "string" }, marketInterpretation: { type: "string" }, deskIntent: { type: "string" }, whyNoTrade: { type: "string" },
    whatDeskWants: { type: "array", items: { type: "string" } }, whatDeskAvoids: { type: "array", items: { type: "string" } },
    currentCatalysts: { type: "array", items: CATALYST_SCHEMA }, nextExpectedEvents: { type: "array", items: CATALYST_SCHEMA }, reasonCodes: { type: "array", items: { type: "string" } },
  },
  required: ["schemaVersion", "marketRegime", "volatilityRegime", "globalBias", "instrumentViews", "preferredStrategyFamilies", "discouragedStrategyFamilies", "opportunityZones", "noTradeZones", "invalidationConditions", "riskMultiplier", "headline", "operatorSummary", "marketInterpretation", "deskIntent", "whyNoTrade", "whatDeskWants", "whatDeskAvoids", "currentCatalysts", "nextExpectedEvents", "reasonCodes"],
};

export function isUsGrainsMarketContextRunnerEntrypoint(entryPath = process.argv[1], moduleUrl = import.meta.url) {
  if (!entryPath) return false;
  try {
    const entryRealPath = realpathSync.native(resolve(entryPath));
    const moduleRealPath = realpathSync.native(fileURLToPath(moduleUrl));
    return process.platform === "win32"
      ? entryRealPath.toLowerCase() === moduleRealPath.toLowerCase()
      : entryRealPath === moduleRealPath;
  } catch {
    return false;
  }
}

async function runCli() {
  let store = null;
  try {
    const input = await readJsonStdin();
    validateRunnerInput(input);
    const { createDeskStoreFromEnv } = await import("../src/store.js");
    store = createDeskStoreFromEnv();
    await store.persistence.initialized;
    const result = await runTask({ store, input });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(failure(error))}\n`);
  } finally {
    await store?.persistence?.close?.();
  }
}

if (isUsGrainsMarketContextRunnerEntrypoint()) await runCli();
