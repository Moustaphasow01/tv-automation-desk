#!/usr/bin/env node
import {
  DESK_ERROR_REGISTRY,
  ERROR_CATEGORIES,
  ERROR_SEVERITIES,
  PROBLEM_DETAILS_SCHEMA_VERSION,
  problemDetailsFromError,
} from "../../packages/desk-domain/index.js";

const failures = [];
const codes = Object.keys(DESK_ERROR_REGISTRY);

if (PROBLEM_DETAILS_SCHEMA_VERSION !== "desk_problem_details_v1") {
  failures.push("unexpected problem details schema version");
}
if (codes.length < 8) failures.push("error registry must contain the common desk errors");

for (const code of codes) {
  const spec = DESK_ERROR_REGISTRY[code];
  if (!/^DESK_[A-Z0-9_]+$/.test(code)) failures.push(`${code}: invalid stable code`);
  if (!Number.isInteger(spec.status) || spec.status < 400 || spec.status > 599) failures.push(`${code}: invalid HTTP status`);
  if (!ERROR_CATEGORIES.includes(spec.category)) failures.push(`${code}: invalid category`);
  if (!ERROR_SEVERITIES.includes(spec.severity)) failures.push(`${code}: invalid severity`);
  if (typeof spec.retryable !== "boolean") failures.push(`${code}: retryable must be boolean`);
  if (!spec.operator_message || spec.operator_message === spec.title) failures.push(`${code}: operator message must be explicit`);
}

const sample = problemDetailsFromError({ code: "DESK_DEPENDENCY_UNAVAILABLE", message: "postgres timeout" });
if (sample.retryable !== true || sample.status !== 503) failures.push("dependency unavailable sample must be retryable 503");
if ("technical_details" in sample) failures.push("technical details must be opt-in");

if (failures.length) {
  console.error("[problem-details] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    schema_version: PROBLEM_DETAILS_SCHEMA_VERSION,
    codes: codes.length,
    categories: Object.fromEntries(ERROR_CATEGORIES.map((category) => [
      category,
      codes.filter((code) => DESK_ERROR_REGISTRY[code].category === category).length,
    ])),
    retryable_codes: codes.filter((code) => DESK_ERROR_REGISTRY[code].retryable),
  }, null, 2));
}
