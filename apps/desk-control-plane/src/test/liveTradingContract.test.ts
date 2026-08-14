import { describe, expect, it } from "vitest";
import { canonicalViewDataset, liveTradingView } from "@/mocks/canonicalDataset";
import { isLiveTradingView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

const authoritativePipeline = [
  "MARKET_DATA",
  "FEATURE_ENGINE",
  "STRATEGY_RUNTIME",
  "SIGNAL_BUS",
  "ARBITRATION",
  "GLOBAL_RISK",
  "BROKER_NETTING",
  "ORDER_INTENT",
  "EXECUTION_GATEWAY",
  "PROVIDER",
  "BROKER",
  "RECONCILIATION"
];

describe("live trading front contract", () => {
  it("accepts the canonical Live Trading view envelope", () => {
    const envelope = assertViewEnvelope(liveTradingView, isLiveTradingView);

    expect(envelope.data.pipeline.map((step) => step.stepId)).toEqual(authoritativePipeline);
    expect(envelope.data.launchGate.status).toBe("READY");
    expect(envelope.data.launchGate.checks.map((check) => check.id)).toEqual(expect.arrayContaining(["data.live_fresh", "data.source_durable", "broker.sim101_addon_ready"]));
    expect(envelope.data.signals.length).toBeGreaterThanOrEqual(2);
    expect(envelope.data.orders.length).toBeGreaterThanOrEqual(2);
    expect(envelope.data.providers.length).toBeGreaterThanOrEqual(2);
  });

  it("makes the launch gate explicit before PAPER agents can run", () => {
    const envelope = assertViewEnvelope(liveTradingView, isLiveTradingView);

    expect(envelope.data.launchGate.finalDecision).toBe("OPEN_DEMO_PAPER_AGENTS_ALLOWED");
    expect(envelope.data.launchGate.finalCheckCommand).toBe("npm run --silent gate:demo-paper -- --json");
    expect(envelope.data.launchGate.releaseCheckCommand).toBe("DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json");
    expect(envelope.data.launchGate.components.map((component) => component.componentId)).toEqual(["demo-paper", "vnext-operator"]);
    expect(envelope.data.launchGate.blockers).toEqual([]);
    expect(envelope.data.launchGate.checks.every((check) => typeof check.detail === "string" && check.detail.length > 0)).toBe(true);
  });

  it("keeps signal, order, provider and position ids coherent across live projections", () => {
    const { signals, arbitrations, riskChecks, orders, providers, positions } = liveTradingView.data;
    const signalIds = new Set(signals.map((signal) => signal.signalId));
    const providerIds = new Set(providers.map((provider) => provider.providerId));
    const strategyInstanceIds = new Set(canonicalViewDataset["strategy-center"].data.strategies.map((strategy) => strategy.strategyInstanceId));
    const portfolioInstanceIds = new Set(canonicalViewDataset.portfolio.data.virtualAllocations.map((allocation) => allocation.strategyInstanceId));

    expect(arbitrations.every((arbitration) => signalIds.has(arbitration.signalId))).toBe(true);
    expect(riskChecks.every((risk) => signalIds.has(risk.signalId))).toBe(true);
    expect(orders.every((order) => signalIds.has(order.signalId) && providerIds.has(order.providerId))).toBe(true);
    expect(positions.every((position) => strategyInstanceIds.has(position.strategyInstanceId))).toBe(true);
    expect(positions.some((position) => portfolioInstanceIds.has(position.strategyInstanceId))).toBe(true);
  });

  it("keeps AI advisory outside the authoritative execution pipeline", () => {
    const pipelineLabels = liveTradingView.data.pipeline.map((step) => `${step.stepId} ${step.label}`.toLowerCase());

    expect(liveTradingView.data.aiAdvisory.mode).toBe("SHADOW");
    expect(pipelineLabels.join(" ")).not.toContain("ai");
    expect(pipelineLabels.join(" ")).not.toContain("llm");
  });
});
