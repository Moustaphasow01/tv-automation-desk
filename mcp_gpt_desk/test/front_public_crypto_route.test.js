import test from "node:test";
import assert from "node:assert/strict";
import { handleFrontControlPlaneHttp, isFrontControlPlaneMethodAllowed, isFrontControlPlaneWriteRequest } from "../src/front-api-server-adapter.js";
import { cryptoObservationOpenApiPaths } from "../src/front-api-openapi-crypto.js";
import { cachedReadResponse, errorResponses } from "../src/front-api-openapi-responses.js";

const pathname = "/front-api/v1/views/crypto-market";
test("extracted response documentation preserves legacy references and cache semantics", () => {
  assert.deepEqual(cachedReadResponse("#/components/schemas/Example"), {
    description: "Successful response", headers: { ETag: { $ref: "#/components/headers/ETag" }, "Cache-Control": { $ref: "#/components/headers/CacheControl" } },
    content: { "application/json": { schema: { $ref: "#/components/schemas/Example" } } },
  });
  assert.deepEqual(Object.keys(errorResponses), ["400", "401", "403", "404", "500"]);
});
test("public observations are a GET-only view with no command permission or request body", async () => {
  assert.equal(isFrontControlPlaneWriteRequest(pathname, "GET"), false);
  assert.equal(isFrontControlPlaneMethodAllowed(pathname, "POST"), false);
  let bodyReads = 0;
  await assert.rejects(handleFrontControlPlaneHttp({ pathname, req: { method: "POST" }, readJsonBody() { bodyReads++; } }), { statusCode: 405 });
  assert.equal(bodyReads, 0);
});
test("invalid scope is rejected before any provider request or store access", async () => {
  await assert.rejects(handleFrontControlPlaneHttp({ pathname, query: { instrument: "ETHUSD" }, req: { method: "GET" }, store: new Proxy({}, { get() { throw new Error("Store must not be touched"); } }) }), { code: "FRONT_CRYPTO_SCOPE_INVALID" });
});
test("published contract separates observation from canonical execution and limits provider scope", () => {
  const path = cryptoObservationOpenApiPaths()[pathname];
  assert.deepEqual(Object.keys(path), ["get"]);
  assert.equal(path.get.responses["200"].content["application/json"].schema.properties.permissions.maxItems, 0);
  assert.equal(path.get.parameters.find((item) => item.name === "instrument").schema.enum.length, 3);
});
