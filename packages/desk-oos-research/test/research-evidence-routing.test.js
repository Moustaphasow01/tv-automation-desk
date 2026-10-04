import test from 'node:test';
import assert from 'node:assert/strict';
import { forensicDepthRoute, visualClaims } from '../src/domain/research-evidence-routing.js';
import { freezeChallengerRationale } from '../src/domain/research-challenger-rationale.js';
import { fingerprint, clock, identity, packet, MemoryFixture, unknownAnswers } from './research-fixtures.js';
import { createScenarioSelfAudit } from '../src/domain/scenario-self-audit.js';
import { reviewResearchCase } from '../src/application/research-case-review.js';

test('depth routing preserves missing evidence and selects images only for ambiguous or deep cases', () => {
  const audit={observations:{},coverage:{},attempt:1};
  assert.equal(forensicDepthRoute(audit).level,0); assert.equal(forensicDepthRoute(audit).visual_required,false);
  assert.equal(forensicDepthRoute({...audit,observations:{activated:true}}).level,1);
  assert.equal(forensicDepthRoute({...audit,observations:{confirmed:true}}).level,2);
  assert.equal(forensicDepthRoute({...audit,observations:{filled:true}}).level,3);
  assert.equal(forensicDepthRoute({...audit,evidence_contradictions:['EXPLICIT_TEST_ONLY']}).level,4);
  assert.equal(forensicDepthRoute({...audit,attempt:2}).level,3);
  assert.ok(forensicDepthRoute({...audit,observations:{filled:true}}).requested_artifacts.length<8);
});
test('visual claims cite actual supplied images; absence is not a visual claim', () => {
  assert.deepEqual(visualClaims({result:{answers:[{kind:'UNKNOWN',evidence_refs:['V'],statement:'unknown'}]},images:[{provenance_ref:'V'}]}),[]);
  assert.equal(visualClaims({result:{answers:[{kind:'INTERPRETATION',question_id:'C',evidence_refs:['V'],statement:'test'}]},images:[{provenance_ref:'V'}]})[0].confidence,'UNCALIBRATED_INTERPRETATION');
});
test('future challenger rationale is mandatory and canonically hashed without editing its original', () => {
  const fields=['analyst_rationale','market_thesis','scenario_purpose','why_this_level','why_this_confirmation',
    'why_this_entry','why_this_stop','why_this_target','alternative_branch_considered','invalidation_logic'];
  const rationale={workflow_owner:'RESEARCH_CHALLENGER',version:'1',parent:'CHAMPION_HASH',experiment_id:'TEST_ONLY',confidence:'UNKNOWN',input_refs:['source'],
    ...Object.fromEntries(fields.map(k=>[k,'SYNTHETIC_TEST_ONLY']))};
  const original=JSON.stringify(rationale),a=freezeChallengerRationale({rationale,fingerprint});
  assert.equal(JSON.stringify(rationale),original);assert.equal(a.rationale_sha256,freezeChallengerRationale({rationale,fingerprint}).rationale_sha256);
  assert.throws(()=>freezeChallengerRationale({rationale:{...rationale,why_this_stop:''},fingerprint}),/RATIONALE_REQUIRED/);
  assert.throws(()=>freezeChallengerRationale({rationale:{...rationale,workflow_owner:'HISTORICAL'},fingerprint}),/OWNER_INVALID/);
});
test('a delivered response survives a restart without a second model call', async () => {
  const memory=new MemoryFixture(),audit=createScenarioSelfAudit({identity,packet:packet(),events:[],trades:[],fingerprint});
  const cycle={cycle_id:'C',definition:{budget:{maximum_model_calls:3},prompt_sha256:'test'}};
  await memory.beginCycle(cycle);let calls=0;
  const model={analyze:async req=>{calls++;return{output:unknownAnswers(),model_identifier:req.selection.identifier,reasoning_effort:'xhigh'};}};
  const args={memory,model,fingerprint,cycle,selection:{identifier:'TEST_ONLY',reasoning_effort:'xhigh'},audit,clock};
  const a=await reviewResearchCase(args),b=await reviewResearchCase(args);
  assert.deepEqual(a,b);assert.equal(calls,1);assert.equal(memory.events.filter(e=>e.type==='MODEL_RESPONSE_RECEIVED').length,1);
});
test('only a conclusively delivered invalid output is retried, bounded and preserved', async () => {
  const memory=new MemoryFixture(),audit=createScenarioSelfAudit({identity,packet:packet(),events:[],trades:[],fingerprint});
  const cycle={cycle_id:'C',definition:{budget:{maximum_model_calls:3},prompt_sha256:'test'}};
  await memory.beginCycle(cycle);let calls=0;
  const model={analyze:async req=>{calls++;return{output:calls===1?{...unknownAnswers(),answers:[]}:unknownAnswers(),model_identifier:req.selection.identifier,reasoning_effort:'xhigh'};}};
  await reviewResearchCase({memory,model,fingerprint,cycle,selection:{identifier:'TEST_ONLY',reasoning_effort:'xhigh'},audit,clock});
  assert.equal(calls,2);assert.equal(memory.events.filter(e=>e.type==='MODEL_OUTPUT_REJECTED').length,1);
  assert.equal(memory.events.filter(e=>e.type==='MODEL_RESPONSE_RECEIVED').length,2);
});
