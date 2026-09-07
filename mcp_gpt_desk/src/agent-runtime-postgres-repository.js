import { randomUUID } from "node:crypto";
import {
  applyAgentConversationUseV1,
  buildAgentEventV1,
  buildAgentConversationAffinityKeyV1,
  claimAgentTaskV1,
  completeAgentTaskV1,
  planAgentConversationAssignmentV1,
  resolveAgentExecutionPolicyV1,
} from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";
import {
  cancelAgentTask,
  failTaskWithRecovery,
  requeueDeadLetter,
} from "./agent-runtime-recovery-postgres.js";
import {
  insertEvent,
  insertLease,
  mapTaskRow,
  repositoryError,
  selectTaskForUpdate,
  toIso,
  updateTask,
} from "./agent-runtime-postgres-common.js";
import { recordTaskRunMetrics } from "./agent-runtime-metrics-postgres.js";
import { acquireAgentRuntimeClaimDeploymentAdmission } from "./persistence/postgres-agent-runtime-deployment-admission.js";

export { mapTaskRow } from "./agent-runtime-postgres-common.js";

export class PostgresAgentRuntimeRepository {
  constructor({ pool, clock = new SystemClock() } = {}) {
    if (!pool?.connect) throw new Error("AGENT_RUNTIME_POSTGRES_POOL_REQUIRED");
    this.pool = pool;
    this.clock = clock;
  }

  async claimNextTask({
    lane,
    workerId,
    leaseSeconds = 900,
    nowUtc = this.clock.now().utc,
    taskTypePatterns = [],
  } = {}) {
    return this.withTransaction(async (client) => {
      const admission = await acquireAgentRuntimeClaimDeploymentAdmission(client);
      if (!admission.allowed) return null;
      const row = await selectClaimableTask(client, { lane, nowUtc, taskTypePatterns });
      if (!row) return null;
      const transition = claimAgentTaskV1(mapTaskRow(row), {
        worker_id: workerId,
        lease_token: randomUUID(),
        lease_seconds: leaseSeconds,
        now_utc: nowUtc,
      });
      if (!transition.ok) throw repositoryError("AGENT_RUNTIME_CLAIM_REJECTED", transition.reasons.join(","));
      await updateTask(client, transition.task);
      const leaseId = await insertLease(client, transition.lease, { agentId: row.agent_id });
      await insertEvent(client, transition.event, { leaseId, agentId: row.agent_id });
      return transition;
    });
  }

  async completeTask({
    taskId,
    workerId,
    leaseToken,
    outputRef = null,
    nowUtc = this.clock.now().utc,
  } = {}) {
    return this.withTransaction(async (client) => {
      const row = await selectTaskForUpdate(client, taskId);
      const transition = completeAgentTaskV1(mapTaskRow(row), {
        worker_id: workerId,
        lease_token: leaseToken,
        output_ref: outputRef,
        now_utc: nowUtc,
      });
      if (!transition.ok) throw repositoryError("AGENT_RUNTIME_COMPLETE_REJECTED", transition.reasons.join(","));
      await updateTask(client, transition.task);
      const leaseId = await insertLease(client, transition.lease, { agentId: row.agent_id });
      await insertEvent(client, transition.event, { leaseId, agentId: row.agent_id });
      return transition;
    });
  }

  async failTask({
    taskId,
    workerId,
    leaseToken,
    errorCode,
    errorMessage,
    retryable = false,
    retryPolicy = {},
    nowUtc = this.clock.now().utc,
  } = {}) {
    return failTaskWithRecovery(this, {
      taskId,
      workerId,
      leaseToken,
      errorCode,
      errorMessage,
      retryable,
      retryPolicy,
      nowUtc,
    });
  }

  async requeueDeadLetter(input = {}) {
    return requeueDeadLetter(this, input);
  }

  async cancelTask(input = {}) {
    return cancelAgentTask(this, input);
  }

  async recordTaskRunMetrics(input = {}) {
    return recordTaskRunMetrics(this, input);
  }

  async resolveConversationForTask({
    taskId,
    provider = "codex",
    affinityKey = null,
    maxTurns = 12,
    policy = {},
    workerId = "agent-runtime-supervisor",
    nowUtc = this.clock.now().utc,
  } = {}) {
    return this.withTransaction(async (client) => {
      const taskRow = await selectTaskForUpdate(client, taskId);
      const missionRow = await selectMissionForUpdate(client, taskRow.agent_mission_id);
      const task = mapTaskRow(taskRow);
      const mission = mapMissionRow(missionRow);
      const resolvedAffinityKey = affinityKey || buildAgentConversationAffinityKeyV1({
        provider,
        lane: task.lane,
        mission_id: task.mission_id,
        task_type: task.task_type,
        scope_key: task.payload?.scope_key || task.payload?.scopeKey,
      });
      const conversations = await listConversationsForMission(client, task.mission_id);
      const plan = planAgentConversationAssignmentV1({
        task,
        mission,
        conversations,
        policy: { ...policy, provider, affinity_key: resolvedAffinityKey, max_turns: maxTurns },
        now_utc: nowUtc,
      });
      if (!plan.ok) throw repositoryError("AGENT_CONVERSATION_ASSIGNMENT_REJECTED", plan.reasons?.join(","));
      if (plan.should_rotate_previous) await rotateConversation(client, plan.previous_conversation_id, nowUtc);
      const conversation = plan.should_create_conversation
        ? await insertConversation(client, plan.conversation_seed, nowUtc)
        : await updateConversation(client, plan.conversation);
      await attachConversationToTask(client, task.task_id, conversation.conversation_id, nowUtc);
      const event = buildAgentEventV1({
        event_type: "CONVERSATION_ATTACHED",
        task: { ...task, conversation_id: conversation.conversation_id },
        actor: workerId,
        now_utc: nowUtc,
        payload: {
          mode: plan.mode,
          provider,
          affinity_key: resolvedAffinityKey,
          previous_conversation_id: plan.previous_conversation_id,
          next_turn_count: conversation.turn_count,
        },
      });
      await insertEvent(client, event, { agentId: mission.agent_id });
      return { ...plan, conversation, event };
    });
  }

  async recordConversationOutcome({
    conversationId,
    externalConversationRef = null,
    threadId = null,
    metadata = {},
    nowUtc = this.clock.now().utc,
  } = {}) {
    if (!conversationId) return null;
    return this.withTransaction(async (client) => {
      const row = await selectConversationForUpdate(client, conversationId);
      const next = applyAgentConversationUseV1(mapConversationRow(row), {
        turn_count: row.turn_count,
        external_conversation_ref: externalConversationRef || threadId,
        metadata,
        now_utc: nowUtc,
      });
      await updateConversation(client, next);
      return { conversation: next };
    });
  }

  async resolveExecutionPolicyForTask({
    taskId,
    defaults = {},
    workerId = "agent-runtime-supervisor",
    nowUtc = this.clock.now().utc,
  } = {}) {
    return this.withTransaction(async (client) => {
      const taskRow = await selectTaskForUpdate(client, taskId);
      const missionRow = await selectMissionForUpdate(client, taskRow.agent_mission_id);
      const agentRow = missionRow.agent_id ? await selectAgent(client, missionRow.agent_id) : null;
      const task = mapTaskRow(taskRow);
      const mission = mapMissionRow(missionRow);
      const agent = agentRow ? mapAgentRow(agentRow) : {};
      const resolved = resolveAgentExecutionPolicyV1({ task, mission, agent, defaults });
      if (!resolved.ok) throw repositoryError("AGENT_EXECUTION_POLICY_REJECTED", resolved.reasons.join(","));
      const snapshot = await insertExecutionPolicySnapshot(client, resolved.snapshot, resolved.policy, { agentId: mission.agent_id, clock: this.clock });
      const event = buildAgentEventV1({
        event_type: "EXECUTION_POLICY_RESOLVED",
        task,
        actor: workerId,
        now_utc: nowUtc,
        payload: {
          policy_snapshot_id: snapshot.policy_snapshot_id,
          policy_hash: snapshot.policy_hash,
          model: resolved.policy.model,
          reasoning_effort: resolved.policy.reasoning_effort,
          routing_profile: resolved.policy.routing_profile,
          prompt_source: resolved.policy.prompt_source,
        },
      });
      await insertEvent(client, event, { agentId: mission.agent_id });
      return { ...resolved, snapshot, event };
    });
  }

  async recordHeartbeat({ serviceId, instanceId, releaseVersion, status, details = {} } = {}) {
    await this.pool.query(
      `INSERT INTO desk_service_heartbeats (
         service_id, service_kind, instance_id, release_version, status, details,
         started_at_utc, heartbeat_at_utc, updated_at_utc
       ) VALUES ($1, 'agent_runtime_supervisor', $2, $3, $4, $5::jsonb, now(), now(), now())
       ON CONFLICT (service_id) DO UPDATE
         SET instance_id = EXCLUDED.instance_id,
             release_version = EXCLUDED.release_version,
             status = EXCLUDED.status,
             details = EXCLUDED.details,
             heartbeat_at_utc = now(),
             updated_at_utc = now()`,
      [serviceId, instanceId, releaseVersion, status, JSON.stringify(details || {})],
    );
  }

  async withTransaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function mapMissionRow(row = {}) {
  return {
    mission_id: row.agent_mission_id,
    mission_key: row.mission_key,
    agent_id: row.agent_id,
    mission_type: row.mission_type,
    lane: row.lane,
    objective: row.objective,
    context_ref: row.context_ref,
    correlation_id: row.correlation_id,
    status: row.status,
    priority: row.priority,
    prompt_composition_id: row.prompt_composition_id,
    model_policy: row.model_policy || {},
    metadata: row.metadata || {},
    created_at_utc: toIso(row.created_at_utc),
    updated_at_utc: toIso(row.updated_at_utc),
  };
}

export function mapConversationRow(row = {}) {
  return {
    conversation_id: row.agent_conversation_id,
    mission_id: row.agent_mission_id,
    provider: row.provider,
    external_conversation_ref: row.external_conversation_ref,
    status: row.status,
    affinity_key: row.affinity_key,
    turn_count: row.turn_count,
    last_used_at_utc: toIso(row.last_used_at_utc),
    metadata: row.metadata || {},
    created_at_utc: toIso(row.created_at_utc),
    updated_at_utc: toIso(row.updated_at_utc),
  };
}

export function mapAgentRow(row = {}) {
  return {
    agent_id: row.agent_id,
    agent_key: row.agent_key,
    agent_type: row.agent_type,
    status: row.status,
    worker_group: row.worker_group,
    capabilities: row.capabilities || [],
    model_policy: row.model_policy || {},
    metadata: row.metadata || {},
    created_at_utc: toIso(row.created_at_utc),
    updated_at_utc: toIso(row.updated_at_utc),
  };
}

async function selectClaimableTask(client, { lane, nowUtc, taskTypePatterns = [] }) {
  const acceptedTaskTypePatterns = sqlTaskTypePatterns(taskTypePatterns);
  const result = await client.query(
    `SELECT t.*, m.agent_id
       FROM agent_tasks t
       JOIN agent_missions m ON m.agent_mission_id = t.agent_mission_id
      WHERE t.lane = $1
        AND (
          $3::text[] IS NULL
          OR EXISTS (
            SELECT 1
              FROM unnest($3::text[]) AS accepted(pattern)
             WHERE t.task_type ILIKE accepted.pattern
          )
        )
        AND (
          (t.status IN ('PENDING', 'READY') AND (t.not_before_utc IS NULL OR t.not_before_utc <= $2::timestamptz))
          OR (t.status IN ('CLAIMED', 'RUNNING') AND t.lease_expires_at_utc <= $2::timestamptz)
        )
      ORDER BY t.priority ASC, t.created_at_utc ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [lane, nowUtc, acceptedTaskTypePatterns.length ? acceptedTaskTypePatterns : null],
  );
  return result.rows[0] || null;
}

function sqlTaskTypePatterns(patterns) {
  if (!Array.isArray(patterns)) return [];
  return patterns
    .map((pattern) => String(pattern || "").trim().toUpperCase())
    .filter(Boolean)
    .map((pattern) => pattern.replaceAll("*", "%"));
}

async function selectMissionForUpdate(client, missionId) {
  const result = await client.query("SELECT * FROM agent_missions WHERE agent_mission_id = $1 FOR UPDATE", [missionId]);
  if (!result.rows[0]) throw repositoryError("AGENT_RUNTIME_MISSION_NOT_FOUND", `Mission not found: ${missionId}`);
  return result.rows[0];
}

async function selectAgent(client, agentId) {
  const result = await client.query("SELECT * FROM agents WHERE agent_id = $1", [agentId]);
  return result.rows[0] || null;
}

async function selectConversationForUpdate(client, conversationId) {
  const result = await client.query("SELECT * FROM agent_conversations WHERE agent_conversation_id = $1 FOR UPDATE", [conversationId]);
  if (!result.rows[0]) throw repositoryError("AGENT_RUNTIME_CONVERSATION_NOT_FOUND", `Conversation not found: ${conversationId}`);
  return result.rows[0];
}

async function listConversationsForMission(client, missionId) {
  const result = await client.query(
    `SELECT *
       FROM agent_conversations
      WHERE agent_mission_id = $1
      ORDER BY last_used_at_utc DESC NULLS LAST, created_at_utc DESC`,
    [missionId],
  );
  return result.rows.map(mapConversationRow);
}

async function attachConversationToTask(client, taskId, conversationId, nowUtc) {
  await client.query(
    `UPDATE agent_tasks
        SET agent_conversation_id = $2,
            revision = revision + 1,
            updated_at_utc = $3::timestamptz
      WHERE agent_task_id = $1`,
    [taskId, conversationId, nowUtc],
  );
}

async function insertConversation(client, seed, nowUtc) {
  const conversation = {
    conversation_id: randomUUID(),
    ...seed,
    created_at_utc: seed.created_at_utc || nowUtc,
    updated_at_utc: seed.updated_at_utc || nowUtc,
  };
  await client.query(
    `INSERT INTO agent_conversations (
       agent_conversation_id, agent_mission_id, provider, external_conversation_ref,
       status, affinity_key, turn_count, last_used_at_utc, metadata,
       created_at_utc, updated_at_utc
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::jsonb, $10::timestamptz, $11::timestamptz)`,
    [
      conversation.conversation_id,
      conversation.mission_id,
      conversation.provider,
      conversation.external_conversation_ref,
      conversation.status,
      conversation.affinity_key,
      conversation.turn_count,
      conversation.last_used_at_utc,
      JSON.stringify(conversation.metadata || {}),
      conversation.created_at_utc,
      conversation.updated_at_utc,
    ],
  );
  return conversation;
}

async function updateConversation(client, conversation) {
  await client.query(
    `UPDATE agent_conversations
        SET external_conversation_ref = $2,
            status = $3,
            affinity_key = $4,
            turn_count = $5,
            last_used_at_utc = $6::timestamptz,
            metadata = $7::jsonb,
            updated_at_utc = $8::timestamptz
      WHERE agent_conversation_id = $1`,
    [
      conversation.conversation_id,
      conversation.external_conversation_ref,
      conversation.status,
      conversation.affinity_key,
      conversation.turn_count,
      conversation.last_used_at_utc,
      JSON.stringify(conversation.metadata || {}),
      conversation.updated_at_utc,
    ],
  );
  return conversation;
}

async function rotateConversation(client, conversationId, nowUtc) {
  if (!conversationId) return;
  await client.query(
    `UPDATE agent_conversations
        SET status = 'ROTATING',
            updated_at_utc = $2::timestamptz
      WHERE agent_conversation_id = $1
        AND status = 'OPEN'`,
    [conversationId, nowUtc],
  );
}

async function insertExecutionPolicySnapshot(client, snapshot, policy, { agentId = null, clock = new SystemClock() } = {}) {
  const snapshotId = randomUUID();
  const result = await client.query(
    `INSERT INTO agent_execution_policy_snapshots (
       agent_execution_policy_snapshot_id, agent_task_id, agent_mission_id, agent_id,
       policy_schema_version, policy_version, policy, policy_hash, created_at_utc
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz)
     ON CONFLICT (agent_task_id, policy_hash) DO UPDATE
       SET created_at_utc = agent_execution_policy_snapshots.created_at_utc
     RETURNING agent_execution_policy_snapshot_id, policy_hash, created_at_utc`,
    [
      snapshotId,
      policy.task_id,
      policy.mission_id,
      agentId,
      snapshot.policy_schema_version,
      snapshot.policy_version,
      JSON.stringify(policy),
      snapshot.policy_hash,
      snapshot.created_at_utc || clock.now().utc,
    ],
  );
  const row = result.rows[0] || {};
  return {
    ...snapshot,
    policy_snapshot_id: row.agent_execution_policy_snapshot_id || snapshotId,
    created_at_utc: toIso(row.created_at_utc) || snapshot.created_at_utc,
    agent_id: agentId,
    policy,
  };
}
