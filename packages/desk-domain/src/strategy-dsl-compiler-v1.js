import { createHash } from "node:crypto";
import {
  DETERMINISTIC_COMPILER_VERSION_V1,
  MASTER_PLAN_SCHEMA_VERSION_V1,
  compileMasterPlanV1,
} from "./deterministic-compiler-entry-v1.js";
import {
  canonicalJson,
  canonicalSha256,
} from "./execution-scope.js";
import {
  HARD_GATE_CODES_V5,
  OPPORTUNITY_SEEKING_CONTROLLED,
} from "./opportunity-policy-v1.js";
import {
  validateStrategyDefinitionV1,
  validateStrategyVersionV1,
} from "./strategy-registry-v1.js";

export const STRATEGY_DSL_SCHEMA_VERSION_V1 = "strategy_dsl_v1";
export const STRATEGY_DSL_COMPILER_VERSION_V1 = "strategy-dsl-compiler-v1";
export const STRATEGY_COMPILED_ARTIFACT_SCHEMA_VERSION_V1 = "strategy_compiled_artifact_v1";
export const STRATEGY_PATTERN_BREAKOUT_RETEST_V1 = "BREAKOUT_RETEST";

const COMPILABLE_VERSION_STATUSES_V1 = new Set(["VALIDATED", "PUBLISHED"]);
const BREAKOUT_RETEST_OPERATORS_BY_DIRECTION = Object.freeze({
  long: Object.freeze({
    break_operator: "CLOSE_ABOVE",
    retest_operator: "TOUCH_BELOW",
    rejection_operator: "REJECT_SUPPORT",
    invalidation_operator: "CLOSE_BELOW",
  }),
  short: Object.freeze({
    break_operator: "CLOSE_BELOW",
    retest_operator: "TOUCH_ABOVE",
    rejection_operator: "REJECT_RESISTANCE",
    invalidation_operator: "CLOSE_ABOVE",
  }),
});

export function compileStrategyVersionToDeterministicPlanV1({
  strategy_definition = null,
  strategy_version = null,
  dsl_source = undefined,
  runtime_bindings = {},
  scope = {},
  source_mode = "PAPER",
  policy = OPPORTUNITY_SEEKING_CONTROLLED,
} = {}) {
  const issues = [];
  const definitionResult = validateStrategyDefinitionV1(strategy_definition || {});
  const dsl = parseStrategyDslSourceV1(
    dsl_source === undefined ? strategy_version?.dsl_source : dsl_source,
    issues,
  );
  const dslText = dsl ? canonicalJson(dsl) : null;
  const versionResult = validateStrategyVersionV1({
    ...(strategy_version || {}),
    ...(dslText ? { dsl_source: dslText } : {}),
  });
  issues.push(...definitionResult.issues, ...versionResult.issues);

  if (versionResult.ok && !COMPILABLE_VERSION_STATUSES_V1.has(versionResult.normalized.status)) {
    issues.push(issue("STRATEGY_VERSION_NOT_COMPILABLE", "strategy_version.status", {
      status: versionResult.normalized.status,
      allowed_statuses: [...COMPILABLE_VERSION_STATUSES_V1],
    }));
  }
  if (definitionResult.ok && versionResult.ok
    && definitionResult.normalized.strategy_definition_id !== versionResult.normalized.strategy_definition_id) {
    issues.push(issue("STRATEGY_VERSION_DEFINITION_MISMATCH", "strategy_version.strategy_definition_id", {
      strategy_definition_id: definitionResult.normalized.strategy_definition_id,
      version_strategy_definition_id: versionResult.normalized.strategy_definition_id,
    }));
  }
  if (dsl) validateStrategyDslV1(dsl, issues);
  if (dsl) validateBreakoutRetestRuntimeBindingsV1(dsl, runtime_bindings, issues);
  if (dslText) {
    const expectedHash = sha256Text(dslText);
    const actualHash = text(strategy_version?.dsl_source_hash || versionResult.normalized?.dsl_source_hash);
    if (actualHash && actualHash !== expectedHash) {
      issues.push(issue("STRATEGY_DSL_SOURCE_HASH_MISMATCH", "strategy_version.dsl_source_hash", {
        expected: expectedHash,
        actual: actualHash,
      }));
    }
  }

  let deterministicPlan = null;
  let artifact = null;
  if (issues.length === 0) {
    const rawMaster = buildBreakoutRetestMasterV1({
      definition: definitionResult.normalized,
      version: versionResult.normalized,
      dsl,
      runtimeBindings: runtime_bindings,
      scope,
    });
    deterministicPlan = compileMasterPlanV1(rawMaster, {
      scope,
      sourceMode: source_mode,
      policy,
    });
    if (!deterministicPlan.valid) {
      for (const error of deterministicPlan.diagnostics?.errors || []) {
        issues.push(issue(error.code || "STRATEGY_DETERMINISTIC_PLAN_INVALID", "deterministic_execution_plan", error));
      }
    }
    artifact = {
      schema_version: STRATEGY_COMPILED_ARTIFACT_SCHEMA_VERSION_V1,
      compiler_version: STRATEGY_DSL_COMPILER_VERSION_V1,
      deterministic_compiler_version: DETERMINISTIC_COMPILER_VERSION_V1,
      deterministic_plan_schema_version: MASTER_PLAN_SCHEMA_VERSION_V1,
      strategy_definition_id: definitionResult.normalized.strategy_definition_id,
      strategy_version_id: versionResult.normalized.strategy_version_id,
      pattern: dsl.pattern,
      dsl_source_hash: versionResult.normalized.dsl_source_hash,
      runtime_binding_hash: `sha256:${canonicalSha256(runtime_bindings || {})}`,
      deterministic_execution_plan: deterministicPlan,
    };
    const artifactHash = `sha256:${canonicalSha256(artifact)}`;
    artifact = {
      ...artifact,
      compiled_artifact_hash: artifactHash,
    };
    if (versionResult.normalized.compiled_artifact_hash
      && versionResult.normalized.compiled_artifact_hash !== artifactHash) {
      issues.push(issue("STRATEGY_COMPILED_ARTIFACT_HASH_MISMATCH", "strategy_version.compiled_artifact_hash", {
        expected: artifactHash,
        actual: versionResult.normalized.compiled_artifact_hash,
      }));
    }
  }

  const cleanIssues = dedupeIssues(issues);
  return Object.freeze({
    ok: cleanIssues.length === 0,
    status: cleanIssues.length === 0 ? "accepted" : "rejected",
    schema_version: "strategy_dsl_compilation_result_v1",
    compiler_version: STRATEGY_DSL_COMPILER_VERSION_V1,
    reasons: cleanIssues.map((entry) => entry.code),
    flags: cleanIssues.map((entry) => entry.problem_code),
    issues: cleanIssues,
    strategy_definition: definitionResult.ok ? definitionResult.normalized : null,
    strategy_version: versionResult.ok ? versionResult.normalized : null,
    dsl,
    deterministic_execution_plan: deterministicPlan,
    compiled_artifact: cleanIssues.length === 0 ? artifact : null,
    evidence: Object.freeze({
      issue_count: cleanIssues.length,
      deterministic_plan_hash: deterministicPlan?.canonical_hash || null,
      compiled_artifact_hash: cleanIssues.length === 0 ? artifact.compiled_artifact_hash : null,
    }),
  });
}

export function parseStrategyDslSourceV1(source, issues = []) {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return stripUndefined(source);
  }
  if (typeof source !== "string" || source.trim().length === 0) {
    issues.push(issue("STRATEGY_DSL_SOURCE_REQUIRED", "dsl_source"));
    return null;
  }
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      issues.push(issue("STRATEGY_DSL_SOURCE_OBJECT_REQUIRED", "dsl_source"));
      return null;
    }
    return stripUndefined(parsed);
  } catch (error) {
    issues.push(issue("STRATEGY_DSL_PARSE_FAILED", "dsl_source", {
      message: error.message,
    }));
    return null;
  }
}

function validateBreakoutRetestRuntimeBindingsV1(dsl, runtimeBindings, issues) {
  const runtimeSetupBindings = normalizeRuntimeSetupBindings(runtimeBindings || {});
  const templates = Array.isArray(dsl.setup_templates) ? dsl.setup_templates : [];
  for (const [index, template] of templates.entries()) {
    const templateId = text(template?.template_id || template?.id) || `breakout_retest_${index + 1}`;
    const bindings = runtimeSetupBindings.get(templateId) || [{}];
    for (const [bindingIndex, binding] of bindings.entries()) {
      const bindingPath = `runtime_bindings.setups.${templateId}${bindings.length > 1 ? `.${bindingIndex}` : ""}`;
      for (const [field, value] of [
        ["break_level", binding.break_level ?? binding.threshold ?? runtimeBindings?.break_level],
        ["retest_level", binding.retest_level ?? runtimeBindings?.retest_level ?? binding.break_level ?? runtimeBindings?.break_level],
        ["stop_loss", binding.stop_loss ?? runtimeBindings?.stop_loss],
        ["take_profit_1", binding.take_profit_1 ?? runtimeBindings?.take_profit_1],
      ]) {
        if (number(value) === null) {
          issues.push(issue("STRATEGY_RUNTIME_BINDING_PRICE_REQUIRED", `${bindingPath}.${field}`, {
            template_id: templateId,
            field,
            binding_index: bindingIndex,
          }));
        }
      }
      const zone = binding.entry_zone || runtimeBindings?.entry_zone;
      if (!zone || typeof zone !== "object" || Array.isArray(zone)
        || number(zone.lower ?? zone.from ?? zone.min) === null
        || number(zone.upper ?? zone.to ?? zone.max) === null) {
        issues.push(issue("STRATEGY_RUNTIME_BINDING_ENTRY_ZONE_REQUIRED", `${bindingPath}.entry_zone`, {
          template_id: templateId,
          binding_index: bindingIndex,
        }));
      }
    }
  }
  if (!text(runtimeBindings?.valid_from_paris || runtimeBindings?.cutoff_paris)) {
    issues.push(issue("STRATEGY_RUNTIME_BINDING_VALID_FROM_REQUIRED", "runtime_bindings.valid_from_paris"));
  }
  if (!text(runtimeBindings?.expires_at_paris)) {
    issues.push(issue("STRATEGY_RUNTIME_BINDING_EXPIRES_AT_REQUIRED", "runtime_bindings.expires_at_paris"));
  }
}

function buildBreakoutRetestMasterV1({
  definition,
  version,
  dsl,
  runtimeBindings,
  scope,
}) {
  const setupTemplates = Array.isArray(dsl.setup_templates) ? dsl.setup_templates : [];
  const runtimeSetupBindings = normalizeRuntimeSetupBindings(runtimeBindings);
  const setups = setupTemplates.flatMap((template, index) => {
    const templateId = text(template.template_id || template.id) || `breakout_retest_${index + 1}`;
    const bindings = runtimeSetupBindings.get(templateId) || [{}];
    return bindings.map((binding, bindingIndex) => breakoutRetestSetupFromTemplateV1({
      template,
      binding,
      runtimeBindings,
      definition,
      version,
      templateId,
      index: index * 1_000 + bindingIndex,
    }));
  });
  const primarySetupId = setups[0]?.setup_id || null;
  const planId = text(runtimeBindings.plan_id)
    || `strategy_plan__${version.strategy_version_id}`;
  return {
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "5.4.0",
    analysis_id: text(runtimeBindings.analysis_id)
      || `strategy_compile__${version.strategy_version_id}`,
    decision_id: text(runtimeBindings.decision_id)
      || `strategy_compile_decision__${version.strategy_version_id}`,
    timestamp_paris: text(runtimeBindings.timestamp_paris || scope.cutoff_paris) || null,
    plan_id: planId,
    plan_disposition: setups.length > 0 ? "SETUP_CONDITIONAL" : "WAIT_NO_SETUP",
    strategy_id: text(scope.strategy_id || definition.external_key) || null,
    session: text(scope.session || runtimeBindings.session) || null,
    trading_date: text(scope.trading_date || runtimeBindings.trading_date) || null,
    timezone: "Europe/Paris",
    data_cutoff_paris: text(scope.cutoff_paris || runtimeBindings.cutoff_paris) || null,
    pack_id: text(scope.pack_id || runtimeBindings.pack_id) || null,
    pack_build_id: text(scope.pack_build_id || runtimeBindings.pack_build_id) || null,
    active_thesis: {
      thesis_id: text(runtimeBindings.thesis_id)
        || `strategy_thesis__${version.strategy_version_id}`,
      plan_id: planId,
      primary_setup_id: primarySetupId,
      status: "CONDITIONAL",
      valid_from_paris: text(runtimeBindings.valid_from_paris || scope.cutoff_paris) || null,
      valid_until_paris: text(runtimeBindings.expires_at_paris || runtimeBindings.valid_until_paris) || null,
      instrument: setups[0]?.instrument || definition.default_instruments?.[0] || null,
      direction: setups[0]?.direction || null,
    },
    gates: canonicalPassHardGatesV1(),
    setups,
    strategy_kernel_context: {
      schema_version: STRATEGY_DSL_SCHEMA_VERSION_V1,
      strategy_definition_id: definition.strategy_definition_id,
      strategy_version_id: version.strategy_version_id,
      pattern: dsl.pattern,
      runtime_contract_bundle_version: version.runtime_contract_bundle_version,
      source: "STRATEGY_KERNEL_TD2_106",
    },
  };
}

function breakoutRetestSetupFromTemplateV1({
  template,
  binding,
  runtimeBindings,
  definition,
  version,
  templateId,
  index,
}) {
  const direction = normalizeDirection(binding.direction || template.direction);
  const operators = BREAKOUT_RETEST_OPERATORS_BY_DIRECTION[direction];
  const instrument = text(binding.instrument || template.instrument || definition.default_instruments?.[0]) || "MNQ";
  const timeframe = text(binding.timeframe || template.timeframe || "M1").toUpperCase();
  const breakLevel = number(binding.break_level ?? binding.threshold ?? runtimeBindings.break_level);
  const retestLevel = number(binding.retest_level ?? runtimeBindings.retest_level ?? breakLevel);
  const tolerancePoints = Math.max(
    0,
    number(binding.tolerance_points ?? template.tolerance_points ?? runtimeBindings.tolerance_points ?? 1),
  );
  const entryZone = normalizeZone(
    binding.entry_zone || runtimeBindings.entry_zone,
    retestLevel,
    tolerancePoints,
  );
  const setupId = text(binding.setup_id)
    || `${text(runtimeBindings.setup_id_prefix) || "strategy_setup"}__${version.strategy_version_id}__${templateId}`;
  const requireRejection = binding.require_rejection_confirmation ?? template.require_rejection_confirmation ?? true;
  const rejectionCondition = rejectionConfirmationCondition({
    setupId,
    instrument,
    timeframe,
    operator: operators.rejection_operator,
    retestLevel,
    tolerancePoints,
    sequenceConditionId: `${setupId}__break_retest_sequence`,
    requireRejection,
  });
  return {
    setup_id: setupId,
    rank: positiveInteger(binding.rank ?? template.rank, index + 1),
    status: normalizeSetupStatus(binding.status || template.status || "ARMED_CONDITIONAL"),
    instrument,
    direction,
    order_type: text(binding.order_type || template.order_type || "LIMIT").toUpperCase(),
    entry_mode: text(binding.entry_mode || template.entry_mode || "RETEST_ZONE_AFTER_CONFIRMATION").toUpperCase(),
    entry_zone: entryZone,
    stop_loss: number(binding.stop_loss ?? runtimeBindings.stop_loss),
    take_profit_1: number(binding.take_profit_1 ?? runtimeBindings.take_profit_1),
    targets: normalizeTargets(binding.targets || runtimeBindings.targets, binding.take_profit_1 ?? runtimeBindings.take_profit_1),
    rr_minimum: number(binding.rr_minimum ?? template.rr_minimum ?? runtimeBindings.rr_minimum ?? 2),
    risk_pct: number(binding.risk_pct ?? template.risk_pct ?? runtimeBindings.risk_pct ?? 0.25),
    valid_from_paris: text(binding.valid_from_paris || runtimeBindings.valid_from_paris || runtimeBindings.cutoff_paris) || null,
    expires_at_paris: text(binding.expires_at_paris || runtimeBindings.expires_at_paris) || null,
    conditions: [
      {
        condition_id: `${setupId}__break_retest_sequence`,
        label: "Cassure puis retest déterministe",
        predicate_type: "BREAK_RETEST_SEQUENCE",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument,
        timeframe,
        operator: operators.break_operator,
        threshold: breakLevel,
        break_threshold: breakLevel,
        parameters: {
          break_condition_id: `${setupId}__break_close`,
          break_threshold: breakLevel,
          retest_level: retestLevel,
          tolerance_points: tolerancePoints,
          max_bars: positiveInteger(binding.max_bars ?? template.max_bars, 12),
          require_rejection_confirmation: requireRejection,
        },
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
        sequence: 1,
        max_bars: positiveInteger(binding.max_bars ?? template.max_bars, 12),
      },
      {
        condition_id: `${setupId}__retest_zone`,
        label: "Retour dans la zone de retest",
        predicate_type: "ZONE_TOUCH",
        role: "CONFIRMATION",
        effect: "REQUIRE_TRUE",
        instrument,
        timeframe,
        operator: operators.retest_operator,
        threshold: direction === "long" ? entryZone.upper : entryZone.lower,
        parameters: {
          zone_lower: entryZone.lower,
          zone_upper: entryZone.upper,
          tolerance_points: tolerancePoints,
        },
        importance: "PRIMARY",
        required_for_trigger: false,
        memory_policy: "LATCH_UNTIL_TRIGGER",
        weight: 0,
        atomic_component: true,
        subsumed_by_condition_id: `${setupId}__break_retest_sequence`,
        sequence: 2,
      },
      rejectionCondition,
      {
        condition_id: `${setupId}__invalidation`,
        label: "Invalidation structurelle du breakout retest",
        predicate_type: "PRICE_RELATION",
        role: "INVALIDATION",
        effect: "BLOCK_IF_TRUE",
        instrument,
        timeframe,
        operator: operators.invalidation_operator,
        threshold: number(binding.invalidation_level ?? runtimeBindings.invalidation_level ?? binding.stop_loss ?? runtimeBindings.stop_loss),
        parameters: {
          threshold: number(binding.invalidation_level ?? runtimeBindings.invalidation_level ?? binding.stop_loss ?? runtimeBindings.stop_loss),
        },
        importance: "HARD_BLOCKER",
        required_for_trigger: false,
        memory_policy: "INVALIDATE_TERMINAL",
      },
    ],
    trigger_policy: {
      min_score: 0.55,
      allow_entry_only: false,
      backend_can_trigger: true,
      threshold_tolerance_points: tolerancePoints,
    },
    management_policy: {
      break_even_at_r: number(binding.break_even_at_r ?? template.break_even_at_r ?? runtimeBindings.break_even_at_r ?? 0.7),
      tp1_close_fraction: number(binding.tp1_close_fraction ?? template.tp1_close_fraction ?? runtimeBindings.tp1_close_fraction ?? 0.5),
    },
    strategy_metadata: {
      strategy_definition_id: definition.strategy_definition_id,
      strategy_version_id: version.strategy_version_id,
      pattern: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
      template_id: templateId,
    },
  };
}

function rejectionConfirmationCondition({
  setupId,
  instrument,
  timeframe,
  operator,
  retestLevel,
  tolerancePoints,
  sequenceConditionId,
  requireRejection,
}) {
  return {
    condition_id: `${setupId}__rejection_confirmation`,
    label: "Confirmation de rejet sur retest",
    predicate_type: "REJECTION_PATTERN",
    role: "CONFIRMATION",
    effect: "REQUIRE_TRUE",
    instrument,
    timeframe,
    operator,
    threshold: retestLevel,
    parameters: {
      threshold: retestLevel,
      tolerance_points: tolerancePoints,
    },
    importance: requireRejection ? "SECONDARY" : "ADVISORY",
    required_for_trigger: requireRejection === true,
    memory_policy: requireRejection ? "LATEST_ONLY" : "LATCH_UNTIL_TRIGGER",
    weight: requireRejection ? 1 : 0,
    atomic_component: requireRejection !== true,
    subsumed_by_condition_id: requireRejection ? null : sequenceConditionId,
    sequence: requireRejection ? 3 : null,
  };
}

function validateStrategyDslV1(dsl, issues) {
  if (dsl.schema_version !== STRATEGY_DSL_SCHEMA_VERSION_V1) {
    issues.push(issue("STRATEGY_DSL_SCHEMA_VERSION_UNSUPPORTED", "dsl_source.schema_version", {
      expected: STRATEGY_DSL_SCHEMA_VERSION_V1,
      actual: dsl.schema_version ?? null,
    }));
  }
  if (dsl.pattern !== STRATEGY_PATTERN_BREAKOUT_RETEST_V1) {
    issues.push(issue("STRATEGY_DSL_PATTERN_UNSUPPORTED", "dsl_source.pattern", {
      expected: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
      actual: dsl.pattern ?? null,
    }));
  }
  if (!Array.isArray(dsl.setup_templates) || dsl.setup_templates.length === 0) {
    issues.push(issue("STRATEGY_DSL_SETUP_TEMPLATES_REQUIRED", "dsl_source.setup_templates"));
  }
  if (Array.isArray(dsl.setup_templates) && dsl.setup_templates.length > 5) {
    issues.push(issue("STRATEGY_DSL_SETUP_TEMPLATE_LIMIT_EXCEEDED", "dsl_source.setup_templates", {
      maximum: 5,
      actual: dsl.setup_templates.length,
    }));
  }
  for (const [index, template] of (dsl.setup_templates || []).entries()) {
    const direction = normalizeDirection(template?.direction);
    if (!BREAKOUT_RETEST_OPERATORS_BY_DIRECTION[direction]) {
      issues.push(issue("STRATEGY_DSL_SETUP_DIRECTION_UNSUPPORTED", `dsl_source.setup_templates.${index}.direction`, {
        actual: template?.direction ?? null,
        supported: Object.keys(BREAKOUT_RETEST_OPERATORS_BY_DIRECTION),
      }));
    }
  }
}

function canonicalPassHardGatesV1() {
  return HARD_GATE_CODES_V5.map((code) => ({
    code,
    classification: "HARD",
    state: "PASS",
    reason: "Strategy Kernel compile-time gate placeholder; runtime gate remains enforced by Live/Replay engine.",
    evidence_refs: ["strategy_kernel_compile_td2_106"],
  }));
}

function normalizeRuntimeSetupBindings(runtimeBindings) {
  const byTemplate = new Map();
  const rawSetups = Array.isArray(runtimeBindings.setups) ? runtimeBindings.setups : [];
  for (const setup of rawSetups) {
    if (!setup || typeof setup !== "object" || Array.isArray(setup)) continue;
    const templateId = text(setup.template_id || setup.id);
    if (!templateId) continue;
    if (!byTemplate.has(templateId)) byTemplate.set(templateId, []);
    byTemplate.get(templateId).push(setup);
  }
  return byTemplate;
}

function normalizeZone(value, center, tolerancePoints) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const lower = number(value.lower ?? value.from ?? value.min);
    const upper = number(value.upper ?? value.to ?? value.max);
    if (lower === null || upper === null) return { lower: null, upper: null };
    return {
      lower: Math.min(lower, upper),
      upper: Math.max(lower, upper),
    };
  }
  if (center === null) return { lower: null, upper: null };
  const halfWidth = Math.max(0.25, tolerancePoints);
  return {
    lower: center - halfWidth,
    upper: center + halfWidth,
  };
}

function normalizeTargets(values, takeProfit1) {
  if (!Array.isArray(values) || values.length === 0) {
    return [{ target_id: "tp1", price: number(takeProfit1), action: "FULL_CLOSE", close_fraction: 1 }];
  }
  return values.map((target, index) => {
    const item = target && typeof target === "object" && !Array.isArray(target) ? target : { price: target };
    const action = text(item.action || (index === values.length - 1 ? "FULL_CLOSE" : "PARTIAL_CLOSE")).toUpperCase();
    return {
      target_id: text(item.target_id || item.id) || `target_${index + 1}`,
      price: number(item.price ?? item.target ?? item.level),
      action: ["PARTIAL_CLOSE", "MOVE_STOP_BE", "TRAIL", "FULL_CLOSE", "RUNNER"].includes(action)
        ? action
        : "PARTIAL_CLOSE",
      close_fraction: boundedFraction(item.close_fraction ?? item.partial_fraction) ?? (action === "FULL_CLOSE" ? 1 : 0.5),
    };
  });
}

function normalizeDirection(value) {
  const normalized = text(value).toLowerCase();
  if (normalized === "sell") return "short";
  if (normalized === "buy") return "long";
  return ["long", "short"].includes(normalized) ? normalized : "unknown";
}

function normalizeSetupStatus(value) {
  const normalized = text(value).toUpperCase();
  if (["SETUP_CANDIDATE", "PRE_ARMED", "ARMED_CONDITIONAL"].includes(normalized)) return normalized;
  if (["ARM", "ARMED", "ACTIVE", "READY"].includes(normalized)) return "ARMED_CONDITIONAL";
  return "SETUP_CANDIDATE";
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedFraction(value) {
  const parsed = number(value);
  return parsed !== null && parsed > 0 && parsed <= 1 ? parsed : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function sha256Text(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function issue(code, path, details = {}, options = {}) {
  return Object.freeze({
    code,
    path,
    message: `${code}${path ? ` at ${path}` : ""}`,
    problem_code: options.problem_code || "DESK_VALIDATION_FAILED",
    severity: options.severity || "error",
    details: stripUndefined(details),
  });
}

function dedupeIssues(issues) {
  const byKey = new Map();
  for (const entry of issues) {
    if (!entry) continue;
    const key = canonicalJson({
      code: entry.code,
      path: entry.path,
      details: entry.details,
    });
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  );
}
