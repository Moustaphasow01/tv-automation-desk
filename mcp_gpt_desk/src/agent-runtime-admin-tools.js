import { z } from "zod";
import { createAgentRuntimeAdminService } from "./agent-runtime-admin-service.js";
import { createAgentRuntimeSchedulerService } from "./agent-runtime-scheduler-service.js";

const uuidSchema = z.string().uuid();
const limitSchema = z.number().int().min(1).max(500).default(50);
const taskStatusSchema = z.enum(["PENDING", "READY", "CLAIMED", "RUNNING", "WAITING_DEPENDENCY", "DONE", "ERROR", "CANCELLED", "EXPIRED"]);
const metricOutcomeSchema = z.enum(["COMPLETED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "DEAD_LETTERED", "CANCELLED"]);
const deadLetterStatusSchema = z.enum(["OPEN", "REQUEUED", "CANCELLED", "RESOLVED"]);
const mutationFields = {
  operator_id: z.string().min(3).max(120),
  reason: z.string().min(8).max(1000),
  idempotency_key: z.string().min(8).max(200),
};

const listTasksSchema = z.object({
  lane: z.string().min(1).max(80).optional(),
  status: taskStatusSchema.optional(),
  mission_id: uuidSchema.optional(),
  limit: limitSchema,
}).strict();
const getTaskSchema = z.object({
  task_id: uuidSchema,
  include_payload: z.boolean().default(false),
}).strict();
const listDeadLettersSchema = z.object({
  lane: z.string().min(1).max(80).optional(),
  status: deadLetterStatusSchema.optional(),
  limit: limitSchema,
}).strict();
const listMetricsSchema = z.object({
  lane: z.string().min(1).max(80).optional(),
  outcome: metricOutcomeSchema.optional(),
  task_id: uuidSchema.optional(),
  mission_id: uuidSchema.optional(),
  limit: limitSchema,
}).strict();
const poolOverviewSchema = z.object({
  lane: z.string().min(1).max(80).optional(),
  metrics_window_minutes: z.number().int().min(5).max(1440).default(60),
  policy: z.record(z.unknown()).optional(),
}).strict();
const schedulerPlanSchema = z.object({
  lane: z.string().min(1).max(80).optional(),
  task_key_prefix: z.string().min(1).max(160).optional(),
  limit: limitSchema,
  policy: z.record(z.unknown()).optional(),
}).strict();
const requeueDeadLetterSchema = z.object({
  dead_letter_id: uuidSchema,
  ...mutationFields,
}).strict();
const cancelTaskSchema = z.object({
  task_id: uuidSchema,
  ...mutationFields,
}).strict();

export function createAgentRuntimeAdminToolDefinitions(store) {
  const service = createAgentRuntimeAdminService({ persistence: store.persistence, clock: store.clock });
  const scheduler = createAgentRuntimeSchedulerService({ persistence: store.persistence, clock: store.clock });
  return [
    adminReadTool("get_agent_runtime_overview", "Get Agent Runtime admin overview", "Returns runtime task, DLQ and metrics summary without lease secrets.", listTasksSchema, overviewInputSchema(), (args) => service.getOverview(args)),
    adminReadTool("list_agent_runtime_tasks", "List Agent Runtime tasks", "Lists durable agent tasks with lease status but never the lease token.", listTasksSchema, listTasksInputSchema(), (args) => service.listTasks(args)),
    adminReadTool("get_agent_runtime_task", "Get Agent Runtime task", "Reads one durable agent task. Full payload is opt-in.", getTaskSchema, getTaskInputSchema(), (args) => service.getTask(args)),
    adminReadTool("list_agent_runtime_dead_letters", "List Agent Runtime dead letters", "Lists agent runtime DLQ entries for controlled recovery.", listDeadLettersSchema, listDeadLettersInputSchema(), (args) => service.listDeadLetters(args)),
    adminReadTool("list_agent_runtime_metrics", "List Agent Runtime metrics", "Lists per-task runtime metrics: latency, outcome, model, tokens and cost.", listMetricsSchema, listMetricsInputSchema(), (args) => service.listMetrics(args)),
    adminReadTool("get_agent_runtime_pool_overview", "Get Agent Runtime pool overview", "Summarizes isolated worker pools by responsibility, lane, task status and recent runtime metrics.", poolOverviewSchema, poolOverviewInputSchema(), (args) => service.getPoolOverview(args)),
    adminReadTool("get_agent_runtime_scheduler_plan", "Get Agent Runtime scheduler plan", "Previews the Live-first scheduler and compute quota decision without claiming work.", schedulerPlanSchema, schedulerPlanInputSchema(), (args) => scheduler.previewSchedule(args)),
    adminWriteTool("requeue_agent_runtime_dead_letter", "Requeue Agent Runtime dead letter", "Creates or returns an idempotent recovery task for an OPEN dead letter.", requeueDeadLetterSchema, requeueDeadLetterInputSchema(), (args) => service.requeueDeadLetter(args)),
    adminWriteTool("cancel_agent_runtime_task", "Cancel Agent Runtime task", "Cancels a non-final agent task through the durable runtime repository.", cancelTaskSchema, cancelTaskInputSchema(), (args) => service.cancelTask(args)),
  ];
}

function adminReadTool(name, title, description, validator, inputSchema, handler) {
  return {
    name,
    title,
    description,
    annotations: { readOnlyHint: true },
    requiredScopes: ["desk.read"],
    validator,
    inputSchema,
    handler,
  };
}

function adminWriteTool(name, title, description, validator, inputSchema, handler) {
  return {
    name,
    title,
    description,
    annotations: { readOnlyHint: false },
    requiredScopes: ["desk.write"],
    validator,
    inputSchema,
    handler,
  };
}

function overviewInputSchema() {
  return {
    type: "object",
    properties: commonListProperties(),
    additionalProperties: false,
  };
}

function listTasksInputSchema() {
  return {
    type: "object",
    properties: {
      ...commonListProperties(),
      status: { type: "string", enum: taskStatusSchema.options },
      mission_id: { type: "string", format: "uuid" },
    },
    additionalProperties: false,
  };
}

function getTaskInputSchema() {
  return {
    type: "object",
    properties: {
      task_id: { type: "string", format: "uuid" },
      include_payload: { type: "boolean", default: false },
    },
    required: ["task_id"],
    additionalProperties: false,
  };
}

function listDeadLettersInputSchema() {
  return {
    type: "object",
    properties: {
      ...commonListProperties(),
      status: { type: "string", enum: deadLetterStatusSchema.options },
    },
    additionalProperties: false,
  };
}

function listMetricsInputSchema() {
  return {
    type: "object",
    properties: {
      ...commonListProperties(),
      outcome: { type: "string", enum: metricOutcomeSchema.options },
      task_id: { type: "string", format: "uuid" },
      mission_id: { type: "string", format: "uuid" },
    },
    additionalProperties: false,
  };
}

function poolOverviewInputSchema() {
  return {
    type: "object",
    properties: {
      lane: { type: "string", minLength: 1, maxLength: 80 },
      metrics_window_minutes: { type: "integer", minimum: 5, maximum: 1440, default: 60 },
      policy: { type: "object", additionalProperties: true },
    },
    additionalProperties: false,
  };
}

function schedulerPlanInputSchema() {
  return {
    type: "object",
    properties: {
      ...commonListProperties(),
      task_key_prefix: { type: "string", minLength: 1, maxLength: 160 },
      policy: { type: "object", additionalProperties: true },
    },
    additionalProperties: false,
  };
}

function requeueDeadLetterInputSchema() {
  return mutationInputSchema({ dead_letter_id: { type: "string", format: "uuid" } }, ["dead_letter_id"]);
}

function cancelTaskInputSchema() {
  return mutationInputSchema({ task_id: { type: "string", format: "uuid" } }, ["task_id"]);
}

function mutationInputSchema(properties, required) {
  return {
    type: "object",
    properties: {
      ...properties,
      operator_id: { type: "string", minLength: 3, maxLength: 120 },
      reason: { type: "string", minLength: 8, maxLength: 1000 },
      idempotency_key: { type: "string", minLength: 8, maxLength: 200 },
    },
    required: [...required, "operator_id", "reason", "idempotency_key"],
    additionalProperties: false,
  };
}

function commonListProperties() {
  return {
    lane: { type: "string", minLength: 1, maxLength: 80 },
    limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
  };
}
