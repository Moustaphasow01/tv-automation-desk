import { describe, expect, it } from "vitest";
import { eventsAuditView, executionProvidersView, ordersView, riskView } from "@/mocks/canonicalDataset";
import { isExecutionProvidersView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildExecutionProviderCommand } from "@/pages/ExecutionProvidersPage";
import { assertViewEnvelope } from "@/shared/contracts";

const requiredPickMyTradeStates = [
  "NOT_CONFIGURED",
  "VALIDATION_PENDING",
  "DEMO",
  "SHADOW",
  "ACTIVE",
  "STANDBY",
  "DEGRADED",
  "DISCONNECTED",
  "DISABLED"
] as const;

describe("execution providers front contract", () => {
  it("accepts the canonical Execution Providers view envelope", () => {
    const envelope = assertViewEnvelope(executionProvidersView, isExecutionProvidersView);

    expect(envelope.data.providers.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.accounts.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.switchWorkflow.length).toBe(6);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(6);
  });

  it("supports every PickMyTrade state without assuming activation", () => {
    const pickMyTradeAdapter = executionProvidersView.data.adapters.find((adapter) => adapter.adapterId === "adapter_pickmytrade_v1");
    const pickMyTradeProvider = executionProvidersView.data.providers.find((provider) => provider.providerId === "provider_pickmytrade_shadow");

    expect(pickMyTradeAdapter).toBeTruthy();
    expect(pickMyTradeAdapter!.availableStates).toEqual(requiredPickMyTradeStates);
    expect(pickMyTradeProvider?.state).toBe("DEGRADED");
    expect(pickMyTradeProvider?.role).toBe("STANDBY");
  });

  it("reuses provider ids from orders and risk actions", () => {
    const providerIds = new Set(executionProvidersView.data.providers.map((provider) => provider.providerId));
    const orderProviderIds = new Set(ordersView.data.providers.map((provider) => provider.providerId));
    const riskProviderIds = riskView.data.commandActions
      .map((action) => action.payload.providerId)
      .filter((providerId): providerId is string => typeof providerId === "string");

    expect([...orderProviderIds].every((providerId) => providerIds.has(providerId))).toBe(true);
    expect(riskProviderIds.some((providerId) => providerIds.has(providerId))).toBe(true);
  });

  it("keeps provider events resolvable against Events Audit", () => {
    const eventIds = new Set(eventsAuditView.data.events.map((event) => event.eventId));
    const eventCorrelationIds = new Set(eventsAuditView.data.events.map((event) => event.correlationId));

    expect(executionProvidersView.data.events.every((event) => eventIds.has(event.eventId))).toBe(true);
    expect(executionProvidersView.data.events.every((event) => eventCorrelationIds.has(event.correlationId))).toBe(true);
  });

  it("does not expose browser secrets, tokens, passwords or credentials", () => {
    const serialized = JSON.stringify(executionProvidersView.data).toLowerCase();

    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("credential");
    expect(executionProvidersView.data.providers.every((provider) => provider.browserExposure === "NONE")).toBe(true);
  });

  it("models the complete provider switch workflow in order", () => {
    expect(executionProvidersView.data.switchWorkflow.map((step) => step.stepId)).toEqual([
      "freeze_new_orders",
      "position_check",
      "sync_target",
      "activate_target",
      "reconcile",
      "resume"
    ]);
  });

  it("submits provider tests through Command Runtime with If-Match", () => {
    const action = executionProvidersView.data.commandActions.find((candidate) => candidate.commandType === "execution.provider.test");
    expect(action).toBeTruthy();

    const input = buildExecutionProviderCommand(action!, "Operator requests provider heartbeat test.");
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T16:20:00.000Z"),
      randomId: (() => {
        const ids = ["provider-one", "provider-two"];
        return () => ids.shift() ?? "provider-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(action!.expectedVersion);
    expect(headers["If-Match"]).toBe(action!.expectedVersion);
    expect(input.payload).toMatchObject({
      actionId: action!.actionId,
      providerId: "provider_ninjatrader_sim101",
      simulationOnly: true
    });
  });

  it("requires step-up before provider switch simulation and rejects denied demo orders", () => {
    const switchAction = executionProvidersView.data.commandActions.find((candidate) => candidate.commandType === "execution.provider.switch_primary");
    const deniedAction = executionProvidersView.data.commandActions.find((candidate) => candidate.commandType === "execution.provider.demo_test_order");
    expect(switchAction).toBeTruthy();
    expect(deniedAction).toBeTruthy();

    expect(() => buildExecutionProviderCommand(switchAction!, "Switch dry-run", "bad-token")).toThrow("EXECUTION_PROVIDER_STEP_UP_REQUIRED");
    expect(() => buildExecutionProviderCommand(deniedAction!, "Demo order")).toThrow("EXECUTION_PROVIDER_PERMISSION_DENIED");

    const input = buildExecutionProviderCommand(switchAction!, "Switch dry-run", switchAction!.actionId);
    expect(input.payload).toMatchObject({
      actionId: switchAction!.actionId,
      targetProviderId: "provider_pickmytrade_shadow",
      simulationOnly: true,
      stepUpAccepted: true
    });
  });

  it("rejects empty command reasons before submitting", () => {
    expect(() => buildExecutionProviderCommand(executionProvidersView.data.commandActions[0], " ")).toThrow(
      "EXECUTION_PROVIDER_REASON_REQUIRED"
    );
  });
});
