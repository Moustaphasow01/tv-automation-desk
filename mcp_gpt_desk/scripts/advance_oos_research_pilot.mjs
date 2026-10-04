import {readFile} from 'node:fs/promises';
import {openResearchHost} from '../src/oos-research-host.js';

const config=JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG,'utf8'));
const host=await openResearchHost({config:{archive_root:config.archive_root,...config.research}});
try {
  const models=await host.api.cycle.model.capabilities();
  console.log(JSON.stringify({event:'research.models_verified',models}));
  const cycle_id=process.env.OOS_RESEARCH_PILOT_CYCLE
    ?? (await host.api.start({dates:['2026-07-02'],budget:{maximum_model_calls:100}})).cycle_id;
  if(!/^[a-f0-9]{64}$/.test(cycle_id||''))throw new Error('RESEARCH_PILOT_CYCLE_REQUIRED');
  if((await host.api.status({cycle_id})).status==='OBSERVING')await host.api.advance({cycle_id,maximum_cases:1});
  const result=await host.api.advance({cycle_id,maximum_cases:1});
  console.log(JSON.stringify({event:'research.pilot_advanced',cycle_id,status:result.status,checkpoint:result.checkpoint}));
  console.log(JSON.stringify(await host.api.status({cycle_id})));
}catch(error){console.error(JSON.stringify({event:'research.pilot_error',code:error.code??'RESEARCH_PILOT_FAILED'}));process.exitCode=1;}
finally{await host.close();}
