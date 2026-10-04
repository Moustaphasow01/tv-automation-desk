/** Resource routing is research-only; it neither changes a scenario nor infers missing events. */
export function forensicDepthRoute(audit) {
  const level = evidenceDepth(audit);
  const triggers = [];
  if (level >= 2 && audit.coverage?.continuous_market_path?.available !== true) triggers.push('STRUCTURED_PATH_INSUFFICIENT');
  if (level >= 3) triggers.push('HTF_CONTEXT_REQUIRED');
  if (level === 4) triggers.push('EVIDENCE_CONTRADICTION');
  return { version: 'RESEARCH_RESOURCE_ROUTE_V1', level, context_budget_tokens: [12000,16000,24000,32000,48000][level],
    visual_required: triggers.length > 0, visual_triggers: triggers, auditor_depth: level >= 3 ? 'DEEP' : 'STANDARD',
    requested_artifacts: level >= 3 ? ['premarket/4h_global.png','replay/15m_final.png','replay/dashboard_final.png']
      : level === 2 ? ['replay/15m_final.png','replay/dashboard_final.png'] : [] };
}

function evidenceDepth(audit) {
  const observed = audit.observations ?? {}, reasons = observed.reason_codes ?? [];
  if (audit.evidence_contradictions?.length) return 4;
  if (observed.filled === true || audit.attempt > 1 || reasons.includes('TARGET_BEFORE_ORDER')) return 3;
  if (observed.confirmed === true || observed.admitted === true || observed.refused === true) return 2;
  if (observed.activated === true) return 1;
  return 0;
}

export function visualClaims({ result, images }) {
  const refs = new Set(images.map(i => i.provenance_ref));
  return result.answers.filter(a => a.kind !== 'UNKNOWN' && a.evidence_refs.some(r => refs.has(r)))
    .map(a => ({ question_id: a.question_id, visual_claim: a.statement,
      artifact_refs: a.evidence_refs.filter(r => refs.has(r)), confidence: 'UNCALIBRATED_INTERPRETATION' }));
}
