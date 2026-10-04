import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

// Maintenance port is deliberately separate from all public tools and the research application.
if(process.platform!=='win32')throw new Error('RESEARCH_MAINTENANCE_REQUIRES_WINDOWS');
const pg=createRequire(process.env.OOS_RESEARCH_MODULE_PACKAGE??new URL('../package.json',import.meta.url))('pg');
const action=process.argv.includes('--stop')?'Stop-Service':'Restart-Service';
const pool=new pg.Pool({connectionString:process.env.OOS_RESEARCH_DATABASE_URL,connectionTimeoutMillis:10000});
const client=await pool.connect();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let locked=false;
try {
  await client.query("SELECT pg_advisory_lock(hashtext('T3_RESEARCH_CAPACITY'))");locked=true;
  const deadline=Date.now()+20*60000;
  while((await client.query("SELECT count(*)::int AS n FROM research_state.t3_tasks WHERE status='RUNNING'")).rows[0].n) {
    if(Date.now()>deadline)throw new Error('RESEARCH_DRAIN_TIMEOUT_NO_PROCESS_KILLED');
    await sleep(3000);
  }
  const before=(await client.query('SELECT cycle_id,status,revision FROM research_state.t3_cycles ORDER BY cycle_id')).rows;
  execFileSync('powershell.exe',['-NoProfile','-Command',
    `$ErrorActionPreference='Stop'; ${action} DeskOosResearch; if((Get-Service DeskOosResearch).Status -ne '${action==='Stop-Service'?'Stopped':'Running'}'){throw 'MAINTENANCE_FAILED'}`],
    {stdio:'pipe',windowsHide:true,timeout:120000});
  const after=(await client.query('SELECT cycle_id,status,revision FROM research_state.t3_cycles ORDER BY cycle_id')).rows;
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('RESEARCH_RESTART_PERSISTENCE_MISMATCH');
  console.log(JSON.stringify({service:'DeskOosResearch',action,status:'PASS',persisted_cycles:after.length,
    active_inference_killed:false,admission_drained:true}));
}finally{
  if(locked)await client.query("SELECT pg_advisory_unlock(hashtext('T3_RESEARCH_CAPACITY'))");
  client.release();await pool.end();
}
