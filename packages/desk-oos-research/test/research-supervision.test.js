import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchSupervision,ResearchApi} from '../index.js';
import {MemoryFixture,fingerprint} from './research-fixtures.js';

function fixture() {
  let now=Date.parse('2026-10-05T08:00:00Z'),calls=0;
  const memory=new MemoryFixture(),tasks=[{task_id:'C',cycle_id:'C',status:'BLOCKED',
    last_error:'RESEARCH_CITATION_UNKNOWN',updated_at:new Date(now).toISOString()}];
  const cycle={clock:()=>new Date(now).toISOString(),fingerprint};
  const api={memory,cycle,assessRecovery:async()=>{calls++;return {validation_version:'RESEARCH_CRITIQUE_CITATIONS_V2',
    request_id:'a'.repeat(64),expected_revision:1,new_model_calls:0};}};
  const queue={list:async()=>tasks,resumeBlocked:async({task})=>{task.status='READY';return true;}};
  const args={api,queue,cycle_id:'anchor',worker_id:'test',interval_ms:1800000};
  return {api,queue,memory,tasks,args,advance:ms=>{now+=ms;},calls:()=>calls};
}
test('verified recovery is journaled; periodic execution survives supervisor restart without duplicate retry',async()=>{
  const f=fixture();let supervisor=new ResearchSupervision(f.args);
  const first=await supervisor.tick();assert.equal(first.recovered.length,1);assert.equal(first.new_model_calls,0);
  assert.equal(first.historical_writes,0);assert.equal(f.calls(),1);
  assert.deepEqual(f.memory.events.map(e=>e.type),['RESEARCH_RECOVERY_VALIDATED','RESEARCH_SUPERVISION_PASS']);
  supervisor=new ResearchSupervision({...f.args,worker_id:'after-restart'});
  assert.equal((await supervisor.tick()).state,'NOT_DUE');assert.equal(f.calls(),1);
  f.advance(1800000);assert.equal((await supervisor.tick()).state,'SUPERVISED');
  assert.equal(f.calls(),1);assert.equal(f.memory.events.length,3);
});
test('unknown, unsafe and indeterminate recovery remain blocked and never generate inference',async()=>{
  const f=fixture();f.tasks.push({...f.tasks[0],task_id:'drift',last_error:'RESEARCH_MODEL_DRIFT'});
  f.api.assessRecovery=async()=>{throw Object.assign(new Error('missing'),{code:'RESEARCH_RECOVERY_RESPONSE_NOT_PERSISTED'});};
  f.queue.resumeBlocked=async()=>assert.fail('must not resume');
  const pass=await new ResearchSupervision(f.args).tick();
  assert.equal(pass.recovered.length,0);assert.deepEqual(pass.blocked.map(b=>b.code),
    ['RESEARCH_RECOVERY_RESPONSE_NOT_PERSISTED','NOT_ALLOWLISTED']);
  assert.equal(f.memory.events.length,1);assert.ok(f.tasks.every(t=>t.status==='BLOCKED'));
});
test('changed queue task is not reported as recovered',async()=>{
  const f=fixture();f.queue.resumeBlocked=async()=>false;
  const pass=await new ResearchSupervision(f.args).tick();assert.equal(pass.recovered.length,0);
  assert.equal(pass.blocked[0].code,'TASK_CHANGED');
});
test('crash after journaling but before admission resumes with the same immutable proof after restart',async()=>{
  const f=fixture(),add=f.memory.addEvent.bind(f.memory),resume=f.queue.resumeBlocked;
  f.memory.addEvent=async row=>{
    const prior=f.memory.events.find(e=>e.event_id===row.event_id);
    if(prior)assert.deepEqual(prior.payload,row.payload);
    return add(row);
  };
  f.queue.resumeBlocked=async()=>{throw Object.assign(new Error('connection lost'),{code:'ECONNRESET'});};
  assert.equal((await new ResearchSupervision(f.args).tick()).recovered.length,0);
  f.advance(1800000);f.queue.resumeBlocked=resume;
  const pass=await new ResearchSupervision({...f.args,worker_id:'new-process'}).tick();
  assert.equal(pass.recovered.length,1);
  assert.equal(f.memory.events.filter(e=>e.type==='RESEARCH_RECOVERY_VALIDATED').length,1);
});
test('public research status reports real supervision freshness, not configured schedule as execution',async()=>{
  const f=fixture(),api=new ResearchApi({cycle:f.api.cycle,memory:f.memory});
  assert.deepEqual(await api.supervisionStatus(),{available:false,reason:'NO_EXECUTION_RECORDED'});
  await new ResearchSupervision(f.args).tick();assert.equal((await api.supervisionStatus()).overdue,false);
  f.advance(1920001);assert.equal((await api.supervisionStatus()).overdue,true);
});
