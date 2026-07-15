import { evaluateGates } from "@tv-automation/desk-domain";

export function evaluateAnalysisGates(analysis) {
  const executableDecision = analysis?.executable_decision || {};
  return evaluateGates({
    decision: executableDecision,
    decisionGates: analysis?.decision_gates || {},
    timeWindows: gateTimeWindows(analysis),
    decisionTimestamp: executableDecision.decision_audit?.decision_timestamp_paris || analysis?.created_at_paris,
  });
}

export function assertAnalysisGatesPass(analysis) {
  const result = evaluateAnalysisGates(analysis);
  if (result.status === "rejected") {
    throw new Error(`decision_gate_rejected:${result.reasons.join(",")}`);
  }
  if (result.status === "review_required") {
    throw new Error(`decision_gate_review_required:${result.reasons.join(",")}`);
  }
  return result;
}

function gateTimeWindows(analysis) {
  if (!Array.isArray(analysis?.session_matrix)) return [];
  return analysis.session_matrix
    .filter((row) => row && typeof row === "object")
    .filter((row) => row.status || row.entry_status || row.new_entries_allowed === false)
    .map((row) => ({
      id: row.id || row.day || row.name,
      status: row.status || row.entry_status,
      start: row.start_paris || row.start,
      end: row.end_paris || row.end,
      new_entries_allowed: row.new_entries_allowed,
    }));
}
