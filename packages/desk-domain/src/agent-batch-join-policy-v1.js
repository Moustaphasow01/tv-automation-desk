import { canonicalSha256 } from "./execution-scope.js";

export const AGENT_BATCH_JOIN_POLICY_VERSION_V1 = "1.0.0";
export const AGENT_BATCH_JOIN_SCHEMA_VERSION_V1 = "agent_batch_join_v1";
export const AGENT_BATCH_JOIN_POLICIES_V1 = Object.freeze(["ALL", "ANY", "FIRST_SOCK", "QUORUM", "TIMEOUT_WITH_PARTIAL_RESULTS"]);
export const AGENT_BATCH_JOIN_STATUSES_V1 = Object.freeze(["WAITING", "COMPLETED", "COMPLETED_PARTIAL", "FAILED", "TIMED_OUT"]);

const DONE_STATUSES = new Set(["DONE"]);
const FAILED_STATUSES = new Set(["ERROR", "CANCELLED", "EXPIRED"]);
const OPEN_STATUSES = new Set(["PENDING", "READY", "CLAIMED", "RUNNING", "WAITING_DEPENDENCY"]);

export function evaluateAgentBatchJoinPolicyV1(input = {}) {
  const nowUtc = timestamp(input.now_utc);
  const policy = enumValue(input.policy, AGENT_BATCH_JOIN_POLICIES_V1, "TIMEOUT_WITH_PARTIAL_RESULTS");
  const tasks = normalizeTasks(input.tasks);
  const groups = groupTasks(tasks);
  const decision = decide({ policy, tasks, groups, nowUtc, input });
  const result = {
    schema_version: AGENT_BATCH_JOIN_SCHEMA_VERSION_V1,
    policy_version: AGENT_BATCH_JOIN_POLICY_VERSION_V1,
    batch_id: text(input.batch_id ?? input.id),
    policy,
    status: decision.status,
    now_utc: nowUtc,
    deadline_at_utc: timestamp(input.deadline_at_utc ?? input.deadline_at, null),
    quorum_size: quorumSize(input, tasks.length),
    counts: {
      total: tasks.length,
      done: groups.done.length,
      failed: groups.failed.length,
      open: groups.open.length,
    },
    accepted_task_ids: decision.accepted.map((task) => task.task_id),
    failed_task_ids: groups.failed.map((task) => task.task_id),
    open_task_ids: groups.open.map((task) => task.task_id),
    remaining_task_actions: decision.actions,
    reasons: decision.reasons,
    timed_out: decision.timedOut,
  };
  return { ...result, join_hash: `sha256:${canonicalSha256(result)}` };
}

function decide(context) {
  if (context.tasks.length === 0) return decision("FAILED", [], [], ["BATCH_EMPTY"]);
  if (context.policy === "ALL") return decideAll(context);
  if (context.policy === "ANY") return decideAny(context);
  if (context.policy === "FIRST_SOCK") return decideFirstSock(context);
  if (context.policy === "QUORUM") return decideQuorum(context);
  return decideTimeoutWithPartial(context);
}

function decideAll({ tasks, groups }) {
  if (groups.failed.length) return decision("FAILED", [], [], ["ALL_FAILED_TASK_PRESENT"]);
  if (groups.done.length === tasks.length) return decision("COMPLETED", groups.done, [], ["ALL_TASKS_DONE"]);
  return decision("WAITING", [], [], ["ALL_WAITING_FOR_OPEN_TASKS"]);
}

function decideAny({ tasks, groups }) {
  if (groups.done.length) return decision("COMPLETED", [firstDone(groups.done)], [], ["ANY_SUCCESS_AVAILABLE"]);
  if (groups.failed.length === tasks.length) return decision("FAILED", [], [], ["ANY_NO_SUCCESS_POSSIBLE"]);
  return decision("WAITING", [], [], ["ANY_WAITING_FOR_FIRST_SUCCESS"]);
}

function decideFirstSock({ tasks, groups }) {
  if (groups.done.length) {
    const accepted = firstDone(groups.done);
    return decision("COMPLETED", [accepted], cancelOpenTasks(tasks, accepted.task_id), ["FIRST_SOCK_SUCCESS_AVAILABLE"]);
  }
  if (groups.failed.length === tasks.length) return decision("FAILED", [], [], ["FIRST_SOCK_NO_SUCCESS_POSSIBLE"]);
  return decision("WAITING", [], [], ["FIRST_SOCK_WAITING_FOR_FIRST_SUCCESS"]);
}

function decideQuorum({ tasks, groups, input }) {
  const quorum = quorumSize(input, tasks.length);
  if (groups.done.length >= quorum) {
    const status = groups.done.length === tasks.length ? "COMPLETED" : "COMPLETED_PARTIAL";
    return decision(status, groups.done.slice(0, quorum), [], ["QUORUM_REACHED"]);
  }
  if (groups.done.length + groups.open.length < quorum) return decision("FAILED", groups.done, [], ["QUORUM_IMPOSSIBLE"]);
  return decision("WAITING", [], [], ["QUORUM_WAITING_FOR_MORE_RESULTS"]);
}

function decideTimeoutWithPartial({ tasks, groups, nowUtc, input }) {
  if (groups.done.length === tasks.length) return decision("COMPLETED", groups.done, [], ["TIMEOUT_POLICY_ALL_TASKS_DONE"]);
  if (!deadlineReached(input, nowUtc)) return decision("WAITING", [], [], ["TIMEOUT_POLICY_BEFORE_DEADLINE"]);
  if (groups.done.length) {
    return decision("COMPLETED_PARTIAL", groups.done, markOpenPartial(groups.open), ["TIMEOUT_WITH_PARTIAL_RESULTS"], true);
  }
  return decision("TIMED_OUT", [], markOpenPartial(groups.open), ["TIMEOUT_WITHOUT_RESULTS"], true);
}

function normalizeTasks(tasks) {
  return array(tasks).map((task) => ({
    task_id: text(task.task_id ?? task.id),
    task_key: text(task.task_key),
    status: String(task.status || "").trim().toUpperCase(),
    output_ref: text(task.output_ref),
    completed_at_utc: timestamp(task.completed_at_utc, null),
    created_at_utc: timestamp(task.created_at_utc ?? task.created_at, null),
  })).filter((task) => task.task_id);
}

function groupTasks(tasks) {
  return {
    done: tasks.filter((task) => DONE_STATUSES.has(task.status)).sort(byCompletion),
    failed: tasks.filter((task) => FAILED_STATUSES.has(task.status)).sort(byIdentity),
    open: tasks.filter((task) => OPEN_STATUSES.has(task.status)).sort(byIdentity),
  };
}

function cancelOpenTasks(tasks, acceptedTaskId) {
  return tasks
    .filter((task) => task.task_id !== acceptedTaskId && OPEN_STATUSES.has(task.status))
    .map((task) => ({ task_id: task.task_id, action: "MARK_SUPERSEDED", reason: "FIRST_SOCK_ACCEPTED_ANOTHER_TASK" }));
}

function markOpenPartial(tasks) {
  return tasks.map((task) => ({ task_id: task.task_id, action: "KEEP_UNFINISHED", reason: "BATCH_JOIN_TIMED_OUT" }));
}

function decision(status, accepted, actions, reasons, timedOut = false) {
  return { status, accepted, actions, reasons, timedOut };
}

function deadlineReached(input, nowUtc) {
  const deadline = timestamp(input.deadline_at_utc ?? input.deadline_at, null);
  return Boolean(deadline) && Date.parse(nowUtc) >= Date.parse(deadline);
}

function quorumSize(input, total) {
  const fallback = Math.floor(total / 2) + 1;
  const explicit = Number(input.quorum_size ?? input.quorum);
  if (!Number.isInteger(explicit)) return Math.max(1, fallback);
  return Math.max(1, Math.min(total || 1, explicit));
}

function firstDone(doneTasks) {
  return doneTasks.slice().sort(byCompletion)[0];
}

function byCompletion(left, right) {
  return String(left.completed_at_utc || left.created_at_utc || "").localeCompare(String(right.completed_at_utc || right.created_at_utc || ""))
    || byIdentity(left, right);
}

function byIdentity(left, right) {
  return String(left.task_id).localeCompare(String(right.task_id));
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || "").trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function timestamp(value, fallback = new Date(0).toISOString()) {
  const textValue = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const millis = Date.parse(textValue || "");
  return Number.isFinite(millis) ? new Date(millis).toISOString() : fallback;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
