import { SystemClock } from "@tv-automation/desk-time";

const DEFAULT_CLOCK = new SystemClock();

export class DomainAssistantWorkerService {
  constructor({ service, clock = DEFAULT_CLOCK } = {}) {
    if (!service) throw new Error("DOMAIN_ASSISTANT_RUNTIME_SERVICE_REQUIRED");
    this.service = service;
    this.clock = clock;
  }

  async runOnce({
    assistantId = null,
    workerId = "domain-assistant-worker-01",
    leaseSeconds = 300,
    nowUtc = this.clock.now().utc,
  } = {}) {
    await this.service.bootstrapProfiles();
    const claim = await this.service.claimNextTask({ assistantId, workerId, leaseSeconds, nowUtc });
    if (!claim) {
      return {
        ok: true,
        status: "IDLE",
        worker_id: workerId,
        assistant_profile_id: assistantId,
        broker_execution: false,
        order_submission_enabled: false,
      };
    }

    const startedAtMs = epochMs(this.clock.now().utc);
    const context = await this.service.getTaskContext({ taskId: claim.task.assistant_task_id });
    const answer = buildReadOnlyAssistantAnswer({ claim, context, workerId, nowUtc });
    const persisted = await this.service.publishAnswer({
      taskId: claim.task.assistant_task_id,
      workerId,
      leaseToken: claim.lease.lease_token,
      content: answer.content,
      citationRefs: answer.citationRefs,
      metrics: {
        inference_mode: "deterministic_read_only",
        input_tokens: estimateTokens(JSON.stringify(context || claim.task)),
        output_tokens: estimateTokens(answer.content),
        latency_ms: Math.max(0, epochMs(this.clock.now().utc) - startedAtMs),
        worker_id: workerId,
        policy_version: claim.task.model_policy_version,
      },
      nowUtc: this.clock.now().utc,
    });

    return {
      ok: true,
      status: persisted.status,
      worker_id: workerId,
      assistant_profile_id: claim.task.assistant_profile_id,
      assistant_conversation_id: claim.task.assistant_conversation_id,
      assistant_task_id: claim.task.assistant_task_id,
      input_snapshot_id: claim.task.input_snapshot_id,
      answer_message_id: persisted.message?.assistant_message_id || null,
      model_policy_version: claim.task.model_policy_version,
      inference_mode: "deterministic_read_only",
      broker_execution: false,
      order_submission_enabled: false,
    };
  }
}

export function buildReadOnlyAssistantAnswer({ claim, context, workerId, nowUtc }) {
  const contextObject = object(context);
  const claimObject = object(claim);
  const task = firstObject(contextObject.task, claimObject.task);
  const snapshot = object(contextObject.snapshot);
  const payload = task.payload || {};
  const question = text(payload.question, "Question opérateur non renseignée.");
  const sources = uniqueTexts([
    ...(snapshot.source_refs || []),
    ...(payload.source_refs || []),
    task.input_snapshot_id,
  ]).slice(0, 8);
  const boundedContext = object(snapshot.bounded_context);
  const domain = text(boundedContext.domain, text(task.assistant_profile_id, "assistant"));
  const snapshotKeys = Object.keys(object(boundedContext.snapshot));
  const snapshotId = text(task.input_snapshot_id, "indisponible");
  return {
    citationRefs: sources,
    content: [
      `Réponse assistant ${domain} — lecture seule.`,
      `Question analysée : ${question}`,
      `Constat : la demande a été traitée depuis le snapshot persistant ${snapshotId} avec ${snapshotKeys.length} bloc(s) de contexte.`,
      `Sources utilisées : ${sourceText(sources)}.`,
      "Sécurité : aucune commande d'exécution, aucun provider et aucun Human Gate n'ont été appelés par cet assistant.",
      `Worker : ${workerId}. Horodatage : ${nowUtc}.`,
    ].join("\n"),
  };
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(String(value || "").length / 4));
}

function epochMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstObject(...values) {
  for (const value of values) {
    const normalized = object(value);
    if (Object.keys(normalized).length) return normalized;
  }
  return {};
}

function sourceText(sources) {
  if (sources.length) return sources.join(", ");
  return "snapshot assistant persistant";
}

function uniqueTexts(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}
