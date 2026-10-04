import { randomUUID, createHash } from 'node:crypto';

const COLUMNS='task_id,cycle_id,priority,status,worker_id,lease_token,lease_until,attempts,maximum_attempts,available_at,last_error,heartbeat_at,created_at,updated_at';
const error = code => Object.assign(new Error(code),{code});

/** Own research tables only; every update from a worker is fenced by its claim token. */
export class PostgresResearchTaskQueue {
  constructor({pool,clock=()=>new Date().toISOString(),lease_ms=1200000,maximum_workers=1}) {
    if(!pool || maximum_workers!==1 || !Number.isInteger(lease_ms) || lease_ms<60000 || lease_ms>3600000) throw error('RESEARCH_QUEUE_CONFIG_INVALID');
    Object.assign(this,{pool,clock,lease_ms});
  }
  async schedule({cycle_id,priority=0}) {
    if(!/^[a-f0-9]{64}$/.test(cycle_id) || !Number.isSafeInteger(priority)) throw error('RESEARCH_TASK_INVALID');
    const {rows}=await this.pool.query(`INSERT INTO research_state.t3_tasks(task_id,cycle_id,priority,available_at,created_at,updated_at)
      VALUES($1,$1,$2,$3,$3,$3) ON CONFLICT(cycle_id) DO NOTHING RETURNING ${COLUMNS}`,[cycle_id,priority,this.clock()]);
    return rows[0] || (await this.pool.query(`SELECT ${COLUMNS} FROM research_state.t3_tasks WHERE cycle_id=$1`,[cycle_id])).rows[0];
  }
  async claim({worker_id}) {
    if(typeof worker_id!=='string' || !worker_id.trim()) throw error('RESEARCH_WORKER_INVALID');
    const client=await this.pool.connect(),now=this.clock();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
      // Serialises admission across processes, not model execution or long-running IO.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('T3_RESEARCH_CAPACITY'))");
      await client.query(`UPDATE research_state.t3_tasks SET status=CASE WHEN attempts+1>=maximum_attempts THEN 'FAILED' ELSE 'READY' END,
        attempts=attempts+1,worker_id=NULL,lease_token=NULL,lease_until=NULL,last_error='WORKER_LEASE_EXPIRED',updated_at=$1
        WHERE status='RUNNING' AND lease_until<=$1`,[now]);
      const occupied=await client.query("SELECT count(*)::int AS n FROM research_state.t3_tasks WHERE status='RUNNING'");
      if(occupied.rows[0].n){await client.query('COMMIT');return null;}
      const next=await client.query(`SELECT task_id FROM research_state.t3_tasks WHERE status='READY' AND available_at<=$1
        ORDER BY priority DESC,created_at,task_id FOR UPDATE SKIP LOCKED LIMIT 1`,[now]);
      if(!next.rows.length){await client.query('COMMIT');return null;}
      const token=randomUUID(),until=new Date(Date.parse(now)+this.lease_ms).toISOString();
      const result=await client.query(`UPDATE research_state.t3_tasks SET status='RUNNING',worker_id=$2,lease_token=$3,
        lease_until=$4,heartbeat_at=$5,updated_at=$5 WHERE task_id=$1 RETURNING ${COLUMNS}`,
        [next.rows[0].task_id,worker_id,token,until,now]);
      await client.query('COMMIT');return result.rows[0];
    } catch(e){await client.query('ROLLBACK');throw e;} finally {client.release();}
  }
  async heartbeat(task) {
    const now=this.clock(),until=new Date(Date.parse(now)+this.lease_ms).toISOString();
    const result=await this.pool.query(`UPDATE research_state.t3_tasks SET heartbeat_at=$3,lease_until=$4,updated_at=$3
      WHERE task_id=$1 AND status='RUNNING' AND lease_token=$2 AND lease_until>$3`,[task.task_id,task.lease_token,now,until]);
    if(!result.rowCount) throw error('RESEARCH_LEASE_LOST');
    await this.worker({worker_id:task.worker_id,state:'WORKING',task_id:task.task_id});
  }
  async settle(task,{status,code=null,delay_ms=0}) {
    if(!['READY','COMPLETED','BLOCKED','FAILED'].includes(status) || !Number.isFinite(delay_ms) || delay_ms<0) throw error('RESEARCH_SETTLEMENT_INVALID');
    const now=this.clock(),available=new Date(Date.parse(now)+delay_ms).toISOString();
    const result=await this.pool.query(`UPDATE research_state.t3_tasks SET status=$3,worker_id=NULL,lease_token=NULL,lease_until=NULL,
      last_error=$4,attempts=attempts+CASE WHEN $4::text IS NULL THEN 0 ELSE 1 END,available_at=$5,updated_at=$6
      WHERE task_id=$1 AND status='RUNNING' AND lease_token=$2 AND lease_until>$6 RETURNING ${COLUMNS}`,
      [task.task_id,task.lease_token,status,code,available,now]);
    if(!result.rowCount) throw error('RESEARCH_LEASE_LOST');
    return result.rows[0];
  }
  async worker({worker_id,state,task_id=null}) {
    await this.pool.query(`INSERT INTO research_state.t3_workers(worker_id,state,task_id,heartbeat_at,capabilities)
      VALUES($1,$2,$3,$4,'{"research_only":true,"maximum_workers":1,"live":false}'::jsonb)
      ON CONFLICT(worker_id) DO UPDATE SET state=EXCLUDED.state,task_id=EXCLUDED.task_id,heartbeat_at=EXCLUDED.heartbeat_at`,
      [worker_id,state,task_id,this.clock()]);
  }
  async incident(task,{code,severity='CRITICAL'}) {
    const id=createHash('sha256').update(`${task.task_id}|${code}|${task.attempts}`).digest('hex');
    await this.pool.query(`INSERT INTO research_state.t3_incidents(incident_id,task_id,severity,code,payload,created_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(incident_id) DO NOTHING`,
      [id,task.task_id,severity,code,JSON.stringify({cycle_id:task.cycle_id,attempts:task.attempts,champion_modified:false}),this.clock()]);
  }
  async list() {
    return (await this.pool.query(`SELECT ${COLUMNS} FROM research_state.t3_tasks ORDER BY priority DESC,created_at,task_id LIMIT 1000`)).rows;
  }
}
