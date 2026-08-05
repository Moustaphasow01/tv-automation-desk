import { z } from "zod";
import { gptTelemetrySchema } from "./gpt-telemetry.js";

const deskWorkflowSchema = z.enum([
  "LIVE_MASTER",
  "LIVE_M15_MONITOR",
  "REPLAY_MASTER",
  "REPLAY_MONITOR",
]);

export const claimNextLiveWorkSchema = z.object({
  worker_id: z.string().min(3).max(120),
  session: z.enum(["asia_open", "ny_open"]).optional(),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lease_seconds: z.number().int().min(120).max(840).default(660),
  retry_attempts: z.number().int().min(1).max(3).default(3),
  retry_delay_seconds: z.number().int().min(30).max(60).default(60),
}).strict();

export const claimNextReplayWorkSchema = z.object({
  worker_id: z.string().min(3).max(120),
  backtest_id: z.string().min(3).optional(),
  lease_seconds: z.number().int().min(120).max(1800).default(720),
}).strict();

export const claimNextDeskWorkSchema = z.object({
  worker_id: z.string().min(3).max(120),
  workflows: z.array(deskWorkflowSchema).min(1).max(4)
    .default(["LIVE_MASTER", "LIVE_M15_MONITOR", "REPLAY_MASTER", "REPLAY_MONITOR"]),
  session: z.enum(["asia_open", "ny_open"]).optional(),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  backtest_id: z.string().min(3).optional(),
  lease_seconds: z.number().int().min(120).max(1800).default(660),
}).strict().superRefine((value, ctx) => {
  const selectedLive = value.workflows.filter((workflow) => workflow.startsWith("LIVE_"));
  if (selectedLive.length === 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["workflows"],
      message: "LIVE workflows are cursor-managed and must be selected together.",
    });
  }
});

const commonLeaseShape = {
  worker_id: z.string().min(3).max(120),
  lease_token: z.string().min(8),
};

const liveLeaseShape = {
  ...commonLeaseShape,
  cursor_id: z.string().min(3),
  checkpoint: z.string().datetime({ offset: true }),
};

const replayLeaseShape = {
  ...commonLeaseShape,
  work_item_id: z.string().min(3),
};

export const heartbeatDeskWorkSchema = z.union([
  z.object({ ...liveLeaseShape }).strict(),
  z.object({
    ...replayLeaseShape,
    lease_seconds: z.number().int().min(120).max(1800).default(720),
  }).strict(),
]);

export const completeDeskWorkSchema = z.union([
  z.object({
    ...liveLeaseShape,
    telemetry: gptTelemetrySchema.optional(),
  }).strict(),
  z.object({
    ...replayLeaseShape,
    output_ref: z.record(z.any()).optional(),
    telemetry: gptTelemetrySchema.optional(),
  }).strict(),
]);

export const failDeskWorkSchema = z.union([
  z.object({
    ...liveLeaseShape,
    error_code: z.string().min(1).max(120),
    error_message: z.string().min(1).max(2000),
    error_class: z.enum(["transient", "deterministic"]).optional(),
    retryable: z.boolean().optional(),
  }).strict(),
  z.object({
    ...replayLeaseShape,
    error_code: z.string().min(2).max(120),
    error_message: z.string().min(1).max(2000),
    retryable: z.boolean().default(true),
  }).strict(),
]);
