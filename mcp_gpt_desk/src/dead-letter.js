export const DEAD_LETTER_SCOPES = Object.freeze(["live", "replay"]);
export const DEAD_LETTER_WORKFLOWS = Object.freeze([
  "LIVE_MASTER",
  "LIVE_M15_MONITOR",
  "REPLAY_MASTER",
  "REPLAY_MONITOR",
]);
export const DEAD_LETTER_ERROR_CLASSES = Object.freeze(["deterministic", "transient_exhausted"]);

export function buildWorkDeadLetter({
  scope,
  source_ref = {},
  workflow,
  error,
  attempt_count,
  context_snapshot = {},
}, tick) {
  assertEnum(scope, DEAD_LETTER_SCOPES, "DEAD_LETTER_SCOPE_INVALID");
  assertEnum(workflow, DEAD_LETTER_WORKFLOWS, "DEAD_LETTER_WORKFLOW_INVALID");
  assertEnum(error?.class, DEAD_LETTER_ERROR_CLASSES, "DEAD_LETTER_ERROR_CLASS_INVALID");
  const runRef = scope === "live" ? source_ref.run_id : source_ref.backtest_id;
  const checkpointRef = scope === "live" ? source_ref.checkpoint : source_ref.step_id;
  if (!runRef || !checkpointRef) throw new Error("DEAD_LETTER_SOURCE_REF_INCOMPLETE");
  const deadLetterId = `dlq__${scope}__${safeIdPart(runRef)}__${safeIdPart(checkpointRef)}`;
  return {
    dead_letter_id: deadLetterId,
    scope,
    source_ref: {
      cursor_id: source_ref.cursor_id || null,
      work_item_id: source_ref.work_item_id || null,
      run_id: source_ref.run_id || null,
      checkpoint: source_ref.checkpoint || null,
      step_id: source_ref.step_id || null,
    },
    workflow,
    error: {
      code: requiredText(error?.code, "DEAD_LETTER_ERROR_CODE_REQUIRED"),
      message: requiredText(error?.message, "DEAD_LETTER_ERROR_MESSAGE_REQUIRED"),
      class: error.class,
      occurred_at_utc: requiredText(error?.occurred_at_utc || tick?.utc, "DEAD_LETTER_OCCURRED_AT_REQUIRED"),
    },
    attempt_count: nonNegativeInteger(attempt_count, "DEAD_LETTER_ATTEMPT_COUNT_INVALID"),
    context_snapshot: { ...context_snapshot },
    created_at_utc: requiredText(tick?.utc, "DEAD_LETTER_CREATED_AT_REQUIRED"),
  };
}

function safeIdPart(value) {
  return String(value).replaceAll("/", "_");
}

function requiredText(value, code) {
  const text = String(value || "").trim();
  if (!text) throw new Error(code);
  return text;
}

function nonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(code);
  return number;
}

function assertEnum(value, allowed, code) {
  if (!allowed.includes(value)) throw new Error(code);
}
