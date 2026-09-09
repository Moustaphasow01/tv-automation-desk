import { describe, expect, it } from "vitest";
import { chartBars, changedBarCount, type MarketPoint } from "@/features/live-trading/workspace/chartData";
import { actionFingerprint, freshProjection, optionalNumber, readOnlyReason, ticketDecisionFingerprint, workspaceActions, type WorkspaceAction } from "@/features/live-trading/workspace/commandPolicy";
import { numberLabel, selectWorkspaceTicket, stableTicketOrder, ticketSection, workspaceCopy, workspaceTickets } from "@/features/live-trading/workspace/workspaceModel";
import { fixtureMeta, fixtureNow, workspaceCard, workspaceDossier, workspaceFocus, workspaceGate, workspaceLiveModel } from "./tradingWorkspaceFixtures";

const point = (overrides: Partial<MarketPoint> = {}): MarketPoint => ({ timestamp: "2026-09-09T11:55:00Z", open: 750, high: 752, low: 749, close: 751, volume: 100, vwap: null, ...overrides });
const active = () => workspaceTickets(workspaceFocus())[0];
const actions = (item = active(), dossier = workspaceDossier()) => workspaceActions(item, dossier, workspaceLiveModel(), fixtureNow);

describe("Workspace market data display", () => {
  it("translates published technical status labels without inventing missing data", () => {
    expect(workspaceCopy("Calendrier UNAVAILABLE · contexte PARTIAL · sens UNKNOWN")).toBe("Calendrier indisponible · contexte partiel · sens non renseigné");
  });
  it("sorts actual timestamps and uses the last received correction for a duplicate", () => {
    const { bars } = chartBars([point(), point({ timestamp: "2026-09-09T11:50:00Z" }), point({ close: 750.5 })]);
    expect(bars).toHaveLength(2); expect(bars[0].time).toBeLessThan(bars[1].time); expect(bars[1].close).toBe(750.5);
  });
  it.each([{ close: null }, { open: NaN }, { high: 749 }, { low: 752 }, { high: Infinity }, { timestamp: "unknown" }])("omits invalid OHLC without repairing prices: %j", (override) => {
    expect(chartBars([point(override)])).toEqual({ bars: [], rejected: 1 });
  });
  it("retains zero and negative prices without converting missing values to zero", () => {
    const normalized = chartBars([point({ open: 0, high: 1, low: -1, close: -0.5, volume: null })]);
    expect(normalized.bars[0]).toMatchObject({ open: 0, low: -1, close: -0.5, volume: null, vwap: null });
    expect(numberLabel(null)).toBe("—"); expect(numberLabel(0)).toBe("0");
  });
  it("does not create bars in gaps or negative volume", () => {
    const normalized = chartBars([point({ volume: -1 }), point({ timestamp: "2026-09-09T12:55:00Z" })]);
    expect(normalized.bars).toHaveLength(2); expect(normalized.bars[0].volume).toBeNull();
  });
  it("counts updates, corrections and removals while reading a frozen snapshot", () => {
    const before = chartBars([point()]).bars;
    const after = chartBars([point({ close: 750 }), point({ timestamp: "2026-09-09T12:00:00Z" })]).bars;
    expect(changedBarCount(before, after)).toBe(2); expect(changedBarCount(before, before)).toBe(0); expect(changedBarCount(before, [])).toBe(1);
  });
});

describe("Workspace ticket identity and stable queue", () => {
  it("never selects an expired dossier by default", () => {
    const items = workspaceTickets(workspaceFocus([workspaceCard({ terminal: true, actionable: false })]));
    expect(selectWorkspaceTicket(items, null)).toBeNull();
    expect(selectWorkspaceTicket(items, items[0].key)?.terminal).toBe(true);
  });
  it("never silently substitutes another ticket for a missing explicit selection", () => {
    expect(selectWorkspaceTicket([active()], "trade:missing")).toBeNull();
    expect(selectWorkspaceTicket([active()], "none")).toBeNull();
  });
  it("puts new IDs in a buffer while keeping updated values in existing rows", () => {
    const item = active(); const newer = { ...item, key: "trade:new", title: "new" };
    const result = stableTicketOrder([newer, { ...item, title: "changed" }], [item.key]);
    expect(result.ordered.map((row) => row.key)).toEqual([item.key]); expect(result.ordered[0].title).toBe("changed"); expect(result.incoming).toEqual([newer]);
  });
  it("drops removed IDs instead of retaining stale actionable rows", () => {
    expect(stableTicketOrder([], [active().key]).ordered).toEqual([]);
  });
  it("does not mistake a rejected human gate for the closure of an open theoretical trade", () => {
    const item = workspaceTickets(workspaceFocus([workspaceCard({ operatorState: "REJECTED", theoreticalTradeStatus: "OPEN", actionable: false })]))[0];
    expect(item.terminal).toBe(false); expect(ticketSection(item)).toBe("tracking"); expect(item.actionable).toBe(false);
  });
});

describe("Workspace fail-closed action policy", () => {
  it("requires fresh complete projections and preserves a published authorized action", () => {
    expect(actions()).toHaveLength(1); expect(freshProjection(fixtureMeta, fixtureNow)).toBe(true);
  });
  it.each([undefined, "PARTIAL", "UNAVAILABLE", "STALE"] as const)("blocks missing or degraded availability %s", (availability) => {
    expect(freshProjection({ ...fixtureMeta, availability }, fixtureNow)).toBe(false);
  });
  it.each([121_000, -31_000])( "blocks old projections and unsafe clock skew (%i ms)", (offset) => {
    expect(freshProjection(fixtureMeta, fixtureNow + offset)).toBe(false);
  });
  it("blocks action on paused charts, disconnected streams, errors and stale projections", () => {
    const health = { connected: true, paused: false, failed: false, meta: fixtureMeta };
    expect(readOnlyReason(health, fixtureNow)).toBeNull();
    for (const change of [{ paused: true }, { connected: false }, { failed: true }, { meta: { ...fixtureMeta, stale: true } }]) expect(readOnlyReason({ ...health, ...change }, fixtureNow)).not.toBeNull();
  });
  it.each([{ permission: "DENIED" }, { permission: "STEP_UP_REQUIRED" }, { expectedRevision: "" }, { payload: { portfolioOrderIntentId: "other-ticket" } }] as const)("does not infer authorization from a button or another ticket: %j", (override) => {
    expect(actions(active(), workspaceDossier(workspaceGate(override)))).toEqual([]);
  });
  it("requires the dossier's actual canonical identity", () => {
    const dossier = workspaceDossier(); dossier.identity.orderIntentId = { state: "UNKNOWN", reason: "missing" };
    expect(actions(active(), dossier)).toEqual([]);
  });
  it("blocks decision when account or instrument identity cannot be verified", () => {
    const dossier = workspaceDossier(); dossier.targetPosition.account = { state: "UNKNOWN", reason: "missing" };
    expect(actions(active(), dossier)).toEqual([]);
    const other = workspaceDossier(); other.signal.instrument = { state: "KNOWN", value: "ZC", asOf: fixtureMeta.asOf, source: "test-only" };
    expect(actions(active(), other)).toEqual([]);
  });
  it("freezes the exact decision plan, including prices, quantity, side and expiry", () => {
    const initial = active();
    for (const change of [{ authorizedQuantity: 2 }, { riskAuthorizedPlan: {} }, { side: "SHORT" }, { expiresAt: "2026-09-09T12:06:00Z" }]) {
      const updated = workspaceTickets(workspaceFocus([workspaceCard(change)]))[0];
      expect(ticketDecisionFingerprint(updated)).not.toBe(ticketDecisionFingerprint(initial));
    }
  });
  it.each([{ terminal: true }, { expiresAt: "2026-09-09T11:59:00Z" }, { expiresAt: null }, { authorizedQuantity: null }, { riskAuthorizedPlan: null }, { allowedActions: [] }])("blocks confirmation when the live card is unsafe: %j", (override) => {
    const item = workspaceTickets(workspaceFocus([workspaceCard(override)]))[0]; expect(actions(item)).toEqual([]);
  });
  it("keeps an explicit undo available even for a previous rejected decision", () => {
    const item = workspaceTickets(workspaceFocus([workspaceCard({ operatorState: "REJECTED", actionable: false })]))[0];
    expect(actions(item, workspaceDossier(workspaceGate({ action: "UNDO" })))[0]?.action.action).toBe("UNDO");
  });
  it("invalidates a confirmation when payload, environment, revision or requirement changes", () => {
    const original: WorkspaceAction = { kind: "gate", action: workspaceGate() };
    for (const change of [{ expectedRevision: "rev-5" }, { environment: "LIVE" as const }, { requiresReason: true }, { payload: { portfolioOrderIntentId: "other" } }]) {
      expect(actionFingerprint({ kind: "gate", action: workspaceGate(change) })).not.toBe(actionFingerprint(original));
    }
  });
  it.each(["", " ", "NaN", "Infinity", "12abc"])("does not turn invalid manual input into zero: %j", (value) => expect(optionalNumber(value)).toBeNull());
  it("accepts explicit zero, negative prices and French decimal separators", () => {
    expect(optionalNumber("0")).toBe(0); expect(optionalNumber(" -1,25 ")).toBe(-1.25); expect(optionalNumber("750.25")).toBe(750.25);
  });
});
