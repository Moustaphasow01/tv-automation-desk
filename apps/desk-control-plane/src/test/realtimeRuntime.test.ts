import { describe, expect, it } from "vitest";
import {
  assertEventEnvelope,
  createRealtimeEventState,
  frontViewNamesForRealtimeEvent,
  reduceRealtimeEvent,
  reduceRealtimeMessage,
  type EventEnvelope
} from "@/domains/realtime/eventEnvelope";
import {
  buildCommandHeaders,
  createCommandRuntimeState,
  prepareDeskCommand,
  reduceCommandEvent,
  type CommandRuntimeClock
} from "@/domains/realtime/commandRuntime";
import { buildRealtimeSseUrl } from "@/shared/transport";

const eventBase = {
  occurredAt: "2026-08-10T13:00:00.000Z",
  correlationId: "corr_runtime_test",
  schemaVersion: "1.0.0",
  payload: {}
} satisfies Omit<EventEnvelope, "eventId" | "eventType">;

describe("front realtime event runtime", () => {
  it("validates the mandatory front event envelope fields", () => {
    const event = assertEventEnvelope({
      ...eventBase,
      eventId: "evt_1",
      eventType: "desk.snapshot.updated",
      sequence: 1
    });

    expect(event.eventType).toBe("desk.snapshot.updated");
    expect(() => assertEventEnvelope({ ...event, schemaVersion: "v1" })).toThrow(/FRONT_EVENT_ENVELOPE_INVALID/);
  });

  it("deduplicates events and counts out-of-order messages", () => {
    const first = {
      ...eventBase,
      eventId: "evt_1",
      eventType: "desk.snapshot.updated",
      sequence: 10
    } satisfies EventEnvelope;
    const older = {
      ...eventBase,
      eventId: "evt_2",
      eventType: "position.updated",
      sequence: 9
    } satisfies EventEnvelope;

    const afterFirst = reduceRealtimeEvent(createRealtimeEventState(), first);
    const afterDuplicate = reduceRealtimeEvent(afterFirst, first);
    const afterOlder = reduceRealtimeEvent(afterDuplicate, older);

    expect(afterOlder.acceptedCount).toBe(2);
    expect(afterOlder.duplicateCount).toBe(1);
    expect(afterOlder.outOfOrderCount).toBe(1);
    expect(afterOlder.sequenceGapCount).toBe(0);
    expect(afterOlder.eventTypeCounts["position.updated"]).toBe(1);
  });

  it("detects sequence gaps per aggregate without inventing missing sequence metadata", () => {
    const first = reduceRealtimeEvent(createRealtimeEventState(), {
      ...eventBase,
      eventId: "evt_a_1",
      aggregateId: "order-intent-1",
      aggregateType: "OrderIntent",
      eventType: "order.status.changed",
      sequence: 4,
    });
    const gap = reduceRealtimeEvent(first, {
      ...eventBase,
      eventId: "evt_a_2",
      aggregateId: "order-intent-1",
      aggregateType: "OrderIntent",
      eventType: "order.status.changed",
      sequence: 7,
    });
    const unrelatedAggregate = reduceRealtimeEvent(gap, {
      ...eventBase,
      eventId: "evt_b_1",
      aggregateId: "order-intent-2",
      aggregateType: "OrderIntent",
      eventType: "order.status.changed",
      sequence: 99,
    });
    const noSequence = reduceRealtimeEvent(unrelatedAggregate, {
      ...eventBase,
      eventId: "evt_no_sequence",
      eventType: "provider.health.changed",
    });

    expect(gap.sequenceGapCount).toBe(1);
    expect(unrelatedAggregate.sequenceGapCount).toBe(1);
    expect(noSequence.sequenceGapCount).toBe(1);
    expect(noSequence.lastSequenceByAggregate["OrderIntent:order-intent-1"]).toBe(7);
  });

  it("isolates sequence tracking by aggregate type as well as aggregate id", () => {
    const intent = reduceRealtimeEvent(createRealtimeEventState(), {
      ...eventBase,
      eventId: "evt_shared_intent",
      aggregateId: "shared-1",
      aggregateType: "OrderIntent",
      eventType: "order_intent.created",
      sequence: 8,
    });
    const signal = reduceRealtimeEvent(intent, {
      ...eventBase,
      eventId: "evt_shared_signal",
      aggregateId: "shared-1",
      aggregateType: "StrategySignal",
      eventType: "strategy.signal.created",
      sequence: 1,
    });

    expect(signal.outOfOrderCount).toBe(0);
    expect(signal.sequenceGapCount).toBe(0);
    expect(signal.lastSequenceByAggregate["OrderIntent:shared-1"]).toBe(8);
    expect(signal.lastSequenceByAggregate["StrategySignal:shared-1"]).toBe(1);
  });

  it("keeps invalid messages visible in runtime counters", () => {
    const state = reduceRealtimeMessage(createRealtimeEventState(), { eventType: "desk.snapshot.updated" });

    expect(state.invalidCount).toBe(1);
    expect(state.acceptedCount).toBe(0);
  });

  it("maps realtime events to the BFF views that must be refreshed", () => {
    expect(
      frontViewNamesForRealtimeEvent({
        ...eventBase,
        eventId: "evt_risk_canonical",
        eventType: "risk.decision.created",
        payload: {}
      })
    ).toEqual(expect.arrayContaining(["command-center", "live-trading", "portfolio"]));
    expect(
      frontViewNamesForRealtimeEvent({
        ...eventBase,
        eventId: "evt_human_gate",
        eventType: "human_gate.state_changed",
        payload: {}
      })
    ).toEqual(expect.arrayContaining(["command-center", "live-trading", "execution-reconciliation"]));
    expect(
      frontViewNamesForRealtimeEvent({
        ...eventBase,
        eventId: "evt_position",
        eventType: "position.updated",
        payload: {}
      })
    ).toEqual(["command-center", "live-trading", "live-plan", "live-timeline", "execution-reconciliation", "portfolio", "performance-overview", "performance-calendar", "performance-trades"]);
    expect(
      frontViewNamesForRealtimeEvent({
        ...eventBase,
        eventId: "evt_jarvis",
        eventType: "jarvis.message.created",
        payload: {}
      })
    ).toEqual(["command-center", "jarvis-workspace"]);
    expect(
      frontViewNamesForRealtimeEvent({
        ...eventBase,
        eventId: "evt_backtest",
        eventType: "backtest.completed",
        payload: {}
      })
    ).toEqual(expect.arrayContaining(["research-candidates", "replay-runs", "performance-overview"]));
  });
});

describe("front command runtime", () => {
  it("creates idempotent command headers without deciding the business outcome", () => {
    const clock: CommandRuntimeClock = {
      now: () => new Date("2026-08-10T13:05:00.000Z"),
      randomId: (() => {
        const ids = ["one", "two"];
        return () => ids.shift() ?? "fallback";
      })()
    };
    const command = prepareDeskCommand(
      {
        commandType: "portfolio.refresh",
        environment: "PAPER",
        expectedVersion: "v42",
        reason: "operator-refresh"
      },
      clock
    );
    const headers = buildCommandHeaders(command) as Record<string, string>;

    expect(command.status).toBe("REQUESTED");
    expect(headers["Idempotency-Key"]).toBe("idem_portfolio_refresh_one");
    expect(headers["X-Correlation-ID"]).toBe("corr_portfolio_refresh_two");
    expect(headers["If-Match"]).toBe("v42");
    expect(headers["X-Desk-Environment"]).toBe("PAPER");
  });

  it("updates command snapshots only from command status events", () => {
    const state = reduceCommandEvent(createCommandRuntimeState(), {
      ...eventBase,
      eventId: "evt_cmd",
      eventType: "command.status.changed",
      payload: {
        commandId: "cmd_1",
        status: "RUNNING",
        message: "Queued by BFF"
      }
    });

    expect(state.commands.cmd_1?.status).toBe("RUNNING");
    expect(state.commands.cmd_1?.correlationId).toBe("corr_runtime_test");

    const unchanged = reduceCommandEvent(state, {
      ...eventBase,
      eventId: "evt_position",
      eventType: "position.updated",
      payload: {
        commandId: "cmd_1",
        status: "SUCCEEDED"
      }
    });

    expect(unchanged.commands.cmd_1?.status).toBe("RUNNING");
  });
});

describe("front realtime transport urls", () => {
  it("builds the BFF SSE endpoint with cursor resume support", () => {
    expect(buildRealtimeSseUrl("https://api.example/front-api/v1", "evt_42", "https://desk.example")).toBe(
      "https://api.example/front-api/v1/events?cursor=evt_42"
    );
  });
});
