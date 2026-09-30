export type OosAction = "capture" | "retry-capture" | "scenario" | "replay" | "retry" | "new-plan" | "run";
export type OosDay = {
  batch_id: string; day: string; state: string; checkpoint: string; capture_count: number;
  definition: { symbol: string; cutoff: string; date: string }; updated_at: string;
  plan_sha256: string | null; manifest_sha256: string | null; candidate_attempt: number;
  allowed_actions: OosAction[]; metrics: Record<string, number | null>;
  error: { code: string } | null; audit: Record<string, unknown> | null;
};
export type OosMetric = { observed_days: number; total_days: number; sum: number | null; mean: number | null; median: number | null };
export type OosOverview = { days: OosDay[]; can_write: boolean; observed_at: string; stats: { days: number; completed: number; metrics: Record<string, OosMetric> } };
export type OosDetail = { day: OosDay; artifacts: string[]; plan_text: string | null; timeline: { revision: number; state: string; occurred_at: string; error: { code: string } | null }[] };
export type OosReceipt = { command_id: string; status: "QUEUED" | "RUNNING" | "COMPLETED"; completed_days: number; total_days: number; receipts: { date: string; state: string; error: { code: string } | null }[] };
export type OosRequest = { batch_id: string; symbol: string; cutoff_time: string; date?: string; month?: string; from?: string; to?: string; action: OosAction };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const STATES = new Set(["NEW", "CAPTURING", "PREMARKET_READY", "WAITING_SCENARIO", "PLAN_RECEIVED", "VALIDATING_PLAN", "FROZEN", "REPLAYING", "CAPTURING_RESULTS", "COMPLETED", "FAILED_TECHNICAL", "FAILED_PLAN_VALIDATION"]);
export function isOosDay(v: unknown): v is OosDay {
  return record(v) && text(v.batch_id) && text(v.day) && text(v.state) && STATES.has(v.state)
    && text(v.checkpoint) && number(v.capture_count) && number(v.candidate_attempt) && text(v.updated_at)
    && record(v.definition) && text(v.definition.symbol) && text(v.definition.cutoff) && text(v.definition.date)
    && Array.isArray(v.allowed_actions) && v.allowed_actions.every(a => ["capture", "retry-capture", "scenario", "replay", "retry", "new-plan"].includes(a))
    && record(v.metrics) && Object.values(v.metrics).every(n => n === null || number(n))
    && [v.plan_sha256, v.manifest_sha256].every(h => h === null || (text(h) && /^[a-f0-9]{64}$/.test(h)))
    && (v.error === null || (record(v.error) && text(v.error.code))) && (v.audit === null || record(v.audit));
}
export function isOosOverview(v: unknown): v is OosOverview {
  return record(v) && Array.isArray(v.days) && v.days.every(isOosDay) && text(v.observed_at) && typeof v.can_write === "boolean"
    && record(v.stats) && number(v.stats.days) && number(v.stats.completed) && record(v.stats.metrics)
    && Object.values(v.stats.metrics).every(m => record(m) && number(m.observed_days) && number(m.total_days)
      && [m.sum, m.mean, m.median].every(n => n === null || number(n)));
}
export function isOosDetail(v: unknown): v is OosDetail {
  return record(v) && isOosDay(v.day) && Array.isArray(v.artifacts) && v.artifacts.every(text)
    && (v.plan_text === null || text(v.plan_text)) && Array.isArray(v.timeline)
    && v.timeline.every(e => record(e) && number(Number(e.revision)) && text(e.state) && text(e.occurred_at)
      && (e.error === null || (record(e.error) && text(e.error.code))));
}
export function isOosReceipt(v: unknown): v is OosReceipt {
  return record(v) && text(v.command_id) && ["QUEUED", "RUNNING", "COMPLETED"].includes(String(v.status))
    && number(v.completed_days) && number(v.total_days) && Array.isArray(v.receipts)
    && v.receipts.every(r => record(r) && text(r.date) && text(r.state) && (r.error === null || (record(r.error) && text(r.error.code))));
}
