import test from 'node:test';
import assert from 'node:assert/strict';
import {critiqueCitationCatalog,resolveCritiqueCitations} from '../src/domain/research-critique-citations.js';
import {researchCanonicalJson} from '../src/domain/research-canonical-json.js';
import {validateCitedClaims} from '../src/domain/research-evidence.js';
import {fingerprint} from './research-fixtures.js';

function fixture() {
  const audit={evidence_refs:['known-source'],coverage:{bars:false},features:{available:false}};
  const payload={result:{answers:[],hypothesis:null},visual_evidence:[{provenance_ref:'visual-source'}]};
  const review={payload,payload_hash:fingerprint(researchCanonicalJson(payload))};
  return {audit,review,fingerprint};
}
test('document citations bind exact existing fields to immutable hashes without claiming market facts',()=>{
  const f=fixture(),before=JSON.stringify(f),catalog=critiqueCitationCatalog(f);
  const output={evidence_refs:['audit.coverage','audit.features','review.result','review.result.hypothesis',f.review.payload_hash]};
  const bindings=resolveCritiqueCitations({output,catalog});
  assert.equal(bindings.length,5);assert.equal(bindings[0].source_pointer,'/coverage');
  assert.equal(bindings[0].source_sha256,fingerprint(researchCanonicalJson(f.audit)));
  assert.equal(bindings[0].classification,'DERIVED_LOCAL');
  assert.equal(bindings[3].classification,'RESEARCH_INTERPRETATION');assert.equal(JSON.stringify(f),before);
});
test('source and visual references are preserved exactly, without a fabricated market classification',()=>{
  const catalog=critiqueCitationCatalog(fixture());
  const bindings=resolveCritiqueCitations({output:{evidence_refs:['known-source','visual-source','known-source']},catalog});
  assert.deepEqual(bindings.map(b=>b.source_ref),['known-source','visual-source']);
  assert.ok(bindings.every(b=>b.classification==='CITED_SOURCE'));
});
for(const ref of ['foreign-case-hash','audit.nonexistent','review.result.nonexistent','review.result.answers.99']) {
  test(`unknown critic citation remains blocked with diagnostics: ${ref}`,()=>{
    assert.throws(()=>resolveCritiqueCitations({output:{evidence_refs:[ref]},catalog:critiqueCitationCatalog(fixture())}),
      e=>e.code==='RESEARCH_CITATION_UNKNOWN' && e.details.unknown_refs[0]===ref && e.details.automatic_paid_retry===false);
  });
}
test('tampered review cannot supply document citations',()=>{
  const f=fixture();f.review.payload.result.hypothesis='changed';
  assert.throws(()=>critiqueCitationCatalog(f),{code:'RESEARCH_REVIEW_HASH_MISMATCH'});
});
test('researcher claims still cannot substitute a document field for market evidence',()=>{
  assert.throws(()=>validateCitedClaims({claims:[{statement:'claim',kind:'INTERPRETATION',evidence_refs:['audit.coverage']}],
    allowedRefs:['known-source']}),e=>e.code==='RESEARCH_CITATION_UNKNOWN' && e.details.scope==='RESEARCHER_CLAIM');
});
