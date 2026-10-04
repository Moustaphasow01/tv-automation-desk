import test from 'node:test';
import assert from 'node:assert/strict';
import {researchResourceAdmission,ResearchScheduler} from '../index.js';
import {callResearchModel} from '../src/application/research-model-call.js';
import {MemoryFixture,fingerprint} from './research-fixtures.js';

test('quota UNKNOWN is not zero; exhausted windows wait for the latest authoritative reset',()=>{
  const now='2026-10-05T00:00:00Z';
  assert.equal(researchResourceAdmission(null,now).quota_known,false);
  assert.equal(researchResourceAdmission({windows:[{used_percent:99}]},now).allowed,true);
  const decision=researchResourceAdmission({windows:[
    {used_percent:100,resets_at:'2026-10-05T01:00:00Z'},
    {used_percent:100,resets_at:'2026-10-05T02:00:00Z'}]},now);
  assert.equal(decision.allowed,false);assert.equal(decision.resume_at,'2026-10-05T02:00:00.000Z');
});
test('resource deferral journals evidence before request accounting and never becomes an indeterminate paid call',async()=>{
  const memory=new MemoryFixture();let calls=0,allow=false;
  const cycle={cycle_id:'C',definition:{budget:{maximum_model_calls:1}}};
  const request={selection:{identifier:'TEST',reasoning_effort:'xhigh'},instructions:'TEST',input:{},role:'TEST'};
  const model={admission:async()=>({allowed:allow,resume_at:'2026-10-05T02:00:00Z'}),
    analyze:async()=>{calls++;return {model_identifier:'TEST',reasoning_effort:'xhigh',output:{}};}};
  await assert.rejects(callResearchModel({memory,model,fingerprint,cycle,request,requestId:'R'}),{code:'RESEARCH_QUOTA_EXHAUSTED'});
  assert.equal(calls,0);assert.equal(memory.events.filter(e=>e.type==='MODEL_REQUESTED').length,0);
  allow=true;await callResearchModel({memory,model,fingerprint,cycle,request,requestId:'R'});
  assert.equal(calls,1);assert.equal(memory.events.filter(e=>e.type==='MODEL_RESPONSE_RECEIVED').length,1);
});
test('scheduler resource waiting does not consume technical failure retries or call an execution port',async()=>{
  const settlements=[],task={task_id:'T',cycle_id:'C',attempts:0};
  const queue={claim:async()=>task,worker:async()=>{},settle:async(t,value)=>settlements.push(value),
    incident:async()=>assert.fail('quota waiting is not a critical trading incident')};
  const api={status:async()=>({status:'DIAGNOSING'}),advance:async()=>{
    throw Object.assign(new Error('quota'),{code:'RESEARCH_QUOTA_EXHAUSTED',
      details:{resume_at:new Date(Date.now()+60000).toISOString()}});
  }};
  const scheduler=new ResearchScheduler({api,queue,worker_id:'W',timers:{setInterval:()=>1,clearInterval:()=>{}}});
  assert.equal((await scheduler.tick()).state,'WAITING_RESOURCE');
  assert.equal(settlements.length,1);assert.equal(settlements[0].status,'READY');
  assert.equal(settlements[0].code,undefined);assert.ok(settlements[0].delay_ms>0);
});
