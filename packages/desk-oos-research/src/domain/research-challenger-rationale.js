import { requireResearch } from './research-evidence.js';
import { researchCanonicalJson } from './research-canonical-json.js';

const FIELDS = ['analyst_rationale','market_thesis','scenario_purpose','why_this_level','why_this_confirmation',
  'why_this_entry','why_this_stop','why_this_target','alternative_branch_considered','invalidation_logic'];

/** A prerequisite for future RESEARCH challengers, never a reconstruction of historical intent. */
export function freezeChallengerRationale({ rationale, fingerprint }) {
  requireResearch(rationale?.workflow_owner === 'RESEARCH_CHALLENGER', 'RESEARCH_RATIONALE_OWNER_INVALID');
  requireResearch(FIELDS.every(k => typeof rationale[k] === 'string' && rationale[k].trim()), 'RESEARCH_RATIONALE_REQUIRED');
  requireResearch(typeof rationale.version === 'string' && rationale.version && typeof rationale.parent === 'string'
    && rationale.parent && typeof rationale.experiment_id === 'string' && rationale.experiment_id, 'RESEARCH_RATIONALE_IDENTITY_REQUIRED');
  requireResearch(['LOW','MEDIUM','HIGH','UNKNOWN'].includes(rationale.confidence), 'RESEARCH_RATIONALE_CONFIDENCE_INVALID');
  requireResearch(Array.isArray(rationale.input_refs) && rationale.input_refs.length > 0
    && rationale.input_refs.every(r => typeof r === 'string' && r.trim()), 'RESEARCH_RATIONALE_PROVENANCE_REQUIRED');
  const original = JSON.parse(JSON.stringify(rationale));
  return { original, rationale_sha256: fingerprint(researchCanonicalJson(original)),
    schema_version: 'RESEARCH_CHALLENGER_RATIONALE_V1', historical_rationale_inferred: false };
}
