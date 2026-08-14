import { currentUtc, hash, text } from "./front-control-plane-common.js";

export function authSession({ actor = {}, nowIso } = {}) {
  const now = nowIso || currentUtc();
  const writeAllowed = actorCanWrite(actor);
  const maskedEmail = actor.email ? maskEmail(actor.email) : "";
  const sessionState = writeAllowed ? "ACTIVE" : "READ_ONLY";
  const permissionsList = authPermissions(writeAllowed);
  return {
    summary: authSummary(writeAllowed, sessionState, permissionsList),
    principal: authPrincipal({ actor, maskedEmail, writeAllowed, now }),
    environments: authEnvironments(writeAllowed),
    permissions: permissionsList,
    routeGuards: authRouteGuards(writeAllowed),
    stepUp: authStepUp(writeAllowed, now),
    session: authSessionState(writeAllowed, now),
    events: [authSessionEvent({ now, sessionState, writeAllowed })],
    commandActions: [],
  };
}

function authPermissions(writeAllowed) {
  return [
    authPermission("front.read", "Lecture cockpit", "COMMAND", "ALLOW", "Lecture BFF autorisée.", false),
    authPermission("front.command", "Commandes VNext", "COMMAND", writeAllowed ? "ALLOW" : "READ_ONLY", writeAllowed ? "Session opérateur active." : "Login opérateur/PIN requis.", !writeAllowed),
    authPermission("execution.paper", "Exécution PAPER", "EXECUTION", writeAllowed ? "ALLOW" : "READ_ONLY", writeAllowed ? "Commandes PAPER auditables." : "Session opérateur requise avant mutation.", !writeAllowed),
    authPermission("execution.live", "Exécution LIVE", "EXECUTION", "DENY", "LIVE verrouillé jusqu’au cutover explicite.", true),
  ];
}

function authSummary(writeAllowed, sessionState, permissionsList) {
  return {
    authenticated: writeAllowed,
    sessionState,
    environment: "PAPER",
    minutesToExpiry: writeAllowed ? 480 : 0,
    permissionsGranted: permissionsList.filter((permission) => permission.decision === "ALLOW").length,
    permissionsDenied: permissionsList.filter(deniedOrReadOnlyPermission).length,
    stepUpReady: writeAllowed,
    readOnly: !writeAllowed,
  };
}

function deniedOrReadOnlyPermission(permission) {
  return ["DENY", "READ_ONLY"].includes(permission.decision);
}

function authPrincipal({ actor = {}, maskedEmail, writeAllowed, now }) {
  return {
    userId: actor.uid || (writeAllowed ? "desk-operator" : "anonymous-read-only"),
    displayName: writeAllowed ? "Opérateur Desk" : "Lecture seule non authentifiée",
    maskedEmail,
    roles: writeAllowed ? ["operator"] : [],
    timezone: "Europe/Paris",
    identityProvider: "LOCAL_OPERATOR_SESSION",
    desks: ["futures"],
    accountScopes: writeAllowed ? ["paper"] : [],
    lastLoginAt: writeAllowed ? now : "",
  };
}

function authEnvironments(writeAllowed) {
  return [
    { environment: "PAPER", label: "Démo/PAPER Sim101", current: true, tradingEnabled: writeAllowed, writeEnabled: writeAllowed, riskProfile: "sim101_addon_approved_only", accountIds: ["Sim101"], status: writeAllowed ? "AVAILABLE" : "READ_ONLY" },
    { environment: "STAGING", label: "Préprod read-only", current: false, tradingEnabled: false, writeEnabled: false, riskProfile: "validation", accountIds: [], status: "READ_ONLY" },
    { environment: "LIVE", label: "Live réel", current: false, tradingEnabled: false, writeEnabled: false, riskProfile: "locked_cutover", accountIds: [], status: "LOCKED" },
  ];
}

function authRouteGuards(writeAllowed) {
  return [
    authRoute("/command-center", "front.read", "ALLOW", "Cockpit lisible sans matière sensible."),
    authRoute("/live", "front.read", "ALLOW", "Session live consultable."),
    authRoute("/orders:command", "front.command", writeAllowed ? "ALLOW" : "READ_ONLY", writeAllowed ? "Session opérateur active." : "PIN opérateur requis."),
    authRoute("/execution/providers:switch", "execution.paper", writeAllowed ? "ALLOW" : "READ_ONLY", writeAllowed ? "Mutation PAPER seulement." : "PIN opérateur requis."),
    authRoute("/admin", "execution.live", "DENY", "Administration LIVE verrouillée."),
  ];
}

function authStepUp(writeAllowed, now) {
  return {
    ready: writeAllowed,
    requiredFor: writeAllowed ? [] : ["front.command", "execution.paper"],
    methods: [authStepUpMethod(writeAllowed, now)],
  };
}

function authStepUpMethod(writeAllowed, now) {
  return {
    methodId: "operator-pin",
    label: "PIN opérateur local",
    state: writeAllowed ? "AVAILABLE" : "UNAVAILABLE",
    ...(writeAllowed ? { lastVerifiedAt: now } : {}),
  };
}

function authSessionState(writeAllowed, now) {
  return {
    sessionId: writeAllowed ? "operator_session_http_only" : "",
    issuedAt: writeAllowed ? now : "",
    expiresAt: writeAllowed ? new Date(Date.parse(now) + 8 * 60 * 60 * 1000).toISOString() : "",
    refreshAfterAt: now,
    refreshStatus: writeAllowed ? "READY" : "BLOCKED",
    deviceLabel: "VNext browser",
    httpOnlySession: true,
    browserMaterialExposure: "NONE",
    legacyStoreImported: false,
    csrfBinding: writeAllowed ? "BOUND" : "MISSING",
  };
}

function authSessionEvent({ now, sessionState, writeAllowed }) {
  return {
    eventId: `auth_${hash(`${now}:${sessionState}`).slice(0, 12)}`,
    at: now,
    title: writeAllowed ? "Session opérateur active" : "Lecture seule",
    eventType: "auth.session.projected",
    status: writeAllowed ? "OK" : "WATCH",
    correlationId: "corr_auth_projection",
  };
}

function actorCanWrite(actor = {}) {
  return ["operator_session", "api_key", "oauth"].includes(String(actor.kind || ""))
    && rows(actor.scopes).includes("desk.write");
}

function rows(value) {
  return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
}

function maskEmail(value) {
  const email = text(value, "local");
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

function authPermission(capability, label, domain, decision, reason, requiresStepUp) {
  return { capability, label, domain, decision, reason, requiresStepUp };
}

function authRoute(route, capability, decision, reason) {
  return { route, capability, decision, reason };
}
