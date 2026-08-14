export const PROBLEM_DETAILS_SCHEMA_VERSION = "desk_problem_details_v1";

export const ERROR_CATEGORIES = Object.freeze([
  "business",
  "technical",
  "operator",
  "security",
  "data",
]);

export const ERROR_SEVERITIES = Object.freeze(["info", "warning", "error", "critical"]);

export const DESK_ERROR_REGISTRY = Object.freeze({
  DESK_VALIDATION_FAILED: errorSpec({
    status: 400,
    category: "business",
    severity: "warning",
    title: "Validation failed",
    operatorMessage: "La demande est incomplète ou incohérente.",
  }),
  DESK_UNAUTHORIZED: errorSpec({
    status: 401,
    category: "security",
    severity: "error",
    title: "Authentication required",
    operatorMessage: "Authentification opérateur requise.",
  }),
  DESK_FORBIDDEN: errorSpec({
    status: 403,
    category: "security",
    severity: "error",
    title: "Action forbidden",
    operatorMessage: "Action refusée par les règles de sécurité.",
  }),
  DESK_NOT_FOUND: errorSpec({
    status: 404,
    category: "business",
    severity: "warning",
    title: "Resource not found",
    operatorMessage: "La ressource demandée est introuvable.",
  }),
  DESK_CONFLICT: errorSpec({
    status: 409,
    category: "business",
    severity: "warning",
    title: "State conflict",
    operatorMessage: "L'état courant ne permet pas cette action.",
  }),
  DESK_SCOPE_INTEGRITY_FAILED: errorSpec({
    status: 409,
    category: "business",
    severity: "error",
    title: "Scope integrity failed",
    operatorMessage: "Le périmètre du travail ne correspond pas au contexte attendu.",
  }),
  DESK_STALE_DATA: errorSpec({
    status: 409,
    category: "data",
    severity: "warning",
    title: "Stale data",
    operatorMessage: "Les données sont trop anciennes pour valider l'action.",
  }),
  DESK_DATA_UNAVAILABLE: errorSpec({
    status: 424,
    category: "data",
    severity: "warning",
    title: "Required data unavailable",
    operatorMessage: "Une donnée obligatoire est indisponible.",
    retryable: true,
  }),
  DESK_RATE_LIMITED: errorSpec({
    status: 429,
    category: "technical",
    severity: "warning",
    title: "Rate limited",
    operatorMessage: "Le service limite temporairement les appels.",
    retryable: true,
  }),
  DESK_DEPENDENCY_UNAVAILABLE: errorSpec({
    status: 503,
    category: "technical",
    severity: "error",
    title: "Dependency unavailable",
    operatorMessage: "Un service dépendant ne répond pas.",
    retryable: true,
  }),
  DESK_OPERATOR_ACTION_REQUIRED: errorSpec({
    status: 409,
    category: "operator",
    severity: "warning",
    title: "Operator action required",
    operatorMessage: "Une action opérateur est requise avant de continuer.",
  }),
  DESK_INTERNAL_ERROR: errorSpec({
    status: 500,
    category: "technical",
    severity: "critical",
    title: "Internal error",
    operatorMessage: "Erreur interne du desk. Voir les logs techniques.",
  }),
});

export function problemDetailsFromError(error, options = {}) {
  const code = normalizeDeskErrorCode(error?.code || error?.error_code || error, options.fallbackCode);
  const spec = DESK_ERROR_REGISTRY[code] || DESK_ERROR_REGISTRY.DESK_INTERNAL_ERROR;
  const detail = text(options.detail || error?.message || spec.operator_message);
  const problem = {
    schema_version: PROBLEM_DETAILS_SCHEMA_VERSION,
    type: `https://trading-desk.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: spec.title,
    status: spec.status,
    detail,
    instance: text(options.instance) || null,
    code,
    category: spec.category,
    severity: spec.severity,
    retryable: spec.retryable,
    operator_message: spec.operator_message,
    trace_id: text(options.traceId || options.trace_id) || null,
  };
  if (options.includeTechnicalDetails === true) {
    problem.technical_details = technicalDetails(error, options);
  }
  return Object.freeze(problem);
}

export function normalizeDeskErrorCode(value, fallbackCode = "DESK_INTERNAL_ERROR") {
  const normalized = text(value).toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (DESK_ERROR_REGISTRY[normalized]) return normalized;
  const fallback = text(fallbackCode).toUpperCase();
  return DESK_ERROR_REGISTRY[fallback] ? fallback : "DESK_INTERNAL_ERROR";
}

export function isRetryableProblem(problem) {
  return problem?.retryable === true;
}

export function operatorMessageForProblem(problem) {
  const code = normalizeDeskErrorCode(problem?.code);
  return text(problem?.operator_message) || DESK_ERROR_REGISTRY[code].operator_message;
}

function errorSpec({ status, category, severity, title, operatorMessage, retryable = false }) {
  return Object.freeze({
    status,
    category,
    severity,
    title,
    operator_message: operatorMessage,
    retryable,
  });
}

function technicalDetails(error, options) {
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  return {
    details,
    cause: text(error?.cause?.message || options.cause) || null,
  };
}

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}
