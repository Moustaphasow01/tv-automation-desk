// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { isCryptoMarketView, type CryptoMarketView } from "@/domains/front-api/cryptoMarketContract";
import { CryptoMarketPane } from "@/features/live-trading/workspace/CryptoMarketPane";
import { numberLabel } from "@/features/live-trading/workspace/workspaceModel";

const runtime = vi.hoisted(() => ({ view: null as unknown, error: false }));
vi.mock("@/domains/front-api/cryptoMarketRepository", () => ({ useCryptoMarket: () => ({ data: { data: runtime.view }, isError: runtime.error, isLoading: false, refetch: vi.fn() }) }));
vi.mock("@/features/live-trading/workspace/FinancialChart", () => ({ FinancialChart: ({ pricePrecision, overlay, bars }: { pricePrecision: number; overlay: unknown; bars: unknown[] }) => <div data-testid="crypto-chart" data-precision={pricePrecision} data-overlay={String(overlay)} data-bars={bars.length} /> }));

function view(): CryptoMarketView {
  const asOf = new Date().toISOString();
  return { schemaVersion: "public_crypto_observation_v1", source: "KRAKEN_SPOT", sourceClass: "EXTERNAL_OBSERVATION", readOnly: true, asOf, instrument: "DOGEUSD", timeframe: "5",
    markets: [{ instrument: "BTCUSD", label: "Bitcoin", base: "BTC", quote: "USD", pricePrecision: 1 }, { instrument: "SOLUSD", label: "Solana", base: "SOL", quote: "USD", pricePrecision: 2 }, { instrument: "DOGEUSD", label: "Dogecoin", base: "DOGE", quote: "USD", pricePrecision: 7 }], timeframes: ["1", "5"],
    feed: { state: "CONNECTED", connected: true, exchange: "online", lastFrameAt: asOf },
    quotes: [{ instrument: "BTCUSD", state: "UNAVAILABLE" }, { instrument: "SOLUSD", state: "UNAVAILABLE" }, { instrument: "DOGEUSD", state: "LIVE", last: 0.0911234, bid: 0.0911233, ask: 0.0911235, changePct: 1.2, asOf, receivedAt: asOf, pricePrecision: 7 }],
    history: { state: "READY", loadedAt: asOf, bars: [{ timestamp: asOf, open: 0.09, high: 0.092, low: 0.089, close: 0.0911234, volume: 125, vwap: null, source: "KRAKEN_SPOT", forming: true }] } };
}

describe("public crypto contract", () => {
  it("keeps observation, USD units and DOGE precision explicit", () => { expect(isCryptoMarketView(view())).toBe(true); expect(numberLabel(0.0911234, 7)).toBe("0,0911234"); });
  it("rejects executable, mixed-source, duplicate and malformed observations", () => {
    for (const data of [{ ...view(), readOnly: false }, { ...view(), sourceClass: "CANONICAL_MARKET_DATA" }, { ...view(), markets: Array(3).fill(view().markets[0]) }, { ...view(), quotes: [{ ...view().quotes[2], last: NaN }, ...view().quotes.slice(0, 2)] }]) expect(isCryptoMarketView(data)).toBe(false);
  });
  it("allows unavailable history and quotes without inventing prices", () => { const data = view(); data.history = null; data.quotes = data.quotes.map(({ instrument }) => ({ instrument, state: "UNAVAILABLE" })); expect(isCryptoMarketView(data)).toBe(true); });
});

it("shows real-precision prices, freezes the whole reading, resumes and never attaches an execution overlay", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  runtime.view = view(); runtime.error = false;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const onPauseChange = vi.fn();
  const render = (resumeGeneration = 0) => <CryptoMarketPane instrument="DOGEUSD" timeframe="5" annotations={{ id: "chart-0", events: [], timeframe: "5", cursor: null }} overlay={null} onPauseChange={onPauseChange} resumeGeneration={resumeGeneration} />;
  try {
    await act(async () => root.render(render()));
    expect(host.querySelector(".tw-chart__price")?.textContent).toBe("0,0911234");
    expect(host.querySelector('[data-testid="crypto-chart"]')?.getAttribute("data-precision")).toBe("7");
    expect(host.querySelector('[data-testid="crypto-chart"]')?.getAttribute("data-overlay")).toBe("null");
    await act(async () => host.querySelector<HTMLButtonElement>(".tw-chart__footer button")!.click());
    expect(onPauseChange).toHaveBeenLastCalledWith("chart-0", true);
    const updated = view(); updated.quotes[2].last = 0.0923456; runtime.view = updated;
    await act(async () => root.render(render())); expect(host.querySelector(".tw-chart__price")?.textContent).toBe("0,0911234");
    await act(async () => root.render(render(1))); expect(host.querySelector(".tw-chart__price")?.textContent).toBe("0,0923456");
    expect(onPauseChange).toHaveBeenLastCalledWith("chart-0", false);
    runtime.error = true; await act(async () => root.render(render(1)));
    expect(host.textContent).toContain("Prix ancien · flux à vérifier");
    expect(host.textContent).toContain("Aucun ordre ni stratégie crypto n’est activé");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
