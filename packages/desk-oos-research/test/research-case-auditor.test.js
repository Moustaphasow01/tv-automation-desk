import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchCycle,ResearchCaseAuditor} from '../index.js';
import {createScenarioSelfAudit} from '../src/domain/scenario-self-audit.js';
import {validateResearcherAnswer} from '../src/domain/research-role-contract.js';
import {CRITIC_PROMPT} from '../src/domain/research-role-contract.js';
import {MemoryFixture,identity,packet,fingerprint,clock,unknownAnswers} from './research-fixtures.js';

async function fixture(interpreted=false) {
  const memory=new MemoryFixture(),cycle=new ResearchCycle({memory,fingerprint,clock});
  await memory.beginCycle({cycle_id:'C',definition:{budget:{maximum_model_calls:10}}});
  await memory.transition({cycle_id:'C',expected_revision:0,status:'CLUSTERING'});
  const audit=createScenarioSelfAudit({identity,packet:packet(),events:[],trades:[],fingerprint});
  await cycle.save('C','scenario_audit',audit.case_id,audit);
  const output=unknownAnswers();
  if(interpreted)Object.assign(output.answers[0],{kind:'INTERPRETATION',evidence_refs:['plan-ref'],missing_reason:null});
  await cycle.save('C','finding','review',{case_id:audit.case_id,result:validateResearcherAnswer({output,audit})});
  return {cycle,memory,audit};
}
test('UNKNOWN reviews receive technical audit without claiming independent inference or altering original',async()=>{
  const f=await fixture(),auditor=new ResearchCaseAuditor({...f,fingerprint,clock});
  const original=(await f.cycle.all('C','finding'))[0].payload_hash;
  assert.equal((await auditor.advance({cycle_id:'C'})).case_reviews_audited,1);
  const saved=(await f.cycle.all('C','critique'))[0].payload;
  assert.equal(saved.independent,false);assert.equal(saved.verdict,'UNKNOWN');
  assert.equal(saved.review_ref.payload_hash,original);
  assert.equal((await f.cycle.all('C','finding'))[0].payload_hash,original);
  assert.equal((await auditor.advance({cycle_id:'C'})).status,'HYPOTHESIZING');
});
test('substantive claims get a fresh independent critique and survive restart without duplicate model call',async()=>{
  const f=await fixture(true);let calls=0;
  const model={capabilities:async()=>[{identifier:'TEST',available:true,reasoning:true,reasoning_efforts:['xhigh'],capability_rank:1}],
    analyze:async request=>{
      calls++;assert.equal(request.session_reuse,'FORBIDDEN');assert.equal(request.role,'DESK_AI_SCENARIO_REVIEW_CRITIC');
      assert.ok(request.input.citation_catalog.some(b=>b.ref==='audit.coverage'));
      return {model_identifier:'TEST',reasoning_effort:'xhigh',output:{verdict:'NEEDS_CORRECTION',
        objections:['Synthetic diagnosis is unsupported'],evidence_refs:['plan-ref']}};
    }};
  let auditor=new ResearchCaseAuditor({...f,model,fingerprint,clock});
  await auditor.advance({cycle_id:'C'});
  assert.equal((await f.cycle.all('C','critique'))[0].payload.independent,true);
  auditor=new ResearchCaseAuditor({...f,model,fingerprint,clock});
  await auditor.advance({cycle_id:'C'});assert.equal(calls,1);
});

async function deliveredLegacy(f,refs=['audit.coverage','review.result.answers','plan-ref']) {
  const review=(await f.cycle.all('C','finding'))[0];
  const input={audit:f.audit,review:review.payload,review_hash:review.payload_hash};
  const request_id=fingerprint(`C|${f.audit.case_id}|CASE_CRITIC_MODEL`);
  const instructions=`${CRITIC_PROMPT}\nCritique this individual scenario diagnosis, not experiment readiness. Check unsupported causal claims, hindsight and citation gaps. Unknown is valid. Never invent missing rationale or bars.`;
  const hashes={request_id,prompt_sha256:fingerprint(instructions),context_sha256:fingerprint(JSON.stringify(input))};
  await f.memory.addEvent({cycle_id:'C',event_id:request_id,type:'MODEL_REQUESTED',payload:{...hashes,
    role:'DESK_AI_SCENARIO_REVIEW_CRITIC',model:{identifier:'TEST',reasoning_effort:'xhigh'}}});
  await f.memory.addEvent({cycle_id:'C',event_id:fingerprint(`${request_id}|RESPONSE`),type:'MODEL_RESPONSE_RECEIVED',payload:{...hashes,
    response:{model_identifier:'TEST',reasoning_effort:'xhigh',output:{verdict:'NEEDS_CORRECTION',objections:['Review lacks bars'],evidence_refs:refs}}}});
  return review;
}
test('delivered legacy critique is revalidated and reused verbatim with zero additional paid calls',async()=>{
  const f=await fixture(true),review=await deliveredLegacy(f);
  const before=JSON.stringify(await f.memory.listEvents('C'));
  const model={capabilities:async()=>[{identifier:'TEST',available:true,reasoning:true,reasoning_efforts:['xhigh'],capability_rank:1}],
    analyze:async()=>assert.fail('legacy response must be reused')};
  const auditor=new ResearchCaseAuditor({...f,model,fingerprint,clock});
  const proof=await auditor.assessRecovery({cycle_id:'C'});
  assert.equal(proof.new_model_calls,0);assert.equal(proof.review_hash,review.payload_hash);
  await auditor.advance({cycle_id:'C'});
  assert.equal(JSON.stringify(await f.memory.listEvents('C')),before);
  const saved=(await f.cycle.all('C','critique'))[0].payload;
  assert.deepEqual(saved.evidence_refs,['audit.coverage','review.result.answers','plan-ref']);
  assert.equal(saved.citation_bindings[0].classification,'DERIVED_LOCAL');
  assert.equal((await f.cycle.all('C','finding'))[0].payload_hash,review.payload_hash);
});
test('a genuinely unknown legacy citation cannot be auto-recovered',async()=>{
  const f=await fixture(true);await deliveredLegacy(f,['foreign-case-hash']);
  const auditor=new ResearchCaseAuditor({...f,fingerprint,clock});
  await assert.rejects(auditor.assessRecovery({cycle_id:'C'}),e=>e.code==='RESEARCH_CITATION_UNKNOWN'
    && e.details.unknown_refs[0]==='foreign-case-hash');
  assert.equal((await f.cycle.all('C','critique')).length,0);
});
test('indeterminate paid request never becomes a fresh V2 inference',async()=>{
  const f=await fixture(true),request_id=fingerprint(`C|${f.audit.case_id}|CASE_CRITIC_MODEL`);
  await f.memory.addEvent({cycle_id:'C',event_id:request_id,type:'MODEL_REQUESTED',payload:{request_id}});
  const model={capabilities:async()=>[{identifier:'TEST',available:true,reasoning:true,reasoning_efforts:['xhigh'],capability_rank:1}],
    analyze:async()=>assert.fail('uncertain inference cannot be repeated')};
  const auditor=new ResearchCaseAuditor({...f,model,fingerprint,clock});
  await assert.rejects(auditor.assessRecovery({cycle_id:'C'}),{code:'RESEARCH_RECOVERY_RESPONSE_NOT_PERSISTED'});
  await assert.rejects(auditor.advance({cycle_id:'C'}),{code:'RESEARCH_MODEL_REQUEST_INDETERMINATE'});
});
test('cached response with modified context or request linkage remains blocked',async()=>{
  const f=await fixture(true);await deliveredLegacy(f);
  const auditor=new ResearchCaseAuditor({...f,fingerprint,clock}),response=f.memory.events.at(-1);
  response.payload.context_sha256='changed';
  await assert.rejects(auditor.assessRecovery({cycle_id:'C'}),{code:'RESEARCH_MODEL_RESPONSE_CONTEXT_CONFLICT'});
});
