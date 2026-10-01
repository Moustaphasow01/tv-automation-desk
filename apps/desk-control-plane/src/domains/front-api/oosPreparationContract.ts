export type OosPreparationDay = {
  date: string; state: string; checkpoint: string; capture_count: number; manifest_sha256: string | null;
  plan_sha256: string | null; replay_status: string; queue_status: string; updated_at: string; error: { code: string } | null;
};
export type OosPreparation = {
  archive_batch_id: string; batch_id: string | null; start_date: string; end_date: string; status: string; observed_at?: string;
  total_days: number; queued: number; ready: number; failed: number; completed: number; premarket_ready: number;
  next_waiting_scenario: string | null; concurrency: number; current_queue: string[]; skipped_dates: string[];
  batches: { batch_id: string; status: string; start_date: string; end_date: string }[]; days: OosPreparationDay[];
};
export type PreparationRequest = { date: string } | { start_date: string; end_date: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string";
const hash = (v: unknown) => v === null || (text(v) && /^[a-f0-9]{64}$/.test(v));
export function isPreparationDay(v: unknown): v is OosPreparationDay {
  return record(v) && ["date", "state", "checkpoint", "replay_status", "queue_status", "updated_at"].every(k => text(v[k]))
    && number(v.capture_count) && v.capture_count <= 8 && hash(v.manifest_sha256) && hash(v.plan_sha256)
    && (v.error === null || (record(v.error) && text(v.error.code)));
}
export function isPreparation(v: unknown): v is OosPreparation {
  return record(v) && ["archive_batch_id", "start_date", "end_date", "status"].every(k => text(v[k]))
    && (v.batch_id === null || text(v.batch_id)) && (v.next_waiting_scenario === null || text(v.next_waiting_scenario))
    && ["total_days", "queued", "ready", "failed", "completed", "premarket_ready", "concurrency"].every(k => number(v[k]))
    && Array.isArray(v.days) && v.days.every(isPreparationDay)
    && [v.current_queue, v.skipped_dates].every(a => Array.isArray(a) && a.every(text))
    && Array.isArray(v.batches) && v.batches.every(b => record(b) && ["batch_id", "status", "start_date", "end_date"].every(k => text(b[k])));
}
