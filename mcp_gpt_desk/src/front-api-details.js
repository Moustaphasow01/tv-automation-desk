import { z } from "zod";
import { loadFrontDeskSession, normalizeFrontApiScope } from "./front-session-projection.js";

const severitySchema = z.enum(["info", "watch", "warning", "action", "critical", "positive"]);
const scopeSchema = z.object({
  strategyId: z.string().min(1),
  session: z.enum(["asia_open", "ny_open"]),
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["live", "paper"]),
});
const baseSchema = z.object({
  contract: z.string().min(1),
  schemaVersion: z.literal("1.0.0"),
  scope: scopeSchema,
  warnings: z.array(z.string()),
});
const conditionSchema = z.object({
  label: z.string(),
  status: z.string(),
  proof: z.string(),
  impact: z.string(),
  deterministic: z.boolean(),
});
const masterSchema = z.object({
  id: z.string(), createdAt: z.string(), decision: z.string(), instrument: z.string(), direction: z.string(),
  confidence: z.number(), summary: z.string(), regime: z.string(), macroThesis: z.string(), assetSelection: z.string(),
  expectedPath: z.array(z.string()), failurePath: z.array(z.string()), monitoringPlaybook: z.array(z.string()),
  sections: z.array(z.object({ title: z.string(), content: z.string() })),
});
const monitorSchema = z.object({
  id: z.string(), time: z.string(), sequence: z.number(), decision: z.string(), severity: severitySchema,
  statusBefore: z.string(), statusAfter: z.string(), healthBefore: z.number(), healthAfter: z.number(),
  summary: z.string(), detailedReason: z.string(), nextAction: z.string(), nextFocus: z.string(),
  expectedVsRealized: z.array(z.object({
    element: z.string(), expected: z.string(), realized: z.string(), verdict: z.string(), impact: z.string(),
  })),
  weakSignals: z.array(z.string()),
  goConditions: z.array(conditionSchema),
  invalidationConditions: z.array(conditionSchema),
});
const thesisSchema = z.object({
  id: z.string(), instrument: z.string(), direction: z.string(), status: z.string(), previousStatus: z.string(),
  dominantScenario: z.string(), secondaryScenario: z.string(), confidence: z.number(), initialConfidence: z.number(),
  health: z.number(), initialHealth: z.number(), validUntil: z.string(), nextFocus: z.string(),
  scoreDriversPositive: z.array(z.string()), scoreDriversNegative: z.array(z.string()),
});
const setupSchema = z.object({
  id: z.string(), label: z.string(), instrument: z.string(), direction: z.string(), status: z.string(), statusLabel: z.string(),
  entryFrom: z.number().nullable(), entryTo: z.number().nullable(), stop: z.number().nullable(),
  tp1: z.number().nullable(), tp2: z.number().nullable(), tp3: z.number().nullable(),
  risk: z.number().nullable(), confidence: z.number().nullable(), rr: z.number().nullable(),
  resultR: z.number().nullable().optional(), reason: z.string(),
});
const positionSchema = z.object({
  active: z.boolean(), status: z.string(), instrument: z.string(), direction: z.string(),
  entry: z.number().nullable(), current: z.number().nullable(), unrealizedR: z.number().nullable(), note: z.string(),
});
const levelSchema = z.object({ price: z.string(), role: z.string(), state: z.string() });
const timelineEventSchema = z.object({
  time: z.string(), type: z.string(), title: z.string(), status: z.string(), detail: z.string(),
  severity: severitySchema, summary: z.string(), sourceType: z.string(),
});

export const frontDetailSchemas = {
  overview: baseSchema.extend({
    contract: z.literal("DeskFrontSessionOverviewResource"),
    overview: z.object({
      id: z.enum(["asia_open", "ny_open"]), strategyId: z.string(), label: z.string(), shortLabel: z.string(),
      date: z.string(), mode: z.string(), status: z.string(), severity: severitySchema,
      lastDataAt: z.string(), lastMonitorAt: z.string(), nextMonitorAt: z.string(), nextMacro: z.string(),
      dataQuality: z.object({ label: z.string(), status: z.string(), antiLookahead: z.boolean(), warnings: z.array(z.string()) }),
      automation: z.object({ status: z.string(), worker: z.string(), cadence: z.string() }),
      liveBrief: z.object({
        eyebrow: z.string(), headline: z.string(), action: z.string(), summary: z.string(),
        why: z.string(), nextAction: z.string(), decision: z.string(),
      }),
    }),
  }),
  timeline: baseSchema.extend({
    contract: z.literal("DeskFrontTimelineResource"),
    timeline: z.array(timelineEventSchema),
  }),
  master: baseSchema.extend({ contract: z.literal("DeskFrontMasterResource"), master: masterSchema }),
  monitor: baseSchema.extend({ contract: z.literal("DeskFrontMonitorResource"), monitor: monitorSchema }),
  thesis: baseSchema.extend({
    contract: z.literal("DeskFrontThesisResource"),
    thesis: thesisSchema,
    levels: z.array(levelSchema),
  }),
  conditions: baseSchema.extend({
    contract: z.literal("DeskFrontThesisConditionsResource"),
    thesisId: z.string(),
    monitorId: z.string().nullable(),
    go: z.array(conditionSchema),
    invalidations: z.array(conditionSchema),
  }),
  setup: baseSchema.extend({
    contract: z.literal("DeskFrontSetupResource"),
    setup: setupSchema,
    position: positionSchema,
    levels: z.array(levelSchema),
  }),
};

export function matchFrontDetailRoute(pathname) {
  const routes = [
    ["overview", /^\/api\/v1\/sessions\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/overview$/],
    ["timeline", /^\/api\/v1\/sessions\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/timeline$/],
    ["conditions", /^\/api\/v1\/theses\/([^/]+)\/conditions$/],
    ["master", /^\/api\/v1\/masters\/([^/]+)$/],
    ["monitor", /^\/api\/v1\/monitors\/([^/]+)$/],
    ["thesis", /^\/api\/v1\/theses\/([^/]+)$/],
    ["setup", /^\/api\/v1\/setups\/([^/]+)$/],
  ];
  for (const [kind, pattern] of routes) {
    const match = pathname.match(pattern);
    if (!match) continue;
    const first = decodePathPart(match[1]);
    if (kind === "overview" || kind === "timeline") {
      return { kind, strategyId: validPathIdentifier(first, "strategy_id"), date: match[2] };
    }
    return { kind, id: validPathIdentifier(first, `${kind}_id`) };
  }
  return null;
}

export function isFrontDetailPath(pathname) {
  return /^\/api\/v1\/(?:masters|monitors|theses|setups)\/[^/]+(?:\/conditions)?$/.test(pathname) ||
    /^\/api\/v1\/sessions\/[^/]+\/[^/]+\/(?:overview|timeline)$/.test(pathname);
}

export function frontDetailCacheSeconds(pathname) {
  const route = matchFrontDetailRoute(pathname);
  if (!route) return 0;
  return route.kind === "monitor" || route.kind === "conditions" || route.kind === "timeline" ? 15 : 30;
}

export async function loadFrontDetailResource(store, pathname, scopeInput = {}) {
  const route = matchFrontDetailRoute(pathname);
  if (!route) throw frontDetailError("FRONT_DETAIL_ROUTE_NOT_FOUND", "front_detail_route_not_found", 404);
  const scopedInput = route.strategyId
    ? {
      ...scopeInput,
      strategy_id: route.strategyId,
      date: route.date,
      trading_date: route.date,
      session: scopeInput.session || sessionFromStrategy(route.strategyId),
    }
    : scopeInput;
  const session = await loadFrontDeskSession(store, normalizeFrontApiScope(scopedInput));
  const base = detailBase(session);

  if (route.kind === "overview") {
    assertRouteScope(session, route);
    return frontDetailSchemas.overview.parse({
      ...base,
      contract: "DeskFrontSessionOverviewResource",
      overview: {
        id: session.id,
        strategyId: session.strategyId,
        label: session.label,
        shortLabel: session.shortLabel,
        date: session.date,
        mode: session.mode,
        status: session.status,
        severity: session.severity,
        lastDataAt: session.lastDataAt,
        lastMonitorAt: session.lastMonitorAt,
        nextMonitorAt: session.nextMonitorAt,
        nextMacro: session.nextMacro,
        dataQuality: session.dataQuality,
        automation: session.automation,
        liveBrief: session.liveBrief,
      },
    });
  }
  if (route.kind === "timeline") {
    assertRouteScope(session, route);
    return frontDetailSchemas.timeline.parse({ ...base, contract: "DeskFrontTimelineResource", timeline: session.timeline });
  }
  if (route.kind === "master") {
    assertEntityId(session.master.id, route.id, "master");
    return frontDetailSchemas.master.parse({ ...base, contract: "DeskFrontMasterResource", master: session.master });
  }
  if (route.kind === "monitor") {
    const monitor = session.monitors.find((item) => item.id === route.id);
    if (!monitor) throw notFound("monitor", route.id);
    return frontDetailSchemas.monitor.parse({ ...base, contract: "DeskFrontMonitorResource", monitor });
  }
  if (route.kind === "thesis") {
    assertEntityId(session.thesis.id, route.id, "thesis");
    return frontDetailSchemas.thesis.parse({
      ...base,
      contract: "DeskFrontThesisResource",
      thesis: session.thesis,
      levels: session.levels,
    });
  }
  if (route.kind === "conditions") {
    assertEntityId(session.thesis.id, route.id, "thesis");
    const monitor = session.monitors.at(-1) || null;
    return frontDetailSchemas.conditions.parse({
      ...base,
      contract: "DeskFrontThesisConditionsResource",
      thesisId: session.thesis.id,
      monitorId: monitor?.id || null,
      go: monitor?.goConditions || [],
      invalidations: monitor?.invalidationConditions || [],
    });
  }
  if (route.kind === "setup") {
    assertEntityId(session.setup.id, route.id, "setup");
    return frontDetailSchemas.setup.parse({
      ...base,
      contract: "DeskFrontSetupResource",
      setup: session.setup,
      position: session.position,
      levels: session.levels,
    });
  }
  throw frontDetailError("FRONT_DETAIL_ROUTE_NOT_FOUND", "front_detail_route_not_found", 404);
}

function detailBase(session) {
  return {
    contract: "DeskFrontDetailResource",
    schemaVersion: "1.0.0",
    scope: {
      strategyId: session.strategyId,
      session: session.id,
      tradingDate: session.date,
      mode: String(session.mode || "live").toLowerCase() === "paper" ? "paper" : "live",
    },
    warnings: session.dataQuality?.warnings || [],
  };
}

function assertRouteScope(session, route) {
  if (session.strategyId !== route.strategyId || session.date !== route.date) {
    throw frontDetailError("FRONT_DETAIL_SCOPE_MISMATCH", "front_detail_scope_mismatch", 404);
  }
}

function assertEntityId(actual, expected, entity) {
  if (!actual || actual.startsWith("no-") || actual !== expected) throw notFound(entity, expected);
}

function notFound(entity, id) {
  return frontDetailError("FRONT_DETAIL_NOT_FOUND", `${entity}_not_found:${id}`, 404);
}

function frontDetailError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function decodePathPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw frontDetailError("FRONT_DETAIL_INVALID_PATH", "front_detail_invalid_encoding", 400);
  }
}

function validPathIdentifier(value, label) {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) {
    throw frontDetailError("FRONT_DETAIL_INVALID_PATH", `front_detail_invalid_${label}`, 400);
  }
  return value;
}

function sessionFromStrategy(strategyId) {
  return strategyId === "ny_open" || strategyId.startsWith("ny_open_") ? "ny_open" : "asia_open";
}
