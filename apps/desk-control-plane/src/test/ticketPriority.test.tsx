// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceTicketPriority, consumePriorityTicket, emptyTicketPriority, isCurrentPriorityTicket } from "@/features/live-trading/workspace/ticketPriority";
import { useTicketPriority } from "@/features/live-trading/workspace/useTicketPriority";
import { parseWorkspacePreferences } from "@/features/live-trading/workspace/workspacePreferences";
import { workspaceTickets } from "@/features/live-trading/workspace/workspaceModel";
import { fixtureNow, workspaceCard, workspaceFocus } from "./tradingWorkspaceFixtures";

const tickets = () => workspaceTickets(workspaceFocus([workspaceCard({ instrument: "ZC" })]));
describe("Ticket priority is navigation, never execution", () => {
  it("detects a newly actionable ticket once, not each revision or refresh", () => {
    const item = tickets()[0];
    const ready = advanceTicketPriority(emptyTicketPriority(), [item], fixtureNow);
    expect(ready.pending).toEqual([item.key]);
    const consumed = consumePriorityTicket(ready, item.key);
    expect(advanceTicketPriority(consumed, [{ ...item, card: { ...item.card!, revision: (item.card!.revision ?? 0) + 1 } }], fixtureNow + 1000).pending).toEqual([]);
  });
  it("ignores historical, unavailable-time, future and non-actionable tickets", () => {
    const item = tickets()[0];
    for (const patch of [{ terminal: true }, { actionable: false }, { expiresAt: null }, { expiresAt: new Date(fixtureNow).toISOString() }, { createdAt: "invalid" }, { createdAt: new Date(fixtureNow + 60000).toISOString() }]) {
      expect(isCurrentPriorityTicket({ ...item, ...patch }, fixtureNow)).toBe(false);
    }
  });
  it("detects a real transition to actionable, discards expired pending entries", () => {
    const item = tickets()[0];
    const before = advanceTicketPriority(emptyTicketPriority(), [{ ...item, actionable: false }], fixtureNow);
    const after = advanceTicketPriority(before, [item], fixtureNow);
    expect(after.pending).toEqual([item.key]);
    expect(advanceTicketPriority(after, [item], fixtureNow + 600000).pending).toEqual([]);
  });
  it("preserves received queue order during a burst and subsequent reorder", () => {
    const one = tickets()[0]; const two = { ...one, key: "trade:second", instrument: "ZW" };
    const first = advanceTicketPriority(emptyTicketPriority(), [one, two], fixtureNow);
    expect(advanceTicketPriority(first, [two, one], fixtureNow).pending).toEqual([one.key, two.key]);
  });
  it("migrates existing preferences to automatic ticket focus without changing the desktop layout", () => {
    const restored = parseWorkspacePreferences(JSON.stringify({ version: 1, chartCount: 4, secondary: ["ZW"] }));
    expect(restored.followTickets).toBe(true); expect(restored.chartCount).toBe(4); expect(restored.secondary).toEqual(["ZW"]);
    expect(parseWorkspacePreferences(JSON.stringify({ version: 1, followTickets: false })).followTickets).toBe(false);
  });
});

let root: Root;
let element: HTMLDivElement;
let api: ReturnType<typeof useTicketPriority>;
const focus = vi.fn();
type Input = Parameters<typeof useTicketPriority>[0];
const initial = (): Input => ({ tickets: [], now: fixtureNow, available: true, suspended: false, automatic: true, supported: ["ZW", "ZC"], instrument: "ZW", onFocus: focus });
function Probe({ input }: { input: Input }) { api = useTicketPriority(input); return null; }
const render = async (input: Input) => { await act(async () => root.render(<Probe input={input} />)); };
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  focus.mockReset(); element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); document.querySelectorAll("dialog,input,select").forEach((item) => item.remove()); vi.restoreAllMocks(); });

describe("Automatic chart pivot lifecycle", () => {
  it("keeps ZW without a ticket, pivots to ZC on arrival, and does not hijack a later manual chart choice", async () => {
    await render(initial()); expect(focus).not.toHaveBeenCalled();
    await render({ ...initial(), tickets: tickets() }); expect(focus).toHaveBeenCalledWith(expect.objectContaining({ instrument: "ZC", key: "trade:intent-test" }));
    expect(api.notice?.previous).toBe("ZW");
    await render({ ...initial(), tickets: tickets(), instrument: "ZW", now: fixtureNow + 1000 });
    expect(focus).toHaveBeenCalledTimes(1);
  });
  it("buffers during a paused chart, ticket inspection, confirmation, or pending command", async () => {
    await render({ ...initial(), tickets: tickets(), suspended: true });
    expect(focus).not.toHaveBeenCalled(); expect(api.pending).toHaveLength(1);
    await act(async () => api.showNext()); expect(focus).not.toHaveBeenCalled();
    await render({ ...initial(), tickets: tickets() }); expect(focus).toHaveBeenCalledTimes(1);
  });
  it("does not navigate or consume an event from stale or disconnected projections", async () => {
    await render({ ...initial(), tickets: tickets(), available: false }); expect(focus).not.toHaveBeenCalled();
    await render({ ...initial(), tickets: tickets() }); expect(focus).toHaveBeenCalledTimes(1);
  });
  it("preserves an open dialog or text input and resumes only afterwards", async () => {
    const dialog = document.createElement("dialog"); dialog.setAttribute("open", ""); document.body.append(dialog);
    await render({ ...initial(), tickets: tickets() }); expect(focus).not.toHaveBeenCalled(); dialog.remove();
    const input = document.createElement("input"); document.body.append(input); input.focus();
    await render({ ...initial(), tickets: tickets(), now: fixtureNow + 1000 }); expect(focus).not.toHaveBeenCalled(); input.blur();
    await render({ ...initial(), tickets: tickets(), now: fixtureNow + 2000 }); expect(focus).toHaveBeenCalledTimes(1);
  });
  it("retains a manual opt-out while offering explicit navigation", async () => {
    await render({ ...initial(), automatic: false, tickets: tickets() }); expect(focus).not.toHaveBeenCalled();
    await act(async () => api.showNext()); expect(focus).toHaveBeenCalledTimes(1);
  });
  it("can prioritize an arriving ticket after a market dropdown selection without requiring an extra tap", async () => {
    const select = document.createElement("select"); document.body.append(select); select.focus();
    await render(initial()); expect(focus).not.toHaveBeenCalled();
    await render({ ...initial(), tickets: tickets() });
    expect(focus).toHaveBeenCalledWith(expect.objectContaining({ instrument: "ZC" }));
    expect(document.activeElement).toBe(select);
  });
  it("never switches through multiple tickets in a burst", async () => {
    const items = [...tickets(), { ...tickets()[0], key: "trade:second", instrument: "ZW" }];
    await render({ ...initial(), tickets: items });
    await render({ ...initial(), tickets: items, now: fixtureNow + 1000 });
    expect(focus).toHaveBeenCalledTimes(1); expect(api.next?.key).toBe("trade:second");
  });
  it("does not show an expired buffered ticket or fabricate a missing instrument", async () => {
    await render({ ...initial(), tickets: tickets(), supported: ["ZW"] }); expect(focus).not.toHaveBeenCalled(); expect(api.supported).toBe(false);
    await act(async () => api.showNext()); expect(focus).not.toHaveBeenCalled();
    await render({ ...initial(), tickets: tickets(), suspended: true, now: fixtureNow + 600000 }); expect(api.next).toBeNull();
    await act(async () => api.showNext()); expect(focus).not.toHaveBeenCalled();
  });
});
