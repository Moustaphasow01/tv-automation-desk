// @vitest-environment happy-dom

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeskAppConfig } from "@/app/appConfig";
import { frontViewQueryKey } from "@/domains/front-api/repositories";
import { RealtimeContext, RealtimeProvider, type RealtimeStatus } from "@/domains/realtime/RealtimeProvider";

const config: DeskAppConfig = {
  dataMode: "bff",
  frontApiBaseUrl: "/front-api/v1",
  operatorAuthBaseUrl: "/api/v1/auth/operator",
  frontApiTimeoutMs: 1_000,
  features: { jarvisWorkspace: true },
};

describe("mounted realtime provider", () => {
  afterEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("stays disconnected until reconnect queries succeed, then clears the connection error", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const sources: FakeEventSource[] = [];
    vi.stubGlobal("EventSource", class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        sources.push(this);
      }
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const focus = vi.fn(async () => "focus-current");
    const chart = vi.fn(async () => "chart-current");
    const focusKey = frontViewQueryKey("live-focus", [], "live-focus");
    const chartKey = frontViewQueryKey("live-trading", [["instrument", "ZC"]], "market-series");
    await client.fetchQuery({ queryKey: focusKey, queryFn: focus });
    await client.fetchQuery({ queryKey: chartKey, queryFn: chart });
    const stopFocus = new QueryObserver(client, { queryKey: focusKey, queryFn: focus, staleTime: Infinity }).subscribe(() => undefined);
    const stopChart = new QueryObserver(client, { queryKey: chartKey, queryFn: chart, staleTime: Infinity }).subscribe(() => undefined);
    const container = document.createElement("div");
    const root = createRoot(container);
    let latest: RealtimeStatus | null = null;
    const Probe = () => { latest = useContext(RealtimeContext); return null; };

    await act(async () => root.render(createElement(RealtimeProvider, {
      config,
      queryClient: client,
      children: createElement(Probe),
    })));
    await act(async () => sources[0]?.onopen?.());
    await act(async () => sources[0]?.onerror?.());

    expect((latest as RealtimeStatus | null)?.connectionStatus).toBe("RECONNECTING");
    expect((latest as RealtimeStatus | null)?.latestError).toBe("BFF_EVENTS_RECONNECTING");

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { sources[1]?.onopen?.(); await Promise.resolve(); });

    expect((latest as RealtimeStatus | null)?.connectionStatus).toBe("OPEN");
    expect((latest as RealtimeStatus | null)?.resyncing).toBe(false);
    expect((latest as RealtimeStatus | null)?.latestError).toBeNull();
    expect(focus).toHaveBeenCalledTimes(2);
    expect(chart).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    stopFocus();
    stopChart();
    client.clear();
  });
});

class FakeEventSource {
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(readonly url: string) {}

  close() {}
}
