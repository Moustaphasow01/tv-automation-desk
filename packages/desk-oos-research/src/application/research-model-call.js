import { requireResearch } from "../domain/research-evidence.js";

/** Durable accounting before inference. An uncertain paid request is never silently replayed. */
export async function callResearchModel({ memory, model, fingerprint, cycle, request, requestId }) {
  const existing = await memory.listEvents(cycle.cycle_id);
  requireResearch(!existing.some(e => e.event_id === requestId), "RESEARCH_MODEL_REQUEST_INDETERMINATE", { request_id: requestId });
  const count = existing.filter(e => e.type === "MODEL_REQUESTED").length;
  const pinned = existing.find(e => e.type === "MODEL_REQUESTED")?.payload?.model;
  requireResearch(!pinned || (pinned.identifier === request.selection.identifier
    && pinned.reasoning_effort === request.selection.reasoning_effort), "RESEARCH_MODEL_DRIFT");
  requireResearch(count < cycle.definition.budget.maximum_model_calls, "RESEARCH_BUDGET_EXHAUSTED", { count });
  await memory.addEvent({ cycle_id: cycle.cycle_id, event_id: requestId, type: "MODEL_REQUESTED", payload: {
    role: request.role, model: request.selection, prompt_sha256: fingerprint(request.instructions),
    context_sha256: fingerprint(JSON.stringify(request.input)), request_id: requestId } });
  const response = await model.analyze({ ...request, session_reuse: "FORBIDDEN", request_id: requestId });
  requireResearch(response.model_identifier === request.selection.identifier
    && response.reasoning_effort === request.selection.reasoning_effort, "RESEARCH_MODEL_TELEMETRY_MISMATCH");
  return response;
}
