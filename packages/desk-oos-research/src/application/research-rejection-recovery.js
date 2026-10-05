import { requireResearch } from '../domain/research-evidence.js';
import { rejectedRequestRetry } from '../domain/research-model-rejection.js';

/** Operator evidence intake; no model, queue mutation or historical-data port. */
export async function recordResearchRejection({ memory, readEvidence, fingerprint, command }) {
  return memory.executeExclusive(command.cycle_id, async () => {
    const events = await memory.listEvents(command.cycle_id);
    const requested = events.find(e => e.type === 'MODEL_REQUESTED' && e.payload.request_id === command.request_id);
    requireResearch(requested && !events.some(e => e.type === 'MODEL_RESPONSE_RECEIVED'
      && e.payload.request_id === command.request_id), 'RESEARCH_REJECTION_NOT_APPLICABLE');
    const proof = await readEvidence({ ...command, requested: requested.payload, requested_at: requested.created_at });
    await memory.addEvent({ cycle_id: command.cycle_id,
      event_id: fingerprint(`${command.request_id}|REJECTION|${proof.source_sha256}`),
      type: 'MODEL_REJECTION_VERIFIED', payload: proof });
    return proof;
  });
}

export async function assessRejectedRequestRecovery({ memory, fingerprint, cycle_id }) {
  const events = await memory.listEvents(cycle_id);
  const requested = events.filter(e => e.type === 'MODEL_REQUESTED').at(-1);
  requireResearch(requested && !events.some(e => e.type === 'MODEL_RESPONSE_RECEIVED'
    && e.payload.request_id === requested.payload.request_id), 'RESEARCH_REJECTION_NOT_APPLICABLE');
  const retry = rejectedRequestRetry({ events, requested: requested.payload, fingerprint });
  requireResearch(retry, 'RESEARCH_PROVIDER_REJECTION_UNPROVEN');
  return { ...retry, retry_request_id: retry.request_id, request_id: requested.payload.request_id, new_model_calls: 0 };
}
