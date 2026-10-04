import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchCycle } from '../src/application/research-cycle.js';
import { ResearchHypotheses } from '../src/application/research-hypotheses.js';
import { createScenarioSelfAudit } from '../src/domain/scenario-self-audit.js';
import { fingerprint,clock,identity,packet,MemoryFixture } from './research-fixtures.js';

test('a known mechanism gets fresh cycle evidence without overwriting original discovery',async()=>{
  const memory=new MemoryFixture(),cycle=new ResearchCycle({memory,fingerprint,clock});
  const ledger=new ResearchHypotheses({cycle,memory,fingerprint,clock});
  const proposal={description:'Synthetic test only',mechanism:'TEST_ONLY',target_component:'CONFIRMATION',
    feature_rule:{feature:'confirmation_step_count',operator:'GTE',value:2},
    outcome_rule:{metric:'PUBLISHED_REAL_R',operator:'GT',value:0},expected_risk:'Unknown',
    winner_risk:'Unknown',testable_change:'Not executable'};
  for(const [id,scenario,result] of [['C','S001',2],['G','S002',-1],['G','S003',3]]){
    await memory.beginCycle({cycle_id:id,definition:{}});
    const audit=createScenarioSelfAudit({identity,packet:packet(scenario),events:[],
      trades:[{trade_id:scenario,real_R:result}],fingerprint});
    await cycle.save(id,'scenario_audit',audit.case_id,audit);
  }
  const original=await ledger.register({cycle_id:'C',proposal});
  const hash=(await memory.findArtifact({kind:'hypothesis',id:original.hypothesis_id})).payload_hash;
  const current=await ledger.register({cycle_id:'G',proposal});
  assert.equal(current.hypothesis_id,original.hypothesis_id);
  assert.equal(current.already_tested_or_registered,true);
  assert.equal(current.supporting_cases.length,1);
  assert.equal(current.counterexamples.length,1);
  assert.equal(current.sample_size.known_cases,2);
  assert.equal((await ledger.all('G')).length,1);
  assert.deepEqual(await ledger.register({cycle_id:'G',proposal}),current);
  assert.equal((await memory.findArtifact({kind:'hypothesis',id:original.hypothesis_id})).payload_hash,hash);
  assert.equal((await cycle.all('G','hypothesis')).length,0);
});
