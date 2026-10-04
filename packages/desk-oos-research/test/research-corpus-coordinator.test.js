import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchCorpusCoordinator} from '../src/application/research-corpus-coordinator.js';
import {ResearchCycle} from '../src/application/research-cycle.js';
import {ResearchApi} from '../src/application/research-api.js';
import {RESEARCHER_PROMPT,RESEARCH_PROMPT_VERSION} from '../src/domain/research-role-contract.js';
import {MemoryFixture,fingerprint,clock,identity,packet,unknownAnswers} from './research-fixtures.js';
import {createScenarioSelfAudit} from '../src/domain/scenario-self-audit.js';

async function fixture() {
  const memory=new MemoryFixture(),cases=[],sources=[];
  const model={capabilities:async()=>[{identifier:'TEST_ONLY',available:true,reasoning:true,capability_rank:1,reasoning_efforts:['xhigh']}],analyze:()=>assert.fail('no duplicate model inference')};
  const observer={read:async()=>({index_hash:'corpus'}),assertCorpus:async()=>{},day:async date=>{
    const subset=cases.filter(c=>c.identity.date===date);return{identity:subset[0].identity,cases:subset,coverage:{observed_attempt_count:subset.length,expected_attempt_count:subset.length}};
  }};
  const cycle=new ResearchCycle({memory,observer,model,fingerprint,clock}),api=new ResearchApi({cycle,memory});
  for(const [i,date] of ['2026-07-02','2026-08-03'].entries()) {
    const src=`source-${i}`,audit=createScenarioSelfAudit({identity:{...identity,date},packet:packet(),events:[],trades:[],fingerprint});cases.push(audit);
    await memory.beginCycle({cycle_id:src,corpus_hash:'corpus',definition:{dates:[date],prompt_version:RESEARCH_PROMPT_VERSION,prompt_sha256:fingerprint(RESEARCHER_PROMPT)}});
    await cycle.save(src,'scenario_audit',audit.case_id,audit);await cycle.save(src,'finding',`finding-${i}`,{case_id:audit.case_id,result:unknownAnswers()});
    await memory.transition({cycle_id:src,expected_revision:0,status:'COMPLETED'});sources.push({cycle_id:src,date,maximum_cases:1});
  }
  const queue={list:async()=>sources.map(s=>({...s,status:'COMPLETED'})),schedule:async task=>task};
  return{memory,cycle,api,queue,sources};
}
test('all day reviews precede global discovery; original hashes link reused reviews without re-inference',async()=>{
  const f=await fixture(),coordinator=new ResearchCorpusCoordinator(f),first=await coordinator.tick();
  assert.equal(first.state,'GLOBAL_DISCOVERY_SCHEDULED');
  const reviews=await f.cycle.all(first.cycle_id,'finding');assert.equal(reviews.length,2);
  assert.ok(reviews.every(r=>r.payload.parent_research_ref.payload_hash && r.payload.fresh_model_call===false));
  assert.equal((await f.cycle.diagnose({cycle_id:first.cycle_id})).status,'CLUSTERING');
  assert.equal((await coordinator.tick()).cycle_id,first.cycle_id);
  assert.equal((await f.cycle.all(first.cycle_id,'finding')).length,2);
});
test('a failed or incomplete day cannot be silently omitted from corpus coverage',async()=>{
  const f=await fixture();f.queue.list=async()=>f.sources.map(s=>({...s,status:'BLOCKED'}));
  assert.equal((await new ResearchCorpusCoordinator(f).tick()).state,'WAITING_DAY_AUDITS');
});
