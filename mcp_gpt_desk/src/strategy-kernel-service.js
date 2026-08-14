import {
  compileStrategyVersionToDeterministicPlanV1,
  planStrategyInstanceSchedulerCycleV1,
  strategyDefinitionHashV1,
  strategyInstanceHashV1,
  strategyVersionHashV1,
  validateStrategyDefinitionV1,
  validateStrategyInstanceTransitionV1,
  validateStrategyInstanceV1,
  validateStrategyVersionTransitionV1,
  validateStrategyVersionV1,
} from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";

export class StrategyKernelService {
  constructor({ repository, clock } = {}) {
    this.repository = repository;
    this.clock = clock || new SystemClock();
  }

  async registerDefinition(input = {}, command = {}) {
    return this.#transaction(`strategy-definition:${input.strategy_definition_id || input.id || input.external_key}`, async (repo) => {
      const candidate = normalizeCreatedUpdated(input, this.#nowIso());
      const validation = validateStrategyDefinitionV1(candidate);
      assertValid(validation);
      const definition = validation.normalized;
      const existing = await repo.findDefinition(definition.strategy_definition_id);
      if (existing) {
        const existingHash = strategyDefinitionHashV1(existing);
        const nextHash = strategyDefinitionHashV1(definition);
        if (existingHash === nextHash) {
          const audit = await repo.appendAuditEvent(auditEvent({
            aggregateType: "strategy_definition",
            aggregateId: definition.strategy_definition_id,
            eventType: "STRATEGY_DEFINITION_REGISTERED_IDEMPOTENT",
            previousHash: existingHash,
            nextHash,
            entity: definition,
            command,
            now: this.#nowIso(),
          }));
          return { status: "IDEMPOTENT", definition: existing, audit };
        }
        throw serviceError("STRATEGY_DEFINITION_CONFLICT", "Strategy Definition already exists with different content.", {
          strategy_definition_id: definition.strategy_definition_id,
        });
      }
      const saved = await repo.upsertDefinition(definition);
      const audit = await repo.appendAuditEvent(auditEvent({
        aggregateType: "strategy_definition",
        aggregateId: saved.strategy_definition_id,
        eventType: "STRATEGY_DEFINITION_REGISTERED",
        nextHash: strategyDefinitionHashV1(saved),
        entity: saved,
        command,
        now: this.#nowIso(),
      }));
      return { status: "CREATED", definition: saved, audit };
    });
  }

  async listDefinitions(filters = {}) {
    return this.repository.listDefinitions(filters);
  }

  async getDefinition(strategyDefinitionId) {
    const definition = await this.repository.findDefinition(strategyDefinitionId);
    if (!definition) throw serviceError("STRATEGY_DEFINITION_NOT_FOUND", `Strategy Definition not found: ${strategyDefinitionId}.`);
    return definition;
  }

  async getDefinitionByExternalKey(externalKey) {
    if (!this.repository.findDefinitionByExternalKey) return null;
    return this.repository.findDefinitionByExternalKey(externalKey);
  }

  async registerVersion(input = {}, command = {}) {
    return this.#transaction(`strategy-version:${input.strategy_version_id || input.id}`, async (repo) => {
      const candidate = normalizeCreatedUpdated(input, this.#nowIso());
      const validation = validateStrategyVersionV1(candidate);
      assertValid(validation);
      const version = validation.normalized;
      const existing = await repo.findVersion(version.strategy_version_id);
      if (existing) {
        const existingHash = strategyVersionHashV1(existing);
        const nextHash = strategyVersionHashV1(version);
        if (existingHash === nextHash) {
          const audit = await repo.appendAuditEvent(auditEvent({
            aggregateType: "strategy_version",
            aggregateId: version.strategy_version_id,
            eventType: "STRATEGY_VERSION_REGISTERED_IDEMPOTENT",
            previousHash: existingHash,
            nextHash,
            previous: existing,
            entity: version,
            command,
            now: this.#nowIso(),
          }));
          return { status: "IDEMPOTENT", version: existing, audit };
        }
        throw serviceError("STRATEGY_VERSION_CONFLICT", "Strategy Version already exists with different content.", {
          strategy_version_id: version.strategy_version_id,
        });
      }
      const saved = await repo.upsertVersion(version);
      const audit = await repo.appendAuditEvent(auditEvent({
        aggregateType: "strategy_version",
        aggregateId: saved.strategy_version_id,
        eventType: "STRATEGY_VERSION_REGISTERED",
        nextHash: strategyVersionHashV1(saved),
        entity: saved,
        command,
        now: this.#nowIso(),
      }));
      return { status: "CREATED", version: saved, audit };
    });
  }

  async listVersions(filters = {}) {
    return this.repository.listVersions(filters);
  }

  async getVersion(strategyVersionId) {
    const version = await this.repository.findVersion(strategyVersionId);
    if (!version) throw serviceError("STRATEGY_VERSION_NOT_FOUND", `Strategy Version not found: ${strategyVersionId}.`);
    return version;
  }

  async transitionVersion(input = {}, command = {}) {
    const strategyVersionId = input.strategy_version_id || input.id;
    return this.#transaction(`strategy-version:${strategyVersionId}`, async (repo) => {
      const previous = await repo.findVersion(strategyVersionId, { forUpdate: true });
      if (!previous) throw serviceError("STRATEGY_VERSION_NOT_FOUND", `Strategy Version not found: ${strategyVersionId}.`);
      const next = normalizeVersionTransition(previous, input, this.#nowIso());
      const validation = validateStrategyVersionTransitionV1(previous, next);
      assertValid(validation);
      const saved = await repo.upsertVersion(validateStrategyVersionV1(next).normalized);
      const audit = await repo.appendAuditEvent(auditEvent({
        aggregateType: "strategy_version",
        aggregateId: saved.strategy_version_id,
        eventType: "STRATEGY_VERSION_TRANSITIONED",
        previousHash: strategyVersionHashV1(previous),
        nextHash: strategyVersionHashV1(saved),
        previous,
        entity: saved,
        command,
        now: this.#nowIso(),
      }));
      return { status: "UPDATED", previous, version: saved, audit };
    });
  }

  async compileVersion(input = {}, command = {}) {
    const strategyVersionId = input.strategy_version_id || input.id;
    return this.#transaction(`strategy-version-compile:${strategyVersionId}`, async (repo) => {
      const version = await repo.findVersion(strategyVersionId);
      if (!version) throw serviceError("STRATEGY_VERSION_NOT_FOUND", `Strategy Version not found: ${strategyVersionId}.`);
      const definition = await repo.findDefinition(version.strategy_definition_id);
      if (!definition) throw serviceError("STRATEGY_DEFINITION_NOT_FOUND", `Strategy Definition not found: ${version.strategy_definition_id}.`);
      const compilation = compileStrategyVersionToDeterministicPlanV1({
        strategy_definition: definition,
        strategy_version: version,
        dsl_source: input.dsl_source ?? input.dslSource,
        runtime_bindings: input.runtime_bindings || input.runtimeBindings || {},
        scope: input.scope || {},
        source_mode: input.source_mode || input.sourceMode || "PAPER",
      });
      const audit = await repo.appendAuditEvent(auditEvent({
        aggregateType: "strategy_version",
        aggregateId: version.strategy_version_id,
        eventType: compilation.ok ? "STRATEGY_VERSION_COMPILED" : "STRATEGY_VERSION_COMPILE_REJECTED",
        previousHash: strategyVersionHashV1(version),
        nextHash: compilation.evidence.compiled_artifact_hash || null,
        entity: version,
        command,
        now: this.#nowIso(),
        payload: {
          compiler_version: compilation.compiler_version,
          compiled_artifact_hash: compilation.evidence.compiled_artifact_hash,
          deterministic_plan_hash: compilation.evidence.deterministic_plan_hash,
          reasons: compilation.reasons,
        },
      }));
      return { status: compilation.ok ? "COMPILED" : "REJECTED", version, definition, compilation, audit };
    });
  }

  async registerInstance(input = {}, command = {}) {
    return this.#transaction(`strategy-instance:${input.strategy_instance_id || input.id}`, async (repo) => {
      const candidate = normalizeCreatedUpdated(input, this.#nowIso());
      const validation = validateStrategyInstanceV1(candidate, {
        liveAccountConflict: candidate.execution_mode === "LIVE"
          && await repo.hasLiveAccountConflict({
            accountScope: candidate.account_scope,
            excludeStrategyInstanceId: candidate.strategy_instance_id,
          }),
      });
      assertValid(validation);
      const instance = validation.normalized;
      const existing = await repo.findInstance(instance.strategy_instance_id);
      if (existing) {
        const existingHash = strategyInstanceHashV1(existing);
        const nextHash = strategyInstanceHashV1(instance);
        if (existingHash === nextHash) {
          const audit = await repo.appendAuditEvent(auditEvent({
            aggregateType: "strategy_instance",
            aggregateId: instance.strategy_instance_id,
            eventType: "STRATEGY_INSTANCE_REGISTERED_IDEMPOTENT",
            previousHash: existingHash,
            nextHash,
            previous: existing,
            entity: instance,
            command,
            now: this.#nowIso(),
          }));
          return { status: "IDEMPOTENT", instance: existing, audit };
        }
        throw serviceError("STRATEGY_INSTANCE_CONFLICT", "Strategy Instance already exists with different content.", {
          strategy_instance_id: instance.strategy_instance_id,
        });
      }
      const saved = await repo.upsertInstance(instance);
      const audit = await repo.appendAuditEvent(auditEvent({
        aggregateType: "strategy_instance",
        aggregateId: saved.strategy_instance_id,
        eventType: "STRATEGY_INSTANCE_REGISTERED",
        nextHash: strategyInstanceHashV1(saved),
        entity: saved,
        command,
        now: this.#nowIso(),
      }));
      return { status: "CREATED", instance: saved, audit };
    });
  }

  async listInstances(filters = {}) {
    return this.repository.listInstances(filters);
  }

  async getInstance(strategyInstanceId) {
    const instance = await this.repository.findInstance(strategyInstanceId);
    if (!instance) throw serviceError("STRATEGY_INSTANCE_NOT_FOUND", `Strategy Instance not found: ${strategyInstanceId}.`);
    return instance;
  }

  async transitionInstance(input = {}, command = {}) {
    const strategyInstanceId = input.strategy_instance_id || input.id;
    return this.#transaction(`strategy-instance:${strategyInstanceId}`, async (repo) => {
      const previous = await repo.findInstance(strategyInstanceId, { forUpdate: true });
      if (!previous) throw serviceError("STRATEGY_INSTANCE_NOT_FOUND", `Strategy Instance not found: ${strategyInstanceId}.`);
      const next = normalizeInstanceTransition(previous, input, this.#nowIso());
      assertManualExecutionModePolicy(previous, next, input, command);
      const validation = validateStrategyInstanceTransitionV1(previous, next, {
        liveAccountConflict: next.execution_mode === "LIVE"
          && await repo.hasLiveAccountConflict({
            accountScope: next.account_scope,
            excludeStrategyInstanceId: next.strategy_instance_id,
          }),
      });
      assertValid(validation);
      const saved = await repo.upsertInstance(validateStrategyInstanceV1(next).normalized);
      const audit = await repo.appendAuditEvent(auditEvent({
        aggregateType: "strategy_instance",
        aggregateId: saved.strategy_instance_id,
        eventType: "STRATEGY_INSTANCE_TRANSITIONED",
        previousHash: strategyInstanceHashV1(previous),
        nextHash: strategyInstanceHashV1(saved),
        previous,
        entity: saved,
        command,
        now: this.#nowIso(),
      }));
      return { status: "UPDATED", previous, instance: saved, audit };
    });
  }

  async planInstanceSchedulerCycle(input = {}, command = {}) {
    const now = schedulerNow(input, this.#nowIso());
    return this.#transaction(`strategy-instance-scheduler:${now.slice(0, 16)}`, async (repo) => {
      const instances = input.instances || await repo.listInstances(schedulerListFilters(input));
      const plan = planStrategyInstanceSchedulerCycleV1(schedulerPlanInput(input, instances, now));
      const audit = await appendSchedulerAudit(repo, plan, command, now, input.audit !== false);
      return { status: "PLANNED", plan, audit };
    });
  }

  async listAuditEvents(filters = {}) {
    return this.repository.listAuditEvents(filters);
  }

  async #transaction(lockKey, operation) {
    if (!this.repository?.transaction) return operation(this.repository);
    return this.repository.transaction(lockKey, operation);
  }

  #nowIso() {
    const value = typeof this.clock.now === "function" ? this.clock.now() : new SystemClock().now();
    if (typeof value === "string") return new Date(value).toISOString();
    if (value?.utc) return new Date(value.utc).toISOString();
    return new Date(value).toISOString();
  }
}

export class InMemoryStrategyKernelRepository {
  constructor() {
    this.definitions = new Map();
    this.versions = new Map();
    this.instances = new Map();
    this.auditEvents = [];
    this.transactionCalls = [];
  }

  async transaction(lockKey, operation) {
    this.transactionCalls.push(lockKey);
    return operation(this);
  }

  async findDefinition(id) { return clone(this.definitions.get(id)); }
  async findVersion(id) { return clone(this.versions.get(id)); }
  async findInstance(id) { return clone(this.instances.get(id)); }
  async listDefinitions({ limit = 100 } = {}) { return [...this.definitions.values()].slice(0, limit).map(clone); }
  async listVersions({ strategyDefinitionId = null, status = null, limit = 100 } = {}) {
    return [...this.versions.values()]
      .filter((item) => !strategyDefinitionId || item.strategy_definition_id === strategyDefinitionId)
      .filter((item) => !status || item.status === String(status).toUpperCase())
      .slice(0, limit)
      .map(clone);
  }
  async listInstances({ strategyVersionId = null, runtimeState = null, executionMode = null, limit = 100 } = {}) {
    return [...this.instances.values()]
      .filter((item) => !strategyVersionId || item.strategy_version_id === strategyVersionId)
      .filter((item) => !runtimeState || item.runtime_state === String(runtimeState).toUpperCase())
      .filter((item) => !executionMode || item.execution_mode === String(executionMode).toUpperCase())
      .slice(0, limit)
      .map(clone);
  }
  async findDefinitionByExternalKey(externalKey) {
    return clone([...this.definitions.values()].find((item) => item.external_key === externalKey));
  }
  async hasLiveAccountConflict({ accountScope, excludeStrategyInstanceId = null } = {}) {
    if (!accountScope) return false;
    return [...this.instances.values()].some((item) => item.strategy_instance_id !== excludeStrategyInstanceId
      && item.account_scope === accountScope
      && item.execution_mode === "LIVE"
      && ["CREATED", "STARTING", "RUNNING", "PAUSED"].includes(item.runtime_state));
  }
  async upsertDefinition(definition) {
    this.definitions.set(definition.strategy_definition_id, clone(definition));
    return clone(definition);
  }
  async upsertVersion(version) {
    this.versions.set(version.strategy_version_id, clone(version));
    return clone(version);
  }
  async upsertInstance(instance) {
    this.instances.set(instance.strategy_instance_id, clone(instance));
    return clone(instance);
  }
  async appendAuditEvent(event) {
    const existing = event.idempotency_key
      ? this.auditEvents.find((item) => item.aggregate_type === event.aggregate_type
        && item.aggregate_id === event.aggregate_id
        && item.event_type === event.event_type
        && item.idempotency_key === event.idempotency_key)
      : null;
    if (existing) return clone(existing);
    const saved = { strategy_kernel_audit_event_id: `memory_audit_${this.auditEvents.length + 1}`, ...clone(event) };
    this.auditEvents.push(saved);
    return clone(saved);
  }
  async listAuditEvents({ aggregateType = null, aggregateId = null, limit = 100 } = {}) {
    return this.auditEvents
      .filter((item) => !aggregateType || item.aggregate_type === aggregateType)
      .filter((item) => !aggregateId || item.aggregate_id === aggregateId)
      .slice(0, limit)
      .map(clone);
  }
}

function normalizeCreatedUpdated(input, now) {
  return {
    ...input,
    created_at: input.created_at || now,
    updated_at: input.updated_at || input.created_at || now,
  };
}

function normalizeVersionTransition(previous, input, now) {
  const status = String(input.status || input.next_status || previous.status || "").toUpperCase();
  const transitionAt = input.updated_at || input.patch?.updated_at || now;
  return {
    ...previous,
    ...input.patch,
    status,
    validated_metrics_ref: input.validated_metrics_ref ?? input.patch?.validated_metrics_ref ?? previous.validated_metrics_ref,
    published_at: input.published_at || input.patch?.published_at || (status === "PUBLISHED" && !previous.published_at ? transitionAt : previous.published_at),
    deprecated_at: input.deprecated_at || input.patch?.deprecated_at || (status === "DEPRECATED" && !previous.deprecated_at ? transitionAt : previous.deprecated_at),
    updated_at: transitionAt,
  };
}

function normalizeInstanceTransition(previous, input, now) {
  const runtimeState = String(input.runtime_state || input.next_runtime_state || previous.runtime_state || "").toUpperCase();
  const executionMode = String(input.execution_mode || input.next_execution_mode || previous.execution_mode || "").toUpperCase();
  return {
    ...previous,
    ...input.patch,
    runtime_state: runtimeState,
    execution_mode: executionMode,
    account_scope: input.account_scope ?? input.patch?.account_scope ?? previous.account_scope,
    triple_lock_validated: input.triple_lock_validated ?? input.patch?.triple_lock_validated ?? previous.triple_lock_validated,
    operator_approval_id: transitionOperatorApproval(previous, input, executionMode),
    last_heartbeat_at: input.last_heartbeat_at || input.patch?.last_heartbeat_at || (
      ["STARTING", "RUNNING", "PAUSED"].includes(runtimeState) ? now : previous.last_heartbeat_at
    ),
    started_at: input.started_at || input.patch?.started_at || (
      runtimeState === "RUNNING" && !previous.started_at ? now : previous.started_at
    ),
    stopped_at: input.stopped_at || input.patch?.stopped_at || (
      runtimeState === "STOPPED" && !previous.stopped_at ? now : previous.stopped_at
    ),
    failed_at: input.failed_at || input.patch?.failed_at || (
      ["FAILED_TO_START", "ERRORED"].includes(runtimeState) && !previous.failed_at ? now : previous.failed_at
    ),
    updated_at: input.updated_at || now,
  };
}

function assertManualExecutionModePolicy(previous = {}, next = {}, input = {}, command = {}) {
  const reasons = [];
  if (previous.execution_mode === "SHADOW" && next.execution_mode === "PAPER" && !explicitOperatorApproval(input)) {
    reasons.push("STRATEGY_INSTANCE_PAPER_OPERATOR_APPROVAL_REQUIRED");
  }
  if (previous.execution_mode === "PAPER" && next.execution_mode === "SHADOW" && !text(command.reason)) {
    reasons.push("STRATEGY_INSTANCE_ROLLBACK_REASON_REQUIRED");
  }
  if (!reasons.length) return;
  throw serviceError("STRATEGY_INSTANCE_OPERATOR_ACTION_REQUIRED", "Strategy Instance execution-mode change requires explicit operator evidence.", {
    reasons,
    previous_execution_mode: previous.execution_mode || null,
    next_execution_mode: next.execution_mode || null,
  });
}

function explicitOperatorApproval(input = {}) {
  return Boolean(text(input.operator_approval_id ?? input.patch?.operator_approval_id));
}

function transitionOperatorApproval(previous = {}, input = {}, executionMode) {
  if (Object.hasOwn(input, "operator_approval_id")) return input.operator_approval_id || null;
  if (Object.hasOwn(input.patch || {}, "operator_approval_id")) return input.patch.operator_approval_id || null;
  return executionMode === "SHADOW" ? null : previous.operator_approval_id;
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function auditEvent({ aggregateType, aggregateId, eventType, previousHash = null, nextHash = null, previous = null, entity, command = {}, now, payload = {} }) {
  return {
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    event_type: eventType,
    idempotency_key: command.idempotency_key || command.idempotencyKey || null,
    actor: command.actor || "strategy_kernel",
    reason: command.reason || null,
    previous_hash: previousHash,
    next_hash: nextHash,
    previous_status: previous?.status || null,
    next_status: entity?.status || null,
    previous_runtime_state: previous?.runtime_state || null,
    next_runtime_state: entity?.runtime_state || null,
    previous_execution_mode: previous?.execution_mode || null,
    next_execution_mode: entity?.execution_mode || null,
    payload: {
      command: sanitizeCommand(command),
      entity_schema_version: entity?.schema_version || null,
      ...sanitizeCommand(payload),
    },
    created_at: now,
  };
}

function schedulerAuditEntity(item) {
  return {
    schema_version: "strategy_instance_scheduler_tick_v1",
    runtime_state: item.runtime_state,
    execution_mode: item.execution_mode,
  };
}

async function appendSchedulerAudit(repo, plan, command, now, enabled) {
  if (!enabled) return [];
  return Promise.all(plan.due.map((item) => repo.appendAuditEvent(auditEvent({
    aggregateType: "strategy_instance",
    aggregateId: item.strategy_instance_id,
    eventType: "STRATEGY_INSTANCE_SCHEDULER_TICK_DUE",
    entity: schedulerAuditEntity(item),
    command: schedulerCommand(command, item),
    now,
    payload: { scheduler_tick: item, scheduler_plan_hash: plan.scheduler_plan_hash },
  }))));
}

function schedulerPlanInput(input, instances, now) {
  return {
    instances,
    now_utc: now,
    last_scheduled_at_by_instance: input.last_scheduled_at_by_instance || input.lastScheduledAtByInstance || {},
    default_cadence_seconds: input.default_cadence_seconds || input.defaultCadenceSeconds || 60,
    default_max_lag_seconds: input.default_max_lag_seconds || input.defaultMaxLagSeconds || null,
  };
}

function schedulerListFilters(input) {
  return {
    strategyVersionId: input.strategy_version_id || input.strategyVersionId || null,
    executionMode: input.execution_mode || input.executionMode || null,
    limit: input.limit || 500,
  };
}

function schedulerNow(input, fallback) {
  return input.now_utc || input.nowUtc || fallback;
}

function schedulerCommand(command = {}, item = {}) {
  const prefix = command.idempotency_key || command.idempotencyKey || null;
  return {
    ...command,
    idempotency_key: prefix ? `${prefix}:${item.scheduler_run_key}` : item.scheduler_run_key,
    reason: command.reason || "strategy_instance_scheduler_cycle",
  };
}

function sanitizeCommand(command = {}) {
  return Object.fromEntries(
    Object.entries(command)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, value]),
  );
}

function assertValid(result) {
  if (result.ok) return;
  throw serviceError("STRATEGY_KERNEL_VALIDATION_FAILED", `Strategy Kernel validation failed: ${result.reasons.join(", ")}`, {
    reasons: result.reasons,
    issues: result.issues,
  });
}

function serviceError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details;
  error.statusCode = code.endsWith("_NOT_FOUND") ? 404 : code.endsWith("_CONFLICT") ? 409 : 422;
  return error;
}

function clone(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
