import { forensicDepthRoute, visualClaims } from '../domain/research-evidence-routing.js';
import { RESEARCHER_PROMPT, RESEARCH_ROLE_OUTPUT_SCHEMA, validateResearcherAnswer } from '../domain/research-role-contract.js';
import { callResearchModel } from './research-model-call.js';

/** New context per attempt; only conclusively delivered invalid outputs may receive a bounded retry. */
export async function reviewResearchCase({ memory, model, fingerprint, cycle, selection, audit, readVisual, clock }) {
  const route = forensicDepthRoute(audit);
  const images = route.visual_required && readVisual ? await readVisual({ audit, route }) : [];
  const visual = images.map(({ data, ...metadata }) => metadata);
  const input = { ...audit, resource_route: route, visual_evidence: visual,
    evidence_refs: [...new Set([...audit.evidence_refs, ...images.map(i => i.provenance_ref)])] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const requestId = fingerprint(`${cycle.cycle_id}|${audit.case_id}|MODEL${attempt ? '|RETRY_1' : ''}`);
    const response = await callResearchModel({ memory, model, fingerprint, cycle, requestId,
      request: { role: 'DESK_AI_RESEARCHER', selection, instructions: RESEARCHER_PROMPT,
        input, images, output_schema: RESEARCH_ROLE_OUTPUT_SCHEMA } });
    try {
      const result = validateResearcherAnswer({ output: response.output, audit: input });
      return { case_id: audit.case_id, result, source_identity: audit.identity, model: selection, resource_route: route,
        visual_evidence_used: images.length > 0, visual_evidence: visual, visual_claims: visualClaims({ result, images }),
        prompt_sha256: cycle.definition.prompt_sha256, context_sha256: fingerprint(JSON.stringify(input)),
        generated_at: clock(), actual_telemetry: response.telemetry ?? null, status: 'UNREVIEWED' };
    } catch (error) {
      await memory.addEvent({ cycle_id: cycle.cycle_id, event_id: fingerprint(`${requestId}|OUTPUT_REJECTED`),
        type: 'MODEL_OUTPUT_REJECTED', payload: { request_id: requestId, code: error.code ?? 'RESEARCH_OUTPUT_INVALID',
          retry_allowed: attempt === 0, original_response_preserved: true } });
      if (attempt === 1) throw error;
    }
  }
}
