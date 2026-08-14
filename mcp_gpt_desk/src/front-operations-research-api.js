export const FRONT_RESEARCH_STATIC_PATHS = [
  "/api/v1/research/overview",
  "/api/v1/research/experiments",
  "/api/v1/research/candidates",
  "/api/v1/research/evaluation-reports",
  "/api/v1/research/actions",
];

export function isFrontOperationsResearchPath(pathname) {
  return FRONT_RESEARCH_STATIC_PATHS.includes(pathname)
    || /^\/api\/v1\/research\/(?:experiments|candidates)\/[^/]+$/.test(pathname);
}

export function frontOperationsResearchMethodAllowed(pathname, method) {
  if (!pathname.startsWith("/api/v1/research/")) return null;
  if (pathname === "/api/v1/research/actions") return method === "POST";
  return method === "GET";
}

export async function handleFrontOperationsResearch(store, { pathname, method = "GET", query = {}, body = {}, actor = {} }) {
  if (pathname === "/api/v1/research/overview") return handled(await store.getResearchLabOverview(researchQuery(query, actor)));
  if (pathname === "/api/v1/research/experiments") return handled(await store.listResearchExperiments(researchQuery(query, actor)));
  let match = pathname.match(/^\/api\/v1\/research\/experiments\/([^/]+)$/);
  if (match) return handled(await store.getResearchExperiment({ research_experiment_id: decode(match[1]) }));
  if (pathname === "/api/v1/research/candidates") return handled(await store.listResearchCandidates(researchQuery(query, actor)));
  match = pathname.match(/^\/api\/v1\/research\/candidates\/([^/]+)$/);
  if (match) return handled(await store.getResearchCandidate({ research_candidate_id: decode(match[1]) }));
  if (pathname === "/api/v1/research/evaluation-reports") return handled(await store.listResearchEvaluationReports(researchQuery(query, actor)));
  if (pathname === "/api/v1/research/actions" && method === "POST") {
    return handled(await store.executeResearchLabAction({ input: body || {}, actor }));
  }
  return { handled: false, result: null };
}

function researchQuery(query = {}, actor = {}) {
  return {
    audience: pickQuery(query, ["audience"], "front"),
    actor,
    researchExperimentId: pickQuery(query, ["research_experiment_id", "researchExperimentId", "experiment_id"]),
    researchHypothesisId: pickQuery(query, ["research_hypothesis_id", "researchHypothesisId", "hypothesis_id"]),
    researchCandidateId: pickQuery(query, ["research_candidate_id", "researchCandidateId", "candidate_id"]),
    status: pickQuery(query, ["status"]),
    verdict: pickQuery(query, ["verdict"]),
    reportKind: pickQuery(query, ["report_kind", "reportKind"]),
    owner: pickQuery(query, ["owner"]),
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

function pickQuery(query, keys, fallback = null) {
  for (const key of keys) {
    if (query[key] !== undefined && query[key] !== null && query[key] !== "") return query[key];
  }
  return fallback;
}

function handled(result) {
  return { handled: true, result };
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
