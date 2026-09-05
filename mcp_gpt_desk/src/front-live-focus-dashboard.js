import { US_GRAINS_INSTRUMENTS } from "./us-grains-strategy-catalog.js";

const PERIODS = ["TODAY", "WEEK", "MONTH", "TOTAL"];
const TIMEZONE = "Europe/Paris";
const FINAL = new Set(["CLOSED", "TARGET_HIT", "STOP_HIT"]);
const OPEN = new Set(["OPEN", "ENTRY_FILLED", "PARTIAL_FILL"]);
const WAITING = new Set(["AWAITING_ENTRY", "PENDING_ENTRY", "WORKING"]);

// Reporting over the qualified lineage already loaded by Live Focus. This is
// deliberately not advertised as a complete ledger or a broker performance.
export function buildLiveFocusDashboard({ tradeCards, observedOpportunities, nowIso }) {
  const unique = [...new Map(tradeCards.map((card) => [card.orderIntentId, card])).values()];
  const cards = unique.filter(inGrainsScope);
  const excluded = unique.filter((card) => !inGrainsScope(card));
  const observations = observedOpportunities.filter(inGrainsScope);
  const today = localDate(nowIso);
  const periods = Object.fromEntries(PERIODS.map((period) => {
    const window = { startDate: periodStart(today, period), endDate: today, asOf: nowIso };
    return [period, summarizePeriod({ cards, observedOpportunities: observations, window })];
  }));
  return {
    schemaVersion: "live_focus_dashboard_v1",
    source: "THEORETICAL_BACKEND",
    coverage: "EXPOSED_HISTORY_ONLY",
    scope: { universe: "US_GRAINS_CBOT", instruments: [...US_GRAINS_INSTRUMENTS],
      excludedTickets: excluded.length, excludedInstruments: [...new Set(excluded.map((card) => card.instrument || "UNKNOWN"))] },
    timezone: TIMEZONE,
    asOf: nowIso,
    dateBasis: { activity: "CREATED_AT", results: "CLOSED_AT" },
    current: {
      actionable: cards.filter((card) => card.actionable === true && card.allowedActions.includes("CONFIRM")).length,
      open: cards.filter((card) => OPEN.has(card.theoreticalState)).length,
      awaitingEntry: cards.filter((card) => WAITING.has(card.theoreticalState)).length,
    },
    periods,
  };
}

function inGrainsScope(item) { return US_GRAINS_INSTRUMENTS.includes(String(item.instrument || "").toUpperCase()); }

function summarizePeriod({ cards, observedOpportunities, window }) {
  const activity = cards.filter((card) => inWindow(card.createdAt, window));
  const observed = observedOpportunities.filter((item) => inWindow(item.createdAt, window));
  const signalIds = new Set([...activity, ...observed].map((item) => item.signalId).filter(Boolean));
  const finalCards = cards.filter((card) => card.theoreticalTradeStatus === "CLOSED" || FINAL.has(card.theoreticalState));
  const closed = finalCards.filter((card) => inWindow(card.closedAt, window) || (!localDate(card.closedAt) && window.startDate === null));
  const contributors = closed.filter((card) => finite(card.realizedR)).map(resultContributor);
  const breakdown = ["TARGET_HIT", "STOP_HIT", "OTHER_CLOSED"].map((kind) => {
    const subset = contributors.filter((item) => item.kind === kind);
    return { kind, count: subset.length, realizedR: sumR(subset.map((item) => item.realizedR)) };
  });
  const expected = activity.map((card) => card.expectedR).filter(finite);
  return {
    startDate: window.startDate,
    endDate: window.endDate,
    qualifiedTickets: activity.length,
    rawSignals: signalIds.size,
    results: {
      count: contributors.length,
      realizedR: sumR(contributors.map((item) => item.realizedR)),
      missingR: closed.length - contributors.length,
      undated: finalCards.filter((card) => !localDate(card.closedAt)).length,
      breakdown,
      contributors,
    },
    expectedR: sumR(expected),
    expectedSample: expected.length,
    expiredWithoutFill: activity.filter((card) => card.theoreticalState === "ENTRY_EXPIRED").length,
    unclassifiedExpiry: activity.filter((card) => card.theoreticalState === "EXPIRED").length,
  };
}

function resultContributor(card) {
  // A profitable CLOSED row is not evidence of a target hit, nor is -1R
  // evidence of a stop hit. Preserve unknown exit reasons explicitly.
  const reason = card.closeReason || card.theoreticalState;
  const kind = ["TARGET_HIT", "TAKE_PROFIT"].includes(reason) ? "TARGET_HIT"
    : ["STOP_HIT", "STOP_LOSS"].includes(reason) ? "STOP_HIT" : "OTHER_CLOSED";
  return {
    orderIntentId: card.orderIntentId,
    instrument: card.instrument,
    closedAt: card.closedAt || null,
    kind,
    realizedR: card.realizedR,
    route: card.route,
  };
}

function localDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function periodStart(today, period) {
  if (!today || period === "TOTAL") return null;
  if (period === "TODAY") return today;
  if (period === "MONTH") return `${today.slice(0, 7)}-01`;
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function inWindow(value, window) {
  const day = localDate(value);
  if (!day) return false;
  return (!window.startDate || day >= window.startDate) && day <= window.endDate && Date.parse(value) <= Date.parse(window.asOf);
}

function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function sumR(values) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) * 1e8) / 1e8 : null; }
