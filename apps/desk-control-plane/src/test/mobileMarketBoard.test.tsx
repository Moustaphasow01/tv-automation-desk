// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarketBoard } from "@/features/live-trading/workspace/MarketBoard";
import { defaultWorkspacePreferences } from "@/features/live-trading/workspace/workspacePreferences";
import { workspaceLiveModel } from "./tradingWorkspaceFixtures";

vi.mock("@/features/live-trading/workspace/MarketPane", () => ({ MarketPane: ({ instrument, activity }: { instrument: string; activity: string }) => <div data-testid="market" data-instrument={instrument} data-activity={activity} /> }));
vi.mock("@/features/live-trading/workspace/Watchlist", () => ({ Watchlist: () => <div>Personal watchlist</div> }));
let root: Root; let container: HTMLDivElement; let mobile: boolean;
const listeners = new Set<() => void>();
const update = vi.fn(); const onScopeChange = vi.fn();
const settings = { preferences: { ...defaultWorkspacePreferences, chartCount: 4 as const, secondary: ["ZW", "MNQ", "MES"] }, update, reset: vi.fn(), persistence: "Local" };
function Board() {
  const model = workspaceLiveModel();
  model.marketSeries = { ...model.marketSeries, supportedInstruments: ["ZC", "ZW", "MNQ", "MES"], supportedTimeframes: ["1", "5", "15"] };
  return <MarketBoard model={model} instrument="ZC" timeframe="5" preferred={["ZC", "ZW"]} settings={settings} overlay={null} events={[]} onScopeChange={onScopeChange} onPauseChange={vi.fn()} />;
}
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mobile = true; listeners.clear(); update.mockReset(); onScopeChange.mockReset();
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ get matches() { return mobile; }, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }) as unknown as MediaQueryList);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Board />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it("puts the asset shortcuts before the single visible chart without discarding the saved desktop layout", () => {
  const board = container.querySelector(".tw-market-board")!;
  expect(board.firstElementChild?.className).toBe("tw-mobile-markets");
  expect(container.querySelectorAll(".tw-chart-slot:not([hidden])")).toHaveLength(1);
  expect(container.querySelectorAll('[data-activity="foreground"]')).toHaveLength(1);
  expect(container.querySelectorAll('[data-activity="background"]')).toHaveLength(3);
  expect(update).not.toHaveBeenCalled();
});
it("restores the four desktop charts after rotation without replacing the first chart", async () => {
  const primary = container.querySelector('[data-testid="market"]');
  await act(async () => { mobile = false; listeners.forEach((listener) => listener()); });
  expect(container.querySelectorAll(".tw-chart-slot:not([hidden])")).toHaveLength(4);
  expect(container.querySelector('[data-testid="market"]')).toBe(primary);
  await act(async () => { mobile = true; listeners.forEach((listener) => listener()); });
  expect(container.querySelectorAll(".tw-chart-slot:not([hidden])")).toHaveLength(1);
  expect(container.querySelector('[data-testid="market"]')).toBe(primary);
});
it("selects a market from the top shortcuts without selecting any trading ticket", async () => {
  const zw = [...container.querySelectorAll<HTMLButtonElement>(".tw-mobile-markets button")].find((button) => button.textContent === "ZW")!;
  await act(async () => zw.click());
  expect(onScopeChange).toHaveBeenCalledWith({ instrument: "ZW" });
});
