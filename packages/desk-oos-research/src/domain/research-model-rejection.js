import { requireResearch } from './research-evidence.js';

export const MODEL_REJECTION_VERSION = 'RESEARCH_MODEL_REJECTION_V1';

/** A terminal provider refusal is distinct from an interrupted/uncertain inference. */
export function validateModelRejection({ proof, requested }) {
  requireResearch(proof?.validation_version === MODEL_REJECTION_VERSION
    && proof.reason === 'server_overloaded' && proof.assistant_responses === 0
    && proof.token_information === 'ABSENT' && proof.maximum_retries === 1
    && /^[a-f0-9]{64}$/.test(proof.source_sha256 ?? '')
    && typeof proof.source_path === 'string' && proof.source_path.length > 0,
  'RESEARCH_PROVIDER_REJECTION_UNPROVEN');
  requireResearch(proof.request_id === requested.request_id
    && proof.prompt_sha256 === requested.prompt_sha256
    && proof.context_sha256 === requested.context_sha256
    && proof.model_identifier === requested.model.identifier
    && proof.reasoning_effort === requested.model.reasoning_effort,
  'RESEARCH_PROVIDER_REJECTION_LINKAGE_FAILED');
  return proof;
}

export function rejectedRequestRetry({ events, requested, fingerprint }) {
  const receipt = events.find(e => e.type === 'MODEL_REJECTION_VERIFIED'
    && e.payload.request_id === requested.request_id);
  if (!receipt) return null;
  const proof = validateModelRejection({ proof: receipt.payload, requested });
  return { request_id: fingerprint(`${requested.request_id}|VERIFIED_REJECTION_RETRY|${receipt.event_id}`),
    parent_request_id: requested.request_id, rejection_event_id: receipt.event_id,
    validation_version: MODEL_REJECTION_VERSION, source_sha256: proof.source_sha256 };
}
