import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchCycle,ResearchCaseAuditor} from '../index.js';
import {createScenarioSelfAudit} from '../src/domain/scenario-self-audit.js';
import {validateResearcherAnswer} from '../src/domain/research-role-contract.js';
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
      return {model_identifier:'TEST',reasoning_effort:'xhigh',output:{verdict:'NEEDS_CORRECTION',
        objections:['Synthetic diagnosis is unsupported'],evidence_refs:['plan-ref']}};
    }};
  let auditor=new ResearchCaseAuditor({...f,model,fingerprint,clock});
  await auditor.advance({cycle_id:'C'});
  assert.equal((await f.cycle.all('C','critique'))[0].payload.independent,true);
  auditor=new ResearchCaseAuditor({...f,model,fingerprint,clock});
  await auditor.advance({cycle_id:'C'});assert.equal(calls,1);
});
