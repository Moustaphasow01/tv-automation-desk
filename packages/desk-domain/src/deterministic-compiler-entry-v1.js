import { canonicalSha256 } from "./execution-scope.js";
import {
  DETERMINISTIC_COMPILER_VERSION_V1,
  MASTER_PLAN_SCHEMA_VERSION_V1,
  MONITOR_COMMAND_SCHEMA_VERSION_V1,
  compileMasterPlanV1 as compileMasterPlanBaseV1,
  compileMonitorCommandV1 as compileMonitorCommandBaseV1,
} from "./deterministic-compilers-v1.js";
import {
  acceptCanonicalMasterPlanV1,
  isCanonicalMasterPlanV1,
} from "./canonical-plan-ingress-v1.js";
import {
  POSITION_REQUESTS_V1,
} from "./position-state-machine-v1.js";
import {
  REPLAN_EVENTS_V1,
  transitionReplanStateV1,
} from "./replan-state-machine-v1.js";
import {
  normalizeV5MasterIngressV1,
  normalizeV5SetupIngressV1,
} from "./v5-native-ingress-v1.js";
import { normalizeV2MonitorIngressV1 } from "./v2-monitor-ingress-v1.js";
import {
  validateNativeMasterCrossFieldsV1,
  validateNativeMonitorCrossFieldsV1,
} from "./native-cross-field-validator-v1.js";
import {
  SETUP_COMMANDS_V1,
  transitionSetupStateV1,
} from "./setup-state-machine-v1.js";
import {
  THESIS_COMMANDS_V1,
  transitionThesisStateV1,
} from "./thesis-state-machine-v1.js";

export {
  DETERMINISTIC_COMPILER_VERSION_V1,
  MASTER_PLAN_SCHEMA_VERSION_V1,
  MONITOR_COMMAND_SCHEMA_VERSION_V1,
};

const THESIS_COMMAND_SET = new Set(Object.values(THESIS_COMMANDS_V1));
const SETUP_COMMAND_SET = new Set(Object.values(SETUP_COMMANDS_V1).filter((value) => value !== "ENGINE_TRIGGER"));
const POSITION_REQUEST_SET = new Set(Object.values(POSITION_REQUESTS_V1));
const REPLAN_REQUEST_SET = new Set(["NOOP", "REQUEST"]);
const SETUP_COMMANDS_REQUIRING_PINNED_PLAN_RISK = new Set([
  SETUP_COMMANDS_V1.UPSERT_CANDIDATE,
  SETUP_COMMANDS_V1.PRE_ARM,
  SETUP_COMMANDS_V1.ARM,
  SETUP_COMMANDS_V1.REPLACE,
]);
const PINNED_PLAN_SCOPE_FIELDS = Object.freeze([
  "mode",
  "trading_date",
  "session",
  "run_id",
  "timezone",
]);

export function compileMasterPlanV1(rawMaster = {}, options = {}) {
  const envelope = object(rawMaster);
  const embedded = object(envelope.deterministic_execution_plan);
  const executionPlan = object(envelope.execution_plan);
  if (isCurrentOrLegacyCanonicalMasterPlanV1(envelope)) {
    return acceptCanonicalMasterPlanV1(envelope, options);
  }
  if (isCurrentOrLegacyCanonicalMasterPlanV1(embedded)) {
    return acceptCanonicalMasterPlanV1(embedded, options);
  }
  if (isCurrentOrLegacyCanonicalMasterPlanV1(executionPlan)) {
    return acceptCanonicalMasterPlanV1(executionPlan, options);
  }
  const nativeScope = object(executionPlan.scope || embedded.scope || envelope.scope);
  const effectiveOptions = {
    ...options,
    scope: { ...nativeScope, ...object(options.scope) },
    sourceMode: options.sourceMode || nativeScope.mode || null,
  };
  const normalized = normalizeV5MasterIngressV1(envelope);
  const compiled = compileMasterPlanBaseV1(normalized, effectiveOptions);
  return appendCompilerErrorsV1(
    compiled,
    validateNativeMasterCrossFieldsV1(envelope, compiled),
  );
}

function isCurrentOrLegacyCanonicalMasterPlanV1(value) {
  return isCanonicalMasterPlanV1(value) || Boolean(
    value
      && typeof value === "object"
      && value.schema_version === MASTER_PLAN_SCHEMA_VERSION_V1
      && Array.isArray(value.ranked_setups),
  );
}

export function compileMonitorCommandV1(rawMonitor = {}, options = {}) {
  const monitorSource = object(rawMonitor);
  const monitor = normalizeV2MonitorIngressV1(monitorSource);
  const nativeScope = object(monitor.scope);
  const effectiveOptions = {
    ...options,
    scope: { ...nativeScope, ...object(options.scope) },
    sourceMode: options.sourceMode || nativeScope.mode || null,
  };
  const requested = object(monitor.requested_command);
  if (Object.keys(requested).length === 0) {
    return compileMonitorCommandBaseV1(monitor, effectiveOptions);
  }

  const diagnostics = validateNativeMonitorCrossFieldsV1(
    monitorSource,
    effectiveOptions.currentState,
  );
  const thesisSlot = parseMachineIntent(
    requested.thesis_command,
    THESIS_COMMAND_SET,
    "thesis",
    THESIS_COMMANDS_V1.NOOP,
    diagnostics,
  );
  const setupSlot = parseMachineIntent(
    requested.setup_command,
    SETUP_COMMAND_SET,
    "setup",
    SETUP_COMMANDS_V1.NOOP,
    diagnostics,
  );
  const positionSlot = parseMachineIntent(
    requested.position_request,
    POSITION_REQUEST_SET,
    "position",
    POSITION_REQUESTS_V1.NONE,
    diagnostics,
  );
  const replanSlot = parseMachineIntent(
    requested.replan_request,
    REPLAN_REQUEST_SET,
    "replan",
    REPLAN_EVENTS_V1.NOOP,
    diagnostics,
  );

  const carrierAction = carrierLegacyAction({
    thesis: thesisSlot.type,
    setup: setupSlot.type,
    position: positionSlot.type,
    replan: replanSlot.type,
  });
  const setupPayload = object(setupSlot.payload);
  const setupPayloadIsCommand = Boolean(
    setupPayload.command || setupPayload.type || setupPayload.action || setupPayload.request,
  );
  const nativeSetup = object(
    setupPayload.setup
      || (!setupPayloadIsCommand ? setupPayload : null)
      || requested.setup
      || monitor.setup_update,
  );
  const requiresPinnedPlanRisk = SETUP_COMMANDS_REQUIRING_PINNED_PLAN_RISK.has(setupSlot.type);
  const pinnedPlanRisk = requiresPinnedPlanRisk
    ? resolvePinnedPlanRiskV1(monitor, effectiveOptions.currentState, diagnostics)
    : null;
  if (requiresPinnedPlanRisk && monitorSetupCarriesRisk(nativeSetup)) {
    diagnostics.push({
      code: "MONITOR_RISK_OVERRIDE_FORBIDDEN",
      evidence: {
        command: setupSlot.type,
        setup_id: nativeSetup.setup_id || null,
        authority: "PINNED_MASTER_PLAN_ONLY",
      },
    });
  }
  const carrierMonitor = {
    ...monitor,
    requested_command: undefined,
    monitor_decision: {
      ...object(monitor.monitor_decision),
      action: undefined,
      status: undefined,
      decision: carrierAction,
    },
    ...(Object.keys(nativeSetup).length > 0
      ? {
        setup_update: normalizeV5SetupIngressV1(nativeSetup, {
          planRisk: pinnedPlanRisk || {},
          riskAuthority: "PINNED_PLAN",
        }),
      }
      : {}),
  };
  const base = compileMonitorCommandBaseV1(carrierMonitor, effectiveOptions);
  const currentState = object(effectiveOptions.currentState);
  if ([SETUP_COMMANDS_V1.UPSERT_CANDIDATE, SETUP_COMMANDS_V1.PRE_ARM, SETUP_COMMANDS_V1.ARM, SETUP_COMMANDS_V1.REPLACE].includes(setupSlot.type)
    && base.setup_command?.setup?.compile_status !== "COMPILED") {
    diagnostics.push({
      code: "SETUP_COMMAND_PAYLOAD_NOT_COMPILED",
      evidence: { command: setupSlot.type, setup_id: nativeSetup.setup_id || null },
    });
  }
  if (setupSlot.type === SETUP_COMMANDS_V1.ARM
    && base.setup_command?.setup?.arm_gate_evaluation?.eligible !== true) {
    diagnostics.push({
      code: "SETUP_ARM_HARD_GATE_BLOCKED",
      evidence: {
        setup_id: nativeSetup.setup_id || null,
        hard_failures: base.setup_command?.setup?.arm_gate_evaluation?.hard_failures || [],
      },
    });
  }
  const thesisCommand = {
    type: thesisSlot.type,
    target_state: valueOrNull(thesisSlot.payload?.target_state || thesisSlot.payload?.state),
    reason: valueOrNull(thesisSlot.payload?.reason || requested.reason),
    payload: base.thesis_command?.payload || {},
  };
  const setupCommand = {
    type: setupSlot.type,
    reason: valueOrNull(setupSlot.payload?.reason || requested.reason),
    setup_id: valueOrNull(
      setupSlot.payload?.setup_id
        || nativeSetup.setup_id
        || currentState.setup?.setup_id,
    ),
    replaces_setup_id: valueOrNull(
      setupSlot.payload?.replaces_setup_id || nativeSetup.replaces_setup_id,
    ),
    setup: base.setup_command?.setup || null,
  };
  const positionRequest = {
    type: positionSlot.type,
    position_id: valueOrNull(
      positionSlot.payload?.position_id
        || currentState.position?.position_id,
    ),
    reduce_fraction: numberOrNull(
      positionSlot.payload?.reduce_fraction
        ?? positionSlot.payload?.partial_fraction,
    ),
    requested_stop: numberOrNull(
      positionSlot.payload?.requested_stop
        ?? positionSlot.payload?.new_stop,
    ),
    reason: valueOrNull(positionSlot.payload?.reason || requested.reason),
    authority: "GPT_REQUEST_ONLY",
  };
  const replanRequest = {
    type: replanSlot.type,
    reason: valueOrNull(replanSlot.payload?.reason || requested.reason),
    dedupe_key: replanSlot.type === "REQUEST"
      ? canonicalSha256({
        reason: replanSlot.payload?.reason || requested.reason || "REPLAN_REQUESTED",
        thesis_id: monitor.linked_active_thesis_id || monitor.thesis_id || null,
      })
      : null,
    requested_at_paris: replanSlot.type === "REQUEST"
      ? valueOrNull(monitor.timestamp_paris || monitor.checkpoint_paris)
      : null,
  };
  const transitions = {
    thesis: transitionThesisStateV1({
      currentState: currentState.thesis?.state || currentState.thesis?.status || currentState.thesis_state || "NO_ACTIVE",
      command: thesisCommand.type,
    }),
    setup: transitionSetupStateV1({
      currentState: currentState.setup?.state || currentState.setup?.status || currentState.setup_state || "NONE",
      command: setupCommand.type,
      authority: "GPT",
    }),
    replan: transitionReplanStateV1({
      currentState: currentState.replan?.state || currentState.replan_state || "IDLE",
      event: replanRequest.type,
    }),
  };
  for (const transition of Object.values(transitions)) {
    if (!transition.accepted) {
      diagnostics.push({
        code: "STATE_TRANSITION_REJECTED",
        evidence: {
          domain: transition.domain,
          reason: transition.reason,
          previous_state: transition.previous_state,
          command: transition.command || transition.event,
        },
      });
    }
  }
  if (positionRequest.type !== "NONE" && !hasActivePosition(currentState.position)) {
    diagnostics.push({
      code: "POSITION_REQUEST_WITHOUT_ACTIVE_POSITION",
      evidence: { request: positionRequest.type },
    });
  }

  const canonical = {
    schema_version: MONITOR_COMMAND_SCHEMA_VERSION_V1,
    plan_id: valueOrNull(
      monitor.plan_id
        || monitorSource.links?.plan_id
        || monitorSource.command?.plan_id,
    ),
    compiler_version: DETERMINISTIC_COMPILER_VERSION_V1,
    source_reference: base.source_reference,
    analytical_scope: base.analytical_scope,
    policy: base.policy,
    gates: base.gates || [],
    source_action: "REQUESTED_COMMAND",
    canonical_action: "ORTHOGONAL_COMMANDS",
    thesis_command: thesisCommand,
    setup_command: setupCommand,
    position_request: positionRequest,
    replan_request: replanRequest,
    transitions,
    alert: base.alert,
    context_transmission: base.context_transmission,
    diagnostics: {
      errors: dedupeDiagnostics([
        ...(base.diagnostics?.errors || []).filter((entry) => !carrierOnlyError(entry)),
        ...diagnostics,
      ]),
      warnings: base.diagnostics?.warnings || [],
      normalizations: [
        ...(base.diagnostics?.normalizations || []),
        {
          code: "NATIVE_ORTHOGONAL_REQUESTED_COMMAND_COMPILED",
          evidence: {
            thesis_command: thesisCommand.type,
            setup_command: setupCommand.type,
            position_request: positionRequest.type,
            replan_request: replanRequest.type,
          },
        },
      ],
    },
  };
  return {
    ...canonical,
    canonical_hash: canonicalSha256(canonical),
    valid: canonical.diagnostics.errors.length === 0,
    transport_context: base.transport_context,
  };
}

function resolvePinnedPlanRiskV1(monitor = {}, currentStateValue = {}, diagnostics = []) {
  const currentState = object(currentStateValue);
  const pinnedPlan = object(currentState.pinned_plan);
  const expectedPlanId = valueOrNull(monitor.plan_id);
  const pinnedPlanId = valueOrNull(pinnedPlan.plan_id);
  if (!expectedPlanId || !pinnedPlanId) {
    diagnostics.push({
      code: "PINNED_PLAN_RISK_MISSING",
      evidence: {
        expected_plan_id: expectedPlanId,
        pinned_plan_id: pinnedPlanId,
      },
    });
    return null;
  }
  if (expectedPlanId !== pinnedPlanId) {
    diagnostics.push({
      code: "PINNED_PLAN_ID_MISMATCH",
      evidence: {
        expected_plan_id: expectedPlanId,
        pinned_plan_id: pinnedPlanId,
      },
    });
    return null;
  }

  const monitorScope = object(monitor.scope);
  const pinnedScope = object(pinnedPlan.scope);
  const mismatches = PINNED_PLAN_SCOPE_FIELDS
    .filter((field) => (
      valueOrNull(monitorScope[field]) === null
      || valueOrNull(pinnedScope[field]) === null
      || valueOrNull(monitorScope[field]) !== valueOrNull(pinnedScope[field])
    ))
    .map((field) => ({
      field,
      expected: valueOrNull(monitorScope[field]),
      pinned: valueOrNull(pinnedScope[field]),
    }));
  if (mismatches.length > 0) {
    diagnostics.push({
      code: "PINNED_PLAN_SCOPE_MISMATCH",
      evidence: { plan_id: pinnedPlanId, mismatches },
    });
    return null;
  }

  const risk = object(pinnedPlan.risk);
  const riskPctRequested = typeof risk.risk_pct_requested === "number"
    && Number.isFinite(risk.risk_pct_requested)
    ? risk.risk_pct_requested
    : null;
  if (
    risk.capital_basis !== "NET_EQUITY"
    || riskPctRequested === null
    || riskPctRequested <= 0
    || riskPctRequested > 0.25
  ) {
    diagnostics.push({
      code: "PINNED_PLAN_RISK_INVALID",
      evidence: {
        plan_id: pinnedPlanId,
        capital_basis: risk.capital_basis || null,
        risk_pct_requested: risk.risk_pct_requested ?? null,
      },
    });
    return null;
  }
  return {
    capital_basis: "NET_EQUITY",
    risk_pct_requested: riskPctRequested,
  };
}

function monitorSetupCarriesRisk(setupValue = {}) {
  const setup = object(setupValue);
  const parameters = object(setup.parameters);
  return [
    setup.risk_pct,
    setup.risk_percent,
    setup.risk,
    setup.risk_policy,
    parameters.risk_pct,
    parameters.risk_percent,
    parameters.risk,
  ].some((value) => value !== undefined && value !== null);
}

function parseMachineIntent(value, allowed, machine, fallback, diagnostics) {
  if (value === undefined || value === null) return { type: fallback, payload: {} };
  if (Array.isArray(value)) {
    diagnostics.push({
      code: "MULTIPLE_MACHINE_INTENTIONS",
      evidence: { machine, count: value.length },
    });
    return { type: fallback, payload: {} };
  }
  if (typeof value === "string") {
    return validateIntent(normalizeEnum(value), {}, allowed, machine, fallback, diagnostics);
  }
  const payload = object(value);
  const nestedIntentions = firstArray(payload.intentions, payload.commands, payload.requests);
  if (nestedIntentions.length > 1) {
    diagnostics.push({
      code: "MULTIPLE_MACHINE_INTENTIONS",
      evidence: { machine, count: nestedIntentions.length },
    });
    return { type: fallback, payload };
  }
  const aliases = [
    payload.type,
    payload.command,
    payload.request,
    payload.action,
    nestedIntentions[0]?.type,
  ].map(normalizeEnum).filter(Boolean);
  const distinct = [...new Set(aliases)];
  if (distinct.length > 1) {
    diagnostics.push({
      code: "CONFLICTING_MACHINE_INTENTION_ALIASES",
      evidence: { machine, values: distinct },
    });
    return { type: fallback, payload };
  }
  return validateIntent(distinct[0] || fallback, payload, allowed, machine, fallback, diagnostics);
}

function validateIntent(type, payload, allowed, machine, fallback, diagnostics) {
  if (!allowed.has(type)) {
    diagnostics.push({
      code: "UNSUPPORTED_MACHINE_INTENTION",
      evidence: { machine, type },
    });
    return { type: fallback, payload };
  }
  return { type, payload };
}

function carrierLegacyAction({ thesis, setup, position, replan }) {
  const setupMap = {
    UPSERT_CANDIDATE: "SETUP_CANDIDATE",
    PRE_ARM: "PRE_ARM",
    ARM: "ARM_SETUP",
    CANCEL: "CANCEL_SETUP",
    EXPIRE: "EXPIRE_SETUP",
    INVALIDATE: "CANCEL_SETUP",
    REPLACE: "TRANSFORM_SCENARIO",
  };
  if (setupMap[setup]) return setupMap[setup];
  const positionMap = {
    REDUCE_RISK: "REDUCE_RISK",
    MOVE_STOP_BE: "MOVE_STOP_BE",
    TAKE_PARTIAL: "TAKE_PARTIAL",
    EXIT_POSITION: "EXIT_POSITION",
  };
  if (positionMap[position]) return positionMap[position];
  const thesisMap = {
    CREATE_WAIT: "WAIT_MORE",
    MAKE_CONDITIONAL: "WAIT_MORE",
    ACTIVATE: "MAINTAIN_THESIS",
    MAINTAIN: "MAINTAIN_THESIS",
    WEAKEN: "WEAKEN_THESIS",
    MARK_AT_RISK: "MARK_AT_RISK",
    INVALIDATE: "INVALIDATE_THESIS",
    REQUIRE_REPLAN: "REPLAN_FULL",
    SUPERSEDE: "TRANSFORM_SCENARIO",
  };
  if (thesisMap[thesis]) return thesisMap[thesis];
  if (replan === "REQUEST") return "REPLAN_FULL";
  return "NO_ACTION";
}

function carrierOnlyError(entry) {
  return ["CONFLICTING_ACTION_ALIASES", "MONITOR_ACTION_MISSING"].includes(entry?.code);
}

function hasActivePosition(position) {
  return ["OPEN", "PROTECTED", "PARTIAL_TAKEN", "REVIEW_REQUIRED"]
    .includes(normalizeEnum(position?.state || position?.status));
}

function dedupeDiagnostics(values) {
  const seen = new Set();
  return values.filter((entry) => {
    const key = `${entry.code}:${JSON.stringify(entry.evidence || null)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendCompilerErrorsV1(result, errors) {
  if (!Array.isArray(errors) || errors.length === 0) return result;
  const diagnostics = {
    ...object(result.diagnostics),
    errors: dedupeDiagnostics([...(result.diagnostics?.errors || []), ...errors]),
    warnings: result.diagnostics?.warnings || [],
    normalizations: result.diagnostics?.normalizations || [],
  };
  const { canonical_hash: ignoredHash, valid: ignoredValid, transport_context: transportContext, ...body } = result;
  const canonical = { ...body, diagnostics };
  return {
    ...canonical,
    canonical_hash: canonicalSha256(canonical),
    valid: false,
    transport_context: transportContext,
  };
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0)
    || values.find((value) => Array.isArray(value))
    || [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberOrNull(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed)
    ? parsed
    : null;
}

function valueOrNull(value) {
  return value === null || value === undefined || value === "" ? null : value;
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
