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
});

class FakeEventSource {
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(readonly url: string) {}

  close() {}
}
