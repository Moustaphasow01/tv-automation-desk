import {requireResearch} from '../domain/research-evidence.js';
import {researchCanonicalJson} from '../domain/research-canonical-json.js';

/** A durable, bounded recovery pass; it never issues inference or historical writes. */
export class ResearchSupervision {
  constructor({api,queue,cycle_id,worker_id,interval_ms=1800000}) {
    requireResearch(Number.isInteger(interval_ms) && interval_ms>=1000,'RESEARCH_SUPERVISION_INTERVAL_INVALID');
    Object.assign(this,{api,queue,cycle_id,worker_id,interval_ms});
  }
  async tick() {
    return this.api.memory.executeExclusive(`supervision:${this.cycle_id}`,async()=>{
      const started_at=this.api.cycle.clock();
      const previous=await this.api.memory.latestEvent('RESEARCH_SUPERVISION_PASS');
      if(previous && Date.parse(started_at)<Date.parse(previous.payload.next_run_at))
        return {state:'NOT_DUE',next_run_at:previous.payload.next_run_at};
      const tasks=await this.queue.list(),recovered=[],blocked=[];
      for(const task of tasks.filter(t=>t.status==='BLOCKED')) {
        const result=await this.recover(task);
        (result.resumed?recovered:blocked).push(result);
      }
      const completed_at=this.api.cycle.clock();
      const payload={started_at,completed_at,worker_id:this.worker_id,interval_ms:this.interval_ms,
        tasks_checked:tasks.length,recovered,blocked,new_model_calls:0,historical_writes:0,
        next_run_at:new Date(Date.parse(completed_at)+this.interval_ms).toISOString()};
      await this.api.memory.addEvent({cycle_id:this.cycle_id,
        event_id:this.api.cycle.fingerprint(researchCanonicalJson(payload)),type:'RESEARCH_SUPERVISION_PASS',payload});
      return {state:'SUPERVISED',...payload};
    });
  }
  async recover(task) {
    const identity={task_id:task.task_id,cycle_id:task.cycle_id,previous_error:task.last_error};
    if(task.last_error!=='RESEARCH_CITATION_UNKNOWN')return {...identity,resumed:false,code:'NOT_ALLOWLISTED'};
    try {
      return await this.api.memory.executeExclusive(task.cycle_id,async()=>{
        const proof=await this.api.assessRecovery({cycle_id:task.cycle_id});
        const payload={...identity,proof,new_model_calls:0,historical_writes:0};
        await this.api.memory.addEvent({cycle_id:task.cycle_id,
          event_id:this.api.cycle.fingerprint(`${task.task_id}|${new Date(task.updated_at).toISOString()}|${researchCanonicalJson(proof)}`),
          type:'RESEARCH_RECOVERY_VALIDATED',payload});
        const resumed=await this.queue.resumeBlocked({task,proof});
        return {...identity,resumed,code:resumed?'VERIFIED_RESPONSE_RECOVERY':'TASK_CHANGED',...proof};
      });
    }catch(error){return {...identity,resumed:false,code:error.code??'RESEARCH_RECOVERY_FAILED',
      details:error.details??{},automatic_paid_retry:false};}
  }
}
