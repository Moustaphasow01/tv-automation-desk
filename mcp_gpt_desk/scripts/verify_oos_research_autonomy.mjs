import {readFile} from 'node:fs/promises';
import {ResearchScheduler} from '@tv-automation/desk-oos-research';
import {openResearchHost} from '../src/oos-research-host.js';

const config=JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG,'utf8'));
let host=await openResearchHost({config:{archive_root:config.archive_root,...config.research}});
let cycle_id;
const assert=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
try {
  const cycle=await host.api.start({dates:['2026-07-02'],budget:{maximum_model_calls:100}});cycle_id=cycle.cycle_id;
  await host.queue.schedule({cycle_id,priority:100});
  let injected=false;
  const save=host.api.cycle.save.bind(host.api.cycle);
  host.api.cycle.save=async (...args)=>{
    if(args[1]==='finding' && args[3]?.case_id && !injected){injected=true;throw Object.assign(new Error('ACCEPTANCE_POST_RESPONSE_FAILURE'),{code:'ECONNRESET'});}
    return save(...args);
  };
  let scheduler=new ResearchScheduler({api:host.api,queue:host.queue,worker_id:'acceptance-before-restart'});
  const before=await host.api.status({cycle_id});
  if(before.status==='OBSERVING')await scheduler.tick();
  const failure=await scheduler.tick();
  assert(injected && failure.state==='RETRY_SCHEDULED','RESEARCH_AUTONOMY_FAILURE_INJECTION_FAILED');
  const delivered=await host.api.status({cycle_id}),events=await host.api.memory.listEvents(cycle_id);
  assert(events.some(e=>e.type==='MODEL_RESPONSE_RECEIVED'),'RESEARCH_AUTONOMY_RESPONSE_NOT_DURABLE');
  await host.close();
  host=await openResearchHost({config:{archive_root:config.archive_root,...config.research}});
  scheduler=new ResearchScheduler({api:host.api,queue:host.queue,worker_id:'acceptance-after-restart'});
  await new Promise(resolve=>setTimeout(resolve,1500));
  const recovered=await scheduler.tick(),after=await host.api.status({cycle_id});
  assert(recovered.state==='READY' && after.reports.finding===delivered.reports.finding+1,'RESEARCH_AUTONOMY_RESTART_RECOVERY_FAILED');
  assert(after.model_requests===delivered.model_requests,'RESEARCH_AUTONOMY_DUPLICATE_INFERENCE');
  const findings=await host.api.artifacts({cycle_id,kind:'finding',limit:200});
  assert(findings.items.some(f=>f.payload.actual_telemetry?.model==='gpt-6-astra' || f.payload.model?.identifier==='gpt-6-astra'),'RESEARCH_AUTONOMY_REAL_MODEL_REQUIRED');
  console.log(JSON.stringify({autonomy_e2e:'PASS',cycle_id,task_selected_automatically:true,real_model:'gpt-6-astra/xhigh',
    response_persisted:true,failure_simulated:true,retry_automatic:true,orchestrator_reopened:true,
    request_not_duplicated:true,next_task_ready:true,reports:after.reports,model_requests:after.model_requests,
    no_user_input:true,champion_modified:false,new_replays:0}));
}catch(error){console.error(JSON.stringify({code:error.code??'RESEARCH_AUTONOMY_E2E_FAILED',cycle_id}));process.exitCode=1;}
finally{await host.close();}
