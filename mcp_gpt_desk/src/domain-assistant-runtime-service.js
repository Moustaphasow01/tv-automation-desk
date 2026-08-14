import { canonicalSha256 } from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";
import { createDomainAssistantRuntimeRepository } from "./domain-assistant-runtime-repository.js";

const ASSISTANT_SERVICE_CLOCK = new SystemClock();

export const DEFAULT_DOMAIN_ASSISTANT_PROFILES = Object.freeze([
  profile("assistant_research", "RESEARCH", "Research Assistant", "research.snapshot.v1", ["research.read", "simulation.read", "agent_runtime.read"]),
  profile("assistant_live_runtime", "LIVE_RUNTIME", "Live / Strategy Runtime Assistant", "live-runtime.snapshot.v1", ["strategy.read", "signal_bus.read", "ai_context.read"]),
  profile("assistant_portfolio_risk", "PORTFOLIO_RISK", "Portfolio & Risk Assistant", "portfolio-risk.snapshot.v1", ["portfolio.read", "risk.read"]),
  profile("assistant_execution", "EXECUTION", "Execution Assistant", "execution.snapshot.v1", ["execution.read", "reconciliation.read"]),
  profile("assistant_data", "DATA", "Data Assistant", "data.snapshot.v1", ["data.read", "market_data.read", "macro.read"]),
  profile("assistant_platform_ops", "PLATFORM_OPS", "Platform / Operations Assistant", "platform-ops.snapshot.v1", ["health.read", "agent_runtime.read", "incidents.read"]),
]);

export class DomainAssistantRuntimeService {
  constructor({ repository, persistence } = {}) {
    this.repository = repository || createDomainAssistantRuntimeRepository(persistence);
  }

  async bootstrapProfiles(profiles = DEFAULT_DOMAIN_ASSISTANT_PROFILES) {
    return this.repository.upsertProfiles(profiles);
  }

  async submitQuestion(input = {}) {
    const nowUtc = iso(input.nowUtc);
    const profile = await this.requireReadOnlyProfile(input.assistantId);
    const question = text(input.question);
    if (!question) throw serviceError("ASSISTANT_QUESTION_REQUIRED", "Assistant question is required.");
    const conversationId = text(input.conversationId) || id("asst_conv", {
      assistantId: profile.assistant_profile_id,
      operatorId: input.operatorId,
      scope: input.scope || {},
    });
    const idempotencyKey = text(input.idempotencyKey || input.idempotency_key) || `assistant-question:${conversationId}:${hash(question)}`;
    const conversation = {
      assistant_conversation_id: conversationId,
      assistant_profile_id: profile.assistant_profile_id,
      operator_id: text(input.operatorId || input.operator_id || "operator"),
      status: "OPEN",
      conversation_summary: text(input.conversationSummary),
      last_message_at_utc: nowUtc,
      metadata: object(input.metadata),
    };
    const operatorMessage = message({
      role: "operator",
      conversationId,
      content: question,
      createdAt: nowUtc,
      messageSeed: { idempotencyKey, role: "operator" },
    });
    const snapshot = this.buildSnapshot({
      profile,
      conversationId,
      domainSnapshot: input.domainSnapshot || input.snapshot || {},
      sourceRefs: input.sourceRefs || [],
      conversationSummary: input.conversationSummary,
      lastMessages: input.lastMessages,
      recentEvents: input.recentEvents,
      nowUtc,
    });
    const task = this.task({
      profile,
      conversationId,
      triggeringMessageId: operatorMessage.assistant_message_id,
      snapshotId: snapshot.assistant_context_snapshot_id,
      taskType: "QUESTION",
      wakeType: "ON_DEMAND",
      idempotencyKey,
      payload: {
        question,
        authority: "READ_ONLY",
        forbidden_actions: forbiddenActionCodes(),
        source_refs: snapshot.source_refs,
      },
      nowUtc,
      priority: input.priority ?? 50,
      maxAttempts: input.maxAttempts ?? 3,
    });
    const events = questionEvents({ profile, conversation, conversationId, task, question, nowUtc });
    return this.submitQuestionBundle({ conversation, operatorMessage, snapshot, task, events });
  }

  async submitQuestionBundle({ conversation, operatorMessage, snapshot, task, events }) {
    return this.repository.submitTaskBundle({
      conversation,
      operatorMessage,
      snapshot,
      task,
      events,
      outbox: [outboxFromEvent(events[1], "ASSISTANT_RUNTIME")],
    });
  }

  async submitPeriodicSnapshot(input = {}) {
    const nowUtc = iso(input.nowUtc);
    const profile = await this.requireReadOnlyProfile(input.assistantId);
    return this.submitSystemTask({
      profile,
      operatorId: input.operatorId || "system",
      conversationId: text(input.conversationId) || id("asst_conv", { assistantId: profile.assistant_profile_id, periodic: true }),
      taskType: "PERIODIC_SNAPSHOT",
      wakeType: "PERIODIC",
      idempotencyKey: text(input.idempotencyKey) || `assistant-periodic:${profile.assistant_profile_id}:${nowUtc.slice(0, 13)}`,
      domainSnapshot: input.domainSnapshot,
      sourceRefs: input.sourceRefs,
      nowUtc,
      priority: input.priority ?? 80,
      payload: { authority: "READ_ONLY", schedule: input.schedule || "hourly" },
      readyEventPayload: { wake_type: "PERIODIC", schedule: input.schedule || "hourly" },
    });
  }

  async submitEventTriggeredSummary(input = {}) {
    const nowUtc = iso(input.nowUtc);
    const profile = await this.requireReadOnlyProfile(input.assistantId);
    const domainEvent = object(input.domainEvent || input.event);
    return this.submitSystemTask({
      profile,
      operatorId: input.operatorId || "system",
      conversationId: text(input.conversationId) || id("asst_conv", { assistantId: profile.assistant_profile_id, event: domainEvent }),
      taskType: "EVENT_SUMMARY",
      wakeType: "EVENT_TRIGGERED",
      idempotencyKey: text(input.idempotencyKey) || `assistant-event:${profile.assistant_profile_id}:${hash(domainEvent)}`,
      domainSnapshot: input.domainSnapshot,
      sourceRefs: input.sourceRefs,
      nowUtc,
      priority: input.priority ?? 40,
      payload: { authority: "READ_ONLY", domain_event: domainEvent },
      readyEventPayload: { wake_type: "EVENT_TRIGGERED", domain_event_hash: hash(domainEvent) },
      eventType: "EVENT_TRIGGERED",
    });
  }

  async claimNextTask(input = {}) {
    return this.repository.claimNextTask(input);
  }

  async publishAnswer(input = {}) {
    if (containsSensitiveWrite(input)) {
      throw serviceError("ASSISTANT_ANSWER_CONTAINS_FORBIDDEN_ACTION", "Assistant answer cannot contain sensitive write actions.");
    }
    return this.repository.publishAnswer(input);
  }

  async failTask(input = {}) {
    return this.repository.failTask(input);
  }

  async requeueDeadLetter(input = {}) {
    return this.repository.requeueDeadLetter(input);
  }

  async requestSensitiveAction(input = {}) {
    const action = text(input.action || input.commandType || input.command_type);
    await this.repository.recordReadOnlyRejection({
      assistantId: input.assistantId,
      conversationId: input.conversationId,
      action,
      reason: "DOMAIN_ASSISTANT_READ_ONLY",
      nowUtc: input.nowUtc || ASSISTANT_SERVICE_CLOCK.now().utc,
    });
    throw serviceError("DOMAIN_ASSISTANT_READ_ONLY", `Assistant cannot execute sensitive action: ${action}`);
  }

  async getConversation(input = {}) {
    return this.repository.getConversation(input);
  }

  async requireReadOnlyProfile(assistantId) {
    let profile = await this.repository.getProfile({ assistantId });
    if (!profile) {
      const known = DEFAULT_DOMAIN_ASSISTANT_PROFILES.find((item) => item.assistant_profile_id === assistantId);
      if (known) {
        await this.repository.upsertProfiles([known]);
        profile = known;
      }
    }
    if (!profile) throw serviceError("ASSISTANT_PROFILE_NOT_FOUND", `Assistant profile not found: ${assistantId}`);
    assertReadOnlyProfile(profile);
    return profile;
  }

  async submitSystemTask({
    profile,
    operatorId,
    conversationId,
    taskType,
    wakeType,
    idempotencyKey,
    domainSnapshot,
    sourceRefs,
    nowUtc,
    priority,
    payload,
    readyEventPayload,
    eventType = "SNAPSHOT_REFRESHED",
  }) {
    const conversation = {
      assistant_conversation_id: conversationId,
      assistant_profile_id: profile.assistant_profile_id,
      operator_id: text(operatorId || "system"),
      status: "OPEN",
      conversation_summary: "",
      last_message_at_utc: nowUtc,
      metadata: {},
    };
    const snapshot = this.buildSnapshot({ profile, conversationId, domainSnapshot, sourceRefs, nowUtc });
    const task = this.task({
      profile,
      conversationId,
      snapshotId: snapshot.assistant_context_snapshot_id,
      taskType,
      wakeType,
      idempotencyKey,
      payload,
      nowUtc,
      priority,
    });
    const events = [
      event(eventType, profile, conversationId, task.assistant_task_id, readyEventPayload || {}, nowUtc),
      event("TASK_READY", profile, conversationId, task.assistant_task_id, { wake_type: wakeType, task_type: taskType }, nowUtc),
    ];
    const outbox = [outboxFromEvent(events[1], "ASSISTANT_RUNTIME")];
    return this.repository.submitTaskBundle({ conversation, operatorMessage: null, snapshot, task, events, outbox });
  }

  buildSnapshot({ profile, conversationId, domainSnapshot = {}, sourceRefs = [], conversationSummary = "", lastMessages = [], recentEvents = [], nowUtc }) {
    const maxMessages = clamp(profile.model_policy?.max_messages, 8, 0, 20);
    const maxEvents = clamp(profile.model_policy?.max_events, 20, 0, 100);
    const boundedContext = {
      domain: profile.assistant_type,
      conversation_summary: text(conversationSummary),
      last_messages: array(lastMessages).slice(-maxMessages),
      recent_events: array(recentEvents).slice(-maxEvents),
      snapshot: object(domainSnapshot),
      authority: {
        mode: "READ_ONLY",
        can_confirm_human_gate: false,
        can_create_provider_command: false,
        can_activate_live: false,
        can_activate_auto_execution: false,
      },
    };
    return {
      assistant_context_snapshot_id: id("asst_snap", { profile: profile.assistant_profile_id, conversationId, nowUtc, boundedContext }),
      assistant_profile_id: profile.assistant_profile_id,
      assistant_conversation_id: conversationId,
      context_builder: profile.context_builder,
      source_refs: array(sourceRefs),
      bounded_context: boundedContext,
      snapshot_hash: hash({ context_builder: profile.context_builder, bounded_context: boundedContext }),
      max_messages: maxMessages,
      max_events: maxEvents,
      created_at_utc: nowUtc,
    };
  }

  task({ profile, conversationId, triggeringMessageId = null, snapshotId, taskType, wakeType, idempotencyKey, payload, nowUtc, priority, maxAttempts = 3 }) {
    return {
      assistant_task_id: id("asst_task", { idempotencyKey, assistantId: profile.assistant_profile_id }),
      assistant_profile_id: profile.assistant_profile_id,
      assistant_conversation_id: conversationId,
      triggering_message_id: triggeringMessageId,
      input_snapshot_id: snapshotId,
      task_type: taskType,
      wake_type: wakeType,
      status: "QUEUED",
      priority,
      idempotency_key: idempotencyKey,
      model_policy_version: profile.model_policy_version,
      payload: object(payload),
      attempt_count: 0,
      max_attempts: maxAttempts,
      metrics: {},
      correlation_id: id("corr_assistant", { idempotencyKey }),
      created_at_utc: nowUtc,
      updated_at_utc: nowUtc,
    };
  }
}

function profile(assistantId, type, displayName, contextBuilder, allowedTools) {
  return {
    assistant_profile_id: assistantId,
    assistant_type: type,
    display_name: displayName,
    enabled: true,
    model_policy_version: "domain-assistant.default.low-cost.v1",
    model_policy: {
      model: "low-cost",
      reasoning_effort: "low",
      max_messages: 8,
      max_events: 20,
      max_output_tokens: 900,
      escalation_policy: "policy_controlled_only",
    },
    wake_policy: { on_demand: true, periodic_minutes: 60, event_triggered: true },
    allowed_tools: allowedTools,
    permissions: {
      mode: "READ_ONLY",
      can_promote_strategy: false,
      can_confirm_human_gate: false,
      can_create_provider_command: false,
      can_activate_live: false,
      can_activate_auto_execution: false,
    },
    context_builder: contextBuilder,
    metadata: { td2: "TD2-419" },
  };
}

function assertReadOnlyProfile(profile) {
  const permissions = object(profile.permissions);
  if (permissions.mode !== "READ_ONLY") throw serviceError("ASSISTANT_PROFILE_NOT_READ_ONLY", "Assistant profiles must be READ_ONLY.");
  for (const key of ["can_confirm_human_gate", "can_create_provider_command", "can_activate_live", "can_activate_auto_execution"]) {
    if (permissions[key] === true) throw serviceError("ASSISTANT_PROFILE_FORBIDDEN_PERMISSION", `Forbidden assistant permission: ${key}`);
  }
  const forbidden = array(profile.allowed_tools).find((tool) => sensitiveToolPattern().test(tool));
  if (forbidden) throw serviceError("ASSISTANT_PROFILE_FORBIDDEN_TOOL", `Forbidden assistant tool: ${forbidden}`);
}

function containsSensitiveWrite(input = {}) {
  const value = JSON.stringify(input || {}).toLowerCase();
  return forbiddenActionCodes().some((code) => value.includes(code.toLowerCase()));
}

function forbiddenActionCodes() {
  return ["PROMOTE_STRATEGY", "DELETE_EXPERIMENT", "MODIFY_GLOBAL_RISK", "ACTIVATE_AUTO", "ACTIVATE_LIVE", "CONFIRM_HUMAN_GATE", "CREATE_PROVIDER_COMMAND", "SEND_ORDER", "SWITCH_PROVIDER"];
}

function questionEvents({ profile, conversation, conversationId, task, question, nowUtc }) {
  return [
    event("QUESTION_SUBMITTED", profile, conversationId, task.assistant_task_id, { question_hash: hash(question), operator_id: conversation.operator_id }, nowUtc),
    event("TASK_READY", profile, conversationId, task.assistant_task_id, { wake_type: "ON_DEMAND", task_type: "QUESTION" }, nowUtc),
  ];
}

function sensitiveToolPattern() {
  return /(write|create|update|delete|promote|confirm|broker|provider_command|human_gate|activate_live|activate_auto|send_order)/i;
}

function message({ role, conversationId, content, createdAt, messageSeed }) {
  return {
    assistant_message_id: id("asst_msg", { conversationId, content, ...messageSeed }),
    assistant_conversation_id: conversationId,
    role,
    content,
    citation_refs: [],
    message_hash: hash({ role, content, created_at_utc: createdAt }),
    metadata: {},
    created_at_utc: createdAt,
  };
}

function event(eventType, profile, conversationId, taskId, payload, nowUtc) {
  const body = { event_type: eventType, assistant_profile_id: profile.assistant_profile_id, task_id: taskId, ...object(payload) };
  return {
    assistant_event_id: id("asst_evt", body),
    assistant_profile_id: profile.assistant_profile_id,
    assistant_conversation_id: conversationId,
    assistant_task_id: taskId,
    event_type: eventType,
    occurred_at_utc: nowUtc,
    payload_hash: hash(body),
    payload: body,
  };
}

function outboxFromEvent(eventValue, channel = "ASSISTANT_RUNTIME") {
  return {
    assistant_outbox_id: id("asst_outbox", { event: eventValue.assistant_event_id, channel }),
    assistant_event_id: eventValue.assistant_event_id,
    channel,
    status: "PENDING",
    idempotency_key: `${channel}:${eventValue.assistant_event_id}`,
    payload: eventValue.payload,
    created_at_utc: eventValue.occurred_at_utc,
  };
}

function serviceError(code, message) { const error = new Error(message || code); error.code = code; error.statusCode = 400; return error; }
function id(prefix, value) { return `${prefix}_${canonicalSha256(value).slice(0, 24)}`; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function text(value) { return String(value ?? "").trim(); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function clamp(value, fallback, min, max) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.trunc(safe)));
}
function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ASSISTANT_SERVICE_CLOCK.now().utc;
}
