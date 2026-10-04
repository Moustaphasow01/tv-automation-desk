import { requireResearch } from './research-evidence.js';

/** Quota affects technical admission only, never a scenario's analytical validity. */
export function researchResourceAdmission(snapshot,now) {
  requireResearch(Number.isFinite(Date.parse(now)),'RESEARCH_RESOURCE_CLOCK_INVALID');
  const windows=snapshot?.windows??[];
  const exhausted=windows.filter(w=>w.used_percent>=100 && (!w.resets_at || Date.parse(w.resets_at)>Date.parse(now)));
  const reset=exhausted.map(w=>Date.parse(w.resets_at)).filter(Number.isFinite);
  return {allowed:exhausted.length===0,quota_known:windows.length>0,
    reason:exhausted.length?'PROVIDER_QUOTA_EXHAUSTED':windows.length?'PROVIDER_QUOTA_AVAILABLE':'PROVIDER_QUOTA_UNKNOWN',
    resume_at:exhausted.length?new Date(reset.length?Math.max(...reset):Date.parse(now)+300000).toISOString():null,
    source:snapshot?.source??'NOT_AVAILABLE',snapshot};
}
