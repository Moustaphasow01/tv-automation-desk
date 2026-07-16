import { SystemClock } from "@tv-automation/desk-time";
import { sanitizeId } from "./desk-replay-orchestration-algorithms.js";

export function documentTimestampUtc(doc) {
  const value = doc.as_of_utc || doc.cutoff_utc || doc.timestamp_utc || doc.cutoff_paris || doc.timestamp_paris || doc.valid_from || doc.created_at_paris || doc.created_at_utc || doc.saved_at_utc || doc.updated_at_utc || doc.created_at || doc.updated_at;
  if (!value) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function isDocumentAtOrBefore(doc, asOfUtc) {
  if (!asOfUtc) return true;
  const documentMs = Date.parse(documentTimestampUtc(doc));
  const asOfMs = Date.parse(asOfUtc);
  return Number.isFinite(documentMs) && Number.isFinite(asOfMs) && documentMs <= asOfMs;
}

export function stableLocalId(prefix, date, session, tick = new SystemClock().now(), runId = null) {
  const stamp = tick.utc.replace(/[-:.TZ]/g, "").slice(0, 14);
  const scopedSession = runId ? `${session || "session"}_${runId}` : session || "session";
  return `${prefix}_${sanitizeId(scopedSession)}_${date || "date"}_${stamp}`;
}

export function normalizeDeskAnalysis(analysis) {
  const executive = analysis.executive_summary || {};
  return {
    ...analysis,
    summary: analysis.summary || executive.summary,
    primary_setup_id: analysis.primary_setup_id || executive.primary_setup_id,
    final_decision: analysis.final_decision || executive.final_decision,
    final_instrument: analysis.final_instrument || executive.final_instrument,
    final_direction: analysis.final_direction || executive.final_direction,
  };
}

export function filterSetupDocs(docs, { pack_id, analysis_id, decision_id, status = "any", primary_only = false, limit = 50 } = {}) {
  const filtered = (docs || [])
    .filter((setup) => !pack_id || setup.pack_id === pack_id)
    .filter((setup) => !analysis_id || setup.analysis_id === analysis_id)
    .filter((setup) => !decision_id || setup.decision_id === decision_id)
    .filter((setup) => !primary_only || setup.is_primary === true)
    .filter((setup) => status === "any" || setup.lifecycle_status === status || setup.status === status)
    .sort((left, right) => {
      const leftDate = String(left.saved_at || left.created_at || "");
      const rightDate = String(right.saved_at || right.created_at || "");
      if (leftDate !== rightDate) {
        return rightDate.localeCompare(leftDate);
      }
      return Number(left.priority || 999) - Number(right.priority || 999);
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
  return {
    ok: true,
    count: filtered.length,
    filters: {
      pack_id: pack_id || null,
      analysis_id: analysis_id || null,
      decision_id: decision_id || null,
      status,
      primary_only: Boolean(primary_only),
    },
    setups: filtered,
  };
}

export function stripDeskWorkLease(value = {}) {
  const { work_item_id: _workItemId, worker_id: _workerId, lease_token: _leaseToken, ...payload } = value;
  return payload;
}
