import { canonicalSha256 } from "@tv-automation/desk-domain";

export const RESEARCH_AGENT_TASK_QUEUE_SCHEMA_VERSION = "research_agent_task_queue_v1";

export async function enqueueResearchAgentTask(pool, input = {}) {
  if (!pool?.connect) throw coded("RESEARCH_AGENT_TASK_QUEUE_POSTGRES_REQUIRED", "PostgreSQL pool is required.", true);
  const mission = normalizeMission(input.mission);
  const task = normalizeTask(input.task, mission);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertMission(client, mission);
    const saved = await upsertTask(client, task);
    await client.query("COMMIT");
    return {
      status: saved.created ? "CREATED" : "EXISTING",
      mission_id: mission.agent_mission_id,
      task_id: task.agent_task_id,
      task_key: task.task_key,
      task_type: task.task_type,
      lane: task.lane,
      not_before_utc: task.not_before_utc,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function stableResearchTaskIds(input = {}) {
  const key = text(input.key || input.task_key || input.scope_key, "research-task");
  const kind = text(input.kind || input.task_type, "agent_task").toLowerCase();
  return {
    missionId: stableUuid({ kind: "agent_mission", key, purpose: kind }),
    taskId: stableUuid({ kind: "agent_task", key, purpose: kind }),
  };
}

function normalizeMission(input = {}) {
  const missionId = requiredText(input.agent_mission_id || input.mission_id, "agent_mission_id");
  const now = iso(input.created_at_utc || input.updated_at_utc);
  return {
    agent_mission_id: missionId,
    mission_key: requiredText(input.mission_key, "mission_key"),
    mission_type: requiredText(input.mission_type, "mission_type"),
    lane: text(input.lane, "research"),
    objective: requiredText(input.objective, "objective"),
    context_ref: text(input.context_ref, null),
    correlation_id: requiredText(input.correlation_id, "correlation_id"),
    status: text(input.status, "CREATED"),
    priority: boundedInteger(input.priority, 40),
    model_policy: object(input.model_policy),
    metadata: object(input.metadata),
    created_at_utc: now,
    updated_at_utc: now,
  };
}

function normalizeTask(input = {}, mission) {
  const now = iso(input.created_at_utc || input.updated_at_utc || mission.created_at_utc);
  const taskId = requiredText(input.agent_task_id || input.task_id, "agent_task_id");
  return {
    agent_task_id: taskId,
    agent_mission_id: mission.agent_mission_id,
    task_key: requiredText(input.task_key, "task_key"),
    task_type: requiredText(input.task_type, "task_type"),
    lane: text(input.lane, mission.lane),
    input_ref: text(input.input_ref, null),
    status: text(input.status, "READY"),
    priority: boundedInteger(input.priority, mission.priority),
    payload: object(input.payload),
    idempotency_key: text(input.idempotency_key, `idem_${taskId}`),
    max_attempts: boundedInteger(input.max_attempts, 3, 1, 20),
    not_before_utc: iso(input.not_before_utc || now),
    correlation_id: text(input.correlation_id, mission.correlation_id),
    metadata: {
      schema_version: RESEARCH_AGENT_TASK_QUEUE_SCHEMA_VERSION,
      ...object(input.metadata),
    },
    created_at_utc: now,
    updated_at_utc: now,
  };
}

async function upsertMission(client, mission) {
  await client.query(
    `INSERT INTO agent_missions (
       agent_mission_id, mission_key, mission_type, lane, objective, context_ref,
       correlation_id, status, priority, model_policy, metadata, created_at_utc, updated_at_utc
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::agent_mission_status,$9,$10::jsonb,$11::jsonb,$12,$13)
     ON CONFLICT (agent_mission_id) DO UPDATE SET
       updated_at_utc = EXCLUDED.updated_at_utc,
       metadata = agent_missions.metadata || EXCLUDED.metadata`,
    [
      mission.agent_mission_id, mission.mission_key, mission.mission_type, mission.lane,
      mission.objective, mission.context_ref, mission.correlation_id, mission.status,
      mission.priority, JSON.stringify(mission.model_policy), JSON.stringify(mission.metadata),
      mission.created_at_utc, mission.updated_at_utc,
    ],
  );
}

async function upsertTask(client, task) {
  const result = await client.query(
    `WITH inserted AS (
       INSERT INTO agent_tasks (
         agent_task_id, agent_mission_id, task_key, task_type, lane, input_ref, status,
         priority, payload, idempotency_key, max_attempts, not_before_utc, correlation_id,
         metadata, created_at_utc, updated_at_utc
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::agent_task_status,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16)
       ON CONFLICT (agent_task_id) DO UPDATE SET
         status = CASE
           WHEN agent_tasks.status IN ('DONE','CLAIMED','RUNNING') THEN agent_tasks.status
           ELSE EXCLUDED.status
         END,
         payload = EXCLUDED.payload,
         metadata = agent_tasks.metadata || EXCLUDED.metadata,
         updated_at_utc = EXCLUDED.updated_at_utc
       RETURNING (xmax = 0) AS inserted
     )
     SELECT COALESCE((SELECT inserted FROM inserted), false) AS inserted`,
    [
      task.agent_task_id, task.agent_mission_id, task.task_key, task.task_type,
      task.lane, task.input_ref, task.status, task.priority, JSON.stringify(task.payload),
      task.idempotency_key, task.max_attempts, task.not_before_utc, task.correlation_id,
      JSON.stringify(task.metadata), task.created_at_utc, task.updated_at_utc,
    ],
  );
  return { created: result.rows[0]?.inserted === true };
}

function stableUuid(value) {
  const hash = canonicalSha256(value).replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(hash[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function boundedInteger(value, fallback, min = 0, max = 1_000) {
  const parsed = Math.trunc(Number(value));
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(selected, max));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw coded("RESEARCH_AGENT_TASK_QUEUE_FIELD_REQUIRED", `${field} is required.`, false);
  return normalized;
}

function iso(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) throw coded("RESEARCH_AGENT_TASK_QUEUE_TIMESTAMP_INVALID", "Invalid timestamp.", false);
  return new Date(parsed).toISOString();
}

function coded(code, message, retryable) {
  return Object.assign(new Error(message || code), { code, retryable });
}
