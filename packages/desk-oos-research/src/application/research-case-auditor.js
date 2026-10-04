import {requireResearch} from '../domain/research-evidence.js';
import {selectResearchModel} from '../domain/research-governance.js';
import {CRITIC_PROMPT,RESEARCH_ROLE_OUTPUT_SCHEMA,validateResearcherAnswer} from '../domain/research-role-contract.js';
import {validateResearchOutput} from '../domain/research-output-validation.js';
import {callResearchModel} from './research-model-call.js';
import {researchCanonicalJson} from '../domain/research-canonical-json.js';

const SCHEMA={type:'object',additionalProperties:false,required:['verdict','objections','evidence_refs'],
  properties:{verdict:{type:'string',enum:['ACCEPTED_WITH_LIMITATIONS','NEEDS_CORRECTION','UNKNOWN']},
    objections:{type:'array',minItems:1,items:{type:'string'}},evidence_refs:{type:'array',items:{type:'string'}}}};

/** An audit is a separate immutable artefact; it never rewrites the researcher's original diagnosis. */
export class ResearchCaseAuditor {
  constructor({cycle,memory,model,fingerprint,clock}){Object.assign(this,{cycle,memory,model,fingerprint,clock});}
  async advance({cycle_id}) {
    const audits=await this.cycle.all(cycle_id,'scenario_audit'),reviews=await this.cycle.all(cycle_id,'finding');
    const critiques=await this.cycle.all(cycle_id,'critique'),byCase=new Map(reviews.filter(r=>r.payload.case_id).map(r=>[r.payload.case_id,r]));
    const checked=new Set(critiques.filter(r=>r.payload.audit_scope==='SCENARIO_REVIEW').map(r=>r.payload.case_id));
    const next=audits.find(a=>!checked.has(a.payload.case_id));
    if(!next)return this.cycle.cluster({cycle_id});
    const review=byCase.get(next.payload.case_id);requireResearch(review,'RESEARCH_CASE_REVIEW_MISSING');
    await this.audit({cycle_id,audit:next.payload,review});
    return {status:'CLUSTERING',case_reviews_audited:checked.size+1,total_cases:audits.length};
  }
  async audit({cycle_id,audit,review}) {
    const cycle=await this.memory.getCycle(cycle_id),refs=[...audit.evidence_refs,...(review.payload.visual_evidence??[]).map(i=>i.provenance_ref)];
    requireResearch(this.fingerprint(researchCanonicalJson(review.payload))===review.payload_hash,'RESEARCH_REVIEW_HASH_MISMATCH');
    const output=Object.fromEntries(Object.keys(RESEARCH_ROLE_OUTPUT_SCHEMA.properties).map(k=>[k,review.payload.result[k]]));
    validateResearcherAnswer({output,audit:{...audit,evidence_refs:refs}});
    const unknown=review.payload.result.answers.every(a=>a.kind==='UNKNOWN') && !review.payload.result.hypothesis;
    const response=unknown?null:await this.critique({cycle,audit,review});
    const result=response?.output??{verdict:'UNKNOWN',objections:['No substantive interpreted claim: technical audit only; no independent-model conclusion.'],evidence_refs:[]};
    validateResearchOutput(result,SCHEMA);
    requireResearch(result.evidence_refs.every(ref=>refs.includes(ref)),'RESEARCH_CITATION_UNKNOWN');
    const payload={...result,audit_scope:'SCENARIO_REVIEW',case_id:audit.case_id,
      review_ref:{cycle_id,id:review.id,payload_hash:review.payload_hash},
      independent:Boolean(response),isolated_session:Boolean(response),classification:response?'RESEARCH_CRITIQUE':'TECHNICAL_RESEARCH_AUDIT',
      actual_telemetry:response?.telemetry??null,generated_at:this.clock(),champion_changes:0,edge_validated:false};
    await this.cycle.save(cycle_id,'critique',this.fingerprint(`${cycle_id}|${audit.case_id}|CASE_CRITIQUE`),payload);
    return payload;
  }
  async critique({cycle,audit,review}) {
    const selection=selectResearchModel(await this.model.capabilities());
    const images=review.payload.visual_evidence_used && this.cycle.readVisual
      ?await this.cycle.readVisual({audit,route:review.payload.resource_route}):[];
    const input={audit,review:review.payload,review_hash:review.payload_hash};
    requireResearch(JSON.stringify(input).length<=1000000,'RESEARCH_CONTEXT_BUDGET_EXCEEDED');
    return callResearchModel({memory:this.memory,model:this.model,fingerprint:this.fingerprint,cycle,
      requestId:this.fingerprint(`${cycle.cycle_id}|${audit.case_id}|CASE_CRITIC_MODEL`),
      request:{role:'DESK_AI_SCENARIO_REVIEW_CRITIC',selection,images,instructions:`${CRITIC_PROMPT}\nCritique this individual scenario diagnosis, not experiment readiness. Check unsupported causal claims, hindsight and citation gaps. Unknown is valid. Never invent missing rationale or bars.`,
        input,output_schema:SCHEMA}});
  }
}
