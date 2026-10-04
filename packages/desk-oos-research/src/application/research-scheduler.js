const TRANSIENT=new Set(['CYCLE_BUSY','ECONNRESET','ETIMEDOUT','ECONNREFUSED','57P01','40001','40P01']);

/** Next READY task is selected by durable priority; failures never send commands to OOS. */
export class ResearchScheduler {
  constructor({api,queue,worker_id,heartbeat_ms=15000,timers={setInterval,clearInterval}}) {
    Object.assign(this,{api,queue,worker_id,heartbeat_ms,timers});
  }
  async tick() {
    const task=await this.queue.claim({worker_id:this.worker_id});
    await this.queue.worker({worker_id:this.worker_id,state:task?'WORKING':'IDLE',task_id:task?.task_id??null});
    if(!task)return {state:'IDLE'};
    let heartbeatError;
    const timer=this.timers.setInterval(()=>{this.queue.heartbeat(task).catch(e=>{heartbeatError=e;});},this.heartbeat_ms);
    try {
      const before=await this.api.status({cycle_id:task.cycle_id});
      const result=before.status==='COMPLETED'?before:await this.api.advance({cycle_id:task.cycle_id,maximum_cases:1});
      if(heartbeatError)throw heartbeatError;
      const after=await this.api.status({cycle_id:task.cycle_id});
      const status=after.status==='COMPLETED'?'COMPLETED':'READY';
      await this.queue.settle(task,{status});
      return {state:status,task_id:task.task_id,cycle_id:task.cycle_id,checkpoint:after.status,revision:after.revision,result};
    } catch(e) {
      const code=e.code || 'RESEARCH_WORKER_FAILED';
      if(code==='RESEARCH_LEASE_LOST')return {state:'LEASE_LOST',task_id:task.task_id};
      const retry=TRANSIENT.has(code) && task.attempts+1<task.maximum_attempts;
      await this.queue.settle(task,{status:retry?'READY':'BLOCKED',code,delay_ms:retry?Math.min(60000,1000*2**task.attempts):0});
      if(!retry)await this.queue.incident(task,{code});
      return {state:retry?'RETRY_SCHEDULED':'BLOCKED',task_id:task.task_id,code};
    } finally {
      this.timers.clearInterval(timer);
      await this.queue.worker({worker_id:this.worker_id,state:'IDLE'});
    }
  }
}
