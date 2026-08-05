import { createHash, createHmac, randomBytes } from "node:crypto";

export const DESK_AI_CONTEXT_CAPABILITY_SCHEMA_VERSION = "desk_ai_context_capability_v1";
export const DESK_AI_CONTEXT_MCP_SERVER_NAME = "desk_context";
export const DESK_AI_CONTEXT_TOOL_NAMES = Object.freeze([
  "get_context_catalog",
  "get_continuity_context",
  "get_market_context",
  "get_macro_context",
  "get_news_context",
  "get_thesis_evolution_context",
  "get_replay_section_page",
  "get_market_dataset",
]);
export const DESK_AI_CONTEXT_REQUIRED_TOOL_NAMES = Object.freeze(
  DESK_AI_CONTEXT_TOOL_NAMES.filter((tool) => (
    !["get_replay_section_page", "get_market_dataset"].includes(tool)
  )),
);

export const DESK_ANALYTICAL_PHASES = Object.freeze([
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
]);

export const DESK_ANALYTICAL_TOOL_PHASES = Object.freeze({
  get_continuity_context: "CONTINUITY",
  get_macro_context: "MACRO",
  get_news_context: "NEWS",
  get_thesis_evolution_context: "THESIS_EVOLUTION",
});

export const DESK_MARKET_CONTEXT_DOMAINS = Object.freeze({
  core_market: Object.freeze({
    phase: "CORE_MARKET",
    instruments: Object.freeze(["MNQ", "MES"]),
    datasets: Object.freeze(["MNQ_M1", "MES_M1", "MNQ_M5", "MES_M5", "MNQ_H4", "MES_H4"]),
  }),
  index_confirmation: Object.freeze({
    phase: "INDEX_CONFIRMATION",
    instruments: Object.freeze(["NQ", "ES"]),
    datasets: Object.freeze(["NQ_M15", "ES_M15", "NQ_H1", "ES_H1", "NQ_H4", "ES_H4"]),
  }),
  cross_asset: Object.freeze({
    phase: "CROSS_ASSET",
    instruments: Object.freeze(["DXY", "VIX", "US10Y", "US02Y", "GC", "CL"]),
    datasets: Object.freeze([
      "US10Y_US02Y",
      "US10Y_US02Y_H4",
      "DXY_CL_GC_VIX",
      "DXY_CL_GC_VIX_H4",
    ]),
  }),
  megacaps: Object.freeze({
    phase: "MEGACAPS",
    instruments: Object.freeze([]),
    datasets: Object.freeze([
      "indices_asie_europe",
      "indices_asie_europe_H4",
      "ny_close_mega_caps",
      "mega_caps_premarket",
      "mega_caps_premarket_H4",
    ]),
  }),
});

const CONTEXT_RUNTIME_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "DESK_OBJECT_ROOT",
  "DESK_ENVIRONMENT",
  "NODE_ENV",
  "DESK_GPT_MCP_STORE",
  "DESK_MCP_STORE",
]);

export function buildDeskAiContextCapability(envelope, {
  env = process.env,
  now = () => new Date(),
  ttlMs = 15 * 60_000,
  allowedTools = DESK_AI_CONTEXT_TOOL_NAMES,
} = {}) {
  if (!envelope?.job_id || !envelope?.scope || !envelope?.workflow) {
    throw contextError(
      "AI_CONTEXT_ENVELOPE_INVALID",
      "A scoped Desk AI envelope is required to create a context capability.",
    );
  }
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + boundedInteger(ttlMs, 15 * 60_000, 60_000, 30 * 60_000));
  const bundle = envelope.bundle || {};
  const suggested = envelope.suggested_payload || {};
  const mode = envelope.scope === "replay"
    ? "replay"
    : String(bundle.mode || "live").toLowerCase();
  const cutoffUtc = firstString(
    bundle.as_of_utc,
    bundle.cutoff_utc,
    bundle.data_cutoff?.cutoff_utc,
    bundle.pack?.cutoff_utc,
    bundle.pack?.data_cutoff?.end_utc,
    suggested.as_of_utc,
    suggested.cutoff_utc,
  );
  const cutoffParis = firstString(
    bundle.cutoff_paris,
    bundle.timestamp_paris,
    bundle.pack?.cutoff_paris,
    bundle.pack?.data_cutoff?.end_paris,
    suggested.cutoff_paris,
    suggested.timestamp_paris,
    envelope.claim_handle?.checkpoint,
  );
  const canonicalScope = compactDefined({
    cursor_id: envelope.claim_handle?.cursor_id,
    checkpoint: envelope.claim_handle?.checkpoint,
    work_item_id: envelope.claim_handle?.work_item_id,
    backtest_id: envelope.claim_handle?.backtest_id || bundle.backtest_id,
    replay_run_id: bundle.replay_run_id || bundle.backtest_id,
    step_id: envelope.claim_handle?.step_id || bundle.step_id,
    run_id: envelope.claim_handle?.run_id || bundle.run_id,
    trading_date: envelope.claim_handle?.trading_date
      || bundle.trading_date
      || bundle.date
      || bundle.pack?.trading_date
      || bundle.pack?.date,
    session: envelope.claim_handle?.session || bundle.session || bundle.pack?.session,
    mode,
    cutoff_utc: cutoffUtc,
    cutoff_paris: cutoffParis,
    timezone: bundle.timezone || "Europe/Paris",
    pack_id: bundle.pack_id || bundle.pack?.pack_id,
    pack_build_id: bundle.pack_build_id || bundle.pack?.pack_build_id,
    bundle_id: bundle.bundle_id,
    bundle_type: bundle.bundle_type || (String(envelope.workflow).endsWith("MASTER") ? "master" : "monitor"),
  });
  assertSuggestedScopeMatchesCanonical(suggested, canonicalScope);
  const capability = {
    schema_version: DESK_AI_CONTEXT_CAPABILITY_SCHEMA_VERSION,
    capability_id: `ctxcap_${randomBytes(18).toString("hex")}`,
    receipt_signing_key: randomBytes(32).toString("hex"),
    created_at_utc: createdAt.toISOString(),
    expires_at_utc: expiresAt.toISOString(),
    job_id: envelope.job_id,
    envelope_hash: envelope.envelope_hash,
    scope: envelope.scope,
    workflow: envelope.workflow,
    worker_id: envelope.worker_id,
    claim_scope: canonicalScope,
    bundle_read: {
      tool: envelope.bundle_tool,
      args: envelope.bundle_args || {},
    },
    bootstrap_manifest: compactDefined({
      source_bundle_hash: bundle.source_bundle_hash,
      canonical_bundle_hash: bundle.canonical_bundle_hash,
      source_manifest_hash: bundle.source_manifest_hash,
      section_manifest: bundle.section_manifest,
      data_quality: bundle.data_quality,
      anti_lookahead_policy: bundle.anti_lookahead_policy,
      market_availability: bundle.market_availability || bundle.data?.market_availability,
      dataset_integrity: bundle.dataset_integrity || bundle.data?.dataset_integrity,
    }),
    mandatory_phases: [...DESK_ANALYTICAL_PHASES],
    market_domains: Object.fromEntries(
      Object.entries(DESK_MARKET_CONTEXT_DOMAINS).map(([domain, definition]) => [
        domain,
        {
          phase: definition.phase,
          instruments: [...definition.instruments],
          datasets: [...definition.datasets],
        },
      ]),
    ),
    allowed_tools: normalizeAllowedTools(allowedTools),
    runtime_env: contextRuntimeEnv(env),
  };
  assertCapabilityScopeComplete(capability);
  return Object.freeze({
    ...capability,
    capability_hash: hashCapability(capability),
  });
}

export function validateDeskAiContextCapability(capability, {
  now = () => new Date(),
} = {}) {
  if (capability?.schema_version !== DESK_AI_CONTEXT_CAPABILITY_SCHEMA_VERSION) {
    throw contextError("AI_CONTEXT_CAPABILITY_VERSION_INVALID", "Unsupported Desk AI context capability.");
  }
  const expectedHash = hashCapability(capability);
  if (!safeEqualText(expectedHash, capability.capability_hash)) {
    throw contextError("AI_CONTEXT_CAPABILITY_HASH_INVALID", "Desk AI context capability integrity failed.");
  }
  if (!capability.job_id || !capability.envelope_hash || !capability.scope || !capability.workflow) {
    throw contextError("AI_CONTEXT_CAPABILITY_SCOPE_INVALID", "Desk AI context capability scope is incomplete.");
  }
  if (!["live", "replay"].includes(capability.scope)) {
    throw contextError("AI_CONTEXT_CAPABILITY_SCOPE_INVALID", "Desk AI context capability scope is unsupported.");
  }
  if (!/^[a-f0-9]{64}$/.test(String(capability.receipt_signing_key || ""))) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_SIGNING_KEY_INVALID",
      "Desk AI context capability has no valid evidence signing key.",
    );
  }
  assertCapabilityScopeComplete(capability);
  const expiresAt = Date.parse(capability.expires_at_utc);
  if (!Number.isFinite(expiresAt) || now().getTime() >= expiresAt) {
    throw contextError("AI_CONTEXT_CAPABILITY_EXPIRED", "Desk AI context capability has expired.");
  }
  if (!capability.runtime_env?.DATABASE_URL) {
    throw contextError("AI_CONTEXT_DATABASE_REQUIRED", "Desk AI context capability has no PostgreSQL read endpoint.");
  }
  assertAllowedTools(capability.allowed_tools);
  return capability;
}

export function publicDeskAiContextCapability(capability = {}) {
  return {
    schema_version: capability.schema_version,
    capability_id: capability.capability_id,
    expires_at_utc: capability.expires_at_utc,
    job_id: capability.job_id,
    envelope_hash: capability.envelope_hash,
    scope: capability.scope,
    workflow: capability.workflow,
    claim_scope: capability.claim_scope,
    bootstrap_manifest: capability.bootstrap_manifest,
    mandatory_phases: capability.mandatory_phases,
    market_domains: capability.market_domains,
    allowed_tools: capability.allowed_tools,
  };
}

export function phaseForDeskContextCall(tool, args = {}) {
  if (tool === "get_market_context" || tool === "get_market_dataset") {
    return DESK_MARKET_CONTEXT_DOMAINS[args.domain]?.phase || null;
  }
  if (tool === "get_replay_section_page") {
    if (args.section === "replay_lineage" || args.section === "replan_context") return "CONTINUITY";
    if (args.section === "macro_calendar") return "MACRO";
    if (args.section === "news_digest") return "NEWS";
    return null;
  }
  return DESK_ANALYTICAL_TOOL_PHASES[tool] || null;
}

export function signDeskContextEvidenceReceipt(receipt, capability) {
  const key = String(capability?.receipt_signing_key || "");
  if (!/^[a-f0-9]{64}$/.test(key)) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_SIGNING_KEY_INVALID",
      "Desk AI context capability has no valid evidence signing key.",
    );
  }
  const unsigned = { ...(receipt || {}) };
  delete unsigned.receipt_hmac;
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(stableStringify(unsigned))
    .digest("hex");
}

export function verifyDeskContextEvidenceReceipt(receipt, capability) {
  const violations = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { valid: false, violations: ["RECEIPT_REQUIRED"] };
  }
  const expectedFields = {
    schema_version: "desk_context_evidence_receipt_v1",
    capability_id: capability?.capability_id,
    job_id: capability?.job_id,
    envelope_hash: capability?.envelope_hash,
    scope: capability?.scope,
    workflow: capability?.workflow,
  };
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (!expected || receipt[field] !== expected) {
      violations.push(`RECEIPT_${field.toUpperCase()}_MISMATCH`);
    }
  }
  if (!DESK_AI_CONTEXT_TOOL_NAMES.includes(receipt.tool)) {
    violations.push("RECEIPT_TOOL_FORBIDDEN");
  }
  const expectedPhase = phaseForDeskContextCall(receipt.tool, receipt.query || {});
  if ((receipt.phase ?? null) !== expectedPhase) {
    violations.push("RECEIPT_PHASE_MISMATCH");
  }
  if (!["COMPLETE", "DEGRADED", "UNAVAILABLE", "BLOCKED"].includes(receipt.status)) {
    violations.push("RECEIPT_STATUS_INVALID");
  }
  if (
    receipt.result_sha256 !== null
    && !/^[a-f0-9]{64}$/.test(String(receipt.result_sha256 || ""))
  ) {
    violations.push("RECEIPT_RESULT_HASH_INVALID");
  }
  if (receipt.status !== "BLOCKED" && !/^[a-f0-9]{64}$/.test(String(receipt.result_sha256 || ""))) {
    violations.push("RECEIPT_RESULT_HASH_REQUIRED");
  }
  if (!Number.isInteger(receipt.evidence_count) || receipt.evidence_count < 0) {
    violations.push("RECEIPT_EVIDENCE_COUNT_INVALID");
  }
  if (!Number.isInteger(receipt.sequence) || receipt.sequence < 1) {
    violations.push("RECEIPT_SEQUENCE_INVALID");
  }
  const recordedAt = Date.parse(receipt.recorded_at_utc);
  const createdAt = Date.parse(capability?.created_at_utc);
  const expiresAt = Date.parse(capability?.expires_at_utc);
  if (
    !Number.isFinite(recordedAt)
    || !Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || recordedAt < createdAt
    || recordedAt > expiresAt
  ) {
    violations.push("RECEIPT_TIMESTAMP_OUT_OF_CAPABILITY");
  }
  let expectedHmac = null;
  try {
    expectedHmac = signDeskContextEvidenceReceipt(receipt, capability);
  } catch {
    violations.push("RECEIPT_SIGNING_KEY_INVALID");
  }
  if (!expectedHmac || !safeEqualText(expectedHmac, receipt.receipt_hmac)) {
    violations.push("RECEIPT_HMAC_INVALID");
  }
  return {
    valid: violations.length === 0,
    violations,
  };
}

function contextRuntimeEnv(env = {}) {
  const runtimeEnv = {};
  for (const key of CONTEXT_RUNTIME_ENV_KEYS) {
    if (env[key] !== undefined && env[key] !== "") runtimeEnv[key] = String(env[key]);
  }
  runtimeEnv.DESK_GPT_MCP_STORE = "postgres";
  runtimeEnv.DESK_POSTGRES_SCHEMA_MODE = "validate";
  runtimeEnv.DESK_ENVIRONMENT = runtimeEnv.DESK_ENVIRONMENT || "production";
  const dedicatedDatabaseUrl = String(env.DESK_AI_CONTEXT_DATABASE_URL || "").trim();
  if (
    isTruthy(env.DESK_AI_CONTEXT_REQUIRE_DEDICATED_DATABASE_URL)
    && !dedicatedDatabaseUrl
  ) {
    throw contextError(
      "AI_CONTEXT_DEDICATED_DATABASE_REQUIRED",
      "Agentic context requires a dedicated PostgreSQL read-only role.",
    );
  }
  runtimeEnv.DATABASE_URL = readOnlyPostgresUrl(
    dedicatedDatabaseUrl || runtimeEnv.DATABASE_URL,
  );
  runtimeEnv.DESK_DATABASE_POOL_SIZE = "2";
  return runtimeEnv;
}

function assertSuggestedScopeMatchesCanonical(suggested = {}, canonical = {}) {
  const aliases = [
    ["backtest_id", "backtest_id"],
    ["replay_run_id", "replay_run_id"],
    ["step_id", "step_id"],
    ["run_id", "run_id"],
    ["trading_date", "trading_date"],
    ["session", "session"],
    ["mode", "mode"],
    ["timezone", "timezone"],
    ["pack_id", "pack_id"],
    ["pack_build_id", "pack_build_id"],
    ["bundle_id", "bundle_id"],
  ];
  for (const [suggestedField, canonicalField] of aliases) {
    const proposed = firstString(suggested[suggestedField]);
    const expected = firstString(canonical[canonicalField]);
    if (proposed && expected && proposed !== expected) {
      throw contextError(
        "AI_CONTEXT_CAPABILITY_SCOPE_MISMATCH",
        `Suggested payload ${suggestedField} differs from the claimed canonical scope.`,
        {
          field: suggestedField,
          expected,
          actual: proposed,
        },
      );
    }
  }
  const suggestedCutoffUtc = firstString(suggested.as_of_utc, suggested.cutoff_utc);
  if (suggestedCutoffUtc && canonical.cutoff_utc && !sameInstant(suggestedCutoffUtc, canonical.cutoff_utc)) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_SCOPE_MISMATCH",
      "Suggested payload cutoff differs from the claimed canonical UTC cutoff.",
      {
        field: "cutoff_utc",
        expected: canonical.cutoff_utc,
        actual: suggestedCutoffUtc,
      },
    );
  }
  const suggestedCutoffParis = firstString(suggested.cutoff_paris, suggested.timestamp_paris);
  if (suggestedCutoffParis && canonical.cutoff_paris && !sameInstant(suggestedCutoffParis, canonical.cutoff_paris)) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_SCOPE_MISMATCH",
      "Suggested payload cutoff differs from the claimed canonical Paris cutoff.",
      {
        field: "cutoff_paris",
        expected: canonical.cutoff_paris,
        actual: suggestedCutoffParis,
      },
    );
  }
}

function assertCapabilityScopeComplete(capability) {
  assertAllowedTools(capability.allowed_tools);
  const scope = capability.claim_scope || {};
  const common = [
    "trading_date",
    "session",
    "mode",
    "cutoff_utc",
    "cutoff_paris",
    "pack_id",
    "pack_build_id",
    "bundle_id",
    "bundle_type",
  ];
  const specific = capability.scope === "live"
    ? ["cursor_id", "checkpoint", "run_id"]
    : ["work_item_id", "backtest_id", "replay_run_id", "step_id"];
  const missing = [...common, ...specific].filter((field) => (
    scope[field] === undefined || scope[field] === null || scope[field] === ""
  ));
  if (missing.length) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_SCOPE_INCOMPLETE",
      "Desk AI context capability is missing canonical claim scope fields.",
      { missing },
    );
  }
  if (!Number.isFinite(Date.parse(scope.cutoff_utc)) || !Number.isFinite(Date.parse(scope.cutoff_paris))) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_CUTOFF_INVALID",
      "Desk AI context capability cutoffs must be valid ISO-8601 instants.",
    );
  }
  if (!capability.bundle_read?.tool || !capability.bundle_read?.args) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_BUNDLE_READ_INVALID",
      "Desk AI context capability has no pinned bundle read.",
    );
  }
  if (capability.scope === "replay" && !capability.bootstrap_manifest?.source_bundle_hash) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_SOURCE_HASH_INCOMPLETE",
      "Replay context capability must pin the immutable source bundle hash.",
    );
  }
}

function normalizeAllowedTools(tools) {
  const requested = new Set(Array.isArray(tools) ? tools.map(String) : []);
  const allowed = DESK_AI_CONTEXT_TOOL_NAMES.filter((tool) => requested.has(tool));
  assertAllowedTools(allowed);
  return allowed;
}

function assertAllowedTools(tools) {
  if (!Array.isArray(tools)) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_TOOLS_INVALID",
      "Desk AI context capability allowed_tools must be an array.",
    );
  }
  const unknown = tools.filter((tool) => !DESK_AI_CONTEXT_TOOL_NAMES.includes(tool));
  const missing = DESK_AI_CONTEXT_REQUIRED_TOOL_NAMES.filter((tool) => !tools.includes(tool));
  if (unknown.length || missing.length) {
    throw contextError(
      "AI_CONTEXT_CAPABILITY_TOOLS_INVALID",
      "Desk AI context capability must expose every mandatory read and no unknown tool.",
      { unknown, missing },
    );
  }
}

function sameInstant(left, right) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? leftTime === rightTime
    : left === right;
}

export function readOnlyPostgresUrl(value) {
  const raw = String(value || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(raw)) {
    throw contextError("AI_CONTEXT_DATABASE_REQUIRED", "DATABASE_URL must be an explicit PostgreSQL URL.");
  }
  const parsed = new URL(raw);
  const currentOptions = String(parsed.searchParams.get("options") || "").trim();
  const directives = [
    currentOptions,
    "-c default_transaction_read_only=on",
    "-c statement_timeout=60000",
    "-c lock_timeout=5000",
  ].filter(Boolean).join(" ");
  parsed.searchParams.set("options", directives);
  return parsed.toString();
}

function hashCapability(capability = {}) {
  const clone = { ...capability };
  delete clone.capability_hash;
  return createHash("sha256").update(stableStringify(clone)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBuffer.length; index += 1) {
    difference |= leftBuffer[index] ^ rightBuffer[index];
  }
  return difference === 0;
}

function compactDefined(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  );
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function contextError(code, message, details = undefined) {
  return Object.assign(new Error(message), {
    code,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}
