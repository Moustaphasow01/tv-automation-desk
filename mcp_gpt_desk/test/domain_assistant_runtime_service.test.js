import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOMAIN_ASSISTANT_PROFILES,
  DomainAssistantRuntimeService,
} from "../src/domain-assistant-runtime-service.js";
import { InMemoryDomainAssistantRuntimeRepository } from "../src/domain-assistant-runtime-repository.js";

test("TD2-419 assistant profiles are explicit, read-only and model-policy driven", async () => {
  const repository = new InMemoryDomainAssistantRuntimeRepository();
  const service = new DomainAssistantRuntimeService({ repository });

  const result = await service.bootstrapProfiles();
  const profiles = await repository.listProfiles();

  assert.equal(result.count, 6);
  assert.deepEqual(profiles.items.map((item) => item.assistant_profile_id).sort(), [
    "assistant_data",
    "assistant_execution",
    "assistant_live_runtime",
    "assistant_platform_ops",
    "assistant_portfolio_risk",
    "assistant_research",
  ]);
  assert.equal(profiles.items.every((item) => item.permissions.mode === "READ_ONLY"), true);
  assert.equal(profiles.items.every((item) => item.model_policy_version === "domain-assistant.default.low-cost.v1"), true);
  assert.equal(profiles.items.every((item) => item.wake_policy.on_demand === true), true);
});

test("TD2-419 on-demand question is persisted before execution and wakes assistant through outbox", async () => {
  const repository = new InMemoryDomainAssistantRuntimeRepository();
  const service = new DomainAssistantRuntimeService({ repository });
  await service.bootstrapProfiles();

  const first = await service.submitQuestion({
    assistantId: "assistant_research",
    operatorId: "operator-1",
    question: "Pourquoi aucune stratégie n'a été promue ?",
    idempotencyKey: "td2-419:question:1",
    domainSnapshot: { experimentsRunning: 2, strategiesRejected: 4 },
    sourceRefs: ["research.experiments", "research.evaluation_reports"],
    lastMessages: Array.from({ length: 12 }, (_, index) => ({ index, text: `message-${index}` })),
    recentEvents: Array.from({ length: 25 }, (_, index) => ({ index, type: "RESEARCH_EVENT" })),
    nowUtc: "2026-08-14T12:00:00.000Z",
  });
  const second = await service.submitQuestion({
    assistantId: "assistant_research",
    operatorId: "operator-1",
    question: "Pourquoi aucune stratégie n'a été promue ?",
    idempotencyKey: "td2-419:question:1",
    domainSnapshot: { experimentsRunning: 999 },
    nowUtc: "2026-08-14T12:00:02.000Z",
  });

  assert.equal(first.status, "RECORDED");
  assert.equal(second.status, "IDEMPOTENT");
  assert.equal(repository.conversations.size, 1);
  assert.equal(repository.messages.size, 1);
  assert.equal(repository.snapshots.size, 1);
  assert.equal(repository.tasks.size, 1);
  assert.equal(repository.outbox.length, 1);
  assert.equal(repository.outbox[0].channel, "ASSISTANT_RUNTIME");
  assert.deepEqual(repository.events.map((item) => item.event_type), ["QUESTION_SUBMITTED", "TASK_READY"]);
  const snapshot = [...repository.snapshots.values()][0];
  assert.equal(snapshot.bounded_context.last_messages.length, 8);
  assert.equal(snapshot.bounded_context.recent_events.length, 20);
  assert.equal(snapshot.bounded_context.authority.can_create_provider_command, false);
});

test("TD2-419 assistant task can be claimed, answered, audited and restored after front close", async () => {
  const repository = new InMemoryDomainAssistantRuntimeRepository();
  const service = new DomainAssistantRuntimeService({ repository });
  await service.bootstrapProfiles();

  const submitted = await service.submitQuestion({
    assistantId: "assistant_execution",
    operatorId: "operator-1",
    question: "Que s'est-il passé avec OI-812 ?",
    idempotencyKey: "td2-419:question:execution",
    domainSnapshot: { orderIntentId: "OI-812", providerCommands: 0 },
    sourceRefs: ["execution.order_intents", "execution.provider_events"],
    nowUtc: "2026-08-14T12:05:00.000Z",
  });
  const claim = await service.claimNextTask({
    assistantId: "assistant_execution",
    workerId: "assistant-worker-01",
    leaseSeconds: 300,
    nowUtc: "2026-08-14T12:05:03.000Z",
  });
  await service.publishAnswer({
    taskId: claim.task.assistant_task_id,
    workerId: "assistant-worker-01",
    leaseToken: claim.lease.lease_token,
    content: "OI-812 est visible en lecture seule. Aucun ProviderCommand n'a été créé.",
    citationRefs: ["execution.order_intents"],
    metrics: { inputTokens: 210, outputTokens: 45, latencyMs: 750 },
    nowUtc: "2026-08-14T12:05:05.000Z",
  });

  const restored = await service.getConversation({ conversationId: submitted.conversation.assistant_conversation_id });

  assert.equal(claim.status, "CLAIMED");
  assert.equal(repository.tasks.get(claim.task.assistant_task_id).status, "DONE");
  assert.equal(repository.answers.size, 1);
  assert.equal(repository.outbox.at(-1).channel, "FRONT_REALTIME");
  assert.equal(restored.messages.length, 2);
  assert.equal(restored.messages[0].role, "operator");
  assert.equal(restored.messages[1].role, "assistant");
  assert.equal([...repository.leases.values()][0].status, "RELEASED");
});

test("TD2-419 assistants reject sensitive actions and cannot publish forbidden broker instructions", async () => {
  const repository = new InMemoryDomainAssistantRuntimeRepository();
  const service = new DomainAssistantRuntimeService({ repository });
  await service.bootstrapProfiles();

  await assert.rejects(
    () => service.requestSensitiveAction({
      assistantId: "assistant_execution",
      action: "CREATE_PROVIDER_COMMAND",
      conversationId: "asst_conv_test",
      nowUtc: "2026-08-14T12:10:00.000Z",
    }),
    { code: "DOMAIN_ASSISTANT_READ_ONLY" },
  );
  assert.equal(repository.events.at(-1).event_type, "READ_ONLY_REJECTED");

  const submitted = await service.submitQuestion({
    assistantId: "assistant_execution",
    operatorId: "operator-1",
    question: "Peux-tu envoyer cet ordre ?",
    idempotencyKey: "td2-419:forbidden-answer",
    nowUtc: "2026-08-14T12:11:00.000Z",
  });
  const claim = await service.claimNextTask({ assistantId: "assistant_execution", workerId: "assistant-worker-01", nowUtc: "2026-08-14T12:11:01.000Z" });
  await assert.rejects(
    () => service.publishAnswer({
      taskId: claim.task.assistant_task_id,
      workerId: "assistant-worker-01",
      leaseToken: claim.lease.lease_token,
      content: "Je vais CREATE_PROVIDER_COMMAND maintenant.",
      nowUtc: "2026-08-14T12:11:02.000Z",
    }),
    { code: "ASSISTANT_ANSWER_CONTAINS_FORBIDDEN_ACTION" },
  );
  assert.equal(repository.tasks.get(submitted.task.assistant_task_id).status, "CLAIMED");
});

test("TD2-419 retry, DLQ and requeue preserve at-least-once idempotent recovery", async () => {
  const repository = new InMemoryDomainAssistantRuntimeRepository();
  const service = new DomainAssistantRuntimeService({ repository });
  await service.bootstrapProfiles();

  await service.submitQuestion({
    assistantId: "assistant_data",
    operatorId: "operator-1",
    question: "Quels feeds sont stale ?",
    idempotencyKey: "td2-419:data-retry",
    nowUtc: "2026-08-14T12:15:00.000Z",
  });
  const firstClaim = await service.claimNextTask({ assistantId: "assistant_data", workerId: "assistant-worker-01", nowUtc: "2026-08-14T12:15:01.000Z" });
  const retry = await service.failTask({
    taskId: firstClaim.task.assistant_task_id,
    workerId: "assistant-worker-01",
    leaseToken: firstClaim.lease.lease_token,
    errorCode: "MODEL_UNAVAILABLE",
    errorMessage: "low-cost model unavailable",
    retryable: true,
    retryDelaySeconds: 0,
    nowUtc: "2026-08-14T12:15:02.000Z",
  });
  const secondClaim = await service.claimNextTask({ assistantId: "assistant_data", workerId: "assistant-worker-02", nowUtc: "2026-08-14T12:15:03.000Z" });
  const dlq = await service.failTask({
    taskId: secondClaim.task.assistant_task_id,
    workerId: "assistant-worker-02",
    leaseToken: secondClaim.lease.lease_token,
    errorCode: "CONTEXT_SOURCE_UNAVAILABLE",
    errorMessage: "data snapshot unavailable",
    retryable: false,
    nowUtc: "2026-08-14T12:15:04.000Z",
  });
  const requeued = await service.requeueDeadLetter({
    deadLetterId: dlq.deadLetter.assistant_task_dead_letter_id,
    operatorId: "operator-1",
    reason: "source restored",
    nowUtc: "2026-08-14T12:15:05.000Z",
  });
  const idempotent = await service.requeueDeadLetter({
    deadLetterId: dlq.deadLetter.assistant_task_dead_letter_id,
    operatorId: "operator-1",
    reason: "source restored",
    nowUtc: "2026-08-14T12:15:06.000Z",
  });

  assert.equal(retry.status, "REQUEUED");
  assert.equal(dlq.status, "DLQ");
  assert.equal(requeued.status, "REQUEUED");
  assert.equal(idempotent.status, "IDEMPOTENT");
  assert.equal(repository.deadLetters.get(dlq.deadLetter.assistant_task_dead_letter_id).status, "REQUEUED");
  assert.equal([...repository.tasks.values()][0].status, "QUEUED");
  assert.deepEqual(repository.events.map((item) => item.event_type).filter((item) => item.includes("TASK") || item.includes("DLQ")), [
    "TASK_READY",
    "TASK_CLAIMED",
    "TASK_REQUEUED",
    "TASK_CLAIMED",
    "TASK_FAILED",
    "DLQ_CREATED",
    "TASK_REQUEUED",
  ]);
});

test("TD2-419 periodic and event-triggered wake policies create durable assistant tasks", async () => {
  const repository = new InMemoryDomainAssistantRuntimeRepository();
  const service = new DomainAssistantRuntimeService({ repository });
  await service.bootstrapProfiles();

  const periodic = await service.submitPeriodicSnapshot({
    assistantId: "assistant_platform_ops",
    idempotencyKey: "td2-419:periodic:ops:12h",
    domainSnapshot: { servicesHealthy: 12, servicesExpected: 12 },
    nowUtc: "2026-08-14T12:00:00.000Z",
  });
  const eventTriggered = await service.submitEventTriggeredSummary({
    assistantId: "assistant_platform_ops",
    idempotencyKey: "td2-419:event:worker-dead",
    domainEvent: { eventType: "WORKER_DEAD", workerId: "codex-live-01" },
    domainSnapshot: { servicesHealthy: 11, servicesExpected: 12 },
    nowUtc: "2026-08-14T12:01:00.000Z",
  });

  assert.equal(periodic.task.task_type, "PERIODIC_SNAPSHOT");
  assert.equal(periodic.task.wake_type, "PERIODIC");
  assert.equal(eventTriggered.task.task_type, "EVENT_SUMMARY");
  assert.equal(eventTriggered.task.wake_type, "EVENT_TRIGGERED");
  assert.equal(repository.tasks.size, 2);
  assert.equal(repository.outbox.length, 2);
  assert.equal(repository.events.some((item) => item.event_type === "SNAPSHOT_REFRESHED"), true);
  assert.equal(repository.events.some((item) => item.event_type === "EVENT_TRIGGERED"), true);
});

test("TD2-419 default profiles remain read-only", () => {
  assert.equal(DEFAULT_DOMAIN_ASSISTANT_PROFILES.every((profile) => profile.permissions.mode === "READ_ONLY"), true);
  assert.equal(DEFAULT_DOMAIN_ASSISTANT_PROFILES.every((profile) => profile.permissions.can_create_provider_command === false), true);
});
