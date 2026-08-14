export const AGENT_CONVERSATION_AFFINITY_VERSION_V1 = "1.0.0";
export const AGENT_CONVERSATION_ASSIGNMENT_SCHEMA_VERSION_V1 = "agent_conversation_assignment_v1";
export const AGENT_CONVERSATION_ASSIGNMENT_MODES_V1 = Object.freeze(["CREATED", "RESUMED", "ROTATED"]);
export const DEFAULT_AGENT_CONVERSATION_MAX_TURNS_V1 = 12;

const OPEN_STATUSES = new Set(["OPEN"]);

export function buildAgentConversationAffinityKeyV1(input = {}) {
  const entity = object(input);
  const provider = lower(pickText("codex", entity.provider));
  const lane = lower(pickText("lane", entity.lane));
  const mission = lower(pickText("mission", entity.mission_id, entity.missionId, entity.mission_key, entity.missionKey));
  const scope = lower(pickText("default", entity.scope_key, entity.scopeKey, entity.task_type, entity.taskType));
  return [provider, lane, mission, scope].map(safeKeyPart).join(":").slice(0, 190);
}

export function planAgentConversationAssignmentV1(input = {}) {
  const entity = object(input);
  const task = object(entity.task);
  const mission = object(entity.mission);
  const policy = object(entity.policy);
  const nowUtc = timestamp(entity.now_utc ?? entity.nowUtc);
  const config = assignmentConfig(entity, task, mission, policy);
  const conversations = matchingConversations(entity.conversations, task, mission, config);
  const preferred = conversations.find((conversation) => conversation.conversation_id === text(task.conversation_id));
  const reusable = reusableConversation(preferred, conversations, policy, config.maxTurns);

  if (reusable) return assignment("RESUMED", { conversation: reusable, affinityKey: config.affinityKey, maxTurns: config.maxTurns, nowUtc });
  const previous = preferred || conversations[0] || null;
  const mode = previous ? "ROTATED" : "CREATED";
  return assignment(mode, { conversation: previous, affinityKey: config.affinityKey, maxTurns: config.maxTurns, nowUtc, provider: config.provider, task, mission, policy });
}

export function applyAgentConversationUseV1(conversationInput = {}, commandInput = {}) {
  const conversation = normalizeConversation(conversationInput);
  const command = object(commandInput);
  const nowUtc = timestamp(command.now_utc ?? command.nowUtc) || conversation.updated_at_utc || conversation.created_at_utc;
  const externalRef = text(command.external_conversation_ref ?? command.externalConversationRef)
    || text(command.thread_id ?? command.threadId)
    || conversation.external_conversation_ref;
  return {
    ...conversation,
    external_conversation_ref: externalRef,
    turn_count: boundedInteger(command.turn_count ?? command.turnCount, conversation.turn_count, 0, 100000),
    last_used_at_utc: nowUtc,
    metadata: { ...conversation.metadata, ...object(command.metadata) },
    updated_at_utc: nowUtc,
  };
}

function assignment(mode, context) {
  const nowUtc = context.nowUtc || null;
  const conversation = context.conversation || null;
  const resumedConversation = mode === "RESUMED"
    ? applyAgentConversationUseV1(conversation, { turn_count: conversation.turn_count + 1, now_utc: nowUtc })
    : null;
  return {
    ok: true,
    schema_version: AGENT_CONVERSATION_ASSIGNMENT_SCHEMA_VERSION_V1,
    mode,
    provider: context.provider || conversation?.provider || "codex",
    affinity_key: context.affinityKey,
    max_turns: context.maxTurns,
    conversation_id: mode === "RESUMED" ? conversation.conversation_id : null,
    conversation: resumedConversation,
    previous_conversation_id: mode === "ROTATED" ? conversation?.conversation_id || null : null,
    next_turn_count: mode === "RESUMED" ? conversation.turn_count + 1 : 1,
    should_create_conversation: mode !== "RESUMED",
    should_rotate_previous: mode === "ROTATED",
    conversation_seed: mode === "RESUMED" ? null : conversationSeed(context),
    reasons: assignmentReasons(mode, conversation, context.policy, context.maxTurns),
    assigned_at_utc: nowUtc,
  };
}

function assignmentConfig(entity, task, mission, policy) {
  const payload = object(task.payload);
  const provider = pickText("codex", policy.provider, entity.provider);
  const maxTurns = boundedInteger(pickDefined(policy.max_turns, policy.maxTurns, entity.max_turns), DEFAULT_AGENT_CONVERSATION_MAX_TURNS_V1, 1, 1000);
  const affinityKey = pickText(null, policy.affinity_key, policy.affinityKey, entity.affinity_key)
    || buildAgentConversationAffinityKeyV1({
      provider,
      lane: pickDefined(task.lane, mission.lane),
      mission_id: pickDefined(task.mission_id, mission.mission_id, mission.agent_mission_id),
      task_type: task.task_type,
      scope_key: pickDefined(policy.scope_key, policy.scopeKey, payload.scope_key, payload.scopeKey),
    });
  return { provider, maxTurns, affinityKey };
}

function matchingConversations(conversations, task, mission, config) {
  return normalizeConversations(conversations)
    .filter((conversation) => conversationMatches(conversation, task, mission, config.provider, config.affinityKey))
    .sort(byLastUse);
}

function reusableConversation(preferred, conversations, policy, maxTurns) {
  const ordered = preferred ? [preferred, ...conversations] : conversations;
  return ordered.filter(Boolean).find((conversation) => isReusableConversation(conversation, policy, maxTurns));
}

function conversationSeed({ provider, affinityKey, task, mission, policy, nowUtc, conversation }) {
  return {
    mission_id: text(task?.mission_id ?? mission?.mission_id ?? mission?.agent_mission_id),
    provider: provider || "codex",
    external_conversation_ref: null,
    status: "OPEN",
    affinity_key: affinityKey,
    turn_count: 1,
    last_used_at_utc: nowUtc,
    metadata: {
      ...object(policy?.metadata),
      previous_conversation_id: conversation?.conversation_id || null,
      rotation_reason: conversation ? rotationReason(conversation, policy) : null,
    },
    created_at_utc: nowUtc,
    updated_at_utc: nowUtc,
  };
}

function assignmentReasons(mode, conversation, policy, maxTurns) {
  if (mode === "CREATED") return ["NO_OPEN_CONVERSATION"];
  if (mode === "RESUMED") return ["AFFINITY_MATCH"];
  return [rotationReason(conversation, policy, maxTurns)];
}

function rotationReason(conversation = {}, policy = {}, maxTurns = DEFAULT_AGENT_CONVERSATION_MAX_TURNS_V1) {
  if (conversation.turn_count >= maxTurns) return "TURN_LIMIT_REACHED";
  if (hashMismatch(conversation.metadata?.runtime_hash, policy.runtime_hash ?? policy.runtimeHash)) return "RUNTIME_HASH_CHANGED";
  if (hashMismatch(conversation.metadata?.contract_hash, policy.contract_hash ?? policy.contractHash)) return "CONTRACT_HASH_CHANGED";
  return "CONVERSATION_ROTATION_REQUIRED";
}

function isReusableConversation(conversation, policy, maxTurns) {
  return OPEN_STATUSES.has(conversation.status)
    && conversation.turn_count < maxTurns
    && !hashMismatch(conversation.metadata?.runtime_hash, policy.runtime_hash ?? policy.runtimeHash)
    && !hashMismatch(conversation.metadata?.contract_hash, policy.contract_hash ?? policy.contractHash);
}

function conversationMatches(conversation, task, mission, provider, affinityKey) {
  const missionId = text(task.mission_id ?? mission.mission_id ?? mission.agent_mission_id);
  return conversation.mission_id === missionId
    && conversation.provider === provider
    && conversation.affinity_key === affinityKey
    && OPEN_STATUSES.has(conversation.status);
}

function normalizeConversations(value) {
  return Array.isArray(value) ? value.map(normalizeConversation).filter((item) => item.conversation_id) : [];
}

function normalizeConversation(input = {}) {
  const entity = object(input);
  return {
    conversation_id: text(entity.conversation_id ?? entity.agent_conversation_id ?? entity.id),
    mission_id: text(entity.mission_id ?? entity.agent_mission_id),
    provider: text(entity.provider) || "codex",
    external_conversation_ref: text(entity.external_conversation_ref ?? entity.thread_ref),
    status: upper(entity.status) || "OPEN",
    affinity_key: text(entity.affinity_key),
    turn_count: boundedInteger(entity.turn_count, 0, 0, 100000),
    last_used_at_utc: timestamp(entity.last_used_at_utc),
    metadata: object(entity.metadata),
    created_at_utc: timestamp(entity.created_at_utc ?? entity.created_at),
    updated_at_utc: timestamp(entity.updated_at_utc ?? entity.updated_at),
  };
}

function byLastUse(left, right) {
  return Date.parse(right.last_used_at_utc || right.created_at_utc || "1970-01-01T00:00:00.000Z")
    - Date.parse(left.last_used_at_utc || left.created_at_utc || "1970-01-01T00:00:00.000Z");
}

function hashMismatch(left, right) {
  return Boolean(text(left) && text(right) && text(left) !== text(right));
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function safeKeyPart(value) {
  return lower(value).replace(/[^a-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "") || "none";
}

function timestamp(value) {
  const normalized = text(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? new Date(Date.parse(normalized)).toISOString() : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickText(fallback, ...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return fallback;
}

function pickDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function upper(value) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
