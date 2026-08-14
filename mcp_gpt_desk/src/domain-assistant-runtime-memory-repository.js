import { randomUUID } from "node:crypto";
import {
  addSeconds,
  assertLease,
  clone,
  errorPayload,
  hash,
  id,
  normalizeAnswer,
  normalizeDeadLetter,
  normalizeMessage,
  normalizeProfile,
  nowIso,
  outboxFromEvent,
  repositoryError,
  taskEvent,
  text,
} from "./domain-assistant-runtime-shared.js";

export class InMemoryDomainAssistantRuntimeRepository {
  constructor({ profiles = [] } = {}) {
    this.profiles = new Map();
    this.conversations = new Map();
    this.messages = new Map();
    this.snapshots = new Map();
    this.tasks = new Map();
    this.leases = new Map();
    this.answers = new Map();
    this.deadLetters = new Map();
    this.events = [];
    this.outbox = [];
    this.idempotency = new Map();
    profiles.forEach((profile) => this.profiles.set(profile.assistant_profile_id, normalizeProfile(profile)));
  }

  async upsertProfiles(profiles = []) {
    profiles.map(normalizeProfile).forEach((profile) => this.profiles.set(profile.assistant_profile_id, clone(profile)));
    return { status: "UPSERTED", count: profiles.length };
  }

  async listProfiles() {
    return { items: [...this.profiles.values()].map(clone) };
  }

  async getProfile({ assistantId } = {}) {
    return clone(this.profiles.get(assistantId)) || null;
  }

  async submitTaskBundle(bundle = {}) {
    const key = bundle.task?.idempotency_key;
    if (this.idempotency.has(key)) {
      return { status: "IDEMPOTENT", task: clone(this.tasks.get(this.idempotency.get(key))) };
    }
    this.conversations.set(bundle.conversation.assistant_conversation_id, clone(bundle.conversation));
    if (bundle.operatorMessage) this.messages.set(bundle.operatorMessage.assistant_message_id, clone(bundle.operatorMessage));
    this.snapshots.set(bundle.snapshot.assistant_context_snapshot_id, clone(bundle.snapshot));
    this.tasks.set(bundle.task.assistant_task_id, clone(bundle.task));
    this.idempotency.set(key, bundle.task.assistant_task_id);
    this.events.push(...(bundle.events || []).map(clone));
    this.outbox.push(...(bundle.outbox || []).map(clone));
    return { status: "RECORDED", ...clone(bundle) };
  }

  async claimNextTask({ assistantId = null, workerId, leaseSeconds = 300, nowUtc = nowIso() } = {}) {
    const claimable = [...this.tasks.values()]
      .filter((task) => task.status === "QUEUED")
      .filter((task) => !assistantId || task.assistant_profile_id === assistantId)
      .filter((task) => !task.not_before_utc || Date.parse(task.not_before_utc) <= Date.parse(nowUtc))
      .sort((a, b) => a.priority - b.priority || a.created_at_utc.localeCompare(b.created_at_utc))[0];
    if (!claimable) return null;
    const lease = {
      assistant_task_lease_id: id("asst_lease", { task: claimable.assistant_task_id, workerId, nowUtc }),
      assistant_task_id: claimable.assistant_task_id,
      worker_id: text(workerId),
      lease_token: randomUUID(),
      status: "ACTIVE",
      acquired_at_utc: nowUtc,
      expires_at_utc: addSeconds(nowUtc, leaseSeconds),
    };
    const task = {
      ...claimable,
      status: "CLAIMED",
      assigned_worker_id: text(workerId),
      lease_token: lease.lease_token,
      lease_expires_at_utc: lease.expires_at_utc,
      attempt_count: claimable.attempt_count + 1,
      updated_at_utc: nowUtc,
    };
    this.tasks.set(task.assistant_task_id, task);
    this.leases.set(lease.assistant_task_lease_id, clone(lease));
    this.events.push(taskEvent("TASK_CLAIMED", task, { worker_id: workerId }, nowUtc));
    return { status: "CLAIMED", task: clone(task), lease: clone(lease) };
  }

  async publishAnswer(input = {}) {
    const task = this.tasks.get(input.taskId);
    assertLease(task, input);
    const now = text(input.nowUtc) || nowIso();
    const message = normalizeMessage({
      message_id: input.messageId || id("asst_msg", { taskId: input.taskId, content: input.content }),
      conversation_id: task.assistant_conversation_id,
      role: "assistant",
      content: input.content,
      citation_refs: input.citationRefs || input.citations || [],
      created_at_utc: now,
    });
    const answer = normalizeAnswer({
      assistant_task_id: task.assistant_task_id,
      assistant_message_id: message.assistant_message_id,
      model_policy_version: task.model_policy_version,
      citation_refs: message.citation_refs,
      metrics: input.metrics || {},
      content: message.content,
      created_at_utc: now,
    });
    this.messages.set(message.assistant_message_id, clone(message));
    this.answers.set(answer.assistant_answer_id, clone(answer));
    this.tasks.set(task.assistant_task_id, { ...task, status: "DONE", answer_message_id: message.assistant_message_id, lease_token: null, lease_expires_at_utc: null, metrics: answer.metrics, updated_at_utc: now });
    this.releaseActiveLease(task.assistant_task_id, task.lease_token, now, "RELEASED");
    const event = taskEvent("ANSWER_PERSISTED", task, { answer_message_id: message.assistant_message_id }, now);
    this.events.push(event);
    this.outbox.push(outboxFromEvent(event, "FRONT_REALTIME"));
    return { status: "ANSWER_PERSISTED", message: clone(message), answer: clone(answer) };
  }

  async failTask(input = {}) {
    const task = this.tasks.get(input.taskId);
    assertLease(task, input);
    const now = text(input.nowUtc) || nowIso();
    const retryable = input.retryable === true && task.attempt_count < task.max_attempts;
    const nextTask = {
      ...task,
      status: retryable ? "QUEUED" : "DLQ",
      assigned_worker_id: null,
      lease_token: null,
      lease_expires_at_utc: null,
      last_error: errorPayload(input),
      not_before_utc: retryable ? addSeconds(now, input.retryDelaySeconds ?? 30) : task.not_before_utc,
      updated_at_utc: now,
    };
    this.tasks.set(task.assistant_task_id, nextTask);
    this.releaseActiveLease(task.assistant_task_id, task.lease_token, now, retryable ? "RELEASED" : "BROKEN");
    this.events.push(taskEvent(retryable ? "TASK_REQUEUED" : "TASK_FAILED", task, errorPayload(input), now));
    if (retryable) return { status: "REQUEUED", deadLetter: null };
    const deadLetter = normalizeDeadLetter(task, input, now);
    this.deadLetters.set(deadLetter.assistant_task_dead_letter_id, clone(deadLetter));
    this.events.push(taskEvent("DLQ_CREATED", task, { dead_letter_id: deadLetter.assistant_task_dead_letter_id }, now));
    return { status: "DLQ", deadLetter: clone(deadLetter) };
  }

  async requeueDeadLetter({ deadLetterId, operatorId = "operator", reason = "manual-requeue", nowUtc = nowIso() } = {}) {
    const deadLetter = this.deadLetters.get(deadLetterId);
    if (!deadLetter) throw repositoryError("ASSISTANT_DLQ_NOT_FOUND", "Assistant dead letter not found.");
    if (deadLetter.status === "REQUEUED") return { status: "IDEMPOTENT", deadLetter: clone(deadLetter) };
    const nextDeadLetter = { ...deadLetter, status: "REQUEUED", updated_at_utc: nowUtc };
    const task = this.tasks.get(deadLetter.assistant_task_id);
    this.deadLetters.set(deadLetterId, nextDeadLetter);
    this.tasks.set(task.assistant_task_id, { ...task, status: "QUEUED", last_error: null, not_before_utc: nowUtc, updated_at_utc: nowUtc });
    this.events.push({
      assistant_event_id: id("asst_evt", { deadLetterId, operatorId, event: "TASK_REQUEUED" }),
      assistant_profile_id: deadLetter.assistant_profile_id,
      assistant_conversation_id: task.assistant_conversation_id,
      assistant_task_id: task.assistant_task_id,
      event_type: "TASK_REQUEUED",
      occurred_at_utc: nowUtc,
      payload_hash: hash({ deadLetterId, operatorId, reason }),
      payload: { dead_letter_id: deadLetterId, operator_id: operatorId, reason },
    });
    return { status: "REQUEUED", deadLetter: clone(nextDeadLetter) };
  }

  async recordReadOnlyRejection(input = {}) {
    const event = {
      assistant_event_id: id("asst_evt", { ...input, event_type: "READ_ONLY_REJECTED" }),
      assistant_profile_id: input.assistantId || null,
      assistant_conversation_id: input.conversationId || null,
      assistant_task_id: null,
      event_type: "READ_ONLY_REJECTED",
      occurred_at_utc: input.nowUtc || nowIso(),
      payload_hash: hash(input),
      payload: clone(input),
    };
    this.events.push(event);
    return { status: "RECORDED", event: clone(event) };
  }

  async getConversation({ conversationId } = {}) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    const messages = [...this.messages.values()]
      .filter((message) => message.assistant_conversation_id === conversationId)
      .sort((a, b) => a.created_at_utc.localeCompare(b.created_at_utc) || a.assistant_message_id.localeCompare(b.assistant_message_id));
    return { conversation: clone(conversation), messages: clone(messages) };
  }

  releaseActiveLease(taskId, leaseToken, releasedAt, status) {
    for (const [leaseId, lease] of this.leases.entries()) {
      if (lease.assistant_task_id === taskId && lease.lease_token === leaseToken) {
        this.leases.set(leaseId, { ...lease, status, released_at_utc: releasedAt });
      }
    }
  }
}
