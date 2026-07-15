import { z } from "zod";

export const claimNextLiveSchema = z.object({
  worker_id: z.string().min(3).max(120),
  session: z.enum(["asia_open", "ny_open"]),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lease_seconds: z.number().int().min(120).max(840).default(660),
}).strict();

const liveCursorLeaseShape = {
  worker_id: z.string().min(3).max(120),
  cursor_id: z.string().min(3),
  checkpoint: z.string().datetime({ offset: true }),
  lease_token: z.string().min(8),
};

export const heartbeatLiveSchema = z.object({
  ...liveCursorLeaseShape,
}).strict();

export const completeLiveSchema = z.object({
  ...liveCursorLeaseShape,
}).strict();

export const failLiveSchema = z.object({
  ...liveCursorLeaseShape,
  error_code: z.string().min(1),
  error_message: z.string().min(1),
  error_class: z.enum(["transient", "deterministic"]),
}).strict();
