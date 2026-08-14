import { randomUUID } from "node:crypto";
import {
  addSeconds,
  assertLease,
  clone,
  errorPayload,
  id,
  insertAnswer,
  insertConversation,
  insertDeadLetter,
  insertEvent,
  insertLease,
  insertMessage,
  insertOutbox,
  insertSnapshot,
  insertTask,
  json,
  normalizeAnswer,
  normalizeDeadLetter,
  normalizeMessage,
  nowIso,
  one,
  outboxFromEvent,
  projectConversationRow,
  projectDeadLetterRow,
  projectMessageRow,
  projectProfileRow,
  projectTaskRow,
  releaseLease,
  repositoryError,
  rows,
  taskEvent,
  taskForUpdate,
  text,
} from "./domain-assistant-runtime-shared.js";

export class PostgresDomainAssistantRuntimeRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
  }

  async ready() {
    if (!this.pool) throw repositoryError("ASSISTANT_RUNTIME_POSTGRES_REQUIRED", "Assistant runtime requires PostgreSQL.");
    await this.persistence?.initialized;
  }

  async upsertProfiles(profiles = []) {
    await this.ready();
    for (const profile of profiles.map(normalizeProfile)) {
      await this.pool.query(
        `INSERT INTO assistant_profiles (
           assistant_profile_id, assistant_type, display_name, enabled, model_policy_version,
           model_policy, wake_policy, allowed_tools, permissions, context_builder, metadata,
           created_at_utc, updated_at_utc
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb,now(),now())
         ON CONFLICT (assistant_profile_id) DO UPDATE SET
           assistant_type = EXCLUDED.assistant_type,
           display_name = EXCLUDED.display_name,
           enabled = EXCLUDED.enabled,
           model_policy_version = EXCLUDED.model_policy_version,
           model_policy = EXCLUDED.model_policy,
           wake_policy = EXCLUDED.wake_policy,
           allowed_tools = EXCLUDED.allowed_tools,
           permissions = EXCLUDED.permissions,
           context_builder = EXCLUDED.context_builder,
           metadata = EXCLUDED.metadata,
           updated_at_utc = now()`,
        [
          profile.assistant_profile_id,
          profile.assistant_type,
          profile.display_name,
          profile.enabled,
          profile.model_policy_version,
          json(profile.model_policy),
          json(profile.wake_policy),
          json(profile.allowed_tools),
          json(profile.permissions),
          profile.context_builder,
          json(profile.metadata),
        ],
      );
    }
    return { status: "UPSERTED", count: profiles.length };
  }

  async listProfiles() {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM assistant_profiles ORDER BY assistant_type, assistant_profile_id");
    return { items: result.rows.map(projectProfileRow) };
  }

  async getProfile({ assistantId } = {}) {
    await this.ready();
    const row = await one(this.pool, "SELECT * FROM assistant_profiles WHERE assistant_profile_id = $1", [assistantId]);
    return row ? projectProfileRow(row) : null;
  }

  async submitTaskBundle(bundle = {}) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await one(client, "SELECT * FROM assistant_tasks WHERE idempotency_key = $1", [bundle.task.idempotency_key]);
      if (existing) {
        await client.query("COMMIT");
        return { status: "IDEMPOTENT", task: projectTaskRow(existing) };
      }
      await insertConversation(client, bundle.conversation);
      if (bundle.operatorMessage) await insertMessage(client, bundle.operatorMessage);
      await insertSnapshot(client, bundle.snapshot);
      await insertTask(client, bundle.task);
      for (const event of bundle.events || []) await insertEvent(client, event);
      for (const outbox of bundle.outbox || []) await insertOutbox(client, outbox);
      await client.query("COMMIT");
      return { status: "RECORDED", ...bundle };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimNextTask({ assistantId = null, workerId, leaseSeconds = 300, nowUtc = nowIso() } = {}) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await one(client, `
        SELECT *
          FROM assistant_tasks
         WHERE status = 'QUEUED'
           AND ($1::text IS NULL OR assistant_profile_id = $1)
           AND (not_before_utc IS NULL OR not_before_utc <= $2::timestamptz)
         ORDER BY priority ASC, created_at_utc ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`, [assistantId, nowUtc]);
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const leaseToken = randomUUID();
      const expiresAt = addSeconds(nowUtc, leaseSeconds);
      const lease = {
        assistant_task_lease_id: id("asst_lease", { task: row.assistant_task_id, leaseToken }),
        assistant_task_id: row.assistant_task_id,
        worker_id: text(workerId),
        lease_token: leaseToken,
        status: "ACTIVE",
        acquired_at_utc: nowUtc,
        expires_at_utc: expiresAt,
      };
      await client.query(
        `UPDATE assistant_tasks
            SET status = 'CLAIMED',
                assigned_worker_id = $2,
                lease_token = $3,
                lease_expires_at_utc = $4,
                attempt_count = attempt_count + 1,
                updated_at_utc = $5
          WHERE assistant_task_id = $1`,
        [row.assistant_task_id, workerId, leaseToken, expiresAt, nowUtc],
      );
      await insertLease(client, lease);
      await insertEvent(client, taskEvent("TASK_CLAIMED", { ...row, assigned_worker_id: workerId }, { worker_id: workerId, lease_token: leaseToken }, nowUtc));
      const task = await one(client, "SELECT * FROM assistant_tasks WHERE assistant_task_id = $1", [row.assistant_task_id]);
      await client.query("COMMIT");
      return { status: "CLAIMED", task: projectTaskRow(task), lease };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async publishAnswer(input = {}) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await taskForUpdate(client, input.taskId);
      assertLease(row, input);
      const now = text(input.nowUtc) || nowIso();
      const message = normalizeMessage({
        message_id: input.messageId || id("asst_msg", { taskId: input.taskId, content: input.content }),
        conversation_id: row.assistant_conversation_id,
        role: "assistant",
        content: input.content,
        citation_refs: input.citationRefs || input.citations || [],
        created_at_utc: now,
      });
      const answer = normalizeAnswer({
        assistant_task_id: row.assistant_task_id,
        assistant_message_id: message.assistant_message_id,
        model_policy_version: row.model_policy_version,
        citation_refs: message.citation_refs,
        metrics: input.metrics || {},
        created_at_utc: now,
        content: message.content,
      });
      await insertMessage(client, message);
      await insertAnswer(client, answer);
      await client.query(
        `UPDATE assistant_tasks
            SET status = 'DONE',
                answer_message_id = $2,
                lease_token = NULL,
                lease_expires_at_utc = NULL,
                metrics = $3::jsonb,
                updated_at_utc = $4
          WHERE assistant_task_id = $1`,
        [row.assistant_task_id, message.assistant_message_id, json(answer.metrics), now],
      );
      await releaseLease(client, row.assistant_task_id, row.lease_token, now);
      const event = taskEvent("ANSWER_PERSISTED", row, { answer_message_id: message.assistant_message_id }, now);
      await insertEvent(client, event);
      await insertOutbox(client, outboxFromEvent(event, "FRONT_REALTIME"));
      await client.query("COMMIT");
      return { status: "ANSWER_PERSISTED", message, answer };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failTask(input = {}) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await taskForUpdate(client, input.taskId);
      assertLease(row, input);
      const now = text(input.nowUtc) || nowIso();
      const retryable = input.retryable === true && row.attempt_count < row.max_attempts;
      const nextStatus = retryable ? "QUEUED" : "DLQ";
      await client.query(
        `UPDATE assistant_tasks
            SET status = $2,
                assigned_worker_id = NULL,
                lease_token = NULL,
                lease_expires_at_utc = NULL,
                last_error = $3::jsonb,
                not_before_utc = $4,
                updated_at_utc = $5
          WHERE assistant_task_id = $1`,
        [row.assistant_task_id, nextStatus, json(errorPayload(input)), retryable ? addSeconds(now, input.retryDelaySeconds ?? 30) : null, now],
      );
      await releaseLease(client, row.assistant_task_id, row.lease_token, now, retryable ? "RELEASED" : "BROKEN");
      const event = taskEvent(retryable ? "TASK_REQUEUED" : "TASK_FAILED", row, errorPayload(input), now);
      await insertEvent(client, event);
      let deadLetter = null;
      if (!retryable) {
        deadLetter = normalizeDeadLetter(row, input, now);
        await insertDeadLetter(client, deadLetter);
        await insertEvent(client, taskEvent("DLQ_CREATED", row, { dead_letter_id: deadLetter.assistant_task_dead_letter_id }, now));
      }
      await client.query("COMMIT");
      return { status: retryable ? "REQUEUED" : "DLQ", deadLetter };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async requeueDeadLetter({ deadLetterId, operatorId = "operator", reason = "manual-requeue", nowUtc = nowIso() } = {}) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await one(client, "SELECT * FROM assistant_task_dead_letters WHERE assistant_task_dead_letter_id = $1 FOR UPDATE", [deadLetterId]);
      if (!row) throw repositoryError("ASSISTANT_DLQ_NOT_FOUND", "Assistant dead letter not found.");
      if (row.status === "REQUEUED") {
        await client.query("COMMIT");
        return { status: "IDEMPOTENT", deadLetter: projectDeadLetterRow(row) };
      }
      await client.query("UPDATE assistant_task_dead_letters SET status='REQUEUED', updated_at_utc=$2 WHERE assistant_task_dead_letter_id=$1", [deadLetterId, nowUtc]);
      await client.query("UPDATE assistant_tasks SET status='QUEUED', last_error=NULL, not_before_utc=$2, updated_at_utc=$2 WHERE assistant_task_id=$1", [row.assistant_task_id, nowUtc]);
      await insertEvent(client, {
        assistant_event_id: id("asst_evt", { deadLetterId, operatorId, event: "TASK_REQUEUED" }),
        assistant_profile_id: row.assistant_profile_id,
        assistant_conversation_id: null,
        assistant_task_id: row.assistant_task_id,
        event_type: "TASK_REQUEUED",
        occurred_at_utc: nowUtc,
        payload: { dead_letter_id: deadLetterId, operator_id: operatorId, reason },
      });
      await client.query("COMMIT");
      return { status: "REQUEUED", deadLetter: projectDeadLetterRow({ ...row, status: "REQUEUED" }) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordReadOnlyRejection(input = {}) {
    await this.ready();
    const event = {
      assistant_event_id: id("asst_evt", { ...input, event_type: "READ_ONLY_REJECTED" }),
      assistant_profile_id: input.assistantId || null,
      assistant_conversation_id: input.conversationId || null,
      assistant_task_id: null,
      event_type: "READ_ONLY_REJECTED",
      occurred_at_utc: input.nowUtc || nowIso(),
      payload: input,
    };
    await insertEvent(this.pool, event);
    return { status: "RECORDED", event };
  }

  async getConversation({ conversationId } = {}) {
    await this.ready();
    const conversation = await one(this.pool, "SELECT * FROM assistant_conversations WHERE assistant_conversation_id = $1", [conversationId]);
    if (!conversation) return null;
    const messages = await rows(this.pool, "SELECT * FROM assistant_messages WHERE assistant_conversation_id = $1 ORDER BY created_at_utc, assistant_message_id", [conversationId]);
    return { conversation: projectConversationRow(conversation), messages: messages.map(projectMessageRow) };
  }
}
