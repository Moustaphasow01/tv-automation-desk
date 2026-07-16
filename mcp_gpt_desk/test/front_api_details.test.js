import test from "node:test";
import assert from "node:assert/strict";
import {
  isFrontDetailPath,
  loadFrontDetailResource,
  matchFrontDetailRoute,
} from "../src/front-api-details.js";
import { frontApiOpenApiDocument } from "../src/front-api-openapi.js";

const scope = {
  strategy_id: "asia_open",
  session: "asia_open",
  trading_date: "2026-07-14",
  date: "2026-07-14",
  mode: "live",
  run_id: "front_live_2026-07-14_asia_open",
  as_of_utc: "2026-07-14T08:15:00.000Z",
  timezone: "Europe/Paris",
};

function detailStore() {
  return {
    async getLiveDeskState(input) {
      return {
        ...input,
        resolved_scope: input,
        desk_status: "THESIS_ACTIVE",
        action_now: { decision: "WAIT", message: "Surveiller le support." },
        active_thesis: {
          thesis_id: "thesis-1", instrument: "MNQ", direction: "long", status: "THESIS_ACTIVE",
          confidence_pct: 65, health_score: 70, dominant_scenario: "Support conservé.",
        },
        latest_master: { analysis_id: "master-1", instrument: "MNQ" },
        active_position: { status: "active", instrument: "MNQ", direction: "long", entry_price: 22_000 },
        key_levels: [{ price: 22_000, role: "support", state: "tested" }],
        data_readiness: {},
        jobs: [],
        alerts: [],
        contracts: {},
      };
    },
    async getLatestMasterAnalysis() {
      return {
        analysis: {
          analysis_id: "master-1",
          created_at_paris: "2026-07-14T08:00:00+02:00",
          full_analysis: {
            executive_summary: {
              final_decision: "WAIT",
              final_instrument: "MNQ",
              final_direction: "long",
              confidence_pct: 65,
              summary: "Plan Master courant.",
            },
            expected_path: ["Support tenu"],
            failure_path: ["Support cassé"],
          },
        },
      };
    },
    async getLatestManualMonitor() { return { monitors: [] }; },
    async getLatestHourlyMonitor() {
      return {
        monitors: [{
          monitor_id: "monitor-1",
          timestamp_paris: "2026-07-14T08:15:00+02:00",
          sequence: 1,
          monitor_decision: { action: "WAIT", reason_summary: "Le support reste valide." },
          thesis_health_score: { previous_score: 68, current_score: 70 },
          active_thesis_update: { status: "THESIS_ACTIVE" },
          conditions_go: [{ condition: "Cassure résistance", status: "not_triggered", proof: "Sous résistance", impact: "Attendre" }],
          invalidations: [{ condition: "Cassure support", status: "not_triggered", proof: "Support tenu", impact: "Maintien" }],
        }],
      };
    },
    async getAuditState() { return { anti_lookahead: {}, errors: [] }; },
    async getSessionSnapshot() { return {}; },
    async getDeskSetups() {
      return {
        setups: [{
          setup_id: "setup-1", label: "Rebond support", instrument: "MNQ", direction: "long", status: "ARMED",
          entry_zone: { from: 22_000, to: 22_010 }, stop_loss: 21_980, take_profit_1: 22_040,
        }],
      };
    },
  };
}

test("detail route matcher recognizes every parameterized BFF route", () => {
  assert.deepEqual(matchFrontDetailRoute("/api/v1/masters/master-1"), { kind: "master", id: "master-1" });
  assert.deepEqual(matchFrontDetailRoute("/api/v1/theses/thesis-1/conditions"), { kind: "conditions", id: "thesis-1" });
  assert.deepEqual(matchFrontDetailRoute("/api/v1/sessions/asia_open/2026-07-14/timeline"), {
    kind: "timeline", strategyId: "asia_open", date: "2026-07-14",
  });
  assert.equal(isFrontDetailPath("/api/v1/setups/setup-1"), true);
  assert.equal(isFrontDetailPath("/api/v1/unknown/value"), false);
});

test("detail resources expose only the requested projected entity", async () => {
  const store = detailStore();
  const routes = {
    "/api/v1/sessions/asia_open/2026-07-14/overview": ["DeskFrontSessionOverviewResource", "overview"],
    "/api/v1/sessions/asia_open/2026-07-14/timeline": ["DeskFrontTimelineResource", "timeline"],
    "/api/v1/masters/master-1": ["DeskFrontMasterResource", "master"],
    "/api/v1/monitors/monitor-1": ["DeskFrontMonitorResource", "monitor"],
    "/api/v1/theses/thesis-1": ["DeskFrontThesisResource", "thesis"],
    "/api/v1/theses/thesis-1/conditions": ["DeskFrontThesisConditionsResource", "go"],
    "/api/v1/setups/setup-1": ["DeskFrontSetupResource", "setup"],
  };

  for (const [pathname, [contract, property]] of Object.entries(routes)) {
    const resource = await loadFrontDetailResource(store, pathname, scope);
    assert.equal(resource.contract, contract, pathname);
    assert.equal(resource.schemaVersion, "1.0.0", pathname);
    assert.ok(property in resource, pathname);
  }
});

test("detail resources preserve canonical IDs, conditions, position and timeline", async () => {
  const store = detailStore();
  const [master, monitor, thesis, conditions, setup, timeline] = await Promise.all([
    loadFrontDetailResource(store, "/api/v1/masters/master-1", scope),
    loadFrontDetailResource(store, "/api/v1/monitors/monitor-1", scope),
    loadFrontDetailResource(store, "/api/v1/theses/thesis-1", scope),
    loadFrontDetailResource(store, "/api/v1/theses/thesis-1/conditions", scope),
    loadFrontDetailResource(store, "/api/v1/setups/setup-1", scope),
    loadFrontDetailResource(store, "/api/v1/sessions/asia_open/2026-07-14/timeline", scope),
  ]);

  assert.equal(master.master.id, "master-1");
  assert.equal(monitor.monitor.id, "monitor-1");
  assert.equal(thesis.thesis.id, "thesis-1");
  assert.equal(conditions.monitorId, "monitor-1");
  assert.equal(conditions.go[0].label, "Cassure résistance");
  assert.equal(setup.setup.id, "setup-1");
  assert.equal(setup.position.entry, 22_000);
  assert.equal(timeline.timeline.some((event) => event.type === "MASTER"), true);
  assert.equal(timeline.timeline.some((event) => event.type === "MONITOR"), true);
});

test("a detail ID outside the current canonical scope returns a deterministic 404 error", async () => {
  await assert.rejects(
    () => loadFrontDetailResource(detailStore(), "/api/v1/masters/master-other", scope),
    (error) => error.code === "FRONT_DETAIL_NOT_FOUND" && error.statusCode === 404 && error.message === "master_not_found:master-other",
  );
});

test("OpenAPI publishes every current BFF route with resolvable component references", () => {
  const document = frontApiOpenApiDocument();
  const expectedPaths = [
    "/live-desk/current", "/sessions", "/sessions/{strategyId}/{date}/overview", "/sessions/{strategyId}/{date}/timeline",
    "/masters/{masterId}", "/monitors/{monitorId}", "/theses/{thesisId}", "/theses/{thesisId}/conditions",
    "/setups/{setupId}", "/positions/current", "/market/snapshot", "/macro/calendar", "/news/headlines",
    "/news/digest", "/desk/activity", "/alerts", "/audit", "/performance/calendar", "/performance/day",
    "/operator/state", "/operator/commands", "/openapi.json",
    "/operations/summary", "/workflows", "/workflows/{workflowId}", "/workflows/{workflowId}/steps",
    "/workflows/{workflowId}/events", "/workflows/{workflowId}/actions", "/replays", "/replays/compare",
    "/replays/{runId}", "/replays/{runId}/days", "/replays/{runId}/days/{date}",
    "/replays/{runId}/sessions/{sessionExecutionId}", "/replays/{runId}/timeline", "/replays/{runId}/price-series",
    "/gpt-processes", "/gpt-processes/{processId}", "/performance/overview", "/incidents",
    "/incidents/{incidentId}/actions", "/history/sessions", "/strategies",
    "/strategies/{strategyId}/versions/compare", "/events",
  ];

  assert.equal(document.openapi, "3.1.0");
  assert.deepEqual(Object.keys(document.paths).sort(), expectedPaths.sort());
  assert.equal(document.paths["/masters/{masterId}"].get.operationId, "getMaster");
  assert.deepEqual(document.paths["/operator/commands"].post.security, [{ BearerAuth: [] }, { DeskApiKey: [] }]);
  assert.equal(document.paths["/operator/commands"].post.responses["409"].description.includes("Revision"), true);

  const serialized = JSON.stringify(document);
  const refs = [...serialized.matchAll(/"\$ref":"#\/components\/([^/]+)\/([^"/]+)"/g)];
  assert.ok(refs.length > 20);
  for (const [, section, name] of refs) {
    assert.ok(document.components[section]?.[name], `unresolved OpenAPI ref: ${section}/${name}`);
  }
});
