import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const names=['start_research_cycle','advance_research_cycle','get_research_status','get_research_artifacts','get_research_scorecard','register_research_experiment'];
const config=JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG,'utf8'));
const client=new Client({name:'OOS research post-deployment acceptance',version:'1'});
const assert=(ok,code)=>{if(!ok)throw new Error(code);};
const call=async(name,args)=>{
  const result=await client.callTool({name,arguments:args});
  assert(!result.isError,`RESEARCH_TOOL_FAILED_${name}`);
  return result.structuredContent;
};
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'
  ?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${config.public_url}/mcp`),{
    requestInit:{headers:{authorization:`Bearer ${process.env.OOS_OPERATOR_TOKEN}`}}}));
  const tools=(await client.listTools()).tools;
  assert(names.every(name=>tools.some(t=>t.name===name)),'RESEARCH_TOOLS_NOT_PUBLISHED');
  const index=await call('get_forensic_index',{date:'2026-07-02',limit:200});
  const day=index.items.find(d=>d.date==='2026-07-02');
  assert(day?.state==='COMPLETED','RESEARCH_PILOT_NOT_PUBLISHED');
  const budget=Math.max(100,(day.attempt_count??0)+50);
  const args={dates:['2026-07-02'],budget:{maximum_model_calls:budget}};
  const first=await call('start_research_cycle',args),second=await call('start_research_cycle',args);
  assert(first.cycle_id===second.cycle_id,'RESEARCH_IDEMPOTENCE_FAILED');
  const initial=await call('get_research_status',{cycle_id:first.cycle_id});
  if(initial.status==='OBSERVING')await call('advance_research_cycle',{cycle_id:first.cycle_id});
  const after=await call('get_research_status',{cycle_id:first.cycle_id});
  const audits=await call('get_research_artifacts',{cycle_id:first.cycle_id,kind:'scenario_audit',limit:200});
  assert(audits.items.length>=day.scenario_count,'RESEARCH_POPULATION_TRUNCATED');
  for(const row of audits.items)assert(createHash('sha256').update(canonical(row.payload)).digest('hex')===row.payload_hash,'RESEARCH_READBACK_HASH_INVALID');
  await call('get_research_scorecard',{cycle_id:first.cycle_id});
  const probe=await client.callTool({name:'register_research_experiment',arguments:{cycle_id:first.cycle_id,
    hypothesis_id:'0'.repeat(64),protocol:{split:{discovery:['2026-07-02'],validation:['2026-09-01'],test:['2026-10-01']},
      primary_metric:'published_real_R',stopping_rule:'acceptance invocation only',false_discovery_control:'no scientific conclusion'}}});
  assert(probe.isError,'RESEARCH_UNDEFINED_HYPOTHESIS_ADMITTED');
  console.log(JSON.stringify({public_tools_count:tools.length,research_tools_visible:names,tool_callability:'PASS',
    auth:'PASS_OPERATOR_SCOPED',research_write:'PASS',read_back:'PASS',idempotence:'PASS',payload_hashes:'PASS',
    pilot_date:day.date,cycle_id:first.cycle_id,scenario_count:day.scenario_count,attempt_count:day.attempt_count,
    audits_persisted:audits.items.length,checkpoint:after.status,model_requests:after.model_requests,new_replays:0}));
}finally{await client.close();}
