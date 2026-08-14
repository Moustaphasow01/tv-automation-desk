import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadonlyTradeTerms, ReconciliationPanel } from "@/features/order-intent/components";
import { buildOrderIntentDossier } from "@/features/order-intent/mapper";
import { buildHumanGateCommand, type HumanGateAction } from "@/features/order-intent/model";
import { presentBackendStatus, presentOrderLifecycleEvidence } from "@/features/order-intent/statusRegistry";
import type { OrderDetailView } from "@/domains/front-api/viewModels";
import type { ViewEnvelope } from "@/shared/contracts";

describe("OrderIntent dossier semi-manual contract", () => {
  it("keeps missing backend authorities unavailable and never infers allowed actions", () => {
    const dossier = buildOrderIntentDossier(orderDetailEnvelope());

    expect(dossier.executionMode.state).toBe("UNAVAILABLE");
    expect(dossier.globalRisk.decision.state).toBe("UNAVAILABLE");
    expect(dossier.targetPosition.authorizedQuantity.state).toBe("UNAVAILABLE");
    expect(dossier.humanGate.actions).toEqual([]);
    expect(dossier.humanGate.unavailableReason).toContain("allowedAction");
  });

  it("uses backend-published authority, Human Gate and reconciliation without inventing them", () => {
    const envelope = orderDetailEnvelope();
    envelope.data.authority = {
      strategy: { strategyId: "strategy-1", strategyInstanceId: "strategy-instance-1", strategyVersion: "v1" },
      signal: { signalId: "signal-1", instrument: "MNQ", side: "BUY" },
      contextGate: { label: "Context Gate", decision: "TAKE", reasonCodes: ["REGIME_OK"], authorityId: "ctx-1", version: "context-v1" },
      portfolioArbitration: { label: "Portfolio Arbitration", decision: "ALLOCATED", reasonCodes: ["alloc-1"], authorityId: "arb-1", version: "portfolio-v1" },
      globalRisk: { label: "Global Risk", decision: "APPROVED", reasonCodes: ["MAX_RISK_OK"], authorityId: "risk-1", version: "risk-v1" },
      targetPosition: { targetPositionId: "target-1", account: "SIM-101", authorizedQuantity: 2 },
    };
    envelope.data.executionMode = "SEMI_MANUAL";
    envelope.data.humanGate = {
      gateId: "gate-1",
      status: "AWAITING_MANUAL_CONFIRMATION",
      revision: 1,
      expiresAt: "2026-08-14T00:05:00Z",
      confirmedAt: "",
      rejectedAt: "",
      unavailableReason: "",
      actions: [{
        action: "CONFIRM",
        actionId: "gate-confirm-1",
        label: "Confirm OrderIntent",
        commandType: "execution.order_intent.confirm",
        environment: "PAPER",
        permission: "ALLOWED",
        requiresConfirmation: true,
        requiresReason: true,
        expectedRevision: "rev-1",
        impactPreview: "Human Gate only.",
        payload: { orderIntentId: "intent-1" },
      }],
    };
    envelope.data.reconciliation = {
      status: "AWAITING_MANUAL_CONFIRMATION",
      checkedAt: "2026-08-14T00:00:00Z",
      expected: [{ label: "quantity", value: 2 }],
      broker: [{ label: "filledQuantity", value: 0 }],
      mismatches: [],
    };

    const dossier = buildOrderIntentDossier(envelope);

    expect(dossier.executionMode).toMatchObject({ state: "KNOWN", value: "SEMI_MANUAL" });
    expect(dossier.contextGate.decision).toMatchObject({ state: "KNOWN", value: "TAKE" });
    expect(dossier.portfolioArbitration.authorityId).toMatchObject({ state: "KNOWN", value: "arb-1" });
    expect(dossier.globalRisk.reasonCodes).toEqual(["MAX_RISK_OK"]);
    expect(dossier.targetPosition.authorizedQuantity).toMatchObject({ state: "KNOWN", value: 2 });
    expect(dossier.humanGate.status).toMatchObject({ state: "KNOWN", value: "AWAITING_MANUAL_CONFIRMATION" });
    expect(dossier.humanGate.actions).toHaveLength(1);
    expect(dossier.reconciliation.broker[0].value).toMatchObject({ state: "KNOWN", value: 0 });
  });

  it("renders post-Risk trade terms as definitions without editable controls", () => {
    const html = renderToStaticMarkup(<ReadonlyTradeTerms dossier={buildOrderIntentDossier(orderDetailEnvelope())} />);

    expect(html).toContain("READ-ONLY APRÈS RISK");
    expect(html).toContain("Instrument");
    expect(html).toContain("Quantité autorisée");
    expect(html).toContain("Entrée");
    expect(html).toContain("Stop");
    expect(html).toContain("Target 1");
    expect(html).not.toMatch(/<(input|select|textarea)\b/i);
    expect(html).not.toContain("contenteditable");
  });

  it("builds a Human Gate command only from a complete backend-published action", () => {
    const action: HumanGateAction = {
      action: "CONFIRM",
      actionId: "gate-confirm-1",
      label: "Confirm OrderIntent",
      commandType: "execution.order_intent.confirm",
      environment: "PAPER",
      permission: "ALLOWED",
      requiresConfirmation: true,
      requiresReason: true,
      expectedRevision: "rev-42",
      impactPreview: "Autorise la création d'une commande provider PAPER.",
      payload: { orderIntentId: "intent-1" },
    };

    expect(buildHumanGateCommand(action, "Validation opérateur.")).toEqual({
      commandType: "execution.order_intent.confirm",
      environment: "PAPER",
      expectedVersion: "rev-42",
      reason: "Validation opérateur.",
      payload: { orderIntentId: "intent-1", actionId: "gate-confirm-1" },
    });
    expect(() => buildHumanGateCommand({ ...action, permission: "DENIED" }, "raison")).toThrow("HUMAN_GATE_ACTION_NOT_ALLOWED");
    expect(() => buildHumanGateCommand(action, "  ")).toThrow("HUMAN_GATE_REASON_REQUIRED");
  });

  it("keeps confirmation, ACK, partial fill and fill semantically distinct", () => {
    const labels = ["CONFIRMED", "ACKNOWLEDGED", "PARTIALLY_FILLED", "FILLED"].map((code) => presentBackendStatus(code).label);
    expect(new Set(labels).size).toBe(4);
    expect(presentBackendStatus("CONFIRMED").helper).toContain("ni un ACK ni un fill");
    expect(presentBackendStatus("ACKNOWLEDGED").helper).toContain("aucun fill");
  });

  it("falls back safely for a new backend status and preserves the raw code", () => {
    const presentation = presentBackendStatus("PROVIDER_FUTURE_STATE");
    expect(presentation.known).toBe(false);
    expect(presentation.label).toBe("Statut inconnu");
    expect(presentation.code).toBe("PROVIDER_FUTURE_STATE");
  });

  it("does not present FILLED as executed when broker quantities contradict it", () => {
    const presentation = presentOrderLifecycleEvidence({ state: "FILLED", orderedQuantity: 2, filledQuantity: 0, remainingQuantity: 2 });

    expect(presentation.label).toBe("État incohérent");
    expect(presentation.tone).toBe("danger");
    expect(presentation.code).toBe("FILLED");
    expect(presentation.helper).toContain("preuve broker insuffisante");
  });

  it("keeps a reconciliation mismatch visible until the backend removes it", () => {
    const html = renderToStaticMarkup(<ReconciliationPanel reconciliation={{
      status: { state: "KNOWN", value: "CONTROLLED_DIVERGENCE", asOf: "2026-08-14T00:00:00Z", source: "backend" },
      checkedAt: { state: "KNOWN", value: "2026-08-14T00:00:00Z", asOf: "2026-08-14T00:00:00Z", source: "backend" },
      expected: [{ label: "Quantité", value: { state: "KNOWN", value: 2, asOf: "2026-08-14T00:00:00Z", source: "backend" } }],
      broker: [{ label: "Quantité", value: { state: "KNOWN", value: 1, asOf: "2026-08-14T00:00:00Z", source: "broker" } }],
      mismatches: [{ field: "quantity", expected: "2", actual: "1", reason: "PARTIAL_FILL" }],
    }} />);

    expect(html).toContain("RECONCILIATION MISMATCH");
    expect(html).toContain("PARTIAL_FILL");
    expect(html).toContain('role="alert"');
  });
});

function orderDetailEnvelope(): ViewEnvelope<OrderDetailView> {
  return {
    meta: {
      generatedAt: "2026-08-14T00:00:01Z",
      asOf: "2026-08-14T00:00:00Z",
      stale: false,
      latencyMs: 12,
      correlationId: "corr-order-1",
      schemaVersion: "1.0.0",
      availability: "PARTIAL",
      warnings: ["human-gate:UNAVAILABLE"],
    },
    permissions: [],
    data: {
      summary: { state: "ACKED", orderedQuantity: 2, filledQuantity: 0, remainingQuantity: 2, fillCount: 0, protectionStatus: "PENDING" },
      identity: { orderId: "order-1", orderIntentId: "intent-1", signalId: "signal-1", providerId: "provider-1", brokerOrderId: "broker-1", correlationId: "corr-order-1", strategyInstanceId: "strategy-instance-1" },
      order: {
        orderId: "order-1", orderIntentId: "intent-1", signalId: "signal-1", providerId: "provider-1", brokerOrderId: "broker-1", strategyInstanceId: "strategy-instance-1",
        account: "SIM-101", instrument: "MNQ", side: "BUY", quantity: 2, remainingQuantity: 2, type: "LIMIT", tif: "DAY", limitPrice: 21450.25,
        stopPrice: 21410.25, targetPrice: 21490.25, commissions: 0, slippageR: 0, protectionStatus: "PENDING", idempotencyKey: "idem-1",
        correlationId: "corr-order-1", updatedAt: "2026-08-14T00:00:00Z", expectedVersion: "rev-1", state: "ACKED",
      },
      intent: null,
      fills: [],
      protections: [],
      lifecycle: [{ eventId: "event-1", at: "2026-08-14T00:00:00Z", state: "ACKED", detail: "Provider acknowledged the order." }],
      relations: [{ label: "Signal", id: "signal-1", route: "/live/signals/signal-1" }],
    },
  };
}
