import type { LiveFocusView } from "@/domains/front-api/viewModels";
import { known, type ViewMeta } from "@/shared/contracts";
import type { OrderIntentDossier, HumanGateAction } from "@/features/order-intent/model";
import { toLiveTradingModel } from "@/features/live-trading/mapper";
import { liveTradingView } from "@/mocks/canonicalDataset";

export const fixtureNow = Date.parse("2026-09-09T12:00:00Z");
export const fixtureMeta: ViewMeta = { generatedAt: "2026-09-09T12:00:00Z", asOf: "2026-09-09T12:00:00Z", stale: false, availability: "AVAILABLE", schemaVersion: "1.0.0", correlationId: "test-correlation", latencyMs: 12 };

export function workspaceCard(overrides: Partial<LiveFocusView["tradeCards"][number]> = {}): LiveFocusView["tradeCards"][number] {
  return { tradeCardId: "card-test", targetPositionId: "target-test", orderIntentId: "intent-test", humanGateId: "gate-test", signalId: "signal-test",
    instrument: "ZW", side: "LONG", strategyName: "Repli du blé", setup: "PULLBACK", createdAt: "2026-09-09T11:58:00Z", expiresAt: "2026-09-09T12:05:00Z",
    operatorState: "PENDING", theoreticalState: "PENDING_ENTRY", authorizedQuantity: 1, riskAmount: 100, expectedR: 2, priority: "ACTIONABLE", attentionReason: null,
    allowedActions: ["CONFIRM", "REJECT", "UNDO"], denialReasons: [], actionable: true, actionPolicy: {}, riskAuthorizedPlan: { orderType: "LIMIT", entry: { price: 750 }, stop: { price: 749 }, targets: [{ price: 752 }] },
    route: "/execution/orders/intent-test", reasonCodes: [], whyThisTrade: {}, source: "test-only", asOf: fixtureMeta.asOf, availability: "AVAILABLE", terminal: false, ...overrides };
}

export function workspaceFocus(cards = [workspaceCard()]): LiveFocusView {
  // Minimal projection fixture for the queue mapper; never imported by application code.
  return { tradeCards: cards, observedOpportunities: [], asOf: fixtureMeta.asOf } as unknown as LiveFocusView;
}

export function workspaceGate(overrides: Partial<HumanGateAction> = {}): HumanGateAction {
  return { action: "CONFIRM", actionId: "confirm-test", commandType: "CONFIRM_HUMAN_GATE", environment: "SHADOW", permission: "ALLOWED", requiresConfirmation: true, requiresReason: false,
    expectedRevision: "rev-4", impactPreview: "Test decision only", label: "Confirm", payload: { portfolioOrderIntentId: "intent-test" }, ...overrides };
}

export function workspaceDossier(action = workspaceGate()): OrderIntentDossier {
  // The policy only consumes this authoritative identity, metadata and action collection.
  const metadata = { asOf: fixtureMeta.asOf, source: "test-only" };
  return { meta: fixtureMeta, degradedReadOnly: false, identity: { orderIntentId: known("intent-test", metadata) },
    targetPosition: { account: known("TEST_ACCOUNT", metadata) }, signal: { instrument: known("ZW", metadata) }, humanGate: { actions: [action] } } as unknown as OrderIntentDossier;
}

export function workspaceLiveModel() { return { ...toLiveTradingModel(liveTradingView), meta: fixtureMeta, selectedTheoreticalExecution: null }; }
