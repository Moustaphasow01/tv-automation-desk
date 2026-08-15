import { normalizeFrontApiScope } from "./front-session-projection.js";
import { nullableNumber, number, rows, stringList, text } from "./front-control-plane-projection-helpers.js";

export function livePlan({ liveSession, query, nowIso }) {
  const scope = normalizeFrontApiScope(query);
  const session = liveSession || {};
  const master = session.master || {};
  const thesis = session.thesis || {};
  const setup = session.setup || {};
  const position = session.position || {};
  return {
    summary: livePlanSummary({ session, master, thesis, setup, position }),
    scope: livePlanScope({ session, scope, nowIso }),
    brief: livePlanBrief(session.liveBrief),
    claim: livePlanClaim(session.claim),
    master: livePlanMaster(master),
    thesis: livePlanThesis(thesis),
    setup: livePlanSetup(setup),
    position: livePlanPosition({ position, scope }),
    levels: rows(session.levels).map(livePlanLevel),
  };
}

function livePlanSummary({ session, master, thesis, setup, position }) {
  return {
    sessionStatus: text(session.status, "UNKNOWN"),
    masterAvailable: availableDocument(master, "no-master"),
    thesisAvailable: availableDocument(thesis, "no-active-thesis"),
    setupAvailable: availableDocument(setup, "no-setup"),
    positionActive: position.active === true,
    nextMonitorAt: text(session.nextMonitorAt, "—"),
  };
}
function livePlanScope({ session, scope, nowIso }) {
  return { sessionId: text(session.id, scope.session), tradingDate: text(session.date, scope.trading_date), mode: text(session.mode, scope.mode).toUpperCase(), generatedAt: nowIso };
}
function livePlanBrief(brief = {}) {
  return {
    headline: text(brief.headline, "Aucun brief live matérialisé."),
    action: text(brief.action, "AUCUNE ACTION"),
    summary: text(brief.summary, "Aucun résumé matérialisé."),
    why: text(brief.why, "Motif non publié."),
    nextAction: text(brief.nextAction, "Aucune prochaine action publiée."),
    decision: text(brief.decision, "NO_ACTION"),
  };
}
function livePlanClaim(claim = {}) {
  return {
    lastClaimAt: text(claim.lastClaimAt, "—"),
    workerId: text(claim.workerId, "—"),
    nextTaskStatus: text(claim.nextTaskStatus, "unknown"),
    nextTaskLabel: text(claim.nextTaskLabel, "Tâche non publiée"),
    dueCheckpoint: text(claim.dueCheckpoint, "—"),
    followingCheckpoint: text(claim.followingTaskCheckpoint, "—"),
    latencySeconds: nullableNumber(claim.latencySeconds),
    latencyTargetSeconds: nullableNumber(claim.latencyTargetSeconds),
  };
}
function livePlanMaster(master = {}) {
  return {
    available: availableDocument(master, "no-master"),
    id: text(master.id, "—"),
    createdAt: text(master.createdAt, "—"),
    decision: text(master.decision, "NON DISPONIBLE"),
    instrument: text(master.instrument, "—"),
    direction: text(master.direction, "wait"),
    confidence: number(master.confidence, 0),
    summary: text(master.summary, "Aucun Master matérialisé."),
    regime: text(master.regime, "Non matérialisé"),
    macroThesis: text(master.macroThesis, "Non matérialisée"),
    assetSelection: text(master.assetSelection, "Non matérialisée"),
    expectedPath: stringList(master.expectedPath),
    failurePath: stringList(master.failurePath),
    monitoringPlaybook: stringList(master.monitoringPlaybook),
  };
}
function livePlanThesis(thesis = {}) {
  return {
    available: availableDocument(thesis, "no-active-thesis"),
    id: text(thesis.id, "—"),
    instrument: text(thesis.instrument, "—"),
    direction: text(thesis.direction, "wait"),
    status: text(thesis.status, "NO_ACTIVE_THESIS"),
    dominantScenario: text(thesis.dominantScenario, "Aucune thèse active matérialisée."),
    secondaryScenario: text(thesis.secondaryScenario, "Aucun scénario secondaire matérialisé."),
    confidence: number(thesis.confidence, 0),
    health: number(thesis.health, 0),
    validUntil: text(thesis.validUntil, "—"),
    nextFocus: text(thesis.nextFocus, "Aucun focus matérialisé."),
    positiveDrivers: stringList(thesis.scoreDriversPositive),
    negativeDrivers: stringList(thesis.scoreDriversNegative),
  };
}
function livePlanSetup(setup = {}) {
  return {
    available: availableDocument(setup, "no-setup"),
    id: text(setup.id, "—"),
    label: text(setup.label, "Aucun setup matérialisé"),
    instrument: text(setup.instrument, "—"),
    direction: text(setup.direction, "wait"),
    status: text(setup.status, "NO_SETUP"),
    geometryReady: setup.geometryReady === true,
    backendCanTrigger: setup.backendCanTrigger === true,
    missingFields: stringList(setup.missingFields),
    entryLower: nullableNumber(firstValue(setup.entryLower, setup.entryFrom)),
    entryUpper: nullableNumber(firstValue(setup.entryUpper, setup.entryTo)),
    executionEntry: nullableNumber(setup.executionEntry),
    executionRule: text(setup.executionRule, "Règle non publiée"),
    stop: nullableNumber(setup.stop),
    tp1: nullableNumber(setup.tp1),
    tp2: nullableNumber(setup.tp2),
    tp3: nullableNumber(setup.tp3),
    risk: nullableNumber(setup.risk),
    confidence: nullableNumber(setup.confidence),
    rr: nullableNumber(setup.rr),
    reason: text(setup.reason, "Aucun motif publié."),
  };
}
function livePlanPosition({ position, scope }) {
  return {
    active: position.active === true,
    status: text(position.status, "NO_POSITION"),
    instrument: text(position.instrument, "—"),
    direction: text(position.direction, "wait"),
    entry: nullableNumber(position.entry),
    current: nullableNumber(position.current),
    unrealizedR: nullableNumber(position.unrealizedR),
    executionMode: text(position.executionMode, scope.mode),
    brokerExecution: position.brokerExecution === true,
    note: text(position.note, "Aucune position canonique active."),
  };
}
function livePlanLevel(item, index) {
  return { levelId: text(firstValue(item.id, item.level_id), `level-${index + 1}`), label: text(firstValue(item.label, item.name), "Niveau"), value: nullableNumber(firstValue(item.value, item.price)), kind: text(firstValue(item.kind, item.type), "REFERENCE") };
}
function availableDocument(document, missingId) { return Boolean(document.id && document.id !== missingId); }
function firstValue(...values) { for (const value of values) if (value !== null && value !== undefined && value !== "") return value; return undefined; }
