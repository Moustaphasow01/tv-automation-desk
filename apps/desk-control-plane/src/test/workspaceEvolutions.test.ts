import { describe, expect, it } from "vitest";
import type { AuthSessionView, LiveTheoreticalExecutionRow } from "@/domains/front-api/viewModels";
import { defaultWorkspacePreferences, groupSymbols, normalizedSearch, parseWorkspacePreferences, workspacePreferenceKey } from "@/features/live-trading/workspace/workspacePreferences";
import { advanceWorkspaceAlerts, EXPIRY_NOTICE_MS, initialAlertState } from "@/features/live-trading/workspace/workspaceAlertModel";
import { canonicalEvidence, manualExecutionLabel, manualStopLabel, publishedCalendar, strategyTitle, ticketExplanation } from "@/features/live-trading/workspace/workspaceSources";
import { chartEvents, createChartCursorLink, eventsOnBars } from "@/features/live-trading/workspace/chartAnnotations";
import { chartBars } from "@/features/live-trading/workspace/chartData";
import { workspaceTickets } from "@/features/live-trading/workspace/workspaceModel";
import { fixtureNow, workspaceCard, workspaceFocus, workspaceLiveModel } from "./tradingWorkspaceFixtures";

function ticket(overrides = {}) { return workspaceTickets(workspaceFocus([workspaceCard(overrides)]))[0]; }
function session(userId: string, environment = "PAPER") {
  return { summary: { authenticated: true, environment }, principal: { userId } } as AuthSessionView;
}

describe("operator-scoped presentation preferences", () => {
  it("defaults without storage, rejects corrupt and future versions", () => {
    for (const raw of [null, "invalid", "null", "[]", '{"version":2,"sound":true}']) expect(parseWorkspacePreferences(raw)).toEqual(defaultWorkspacePreferences);
  });
  it("isolates operators, environments and separator characters", () => {
    const keys = [session("a"), session("b"), session("a", "LIVE"), session("a:PAPER")].map(workspacePreferenceKey);
    expect(new Set(keys).size).toBe(4);
    expect(workspacePreferenceKey(null)).toBeNull();
    expect(workspacePreferenceKey({ ...session("a"), summary: { ...session("a").summary, authenticated: false } })).toBeNull();
  });
  it("clamps widths and ignores malformed field types", () => {
    const preferences = parseWorkspacePreferences(JSON.stringify({ version: 1, inspectorWidth: 9999, chartCount: 3, sound: "true", watchlistVisible: "false" }));
    expect(preferences.inspectorWidth).toBe(480);
    expect(preferences.chartCount).toBe(2);
    expect(preferences.sound).toBe(false);
    expect(preferences.watchlistVisible).toBe(true);
  });
  it("keeps repeated timeframes but de-duplicates favorites", () => {
    const preferences = parseWorkspacePreferences(JSON.stringify({ version: 1, favorites: ["ZW", "ZW", null], timeframes: ["5", "5", "15", "60"] }));
    expect(preferences.favorites).toEqual(["ZW"]);
    expect(preferences.timeframes).toEqual(["5", "5", "15", "60"]);
  });
  it("validates groups, drops duplicate IDs and invalid active groups", () => {
    const preferences = parseWorkspacePreferences(JSON.stringify({ version: 1, activeGroup: "missing", groups: [{ id: "group-1", name: " Grains ", symbols: ["ZW"] }, { id: "group-1", name: "duplicate" }, { id: "desk", name: "reserved" }] }));
    expect(preferences.groups).toEqual([{ id: "group-1", name: "Grains", symbols: ["ZW"] }]);
    expect(preferences.activeGroup).toBe("desk");
  });
  it("filters delisted instruments without changing the saved group", () => {
    const preferences = { ...defaultWorkspacePreferences, activeGroup: "favorites", favorites: ["ZW", "REMOVED", "ZC"] };
    expect(groupSymbols(preferences, ["ES"], ["ZW", "ZC"])).toEqual(["ZW", "ZC"]);
    expect(preferences.favorites).toContain("REMOVED");
  });
  it("normalizes spaces, case and accents for UI search", () => expect(normalizedSearch("  BLÉ  ")).toBe("ble"));
});

describe("deduplicated operational notifications", () => {
  it("records actionable tickets once and preserves a local read mark", () => {
    const first = advanceWorkspaceAlerts(initialAlertState, [ticket()], fixtureNow);
    expect(first.alerts).toHaveLength(1);
    const read = { ...first, alerts: first.alerts.map((alert) => ({ ...alert, read: true })) };
    expect(advanceWorkspaceAlerts(read, [ticket()], fixtureNow + 1_000)).toBe(read);
  });
  it("never announces historical cards as new decisions", () => {
    expect(advanceWorkspaceAlerts(initialAlertState, [ticket({ terminal: true, actionable: false })], fixtureNow).alerts).toHaveLength(0);
  });
  it("reminds at the two-minute boundary, never after expiry", () => {
    const expiresAt = new Date(fixtureNow + EXPIRY_NOTICE_MS).toISOString();
    const item = ticket({ expiresAt });
    const state = advanceWorkspaceAlerts(initialAlertState, [item], fixtureNow);
    expect(state.alerts.filter((alert) => alert.id.includes(":expiry:"))).toHaveLength(1);
    expect(advanceWorkspaceAlerts(state, [item], fixtureNow + 1_000)).toBe(state);
    const expired = advanceWorkspaceAlerts(initialAlertState, [ticket({ expiresAt: new Date(fixtureNow - 1).toISOString(), actionable: false })], fixtureNow);
    expect(expired.alerts.some((alert) => alert.id.includes(":expiry:"))).toBe(false);
  });
  it("records state transitions rather than each refresh", () => {
    const first = advanceWorkspaceAlerts(initialAlertState, [ticket()], fixtureNow);
    const changed = ticket({ operatorState: "REJECTED", actionable: false });
    const second = advanceWorkspaceAlerts(first, [changed], fixtureNow + 1_000);
    expect(second.alerts.some((alert) => alert.id.includes(":state:"))).toBe(true);
    expect(advanceWorkspaceAlerts(second, [changed], fixtureNow + 2_000)).toBe(second);
  });
});

describe("published source boundaries", () => {
  it("separates an explicitly absent declaration from unknown or unavailable publication", () => {
    expect(manualExecutionLabel("NOT_REPORTED")).toBe("Non déclarée");
    for (const value of [undefined, null, "UNKNOWN", "NONE"]) expect(manualExecutionLabel(value)).toBe("Statut de déclaration non publié");
    expect(manualExecutionLabel("UNAVAILABLE")).toBe("Déclaration indisponible");
    expect(manualStopLabel({ placed: false, source: "NOT_REPORTED" })).toBe("Placement du stop non déclaré");
    expect(manualStopLabel({ placed: false, source: "UNKNOWN" })).toBe("Statut du stop non publié");
    expect(manualStopLabel({ placed: true, source: "NOT_AVAILABLE" })).toBe("Déclaration du stop indisponible");
    expect(manualStopLabel({ placed: true, source: "OPERATOR_DECLARATION" })).toBe("Stop déclaré posé par l’opérateur");
    expect(manualStopLabel({ placed: false, source: "OPERATOR_DECLARATION" })).toBe("Stop déclaré non posé");
  });
  it("uses an exact strategy instance match, not a symbol guess", () => {
    const model = workspaceLiveModel();
    const record = { ...model.strategyInstances[0], strategyInstanceId: "instance-1", name: "Repli de séance" };
    expect(strategyTitle(ticket({ strategyInstanceId: "instance-1", strategyName: "INTERNAL_CODE" }), [record])).toBe("Repli de séance");
    expect(strategyTitle(ticket({ strategyInstanceId: "other", strategyName: "INTERNAL_CODE" }), [record])).toBe("Nom de stratégie non publié");
  });
  it("does not invent missing explanations or invalidation conditions", () => {
    expect(ticketExplanation(ticket()).now).toBe("Non publié");
    expect(ticketExplanation(ticket()).invalidations).toEqual([]);
    expect(ticketExplanation(ticket({ whyThisTrade: { whatInvalidates: [null, "NOT_AVAILABLE", "Cassure du niveau publié"] } })).invalidations).toEqual(["Cassure du niveau publié"]);
  });
  it("only exposes calendar events with a published valid time and name", () => {
    const focus = { ...workspaceFocus(), marketDeskBrief: { status: "AVAILABLE", headline: "", operatorSummary: "", nextExpectedEvents: [{ at: "not-time", title: "Reject" }, { at: "2026-09-09T14:00:00Z" }, { eventTimestamp: "2026-09-09T13:00:00Z", title: "Rapport publié" }] } };
    expect(publishedCalendar(focus)).toEqual([{ id: "2026-09-09T13:00:00Z:2", at: "2026-09-09T13:00:00Z", title: "Rapport publié" }]);
  });
  it("does not treat an ack or unrelated legacy fill as canonical execution proof", () => {
    const model = workspaceLiveModel();
    model.source = { ...model.source, canonicalOrders: [{ sourceClass: "CANONICAL_RUNTIME", portfolioOrderIntentId: "intent-test", status: "ACKED" }], canonicalFills: [{ sourceClass: "LEGACY", portfolioOrderIntentId: "intent-test" }, { sourceClass: "CANONICAL_RUNTIME", portfolioOrderIntentId: "unrelated" }] };
    expect(canonicalEvidence(model, "intent-test").orders).toHaveLength(1);
    expect(canonicalEvidence(model, "intent-test").fills).toHaveLength(0);
    expect(canonicalEvidence(model, undefined)).toEqual({ orders: [], fills: [], positions: [] });
  });
});

describe("chart event and cursor isolation", () => {
  const bars = chartBars([{ timestamp: "2026-09-09T12:00:00Z", open: 10, high: 12, low: 9, close: 11, volume: 0, vwap: null }, { timestamp: "2026-09-09T13:00:00Z", open: 10, high: 12, low: 9, close: 11, volume: null, vwap: null }]).bars;
  it("places an event only in its containing received candle, not across gaps", () => {
    const events = [{ id: "valid", at: "2026-09-09T12:03:00Z", label: "Ticket reçu", kind: "ticket" as const }, { id: "gap", at: "2026-09-09T12:30:00Z", label: "Gap", kind: "session" as const }];
    expect(eventsOnBars(events, bars, "5").map((event) => event.id)).toEqual(["valid"]);
    expect(eventsOnBars(events, bars, "bad")).toEqual([]);
  });
  it("binds theoretical markers to the selected canonical ticket", () => {
    const focus = { ...workspaceFocus(), session: { sessionStart: null, sessionEnd: null } } as ReturnType<typeof workspaceFocus>;
    const rows = [{ portfolioOrderIntentId: "unrelated", entryFilledAt: "2026-09-09T12:01:00Z" }] as LiveTheoreticalExecutionRow[];
    expect(chartEvents(focus, ticket(), rows).some((event) => event.kind === "theory")).toBe(false);
    rows[0].portfolioOrderIntentId = "intent-test";
    expect(chartEvents(focus, ticket(), rows).some((event) => event.label === "Entrée théorique")).toBe(true);
  });
  it.each([['1H', 3_600], ['4H', 14_400], ['1D', 86_400]])("places %s markers only inside received bars", (timeframe, seconds) => {
    const bar = bars[0];
    const event = (id: string, offset: number) => ({ id, at: new Date((bar.time + offset) * 1_000).toISOString(), label: id, kind: "ticket" as const });
    const events = [event("before", -1), event("inside", seconds - 1), event("gap", seconds), event("overnight-gap", seconds * 2)];
    expect(eventsOnBars(events, [bar], timeframe).map((item) => item.id)).toEqual(["inside"]);
  });
  it("deduplicates cursor messages and releases subscribers", () => {
    const cursor = createChartCursorLink();
    const values: (number | null)[] = [];
    const unsubscribe = cursor.subscribe((point) => values.push(point.time));
    cursor.publish({ origin: "one", time: 123 }); cursor.publish({ origin: "one", time: 123 });
    cursor.publish({ origin: "one", time: null }); unsubscribe(); cursor.publish({ origin: "two", time: 234 });
    expect(values).toEqual([123, null]);
  });
});
