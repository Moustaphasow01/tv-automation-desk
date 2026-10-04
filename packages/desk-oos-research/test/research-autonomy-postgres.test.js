import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID,createHash } from 'node:crypto';
import { PostgresResearchMemory,PostgresResearchTaskQueue,ResearchScheduler } from '../index.js';

const enabled=process.env.RUN_POSTGRES_TESTS==='1' && !!process.env.DATABASE_URL;
test('AUTONOMY E2E: actual PG leases, restart, bounded retry, next task and fencing', {skip:!enabled,timeout:120000},async()=>{
  const {Pool}=createRequire(new URL('../../../mcp_gpt_desk/package.json',import.meta.url))('pg');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:8});
  const schema=`t3_autonomy_${randomUUID().replaceAll('-','')}`;
  const scoped={query:(sql,args)=>pool.query(sql.replaceAll('research_state',schema),args),connect:async()=>{
    const c=await pool.connect();return {query:(sql,args)=>c.query(sql.replaceAll('research_state',schema),args),release:()=>c.release()};}};
  let now=Date.parse('2026-10-04T10:00:00Z');const clock=()=>new Date(now).toISOString();
  const memory=PostgresResearchMemory({pool:scoped,clock});
  const queue=new PostgresResearchTaskQueue({pool:scoped,clock,lease_ms:60000});
  const ids=[1,2].map(n=>createHash('sha256').update(String(n)).digest('hex'));
  const timers={setInterval:()=>1,clearInterval:()=>{}};
  try {
    for(const name of ['075_oos_research_memory.sql','076_oos_research_task_queue.sql']) {
      const sql=await readFile(new URL(`../../../infra/postgres/init/${name}`,import.meta.url),'utf8');
      await scoped.query(sql);
    }
    for(const id of ids){await memory.beginCycle({cycle_id:id,input_hash:id,corpus_hash:id,definition:{test_only:true}});await queue.schedule({cycle_id:id});}
    await queue.schedule({cycle_id:ids[0]});assert.equal((await queue.list()).length,2);
    const claimed=await Promise.all([queue.claim({worker_id:'first'}),queue.claim({worker_id:'other'})]);
    assert.equal(claimed.filter(Boolean).length,1);const stale=claimed.find(Boolean);
    now+=60001;const recovered=await queue.claim({worker_id:'after-crash'});assert.equal(recovered.task_id,stale.task_id);
    await assert.rejects(queue.settle(stale,{status:'COMPLETED'}),{code:'RESEARCH_LEASE_LOST'});
    await queue.settle(recovered,{status:'READY'});
    let fail=true;const sessions=[];
    const api={status:({cycle_id})=>memory.getCycle(cycle_id),advance:async({cycle_id})=>{
      if(fail){fail=false;throw Object.assign(new Error('transient'),{code:'ECONNRESET'});}
      const c=await memory.getCycle(cycle_id);sessions.push(randomUUID());
      return memory.transition({cycle_id,expected_revision:c.revision,status:c.status==='OBSERVING'?'DIAGNOSING':'COMPLETED',checkpoint:{test_only:true}});
    }};
    let scheduler=new ResearchScheduler({api,queue,worker_id:'before-restart',timers});
    assert.equal((await scheduler.tick()).state,'RETRY_SCHEDULED');now+=10000;
    scheduler=new ResearchScheduler({api,queue,worker_id:'after-restart',timers});
    for(let n=0;n<6;n++)await scheduler.tick();
    assert.deepEqual((await queue.list()).map(t=>t.status),['COMPLETED','COMPLETED']);
    assert.equal(new Set(sessions).size,4);assert.equal((await memory.getCycle(ids[0])).revision,2);
    assert.equal((await scoped.query('SELECT count(*)::int AS n FROM research_state.t3_workers')).rows[0].n,2);
    const query=await scoped.query('SELECT count(*)::int AS n FROM research_state.t3_events');assert.equal(query.rows[0].n,6);
  }finally{await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});
