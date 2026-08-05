import type { Page, Route } from "@playwright/test";
import { deskSessionFixture } from "@/test/fixtures/deskSessionFixture";
import type { DeskOperatorState, DeskSession, FrontResourceMeta } from "@/types";

export async function installDeskApiMock(page: Page) {
  const session = createSession();
  const meta = createMeta(session);
  let operatorState = createOperatorState(session, 0);

  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/v1/operator/commands" && request.method() === "POST") {
      operatorState = createOperatorState(session, operatorState.revision + 1);
      return json(route, {
        contract: "DeskFrontOperatorCommandResult",
        schemaVersion: "1.0.0",
        ok: true,
        idempotent: false,
        command: {
          id: "mock-command-1",
          type: "request_replan",
          status: "APPLIED",
          revision: operatorState.revision,
          auditId: "mock-audit-1",
          brokerExecution: false
        },
        operatorState,
        session
      });
    }

    const response = responseFor(path, session, meta, operatorState);
    if (response !== undefined) return json(route, response);
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: `unhandled_e2e_endpoint:${path}` })
    });
  });
}

function responseFor(path: string, session: DeskSession, meta: FrontResourceMeta, operatorState: DeskOperatorState) {
  if (path === "/api/v1/live-desk/current") return session;
  if (path === "/api/v1/market/snapshot") return {
    ...meta,
    lastDataAt: session.lastDataAt,
    market: session.market,
    marketBrief: session.marketBrief,
    crossAssetBrief: session.crossAssetBrief,
    levels: session.levels
  };
  if (path === "/api/v1/positions/current") return { ...meta, position: session.position };
  if (path === "/api/v1/macro/calendar") return { ...meta, nextMacro: session.nextMacro, nearEvent: false, macro: session.macro };
  if (path === "/api/v1/news/digest") return { ...meta, news: session.news };
  if (path === "/api/v1/news/headlines") return { ...meta, headlines: session.news.headlines };
  if (path === "/api/v1/desk/activity") return { ...meta, automation: session.automation, activity: session.activity };
  if (path === "/api/v1/alerts") return { ...meta, alerts: session.alerts };
  if (path === "/api/v1/audit") return { ...meta, dataQuality: session.dataQuality, audit: session.audit };
  if (path === "/api/v1/operator/state") return operatorState;
  if (path.startsWith("/api/v1/masters/")) return { ...meta, master: session.master };
  if (path.startsWith("/api/v1/monitors/")) return { ...meta, monitor: session.monitors.at(-1) };
  if (path.match(/^\/api\/v1\/sessions\/[^/]+\/[^/]+\/timeline$/)) return { ...meta, timeline: session.timeline };
  if (path.startsWith("/api/v1/setups/")) return { ...meta, setup: session.setup, position: session.position, levels: session.levels };
  if (path.endsWith("/conditions") && path.startsWith("/api/v1/theses/")) return {
    ...meta,
    thesisId: session.thesis.id,
    monitorId: session.monitors.at(-1)?.id || null,
    go: session.monitors.at(-1)?.goConditions || [],
    invalidations: session.monitors.at(-1)?.invalidationConditions || []
  };
  if (path.startsWith("/api/v1/theses/")) return { ...meta, thesis: session.thesis, levels: session.levels };
  return undefined;
}

function createSession(): DeskSession {
  const raw = JSON.parse(JSON.stringify(deskSessionFixture.sessions.ny_open));
  raw.master.sections = raw.master.sections.map((section: { title: string; body: string }) => ({
    title: section.title,
    content: section.body
  }));
  raw.currentCheckpointAt = raw.lastMonitorAt;
  raw.lastCompletedCheckpointAt = raw.lastMonitorAt;
  raw.nextCheckpointAt = raw.nextMonitorAt;
  raw.claim = {
    lastClaimAt: raw.lastMonitorAt,
    lastClaimAtUtc: "2026-07-13T15:45:00.000Z",
    workerId: "e2e-live-worker",
    nextTaskStatus: "waiting",
    nextTaskStatusLabel: "En attente",
    nextTaskWorkflow: "LIVE_M15_MONITOR",
    nextTaskLabel: "Monitor GPT M5",
    nextTaskCheckpoint: raw.nextMonitorAt,
    followingTaskCheckpoint: "18:15",
    followingTaskWorkflow: "LIVE_M15_MONITOR",
    lastCompletedCheckpoint: raw.lastMonitorAt,
    dueCheckpoint: raw.nextMonitorAt,
    readyAt: raw.nextMonitorAt,
    bundleReadyAt: raw.nextMonitorAt,
    latencySeconds: 42,
    latencyTargetSeconds: 120,
    latencyStatus: "on_target",
    bundleClaimLatencySeconds: 42,
    bundleClaimLatencyStatus: "on_target"
  };
  return raw as DeskSession;
}

function createMeta(session: DeskSession): FrontResourceMeta {
  return {
    contract: "DeskFrontE2EFixture",
    schemaVersion: "1.0.0",
    scope: {
      strategyId: session.strategyId,
      session: session.id,
      tradingDate: session.date,
      mode: "live"
    },
    warnings: []
  };
}

function createOperatorState(session: DeskSession, revision: number): DeskOperatorState {
  return {
    contract: "DeskFrontOperatorState",
    schemaVersion: "1.0.0",
    scope: {
      strategyId: session.strategyId,
      session: session.id,
      tradingDate: session.date,
      mode: "live"
    },
    revision,
    setup: { id: session.setup.id, status: session.setup.status },
    position: { id: "position-e2e", status: session.position.status, entry: session.position.entry },
    thesis: { id: session.thesis.id, status: session.thesis.status },
    allowedCommands: [{
      command: "request_replan",
      enabled: true,
      reason: null,
      targetId: session.thesis.id,
      confirmationPhrase: "REQUEST_REPLAN",
      dangerLevel: "critical"
    }],
    brokerExecution: false
  };
}

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}
