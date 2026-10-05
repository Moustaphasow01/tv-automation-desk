export const RESEARCH_VERSION = "T3_INTELLIGENCE_V1";
export const missing = field => ({ available: false, reason: "NOT_PERSISTED", field });

export function requireResearch(condition, code, details = {}) {
  if (!condition) throw Object.assign(new Error(code), { code, details });
}

/** Missing numbers never become zero, and descriptive strings never become market facts. */
export function observation(value, refs, field) {
  if (value === null || value === undefined || value?.available === false) return missing(field);
  return { available: true, value, evidence_refs: [...new Set(refs.filter(Boolean))], classification: "DERIVED_LOCAL" };
}

export function sourceIdentity(day) {
  requireResearch(day.forensic_integrity_status === "PASS", "RESEARCH_SOURCE_INTEGRITY_FAILED", { date: day.date });
  for (const key of ["plan_sha256", "manifest_sha256", "snapshot_sha256"]) {
    requireResearch(/^[a-f0-9]{64}$/.test(day[key]), "RESEARCH_SOURCE_HASH_REQUIRED", { key, date: day.date });
  }
  return { date: day.date, plan_sha256: day.plan_sha256, manifest_sha256: day.manifest_sha256,
    snapshot_sha256: day.snapshot_sha256, sample_purpose: day.sample_purpose, scorable: day.scorable };
}

export function validateCitedClaims({ claims, allowedRefs }) {
  const known = new Set(allowedRefs);
  for (const claim of claims) {
    requireResearch(typeof claim.statement === "string" && claim.statement.length > 0, "RESEARCH_CLAIM_REQUIRED");
    requireResearch(["INTERPRETATION", "HYPOTHESIS", "UNKNOWN"].includes(claim.kind), "RESEARCH_CLAIM_KIND_INVALID");
    requireResearch(claim.kind === "UNKNOWN" || claim.evidence_refs?.length > 0, "RESEARCH_CITATION_REQUIRED");
    const unknown_refs=(claim.evidence_refs ?? []).filter(ref => !known.has(ref));
    requireResearch(unknown_refs.length===0, "RESEARCH_CITATION_UNKNOWN", {unknown_refs,
      scope:'RESEARCHER_CLAIM',automatic_paid_retry:false});
    requireResearch(claim.kind !== "UNKNOWN" || Boolean(claim.missing_reason), "RESEARCH_UNKNOWN_REASON_REQUIRED");
  }
}

export function uniqueResearchCases(cases) {
  return [...new Map(cases.map(c => [c.case_id, c])).values()];
}
