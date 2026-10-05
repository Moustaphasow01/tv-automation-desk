import { requireResearch } from '../domain/research-evidence.js';

/** Cross-day discovery reuses audited research dossiers, never replays or regenerates market plans. */
export class ResearchCorpusCoordinator {
  constructor({api,queue,sources}) {Object.assign(this,{api,queue,sources});}
  async tick() {
    if(!this.sources.length)return {state:'NO_CORPUS'};
    const tasks=await this.queue.list(),states=new Map(tasks.map(t=>[t.cycle_id,t.status]));
    if(this.sources.some(s=>states.get(s.cycle_id)!=='COMPLETED'))return {state:'WAITING_DAY_AUDITS'};
    const count=this.sources.reduce((n,s)=>n+s.maximum_cases,0);
    const cycle=await this.api.start({dates:this.sources.map(s=>s.date),budget:{maximum_model_calls:Math.ceil(count/100)*21+100}});
    if(cycle.status==='COMPLETED')return this.api.science
      ?this.api.science.tick({cycle_id:cycle.cycle_id}):{state:'GLOBAL_DISCOVERY_COMPLETED',cycle_id:cycle.cycle_id};
    if(cycle.status==='OBSERVING')await this.api.advance({cycle_id:cycle.cycle_id});
    if((await this.api.status({cycle_id:cycle.cycle_id})).status==='DIAGNOSING')await this.seed(cycle.cycle_id);
    await this.queue.schedule({cycle_id:cycle.cycle_id,priority:-100});
    return {state:'GLOBAL_DISCOVERY_SCHEDULED',cycle_id:cycle.cycle_id,source_days:this.sources.length};
  }
  async seed(cycle_id) {
    return this.api.memory.executeExclusive(cycle_id,async()=>{
      const target=await this.api.memory.getCycle(cycle_id),ids=new Set((await this.api.cycle.all(cycle_id,'scenario_audit')).map(a=>a.payload.case_id));
      for(const source of this.sources)await this.copySource({source,target,ids});
      const copied=(await this.api.cycle.all(cycle_id,'finding')).filter(f=>ids.has(f.payload.case_id));
      requireResearch(new Set(copied.map(f=>f.payload.case_id)).size===ids.size,'RESEARCH_GLOBAL_REVIEW_COVERAGE_MISMATCH');
    });
  }
  async copySource({source,target,ids}) {
    const cycle=await this.api.memory.getCycle(source.cycle_id);
    requireResearch(cycle?.status==='COMPLETED' && cycle.corpus_hash===target.corpus_hash,'RESEARCH_GLOBAL_SOURCE_NOT_READY');
    requireResearch(cycle.definition.prompt_sha256===target.definition.prompt_sha256,'RESEARCH_GLOBAL_METHOD_MISMATCH');
    const audits=await this.api.cycle.all(source.cycle_id,'scenario_audit'),findings=await this.api.cycle.all(source.cycle_id,'finding');
    const byCase=new Map(findings.filter(f=>f.payload.case_id).map(f=>[f.payload.case_id,f]));
    requireResearch(audits.every(a=>ids.has(a.payload.case_id) && byCase.has(a.payload.case_id)),'RESEARCH_GLOBAL_REVIEW_MISSING');
    for(const audit of audits) {
      const parent=byCase.get(audit.payload.case_id),id=this.api.cycle.fingerprint(`${target.cycle_id}|${audit.payload.case_id}|DIAGNOSIS`);
      await this.api.cycle.save(target.cycle_id,'finding',id,{...parent.payload,
        parent_research_ref:{cycle_id:source.cycle_id,artifact_id:parent.id,payload_hash:parent.payload_hash},
        aggregation_classification:'DERIVED_LOCAL',fresh_model_call:false});
    }
    for(const critique of (await this.api.cycle.all(source.cycle_id,'critique')).filter(c=>c.payload.audit_scope==='SCENARIO_REVIEW')) {
      await this.api.cycle.save(target.cycle_id,'critique',this.api.cycle.fingerprint(`${target.cycle_id}|${critique.payload.case_id}|CASE_CRITIQUE`),
        {...critique.payload,parent_research_ref:{cycle_id:source.cycle_id,artifact_id:critique.id,payload_hash:critique.payload_hash},
          aggregation_classification:'DERIVED_LOCAL',fresh_model_call:false});
    }
  }
}
