import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_ERROR_REGISTRY,
  ERROR_CATEGORIES,
  ERROR_SEVERITIES,
  PROBLEM_DETAILS_SCHEMA_VERSION,
  isRetryableProblem,
  normalizeDeskErrorCode,
  operatorMessageForProblem,
  problemDetailsFromError,
} from "../index.js";

describe("Problem Details", () => {
  it("creates a stable operator-safe problem from a domain error", () => {
    const error = new Error("scope mismatch between claim and bundle");
    error.code = "DESK_SCOPE_INTEGRITY_FAILED";
    error.details = { claim_session: "asia_open", bundle_session: "ny_open" };

    const problem = problemDetailsFromError(error, {
      traceId: "trace_1",
      instance: "/api/live/claim",
    });

    assert.equal(problem.schema_version, PROBLEM_DETAILS_SCHEMA_VERSION);
    assert.equal(problem.code, "DESK_SCOPE_INTEGRITY_FAILED");
    assert.equal(problem.status, 409);
    assert.equal(problem.category, "business");
    assert.equal(problem.operator_message, "Le périmètre du travail ne correspond pas au contexte attendu.");
    assert.equal(problem.trace_id, "trace_1");
    assert.equal("technical_details" in problem, false);
  });

  it("keeps technical details only when explicitly requested", () => {
    const error = new Error("db timeout");
    error.code = "DESK_DEPENDENCY_UNAVAILABLE";
    error.details = { dependency: "postgres" };

    const problem = problemDetailsFromError(error, { includeTechnicalDetails: true });

    assert.equal(problem.status, 503);
    assert.equal(isRetryableProblem(problem), true);
    assert.deepEqual(problem.technical_details.details, { dependency: "postgres" });
  });

  it("falls back to a known internal error code", () => {
    const problem = problemDetailsFromError("unknown legacy string");
    assert.equal(problem.code, "DESK_INTERNAL_ERROR");
    assert.equal(normalizeDeskErrorCode("DESK_STALE_DATA"), "DESK_STALE_DATA");
    assert.equal(operatorMessageForProblem(problem), DESK_ERROR_REGISTRY.DESK_INTERNAL_ERROR.operator_message);
  });

  it("keeps registry categories and severities canonical", () => {
    for (const [code, spec] of Object.entries(DESK_ERROR_REGISTRY)) {
      assert.match(code, /^DESK_[A-Z0-9_]+$/);
      assert.ok(ERROR_CATEGORIES.includes(spec.category), code);
      assert.ok(ERROR_SEVERITIES.includes(spec.severity), code);
      assert.equal(typeof spec.operator_message, "string");
      assert.ok(spec.operator_message.length > 0);
    }
  });
});
