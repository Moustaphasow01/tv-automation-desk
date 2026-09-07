import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frontViewQueryKey } from "@/domains/front-api/repositories";
import {
  admitRealtimeEvent,
  invalidateRealtimeEventQueries,
  RealtimeQuerySynchronizer,
  refetchRealtimeRecoveryQueries,
} from "@/domains/realtime/realtimeQuerySync";
import { createRealtimeEventState, type EventEnvelope } from "@/domains/realtime/eventEnvelope";

const subscriptions: Array<() => void> = [];
const clients: QueryClient[] = [];

afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  clients.splice(0).forEach((client) => client.clear());
});

describe("realtime query synchronization", () => {
  it("refetches a parameterized Live Focus query once and ignores a duplicate before effects", async () => {
    const client = queryClient();
    const focus = vi.fn(async () => "focus-current");
    const desk = vi.fn(async () => "desk-current");
    const chart = vi.fn(async () => "chart-current");
    await observe(client, frontViewQueryKey("live-focus", [["period", "week"]], "live-focus"), focus);
    await observe(client, frontViewQueryKey("live-trading"), desk);
    await observe(client, frontViewQueryKey("live-trading", [["instrument", "ZC"]], "market-series"), chart);

    const event = marketContextEvent("evt_context_1", 1);
    const accepted = admitRealtimeEvent(createRealtimeEventState(), event);
    if (accepted.refreshCanonicalQueries) await invalidateRealtimeEventQueries(client, event);
    const duplicate = admitRealtimeEvent(accepted.state, event);
    if (duplicate.refreshCanonicalQueries) await invalidateRealtimeEventQueries(client, event);

    expect(accepted.disposition).toBe("ACCEPTED");
    expect(accepted.applyCommandEffect).toBe(true);
    expect(duplicate.disposition).toBe("DUPLICATE");
    expect(duplicate.applyCommandEffect).toBe(false);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(desk).toHaveBeenCalledTimes(2);
    expect(chart).toHaveBeenCalledTimes(1);
  });

  it("detects an out-of-order event before command effects and still refreshes canonical data", async () => {
    const client = queryClient();
    const focus = vi.fn(async () => "focus-current");
    await observe(client, frontViewQueryKey("live-focus", [], "live-focus"), focus);
    const current = admitRealtimeEvent(createRealtimeEventState(), marketContextEvent("evt_context_2", 2));
    const olderEvent = marketContextEvent("evt_context_older", 1);
    const older = admitRealtimeEvent(current.state, olderEvent);

    if (older.refreshCanonicalQueries) await invalidateRealtimeEventQueries(client, olderEvent);

    expect(older.disposition).toBe("OUT_OF_ORDER");
    expect(older.applyCommandEffect).toBe(false);
    expect(older.state.outOfOrderCount).toBe(1);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("refetches desk and chart scopes during both resync and reconnect recovery", async () => {
    const client = queryClient();
    const focus = vi.fn(async () => "focus-current");
    const chart = vi.fn(async () => "chart-current");
    await observe(client, frontViewQueryKey("live-focus", [], "live-focus"), focus);
    await observe(client, frontViewQueryKey("live-trading", [["instrument", "ZW"]], "market-series"), chart);

    await refetchRealtimeRecoveryQueries(client);
    await refetchRealtimeRecoveryQueries(client);

    expect(focus).toHaveBeenCalledTimes(3);
    expect(chart).toHaveBeenCalledTimes(3);
  });

  it("retains last-known data and source-specific errors when recovery refetch fails", async () => {
    const client = queryClient();
    const focus = vi.fn()
      .mockResolvedValueOnce("focus-last-known")
      .mockRejectedValueOnce(new Error("FOCUS_SOURCE_UNAVAILABLE"));
    const chart = vi.fn()
      .mockResolvedValueOnce("chart-last-known")
      .mockResolvedValueOnce("chart-current");
    const focusKey = frontViewQueryKey("live-focus", [], "live-focus");
    const chartKey = frontViewQueryKey("live-trading", [["instrument", "ZC"]], "market-series");
    await observe(client, focusKey, focus);
    await observe(client, chartKey, chart);

    await expect(refetchRealtimeRecoveryQueries(client)).rejects.toThrow("FOCUS_SOURCE_UNAVAILABLE");

    expect(client.getQueryData(focusKey)).toBe("focus-last-known");
    expect(client.getQueryState(focusKey)?.error).toMatchObject({ message: "FOCUS_SOURCE_UNAVAILABLE" });
    expect(client.getQueryData(chartKey)).toBe("chart-current");
    expect(client.getQueryState(chartKey)?.error).toBeNull();
  });

  it("queues an event burst during resync and refreshes it before recovery completes", async () => {
    const client = queryClient();
    const recoveryResponse = deferred<string>();
    const focus = vi.fn()
      .mockResolvedValueOnce("focus-last-known")
      .mockImplementationOnce(() => recoveryResponse.promise)
      .mockResolvedValueOnce("focus-after-event");
    const focusKey = frontViewQueryKey("live-focus", [], "live-focus");
    await observe(client, focusKey, focus);
    const recoveryStates: boolean[] = [];
    const synchronizer = new RealtimeQuerySynchronizer(client, {
      onError: () => undefined,
      onRecoveryState: (active) => recoveryStates.push(active),
    });

    const recovery = synchronizer.recover();
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
    await synchronizer.refreshInvalidatedViews(["live-focus"]);
    recoveryResponse.resolve("focus-recovered");
    await recovery;

    expect(focus).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(focusKey)).toBe("focus-after-event");
    expect(recoveryStates).toEqual([true, false]);
    synchronizer.close();
  });

  it("keeps a failed recovery visible until a later canonical refetch succeeds", async () => {
    const client = queryClient();
    const focus = vi.fn()
      .mockResolvedValueOnce("focus-last-known")
      .mockRejectedValueOnce(new Error("FOCUS_SOURCE_UNAVAILABLE"))
      .mockResolvedValueOnce("focus-current");
    const focusKey = frontViewQueryKey("live-focus", [], "live-focus");
    await observe(client, focusKey, focus);
    const errors: Array<string | null> = [];
    const synchronizer = new RealtimeQuerySynchronizer(client, {
      onError: (message) => errors.push(message),
      onRecoveryState: () => undefined,
    });
    synchronizer.recordConnectionError(new Error("BFF_EVENTS_RECONNECTING"));

    await synchronizer.recover();
    expect(errors.at(-1)).toBe("FOCUS_SOURCE_UNAVAILABLE");
    expect(client.getQueryData(focusKey)).toBe("focus-last-known");

    await synchronizer.recover();
    expect(errors.at(-1)).toBeNull();
    expect(client.getQueryData(focusKey)).toBe("focus-current");
    synchronizer.close();
  });

  it("does not clear a connection failure from an ordinary refresh or an older recovery", async () => {
    const client = queryClient();
    const recoveryResponse = deferred<string>();
    const focus = vi.fn()
      .mockResolvedValueOnce("focus-last-known")
      .mockResolvedValueOnce("focus-refreshed")
      .mockImplementationOnce(() => recoveryResponse.promise);
    await observe(client, frontViewQueryKey("live-focus", [], "live-focus"), focus);
    const errors: Array<string | null> = [];
    const synchronizer = new RealtimeQuerySynchronizer(client, {
      onError: (message) => errors.push(message),
      onRecoveryState: () => undefined,
    });
    synchronizer.recordConnectionError(new Error("BFF_EVENTS_RECONNECTING"));

    await synchronizer.refreshInvalidatedViews(["live-focus"]);
    expect(errors.at(-1)).toBe("BFF_EVENTS_RECONNECTING");

    const recovery = synchronizer.recover();
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(3));
    synchronizer.recordConnectionError(new Error("BFF_EVENTS_RECONNECTING_AGAIN"));
    recoveryResponse.resolve("focus-recovered");
    await recovery;

    expect(errors.at(-1)).toBe("BFF_EVENTS_RECONNECTING_AGAIN");
    synchronizer.close();
  });

  it("single-flights a slow refresh burst and drains the latest invalidation without cancellation", async () => {
    const client = queryClient();
    const firstRefresh = deferred<string>();
    const catchupRefresh = deferred<string>();
    let abortCount = 0;
    let callCount = 0;
    const focus = vi.fn((context?: { signal?: AbortSignal }) => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve("focus-last-known");
      context?.signal?.addEventListener("abort", () => { abortCount += 1; }, { once: true });
      return callCount === 2 ? firstRefresh.promise : catchupRefresh.promise;
    });
    const focusKey = frontViewQueryKey("live-focus", [], "live-focus");
    await observe(client, focusKey, focus);
    const synchronizer = new RealtimeQuerySynchronizer(client, {
      onError: () => undefined,
      onRecoveryState: () => undefined,
    });

    const refresh = synchronizer.refreshInvalidatedViews(["live-focus"]);
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
    const burst = Array.from({ length: 8 }, () => synchronizer.refreshInvalidatedViews(["live-focus"]));
    await Promise.resolve();
    expect(focus).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(focusKey)).toBe("focus-last-known");

    firstRefresh.resolve("focus-intermediate");
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(3));
    catchupRefresh.resolve("focus-latest");
    await Promise.all([refresh, ...burst]);

    expect(abortCount).toBe(0);
    expect(focus).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(focusKey)).toBe("focus-latest");
    synchronizer.close();
  });

  it("drains a queued refresh after failure but drops queued work after close", async () => {
    const client = queryClient();
    const failedRefresh = deferred<string>();
    const successfulRefresh = deferred<string>();
    const focus = vi.fn()
      .mockResolvedValueOnce("focus-last-known")
      .mockImplementationOnce(() => failedRefresh.promise)
      .mockImplementationOnce(() => successfulRefresh.promise);
    const focusKey = frontViewQueryKey("live-focus", [], "live-focus");
    await observe(client, focusKey, focus);
    const errors: Array<string | null> = [];
    const synchronizer = new RealtimeQuerySynchronizer(client, {
      onError: (message) => errors.push(message),
      onRecoveryState: () => undefined,
    });

    const first = synchronizer.refreshInvalidatedViews(["live-focus"]);
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
    const queued = synchronizer.refreshInvalidatedViews(["live-focus"]);
    failedRefresh.reject(new Error("FOCUS_REFRESH_FAILED"));
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(3));
    successfulRefresh.resolve("focus-current");
    await Promise.all([first, queued]);

    expect(errors).toEqual(["FOCUS_REFRESH_FAILED", null]);
    expect(client.getQueryData(focusKey)).toBe("focus-current");

    const afterClose = deferred<string>();
    focus.mockImplementationOnce(() => afterClose.promise);
    const closing = synchronizer.refreshInvalidatedViews(["live-focus"]);
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(4));
    void synchronizer.refreshInvalidatedViews(["live-focus"]);
    synchronizer.close();
    afterClose.resolve("focus-after-close");
    await closing;
    expect(focus).toHaveBeenCalledTimes(4);
  });
});

function queryClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  return client;
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

async function observe(client: QueryClient, queryKey: QueryKey, queryFn: () => Promise<string>): Promise<void> {
  await client.fetchQuery({ queryKey, queryFn, staleTime: Infinity });
  const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity, retry: false });
  subscriptions.push(observer.subscribe(() => undefined));
}

function marketContextEvent(eventId: string, sequence: number): EventEnvelope {
  return {
    eventId,
    aggregateId: "market-context-1",
    aggregateType: "market_context_snapshot",
    eventType: "market.context.snapshot.published",
    occurredAt: "2026-09-07T16:45:27.000Z",
    correlationId: "corr_context_1",
    schemaVersion: "1.0.0",
    sequence,
    payload: {},
  };
}
