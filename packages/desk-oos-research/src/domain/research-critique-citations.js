import { requireResearch } from './research-evidence.js';
import { researchCanonicalJson } from './research-canonical-json.js';

export const CRITIQUE_CITATION_VERSION = 'RESEARCH_CRITIQUE_CITATIONS_V2';

/** Research-document references are not promoted to facts about the market. */
export function critiqueCitationCatalog({ audit, review, fingerprint }) {
  requireResearch(fingerprint(researchCanonicalJson(review.payload)) === review.payload_hash,
    'RESEARCH_REVIEW_HASH_MISMATCH');
  const sources = [...audit.evidence_refs, ...(review.payload.visual_evidence ?? []).map(i => i.provenance_ref)];
  const catalog = [...new Set(sources)].map(ref => ({ ref, source_ref: ref, classification: 'CITED_SOURCE' }));
  appendDocument(catalog, 'audit', audit, fingerprint(researchCanonicalJson(audit)), 'DERIVED_LOCAL');
  appendDocument(catalog, 'review', review.payload, review.payload_hash, 'RESEARCH_INTERPRETATION');
  for (const key of Object.keys(review.payload.result ?? {})) {
    catalog.push({ ref: `review.result.${key}`, source_sha256: review.payload_hash,
      source_pointer: `/result/${key}`, classification: 'RESEARCH_INTERPRETATION' });
  }
  catalog.push({ ref: review.payload_hash, source_sha256: review.payload_hash,
    source_pointer: '', classification: 'RESEARCH_INTERPRETATION' });
  return catalog;
}

function appendDocument(catalog, name, document, hash, classification) {
  catalog.push({ ref: name, source_sha256: hash, source_pointer: '', classification });
  for (const key of Object.keys(document)) {
    catalog.push({ ref: `${name}.${key}`, source_sha256: hash,
      source_pointer: `/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, classification });
  }
}

/** Only fields actually supplied to the hypothesis critic may be cited. */
export function hypothesisCitationCatalog({ hypothesis, cases, fingerprint }) {
  const documents = [{ name: 'hypothesis', row: hypothesis, classification: 'RESEARCH_HYPOTHESIS' },
    ...cases.map((row, index) => ({ name: `cases[${index}]`, row, classification: 'DERIVED_LOCAL' }))];
  const catalog = [...new Set(cases.flatMap(row => row.payload.evidence_refs))]
    .map(ref => ({ ref, source_ref: ref, classification: 'CITED_SOURCE' }));
  for (const { name, row, classification } of documents) {
    requireResearch(fingerprint(researchCanonicalJson(row.payload)) === row.payload_hash,
      'RESEARCH_DOCUMENT_HASH_MISMATCH', { document: name });
    appendDocument(catalog, name, row.payload, row.payload_hash, classification);
  }
  return catalog;
}

export function resolveCritiqueCitations({ output, catalog, scope = 'SCENARIO_REVIEW_CRITIC' }) {
  const indexed = new Map(catalog.map(binding => [binding.ref, binding]));
  const unknown = output.evidence_refs.filter(ref => !indexed.has(ref));
  requireResearch(unknown.length === 0, 'RESEARCH_CITATION_UNKNOWN', {
    validation_version: CRITIQUE_CITATION_VERSION, unknown_refs: unknown,
    scope, automatic_paid_retry: false,
  });
  return [...new Set(output.evidence_refs)].map(ref => ({ ...indexed.get(ref) }));
}
