import { createHash } from "node:crypto";
import { frontApiOpenApiDocument } from "./front-api-openapi.js";
import { operatorAccessPolicyForFrontRoute } from "./operator-access-policy-v1.js";

export const FRONT_API_V2_CATALOG_PATH = "/api/v2/catalog.json";
export const FRONT_API_V2_CATALOG_VERSION = "2.0.0";

const DOMAIN_RULES = [
  { id: "today", label: "Aujourd'hui", order: 10, match: (path) => /^\/(?:front-api\/v1\/views\/crypto-market$|live-desk|sessions|masters|monitors|theses|setups|positions|market|macro|news|desk|alerts|audit|performance\/(?:calendar|day))/.test(path) },
  { id: "operations", label: "Opérations", order: 20, match: (path) => /^\/(?:operations|workflows|replays|gpt-processes|observability|incidents|notifications|runbooks|history|events)/.test(path) },
  { id: "performance", label: "Performance", order: 30, match: (path) => /^\/(?:performance\/overview|simulation-runs)/.test(path) },
  { id: "strategy", label: "Stratégies", order: 40, match: (path) => /^\/(?:strategies|strategy-v2)/.test(path) },
  { id: "research", label: "Recherche", order: 50, match: (path) => /^\/research/.test(path) },
  { id: "data_foundation", label: "Fondation données", order: 60, match: (path) => /^\/data-foundation/.test(path) },
  { id: "execution", label: "Exécution", order: 70, match: (path) => /^\/execution/.test(path) },
  { id: "governance", label: "Gouvernance", order: 80, match: (path) => /^\/(?:operator|portfolio-risk|ai-context|openapi)/.test(path) },
];

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"];

export function buildFrontApiV2Catalog({ openApi = frontApiOpenApiDocument() } = {}) {
  const operations = Object.entries(openApi.paths || {})
    .flatMap(([path, pathItem]) => METHOD_ORDER
      .filter((method) => pathItem?.[method])
      .map((method) => buildOperationContract(path, method, pathItem[method])))
    .sort((left, right) => left.domainOrder - right.domainOrder || left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
  const domains = DOMAIN_RULES
    .map((domain) => ({
      id: domain.id,
      label: domain.label,
      operationCount: operations.filter((operation) => operation.domain === domain.id).length,
      paths: [...new Set(operations.filter((operation) => operation.domain === domain.id).map((operation) => operation.path))],
    }))
    .filter((domain) => domain.operationCount > 0);
  const signature = operations.map(({ method, path, operationId, responseSchemas, requestSchema, stability }) => ({
    method, path, operationId, requestSchema, responseSchemas, stability,
  }));
  return {
    contract: "DeskFrontApiCatalogV2",
    version: FRONT_API_V2_CATALOG_VERSION,
    generatedFrom: { openapi: openApi.openapi, title: openApi.info?.title || "Desk Front API", version: openApi.info?.version || "unknown" },
    compatibilityPolicy: {
      currentBasePath: "/api/v1",
      catalogPath: FRONT_API_V2_CATALOG_PATH,
      breakingChanges: "forbidden_without_major_version",
      additions: "allowed_when_backward_compatible",
      deprecationMinimumNotice: "one_major_version",
      namingPolicy: "business_label_first_technical_identifiers_second",
    },
    domains,
    operations: operations.map(({ domainOrder, ...operation }) => operation),
    compatibilityFingerprint: hashJson(signature),
  };
}

function buildOperationContract(path, method, operation) {
  const domain = classifyDomain(path);
  const operatorScopes = operatorAccessPolicyForFrontRoute({ path, method });
  const responseSchemas = schemaRefs(operation.responses || {});
  const requestSchema = schemaRefs(operation.requestBody || {})[0] || null;
  const isWrite = method !== "get";
  return {
    domain: domain.id,
    domainLabel: domain.label,
    domainOrder: domain.order,
    method: method.toUpperCase(),
    path,
    operationId: operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_")}`,
    businessName: `${domain.label} — ${normalizeBusinessSummary(operation.summary || operation.operationId || path)}`,
    summary: operation.summary || null,
    stability: path === "/openapi.json" ? "compatibility_reference" : "stable",
    audience: ["current_front", "future_front_v3", isWrite ? "operator_console" : "read_model"],
    access: isWrite ? "desk.write" : "desk.read",
    operatorScopes,
    writePolicy: isWrite ? "operator_confirmed_revisioned_idempotent" : "read_only_cacheable_when_declared",
    requestSchema,
    responseSchemas,
    technical: {
      tags: Array.isArray(operation.tags) ? operation.tags : [],
      security: operation.security || null,
    },
  };
}

function classifyDomain(path) {
  return DOMAIN_RULES.find((domain) => domain.match(path)) || { id: "uncategorized", label: "Non classé", order: 999 };
}

function normalizeBusinessSummary(value) {
  return String(value || "")
    .replace(/\bGet\b/g, "Consulter")
    .replace(/\bRead\b/g, "Consulter")
    .replace(/\bList\b/g, "Lister")
    .replace(/\bCreate\b/g, "Créer")
    .replace(/\bUpdate\b/g, "Mettre à jour")
    .replace(/\bExecute\b/g, "Exécuter")
    .replace(/Last-Event-ID/g, "curseur de reprise")
    .replace(/\bGPT\b/g, "IA")
    .replace(/\bBFF\b/g, "API front")
    .replace(/\s+/g, " ")
    .trim();
}

function schemaRefs(value, output = new Set()) {
  if (!value || typeof value !== "object") return [...output].sort();
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/schemas/")) output.add(value.$ref);
  for (const child of Object.values(value)) schemaRefs(child, output);
  return [...output].sort();
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
