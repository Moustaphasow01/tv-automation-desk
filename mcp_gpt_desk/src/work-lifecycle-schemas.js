import { z } from "zod";
import { gptTelemetrySchema } from "./gpt-telemetry.js";

const replayWorkflowSchema = z.enum(["REPLAY_MASTER", "REPLAY_MONITOR"]);

export const claimNextReplaySchema = z.object({
  worker_id: z.string().min(3).max(120),
  backtest_id: z.string().min(3).optional(),
  workflows: z.array(replayWorkflowSchema).min(1).max(2).default(["REPLAY_MASTER", "REPLAY_MONITOR"]),
  lease_seconds: z.number().int().min(120).max(1800).default(720),
}).strict();

const replayLeaseShape = {
  work_item_id: z.string().min(3),
  worker_id: z.string().min(3).max(120),
  lease_token: z.string().min(8),
};

export const heartbeatReplaySchema = z.object({
  ...replayLeaseShape,
  lease_seconds: z.number().int().min(120).max(1800).default(720),
}).strict();

export const completeReplaySchema = z.object({
  ...replayLeaseShape,
  output_ref: z.record(z.any()).optional(),
  telemetry: gptTelemetrySchema.optional(),
}).strict();

export const failReplaySchema = z.object({
  ...replayLeaseShape,
  error_code: z.string().min(2).max(120),
  error_message: z.string().min(1).max(2000),
  retryable: z.boolean().default(true),
}).strict();
