import {requireResearch} from '../domain/research-evidence.js';
import {selectResearchModel} from '../domain/research-governance.js';
import {CRITIC_PROMPT,RESEARCH_ROLE_OUTPUT_SCHEMA,validateResearcherAnswer} from '../domain/research-role-contract.js';
import {validateResearchOutput} from '../domain/research-output-validation.js';
import {callResearchModel} from './research-model-call.js';
import {researchCanonicalJson} from '../domain/research-canonical-json.js';
import {critiqueCitationCatalog,resolveCritiqueCitations,CRITIQUE_CITATION_VERSION} from '../domain/research-critique-citations.js';

const SCHEMA={type:'object',additionalProperties:false,required:['verdict','objections','evidence_refs'],
  properties:{verdict:{type:'string',enum:['ACCEPTED_WITH_LIMITATIONS','NEEDS_CORRECTION','UNKNOWN']},
    objections:{type:'array',minItems:1,items:{type:'string'}},evidence_refs:{type:'array',items:{type:'string'}}}};

/** An audit is a separate immutable artefact; it never rewrites the researcher's original diagnosis. */
export class ResearchCaseAuditor {
  constructor({cycle,memory,model,fingerprint,clock}){Object.assign(this,{cycle,memory,model,fingerprint,clock});}
  async advance({cycle_id}) {
    const next=await this.pendingReview(cycle_id);
    if(!next)return this.cycle.cluster({cycle_id});
    await this.audit({cycle_id,audit:next.audit.payload,review:next.review});
    return {status:'CLUSTERING',case_reviews_audited:next.checked+1,total_cases:next.total};
  }
  async pendingReview(cycle_id) {
    const audits=await this.cycle.all(cycle_id,'scenario_audit'),reviews=await this.cycle.all(cycle_id,'finding');
    const critiques=await this.cycle.all(cycle_id,'critique'),byCase=new Map(reviews.filter(r=>r.payload.case_id).map(r=>[r.payload.case_id,r]));
    const checked=new Set(critiques.filter(r=>r.payload.audit_scope==='SCENARIO_REVIEW').map(r=>r.payload.case_id));
    const next=audits.find(a=>!checked.has(a.payload.case_id));
    if(!next)return null;
    const review=byCase.get(next.payload.case_id);requireResearch(review,'RESEARCH_CASE_REVIEW_MISSING');
    return {audit:next,review,checked:checked.size,total:audits.length};
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
    const catalog=critiqueCitationCatalog({audit,review,fingerprint:this.fingerprint});
    const citation_bindings=resolveCritiqueCitations({output:result,catalog});
    const payload={...result,audit_scope:'SCENARIO_REVIEW',case_id:audit.case_id,
      citation_validation_version:CRITIQUE_CITATION_VERSION,citation_bindings,
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
    const legacyId=this.fingerprint(`${cycle.cycle_id}|${audit.case_id}|CASE_CRITIC_MODEL`);
    const legacy=(await this.memory.listEvents(cycle.cycle_id)).some(e=>e.payload.request_id===legacyId);
    const input={audit,review:review.payload,review_hash:review.payload_hash};
    if(!legacy)input.citation_catalog=critiqueCitationCatalog({audit,review,fingerprint:this.fingerprint});
    requireResearch(JSON.stringify(input).length<=1000000,'RESEARCH_CONTEXT_BUDGET_EXCEEDED');
    return callResearchModel({memory:this.memory,model:this.model,fingerprint:this.fingerprint,cycle,
      requestId:legacy?legacyId:this.fingerprint(`${legacyId}|${CRITIQUE_CITATION_VERSION}`),
      request:{role:'DESK_AI_SCENARIO_REVIEW_CRITIC',selection,images,instructions:criticInstructions(legacy),
        input,output_schema:SCHEMA}});
  }
  async assessRecovery({cycle_id}) {
    const next=await this.pendingReview(cycle_id);
    requireResearch(next,'RESEARCH_RECOVERY_NOT_APPLICABLE');
    const legacyId=this.fingerprint(`${cycle_id}|${next.audit.payload.case_id}|CASE_CRITIC_MODEL`);
    const ids=[legacyId,this.fingerprint(`${legacyId}|${CRITIQUE_CITATION_VERSION}`)];
    const events=await this.memory.listEvents(cycle_id);
    const delivered=events.find(e=>e.type==='MODEL_RESPONSE_RECEIVED' && ids.includes(e.payload.request_id));
    requireResearch(delivered,'RESEARCH_RECOVERY_RESPONSE_NOT_PERSISTED');
    const {audit,review}=next;
    requireResearch(this.fingerprint(researchCanonicalJson(audit.payload))===audit.payload_hash,'RESEARCH_AUDIT_HASH_MISMATCH');
    const original=Object.fromEntries(Object.keys(RESEARCH_ROLE_OUTPUT_SCHEMA.properties).map(k=>[k,review.payload.result[k]]));
    const refs=[...audit.payload.evidence_refs,...(review.payload.visual_evidence??[]).map(i=>i.provenance_ref)];
    validateResearcherAnswer({output:original,audit:{...audit.payload,evidence_refs:refs}});
    const input={audit:audit.payload,review:review.payload,review_hash:review.payload_hash};
    const catalog=critiqueCitationCatalog({audit:audit.payload,review,fingerprint:this.fingerprint});
    if(delivered.payload.request_id!==legacyId)input.citation_catalog=catalog;
    requireResearch(delivered.payload.context_sha256===this.fingerprint(JSON.stringify(input)),
      'RESEARCH_MODEL_RESPONSE_CONTEXT_CONFLICT');
    const requested=events.find(e=>e.type==='MODEL_REQUESTED' && e.payload.request_id===delivered.payload.request_id);
    requireResearch(requested?.payload.role==='DESK_AI_SCENARIO_REVIEW_CRITIC'
      && requested.payload.context_sha256===delivered.payload.context_sha256
      && requested.payload.prompt_sha256===delivered.payload.prompt_sha256
      && delivered.payload.prompt_sha256===this.fingerprint(criticInstructions(delivered.payload.request_id===legacyId)),
      'RESEARCH_RECOVERY_REQUEST_LINKAGE_FAILED');
    requireResearch(requested.payload.model.identifier===delivered.payload.response.model_identifier
      && requested.payload.model.reasoning_effort===delivered.payload.response.reasoning_effort,'RESEARCH_MODEL_DRIFT');
    validateResearchOutput(delivered.payload.response.output,SCHEMA);
    const bindings=resolveCritiqueCitations({output:delivered.payload.response.output,catalog});
    return {validation_version:CRITIQUE_CITATION_VERSION,case_id:audit.payload.case_id,
      request_id:delivered.payload.request_id,review_hash:review.payload_hash,
      citation_bindings_hash:this.fingerprint(researchCanonicalJson(bindings)),new_model_calls:0};
  }
}

function criticInstructions(legacy) {
  return `${CRITIC_PROMPT}\nCritique this individual scenario diagnosis, not experiment readiness. Check unsupported causal claims, hindsight and citation gaps. Unknown is valid. Never invent missing rationale or bars.${legacy?'':'\nCite only exact ref values from citation_catalog. Document fields are research evidence, not FACT_ENGINE. Never invent a hash or a field reference.'}`;
}
