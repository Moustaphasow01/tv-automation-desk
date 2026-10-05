import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ResearchScheduler,ResearchCorpusCoordinator } from '@tv-automation/desk-oos-research';
import { openResearchHost } from '../src/oos-research-host.js';

const config=JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG,'utf8'));
if(config.research_enabled!==true)throw new Error('RESEARCH_SCHEDULER_NOT_ENABLED');
const host=await openResearchHost({config:{archive_root:config.archive_root,...config.research}});
const data=result=>result.structuredContent ?? result;
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
const scheduler=new ResearchScheduler({api:host.api,queue:host.queue,worker_id:`vps-research-${randomUUID()}`});
let coordinator;
async function enqueueCorpus() {
  const days=[];
  for(const month of ['2026-07','2026-08']) {
    let cursor;
    do {
      const page=data(await host.readForensic('get_forensic_index',{month,limit:200,...(cursor?{cursor}:{})}));
      days.push(...page.items); cursor=page.next_cursor;
    }while(cursor);
  }
  const eligible=days.filter(d=>d.state==='COMPLETED').sort((a,b)=>a.date.localeCompare(b.date));
  const sources=[];
  for(const day of eligible) {
    const maximum_cases=(day.attempt_count??0)+day.scenario_count;
    const budget=day.date==='2026-07-02'?100:Math.min(10000,Math.max(100,maximum_cases*2+50));
    const cycle=await host.api.start({dates:[day.date],budget:{maximum_model_calls:budget}});
    await host.queue.schedule({cycle_id:cycle.cycle_id,priority:day.date==='2026-07-02'?100:0});
    sources.push({date:day.date,cycle_id:cycle.cycle_id,maximum_cases});
  }
  coordinator=new ResearchCorpusCoordinator({api:host.api,queue:host.queue,sources});
  console.log(JSON.stringify({event:'research.corpus_scheduled',enumerated:days.length,scheduled:eligible.length}));
}
try {
  if(process.argv.includes('--enqueue-corpus'))await enqueueCorpus();
  while(!stopping) {
    try {
      const step=await scheduler.tick();
      console.log(JSON.stringify({event:'research.scheduler_tick',state:step.state,task_id:step.task_id,checkpoint:step.checkpoint,code:step.code}));
      if(step.state==='IDLE' && coordinator) {
        const next=await coordinator.tick();
        if(['GLOBAL_DISCOVERY_SCHEDULED','SCIENTIFIC_TASK_SCHEDULED'].includes(next.state))
          console.log(JSON.stringify({event:'research.scientific_next_task',...next}));
      }
    }catch(error){console.error(JSON.stringify({event:'research.scheduler_error',code:error.code??'RESEARCH_SCHEDULER_FAILED'}));}
    if(!stopping)await new Promise(resolve=>setTimeout(resolve,5000));
  }
}finally{await host.close();}
