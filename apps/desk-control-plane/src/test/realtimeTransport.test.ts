import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeskTransport } from "@/shared/transport";
import { createRealtimeEventState, type EventEnvelope } from "@/domains/realtime/eventEnvelope";
import type { DeskAppConfig } from "@/app/appConfig";

const bffConfig: DeskAppConfig = {
  dataMode: "bff",
  frontApiBaseUrl: "/front-api/v1",
  operatorAuthBaseUrl: "/api/v1/auth/operator",
  frontApiTimeoutMs: 1_000,
  features: {
    jarvisWorkspace: true
  }
};

describe("front realtime transport", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("subscribes to the BFF SSE stream with cursor resume", () => {
    const sourceInstances: FakeEventSource[] = [];

    vi.stubGlobal("window", {
      location: { origin: "https://desk.example" },
      setTimeout,
      clearTimeout
    });
    vi.stubGlobal(
      "EventSource",
      class extends FakeEventSource {
        constructor(url: string) {
          super(url);
          sourceInstances.push(this);
        }
      }
    );

    const statuses: string[] = [];
    const errors: string[] = [];
    const events: EventEnvelope[] = [];
    const transport = createDeskTransport(bffConfig);
    const state = { ...createRealtimeEventState(), lastEventId: "evt_checkpoint" };
    const subscription = transport.subscribeEvents(
      {
        onEvent: (event) => events.push(event),
        onStatus: (status) => statuses.push(status),
        onError: (error) => errors.push(error.message)
      },
      state
    );

    expect(sourceInstances[0]?.url).toBe("https://desk.example/front-api/v1/events?cursor=evt_checkpoint");
    expect(errors).toEqual([]);

    sourceInstances[0]?.onmessage?.({
      data: JSON.stringify({
        eventId: "evt_after_fallback",
        eventType: "desk.snapshot.updated",
        occurredAt: "2026-08-10T13:15:00.000Z",
        correlationId: "corr_transport_test",
        schemaVersion: "1.0.0",
        payload: { source: "sse" }
      })
    });

    expect(events[0]?.eventId).toBe("evt_after_fallback");

    subscription.close();

    expect(statuses).toContain("CONNECTING");
    expect(statuses.at(-1)).toBe("CLOSED");
  });

  it("reports disconnection immediately and resumes from the latest cursor after backoff", () => {
    vi.useFakeTimers();
    const sourceInstances: FakeEventSource[] = [];
    vi.stubGlobal("window", {
      location: { origin: "https://desk.example" },
      setTimeout,
      clearTimeout
    });
    vi.stubGlobal(
      "EventSource",
      class extends FakeEventSource {
        constructor(url: string) {
          super(url);
          sourceInstances.push(this);
        }
      }
    );
    const statuses: string[] = [];
    const errors: string[] = [];
    const subscription = createDeskTransport(bffConfig).subscribeEvents({
      onEvent: () => undefined,
      onStatus: (status) => statuses.push(status),
      onError: (error) => errors.push(error.message),
    });

    sourceInstances[0]?.onopen?.();
    sourceInstances[0]?.onmessage?.({ data: JSON.stringify(event("evt_latest")) });
    sourceInstances[0]?.onerror?.();

    expect(statuses).toEqual(["CONNECTING", "OPEN", "RECONNECTING"]);
    expect(errors).toEqual(["BFF_EVENTS_RECONNECTING"]);
    expect(sourceInstances).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(sourceInstances[1]?.url).toBe("https://desk.example/front-api/v1/events?cursor=evt_latest");
    sourceInstances[1]?.onopen?.();
    expect(statuses.at(-1)).toBe("OPEN");

    subscription.close();
  });

  it("reports browser offline immediately and reconnects with the same cursor when the network returns", () => {
    const sourceInstances: FakeEventSource[] = [];
    const listeners = new Map<string, Set<() => void>>();
    const network = { onLine: true };
    vi.stubGlobal("navigator", network);
    vi.stubGlobal("window", {
      location: { origin: "https://desk.example" },
      setTimeout,
      clearTimeout,
      addEventListener: (type: string, listener: () => void) => {
        const current = listeners.get(type) ?? new Set();
        current.add(listener);
        listeners.set(type, current);
      },
      removeEventListener: (type: string, listener: () => void) => listeners.get(type)?.delete(listener),
    });
    vi.stubGlobal("EventSource", class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        sourceInstances.push(this);
      }
    });
    const statuses: string[] = [];
    const errors: string[] = [];
    const subscription = createDeskTransport(bffConfig).subscribeEvents({
      onEvent: () => undefined,
      onStatus: (status) => statuses.push(status),
      onError: (error) => errors.push(error.message),
    });
    sourceInstances[0]?.onopen?.();
    sourceInstances[0]?.onmessage?.({ data: JSON.stringify(event("evt_before_offline")) });

    network.onLine = false;
    listeners.get("offline")?.forEach((listener) => listener());
    expect(statuses.at(-1)).toBe("OFFLINE");
    expect(errors.at(-1)).toBe("BFF_NETWORK_OFFLINE");

    network.onLine = true;
    listeners.get("online")?.forEach((listener) => listener());
    expect(statuses.at(-1)).toBe("RECONNECTING");
    expect(sourceInstances[1]?.url).toBe("https://desk.example/front-api/v1/events?cursor=evt_before_offline");

    subscription.close();
    expect(listeners.get("offline")?.size).toBe(0);
    expect(listeners.get("online")?.size).toBe(0);
  });
});

function event(eventId: string): EventEnvelope {
  return {
    eventId,
    eventType: "desk.snapshot.updated",
    occurredAt: "2026-08-10T13:15:00.000Z",
    correlationId: "corr_transport_test",
    schemaVersion: "1.0.0",
    payload: { source: "sse" }
  };
}

class FakeEventSource {
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(readonly url: string) {}

  close() {}
}
