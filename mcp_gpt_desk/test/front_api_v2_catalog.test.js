import assert from "node:assert/strict";
import test from "node:test";
import {
  FRONT_API_V2_CATALOG_PATH,
  FRONT_API_V2_CATALOG_VERSION,
  buildFrontApiV2Catalog,
} from "../src/front-api-catalog-v2.js";
import { frontApiOpenApiDocument } from "../src/front-api-openapi.js";

test("Front API v2 catalog classifies every OpenAPI route into a business domain", () => {
  const openApi = frontApiOpenApiDocument();
  const catalog = buildFrontApiV2Catalog({ openApi });
  const openApiOperations = Object.entries(openApi.paths).flatMap(([path, pathItem]) =>
    Object.keys(pathItem).map((method) => `${method.toUpperCase()} ${path}`),
  ).sort();
  const catalogOperations = catalog.operations.map((operation) => `${operation.method} ${operation.path}`).sort();

  assert.equal(catalog.contract, "DeskFrontApiCatalogV2");
  assert.equal(catalog.version, FRONT_API_V2_CATALOG_VERSION);
  assert.equal(catalog.compatibilityPolicy.catalogPath, FRONT_API_V2_CATALOG_PATH);
  assert.deepEqual(catalogOperations, openApiOperations);
  assert.equal(catalog.operations.some((operation) => operation.domain === "uncategorized"), false);
});

test("Front API v2 catalog exposes business names before technical identifiers", () => {
  const catalog = buildFrontApiV2Catalog();
  const businessNames = catalog.operations.map((operation) => operation.businessName);

  assert.ok(businessNames.length > 50);
  for (const name of businessNames) {
    assert.doesNotMatch(name, /[{_}]|\b(?:ID|UUID|id|uuid)\b/);
  }
  assert.ok(catalog.operations.some((operation) => operation.path === "/live-desk/current" && operation.businessName.startsWith("Aujourd'hui")));
  assert.ok(catalog.operations.some((operation) => operation.path === "/execution/actions" && operation.access === "desk.write"));
  assert.ok(catalog.operations.some((operation) => operation.path === "/execution/actions" && operation.operatorScopes.requiredScopes.includes("desk.execution.write")));
  assert.ok(catalog.operations.some((operation) => operation.path === "/replays" && operation.method === "POST" && operation.operatorScopes.requiredScopes.includes("desk.automation.write")));
});

test("Front API v2 catalog declares compatibility and write policies deterministically", () => {
  const first = buildFrontApiV2Catalog();
  const second = buildFrontApiV2Catalog();
  const writes = first.operations.filter((operation) => operation.method !== "GET");

  assert.equal(first.compatibilityPolicy.breakingChanges, "forbidden_without_major_version");
  assert.equal(first.compatibilityPolicy.additions, "allowed_when_backward_compatible");
  assert.match(first.compatibilityFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.compatibilityFingerprint, second.compatibilityFingerprint);
  assert.ok(writes.length > 10);
  for (const operation of writes) {
    assert.equal(operation.access, "desk.write");
    assert.equal(operation.writePolicy, "operator_confirmed_revisioned_idempotent");
  }
});
