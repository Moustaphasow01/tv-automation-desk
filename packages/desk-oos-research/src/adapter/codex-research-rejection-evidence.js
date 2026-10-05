import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { requireResearch } from '../domain/research-evidence.js';
import { MODEL_REJECTION_VERSION, validateModelRejection } from '../domain/research-model-rejection.js';

/** Reads only explicitly identified existing session traces, never auth/config files. */
export function codexResearchRejectionEvidence({ sessions_root, fingerprint }) {
  return async ({ source_path, source_sha256, requested, requested_at }) => {
    const root = await realpath(sessions_root), file = await realpath(source_path);
    const relative = path.relative(root, file);
    requireResearch(!relative.startsWith('..') && !path.isAbsolute(relative)
      && /^rollout-[a-zA-Z0-9-]+\.jsonl$/.test(path.basename(file)), 'RESEARCH_REJECTION_SOURCE_FORBIDDEN');
    requireResearch((await stat(file)).size <= 10000000, 'RESEARCH_REJECTION_SOURCE_TOO_LARGE');
    const raw = await readFile(file);
    requireResearch(fingerprint(raw) === source_sha256, 'RESEARCH_REJECTION_SOURCE_HASH_MISMATCH');
    const rows = raw.toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    return verifyTrace({ rows, requested, requested_at, source_path: file, source_sha256, fingerprint });
  };
}

function verifyTrace({ rows, requested, requested_at, source_path, source_sha256, fingerprint }) {
  const { start, end, completed_at } = verifyTerminalRefusal(rows);
  const at = Date.parse(requested_at);
  requireResearch(Number.isFinite(at) && start >= at && start - at <= 60000 && end >= start,
    'RESEARCH_PROVIDER_REJECTION_LINKAGE_FAILED');
  const marker = '\n\nUNTRUSTED_PERSISTED_EVIDENCE_JSON:\n';
  const texts = rows.filter(r => r.type === 'response_item' && r.payload.role === 'user')
    .flatMap(r => r.payload.content.map(c => c.text ?? '')).filter(t => t.includes(marker));
  requireResearch(texts.length === 1, 'RESEARCH_PROVIDER_REJECTION_LINKAGE_FAILED');
  const text = texts[0], offset = text.indexOf(marker);
  const turns = rows.filter(r => r.type === 'turn_context');
  requireResearch(turns.length === 1 && turns[0].payload.model === requested.model.identifier
    && turns[0].payload.effort === requested.model.reasoning_effort, 'RESEARCH_MODEL_DRIFT');
  return validateModelRejection({ requested, proof: { validation_version: MODEL_REJECTION_VERSION,
    request_id: requested.request_id, source_path, source_sha256,
    prompt_sha256: fingerprint(text.slice(0, offset)), context_sha256: fingerprint(text.slice(offset + marker.length)),
    model_identifier: turns[0].payload.model, reasoning_effort: turns[0].payload.effort,
    reason: 'server_overloaded', assistant_responses: 0, token_information: 'ABSENT', maximum_retries: 1,
    completed_at, classification: 'DERIVED_LOCAL' } });
}

function verifyTerminalRefusal(rows) {
  const starts = rows.filter(r => r.type === 'event_msg' && r.payload.type === 'task_started');
  const ends = rows.filter(r => r.type === 'event_msg' && r.payload.type === 'task_complete');
  requireResearch(starts.length === 1 && ends.length === 1
    && starts[0].payload.turn_id === ends[0].payload.turn_id
    && ends[0].payload.error?.codex_error_info === 'server_overloaded'
    && !ends[0].payload.last_agent_message, 'RESEARCH_PROVIDER_REJECTION_UNPROVEN');
  const assistant = rows.filter(r => r.type === 'response_item' && r.payload.role === 'assistant');
  requireResearch(assistant.length === 0 && rows.filter(r => r.payload?.type === 'token_count')
    .every(r => r.payload.info === null), 'RESEARCH_PROVIDER_REJECTION_UNPROVEN');
  return { start: Date.parse(starts[0].timestamp), end: Date.parse(ends[0].timestamp), completed_at: ends[0].timestamp };
}
