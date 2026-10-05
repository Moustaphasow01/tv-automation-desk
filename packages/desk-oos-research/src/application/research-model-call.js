import { requireResearch } from "../domain/research-evidence.js";
import { rejectedRequestRetry } from '../domain/research-model-rejection.js';

/** Durable accounting before inference. An uncertain paid request is never silently replayed. */
export async function callResearchModel({ memory, model, fingerprint, cycle, request, requestId }) {
  const existing = await memory.listEvents(cycle.cycle_id);
  const recovery = resolveRejectedRequest({ existing, requestId, request, fingerprint });
  if (recovery) requestId = recovery.request_id;
  const delivered = existing.find(e => e.type === "MODEL_RESPONSE_RECEIVED" && e.payload.request_id === requestId);
  if (delivered) {
    requireResearch(delivered.payload.prompt_sha256 === fingerprint(request.instructions)
      && delivered.payload.context_sha256 === fingerprint(JSON.stringify(request.input)), "RESEARCH_MODEL_RESPONSE_CONTEXT_CONFLICT");
    requireResearch(delivered.payload.response.model_identifier === request.selection.identifier
      && delivered.payload.response.reasoning_effort === request.selection.reasoning_effort, 'RESEARCH_MODEL_DRIFT');
    return delivered.payload.response;
  }
  requireResearch(!existing.some(e => e.event_id === requestId), "RESEARCH_MODEL_REQUEST_INDETERMINATE", { request_id: requestId });
  const count = existing.filter(e => e.type === "MODEL_REQUESTED").length;
  const pinned = existing.find(e => e.type === "MODEL_REQUESTED")?.payload?.model;
  requireResearch(!pinned || (pinned.identifier === request.selection.identifier
    && pinned.reasoning_effort === request.selection.reasoning_effort), "RESEARCH_MODEL_DRIFT");
  requireResearch(count < cycle.definition.budget.maximum_model_calls, "RESEARCH_BUDGET_EXHAUSTED", { count });
  if(model.admission) {
    const admission=await model.admission();
    await memory.addEvent({cycle_id:cycle.cycle_id,event_id:fingerprint(`${requestId}|RESOURCE|${JSON.stringify(admission)}`),
      type:'MODEL_RESOURCE_ADMISSION',payload:{request_id:requestId,...admission}});
    requireResearch(admission.allowed,'RESEARCH_QUOTA_EXHAUSTED',{resume_at:admission.resume_at});
  }
  await memory.addEvent({ cycle_id: cycle.cycle_id, event_id: requestId, type: "MODEL_REQUESTED", payload: {
    ...(recovery ? { recovery_parent_request_id: recovery.parent_request_id, rejection_event_id: recovery.rejection_event_id } : {}),
    role: request.role, model: request.selection, prompt_sha256: fingerprint(request.instructions),
    context_sha256: fingerprint(JSON.stringify(request.input)), request_id: requestId } });
  const response = await model.analyze({ ...request, session_reuse: "FORBIDDEN", request_id: requestId });
  requireResearch(response.model_identifier === request.selection.identifier
    && response.reasoning_effort === request.selection.reasoning_effort, "RESEARCH_MODEL_TELEMETRY_MISMATCH");
  await memory.addEvent({ cycle_id: cycle.cycle_id, event_id: fingerprint(`${requestId}|RESPONSE`), type: "MODEL_RESPONSE_RECEIVED",
    payload: { request_id: requestId, prompt_sha256: fingerprint(request.instructions),
      context_sha256: fingerprint(JSON.stringify(request.input)), response } });
  return response;
}

function resolveRejectedRequest({ existing, requestId, request, fingerprint }) {
  const original = existing.find(e => e.type === 'MODEL_REQUESTED' && e.payload.request_id === requestId);
  const originalDelivered = existing.some(e => e.type === 'MODEL_RESPONSE_RECEIVED' && e.payload.request_id === requestId);
  const recovery = original && !originalDelivered
    ? rejectedRequestRetry({ events: existing, requested: original.payload, fingerprint }) : null;
  if (recovery) {
    requireResearch(original.payload.prompt_sha256 === fingerprint(request.instructions)
      && original.payload.context_sha256 === fingerprint(JSON.stringify(request.input)), 'RESEARCH_MODEL_RESPONSE_CONTEXT_CONFLICT');
    requireResearch(original.payload.model.identifier === request.selection.identifier
      && original.payload.model.reasoning_effort === request.selection.reasoning_effort, 'RESEARCH_MODEL_DRIFT');
  }
  return recovery;
}
