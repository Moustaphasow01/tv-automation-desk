import { describe, expect, it } from "vitest";
import { eventsAuditView, liveSignalDetailView, liveTradingView, ordersView, portfolioView } from "@/mocks/canonicalDataset";
import { isOrdersView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildOrdersCommand } from "@/pages/OrdersPage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("orders front contract", () => {
  it("accepts the canonical Orders view envelope", () => {
    const envelope = assertViewEnvelope(ordersView, isOrdersView);

    expect(envelope.data.orderIntents.length).toBeGreaterThanOrEqual(2);
    expect(envelope.data.activeOrders.length).toBeGreaterThanOrEqual(2);
    expect(envelope.data.fills.length).toBeGreaterThanOrEqual(2);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(4);
  });

  it("reuses order, fill, provider and signal ids from live projections", () => {
    const liveOrderIds = new Set(liveTradingView.data.orders.map((order) => order.orderId));
    const liveFillIds = new Set(liveTradingView.data.fills.map((fill) => fill.fillId));
    const liveProviderIds = new Set(liveTradingView.data.providers.map((provider) => provider.providerId));
    const liveSignalIds = new Set(liveTradingView.data.signals.map((signal) => signal.signalId));
    const liveSignalDetailOrderIds = new Set(liveSignalDetailView.data.linkedOrders.map((order) => order.orderId));
    const portfolioInstanceIds = new Set(portfolioView.data.virtualAllocations.map((allocation) => allocation.strategyInstanceId));

    expect(ordersView.data.activeOrders.some((order) => liveOrderIds.has(order.orderId))).toBe(true);
    expect(ordersView.data.activeOrders.some((order) => liveSignalDetailOrderIds.has(order.orderId))).toBe(true);
    expect(ordersView.data.fills.every((fill) => liveFillIds.has(fill.fillId))).toBe(true);
    expect(ordersView.data.providers.every((provider) => liveProviderIds.has(provider.providerId))).toBe(true);
    expect(ordersView.data.orderIntents.every((intent) => liveSignalIds.has(intent.signalId))).toBe(true);
    expect(ordersView.data.activeOrders.some((order) => portfolioInstanceIds.has(order.strategyInstanceId))).toBe(true);
  });

  it("keeps event history resolvable against Events Audit", () => {
    const eventIds = new Set(eventsAuditView.data.events.map((event) => event.eventId));

    expect(ordersView.data.history.every((event) => eventIds.has(event.eventId))).toBe(true);
    expect(ordersView.data.history.map((event) => event.eventId)).toEqual(
      expect.arrayContaining(["evt_order_intent_created", "evt_execution_gateway_accepted", "evt_provider_order_ack"])
    );
  });

  it("renders explicit provider states and protection states", () => {
    expect(ordersView.data.providers.map((provider) => provider.status)).toEqual(expect.arrayContaining(["OK", "DEGRADED"]));
    expect(ordersView.data.protections.map((protection) => protection.state)).toEqual(expect.arrayContaining(["ATTACHED", "PENDING"]));
    expect(ordersView.data.activeOrders.every((order) => order.idempotencyKey && order.correlationId && order.expectedVersion)).toBe(true);
  });

  it("submits orders actions through Command Runtime with target expected version", () => {
    const action = ordersView.data.commandActions.find((candidate) => candidate.commandType === "orders.cancel");
    expect(action).toBeTruthy();

    const input = buildOrdersCommand(action!, "Operator confirms cancel after checking provider state.");
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T16:20:00.000Z"),
      randomId: (() => {
        const ids = ["orders-one", "orders-two"];
        return () => ids.shift() ?? "orders-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(action!.expectedVersion);
    expect(headers["If-Match"]).toBe(action!.expectedVersion);
    expect(input.reason).toContain("Operator confirms");
    expect(input.payload).toMatchObject({
      actionId: action!.actionId,
      targetOrderId: action!.targetOrderId,
      orderId: action!.targetOrderId,
      providerId: "provider_ninjatrader_sim101"
    });
  });

  it("rejects empty command reasons before submitting", () => {
    expect(() => buildOrdersCommand(ordersView.data.commandActions[0], " ")).toThrow("ORDERS_REASON_REQUIRED");
  });

  it("fails closed when an order action is not backend-authorized", () => {
    const denied = { ...ordersView.data.commandActions[0], permission: "DENIED" as const };
    expect(() => buildOrdersCommand(denied, "Operator reviewed the action.")).toThrow("ORDERS_ACTION_NOT_ALLOWED");
  });
});
