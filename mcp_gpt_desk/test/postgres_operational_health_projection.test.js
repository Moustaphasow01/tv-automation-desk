import assert from "node:assert/strict";
import test from "node:test";

import { projectOperationalServices } from "../src/persistence/postgres-operational-health.js";

test("optional stopped services do not degrade current operational health", () => {
  const result = projectOperationalServices([
    { service_id: "live_runtime_scheduler", status: "healthy", age_seconds: 5 },
    { service_id: "retired_research_burst", status: "stopped", age_seconds: 800000 },
  ], { expectedServices: ["live_runtime_scheduler"] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missingServices, []);
  assert.deepEqual(result.services.map((service) => service.service_id), ["live_runtime_scheduler"]);
});

test("an expected stopped service remains visible and degrades health", () => {
  const result = projectOperationalServices([
    { service_id: "live_runtime_scheduler", status: "stopped", age_seconds: 5 },
  ], { expectedServices: ["live_runtime_scheduler"] });

  assert.equal(result.ok, false);
  assert.equal(result.services[0].healthy, false);
});

test("an optional worker stuck in stopping remains degraded until retired", () => {
  const result = projectOperationalServices([
    { service_id: "live_runtime_scheduler", status: "healthy", age_seconds: 5 },
    { service_id: "stuck_worker", status: "stopping", age_seconds: 120 },
  ], { expectedServices: ["live_runtime_scheduler"] });

  assert.equal(result.ok, false);
});
