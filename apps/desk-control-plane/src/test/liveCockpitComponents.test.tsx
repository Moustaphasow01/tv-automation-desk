import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LiveActivityDock } from "@/features/live-trading/LiveActivityDock";
import { LiveCockpitStatusBar } from "@/features/live-trading/LiveCockpitStatusBar";
import { LiveDecisionStack } from "@/features/live-trading/LiveDecisionStack";
import { commandForCurrentGate, commandLocksGateActions } from "@/features/live-trading/LiveHumanGate";
import { toLiveTradingModel } from "@/features/live-trading/mapper";
import type { LiveTradingModel } from "@/features/live-trading/model";
import { liveTradingView } from "@/mocks/canonicalDataset";

const noopSubmit = async () => undefined;

describe("Live Trading cockpit components", () => {
  it("publishes the backend scope and the next Human Gate milestone in the status bar", () => {
    const model = withOrderIntent(cockpitModel(), {
      expiresAt: "2026-08-27T15:45:00.000Z",
    });
    model.marketSeries = {
      ...model.marketSeries,
      availability: "KNOWN",
      source: "market_candles",
      asOf: "2026-08-27T15:30:00.000Z",
      instrument: "ZC",
      timeframe: "15",
      supportedInstruments: ["ZC", "ZW"],
      supportedTimeframes: ["5", "15", "60"],
    };

    const markup = render(<LiveCockpitStatusBar model={model} onScopeChange={() => undefined} />);

    expect(markup).toContain("Instrument du cockpit");
    expect(markup).toContain("value=\"ZC\" selected=\"\"");
    expect(markup).toContain("aria-label=\"Unité de temps du cockpit\"");
    expect(markup).toContain("M15");
    expect(markup).toContain("H1");
    expect(markup).toContain("Expiration Human Gate");
    expect(markup).toContain("Semi-manuel");
    expect(markup).toContain("Auto désactivée");
  });

  it("labels a past Human Gate deadline as expired instead of presenting it as the next milestone", () => {
    const base = cockpitModel();
    const model = withOrderIntent(base, { expiresAt: "2026-01-01T10:00:00.000Z" });
    model.meta = { ...model.meta, asOf: "2026-08-27T15:30:00.000Z" };

    const markup = render(<LiveCockpitStatusBar model={model} onScopeChange={() => undefined} />);

    expect(markup).toContain("Human Gate expiré");
    expect(markup).not.toContain("Expiration Human Gate");
  });

  it("offers an explicit scope switch when the current signal and chart instruments differ", () => {
    const base = cockpitModel();
    const signal = base.latestSignal;
    expect(signal).not.toBeNull();
    const chartInstrument = signal?.symbol === "MNQ" ? "MES" : "MNQ";
    const onScopeChange = vi.fn();
    const model: LiveTradingModel = {
      ...base,
      marketSeries: {
        ...base.marketSeries,
        instrument: chartInstrument,
        supportedInstruments: [chartInstrument, signal?.symbol ?? ""].filter(Boolean),
      },
    };

    const tree = LiveDecisionStack({
      model,
      onSubmit: noopSubmit,
      submittingActionId: null,
      command: null,
      error: null,
      onScopeChange,
    });
    const switchButton = findElement(tree, (element) => (
      element.type === "button" && textContent(element.props.children as ReactNode).includes(`Afficher ${signal?.symbol}`)
    ));

    expect(switchButton).not.toBeNull();
    expect(render(tree)).toContain(`Le signal courant concerne ${signal?.symbol}`);
    (switchButton?.props as { onClick?(): void }).onClick?.();
    expect(onScopeChange).toHaveBeenCalledWith({ instrument: signal?.symbol });
  });

  it("does not invent scope capabilities when the backend publishes no selectable scope", () => {
    const base = cockpitModel();
    const model: LiveTradingModel = {
      ...base,
      marketSeries: {
        ...base.marketSeries,
        instrument: "ZC",
        timeframe: "15",
        supportedInstruments: [],
        supportedTimeframes: [],
      },
    };

    const statusMarkup = render(<LiveCockpitStatusBar model={model} onScopeChange={() => undefined} />);
    expect(statusMarkup).toContain("Instrument du cockpit");
    expect(statusMarkup).toMatch(/aria-label="Instrument du cockpit"[^>]+disabled=""/);
    expect(statusMarkup).toContain("Périmètres disponibles non publiés");
    expect(statusMarkup).toContain("Unités disponibles non publiées · actif M15");
    expect(statusMarkup).not.toContain(">MNQ<");
    expect(statusMarkup).not.toContain(">MES<");

    const signal = model.latestSignal;
    const chartInstrument = signal?.symbol === "ZC" ? "ZW" : "ZC";
    const mismatchModel = { ...model, marketSeries: { ...model.marketSeries, instrument: chartInstrument } };
    const decisionMarkup = render(
      <LiveDecisionStack
        model={mismatchModel}
        onSubmit={noopSubmit}
        submittingActionId={null}
        command={null}
        error={null}
        onScopeChange={() => undefined}
      />,
    );
    expect(decisionMarkup).toContain("Changement de périmètre indisponible");
    expect(decisionMarkup).not.toContain(`Afficher ${signal?.symbol}`);
  });

  it("keeps post-Risk trade terms immutable and Human Gate fail-closed", () => {
    const model = withOrderIntent(cockpitModel());
    const markup = render(
      <LiveDecisionStack
        model={model}
        onSubmit={noopSubmit}
        submittingActionId={null}
        command={null}
        error={null}
      />,
    );

    expect(markup).toContain("Lecture seule après décision Risk");
    expect(markup).toContain("Quantité autorisée");
    expect(markup).toContain("507,5");
    expect(markup).toContain("505,75");
    expect(markup).toContain("T1 511");
    expect(markup).not.toContain("[object Object]");
    expect(markup).toContain("Confirmer");
    expect(markup).toContain("Rejeter");
    expect(markup).toMatch(/class="lt-gate-confirm" disabled=""/);
    expect(markup).toMatch(/class="lt-gate-reject" disabled=""/);
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("contenteditable");
    expect(model.gateActions).toEqual([]);
  });

  it("renders an honestly unavailable Risk utilization without throwing", () => {
    const base = cockpitModel();
    const publishedRisk = base.source.riskChecks[0];
    const model: LiveTradingModel = {
      ...base,
      riskCheck: publishedRisk ? { ...publishedRisk, usedPct: null } : null,
    };

    const markup = render(
      <LiveDecisionStack
        model={model}
        onSubmit={noopSubmit}
        submittingActionId={null}
        command={null}
        error={null}
      />,
    );

    expect(markup).toContain("Utilisation");
    expect(markup).toContain("Non publiée");
  });

  it("locks Human Gate actions throughout an accepted command and permits only terminal-failure retry", () => {
    expect(commandLocksGateActions("ACCEPTED")).toBe(true);
    expect(commandLocksGateActions("RUNNING")).toBe(true);
    expect(commandLocksGateActions("SUCCEEDED")).toBe(true);
    expect(commandLocksGateActions("FAILED")).toBe(false);
    expect(commandLocksGateActions("CONFLICT")).toBe(false);
    expect(commandLocksGateActions(null)).toBe(false);
  });

  it("does not let a completed command lock another OrderIntent or a new gate action", () => {
    const receipt = {
      commandId: "command-1",
      status: "ACCEPTED" as const,
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      acceptedAt: "2026-08-27T09:00:00Z",
    };
    const binding = {
      orderIntentId: "intent-1",
      actionId: "human-gate.confirm.intent-1",
      expectedRevision: "1",
      receipt,
    };
    const action = (expectedRevision: string) => ({
      action: "CONFIRM" as const,
      actionId: "human-gate.confirm.intent-1",
      label: "Confirmer",
      commandType: "CONFIRM_ORDER_INTENT",
      environment: "PAPER" as const,
      permission: "ALLOWED" as const,
      requiresConfirmation: true,
      requiresReason: false,
      expectedRevision,
      impactPreview: "Confirmer",
      payload: {},
    });

    expect(commandForCurrentGate(binding, "intent-1", [action("1")])).toEqual(receipt);
    expect(commandForCurrentGate(binding, "intent-1", [])).toEqual(receipt);
    expect(commandForCurrentGate(binding, "intent-2", [action("1")])).toBeNull();
    expect(commandForCurrentGate(binding, "intent-1", [action("2")])).toBeNull();
  });

  it("keeps one secondary depth active in the activity dock", () => {
    const base = cockpitModel();
    const model: LiveTradingModel = {
      ...base,
      operator: {
        status: "THEORETICAL_TRACKING",
        label: "Position théorique suivie",
        detail: "Le backend suit la position théorique.",
        tone: "success",
      },
    };
    const markup = render(<LiveActivityDock model={model} />);

    expect(markup).toContain("Activité de session");
    expect(markup).toContain("Plein écran");
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).not.toContain("Développer la profondeur");
    expect(markup).toMatch(/role="tab" aria-selected="true"[^>]+id="lt-dock-tab-position"/);
    expect(markup).toMatch(/role="tab" aria-selected="true" tabindex="0"/);
    expect(markup.match(/role="tab" aria-selected="false" tabindex="-1"/g)).toHaveLength(5);
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(markup).toContain("Position");
    expect(markup).toContain("Événements");
    expect(markup).toContain("Flux &amp; qualité");
  });
});

function cockpitModel(): LiveTradingModel {
  return toLiveTradingModel(structuredClone(liveTradingView));
}

function withOrderIntent(
  base: LiveTradingModel,
  options: { expiresAt?: string | null } = {},
): LiveTradingModel {
  const signalId = base.latestSignal?.signalId ?? "signal-cockpit";
  const orderIntent = {
    portfolioOrderIntentId: "intent-cockpit",
    orderIntentId: "intent-cockpit",
    signalId,
    strategyInstanceId: base.latestSignal?.strategyInstanceId ?? "strategy-cockpit",
    symbol: base.latestSignal?.symbol ?? "ZC",
    side: "BUY",
    type: "LIMIT",
    quantity: 2,
    state: "AWAITING_MANUAL_CONFIRMATION",
    limitPrice: 507.5,
    stopPrice: 505.75,
    targetPrice: 511,
    targetPositionId: "target-cockpit",
    createdAt: "2026-08-27T15:30:00.000Z",
    executionTerms: {
      instrument: base.latestSignal?.symbol ?? "ZC",
      quantity: 2,
      order_type: "LIMIT",
      entry: { price: 507.5 },
      stop: { price: 505.75 },
      targets: [{ label: "T1", price: 511 }],
    },
    riskSnapshot: { requestedQty: 3, authorizedQty: 2 },
    immutability: { policy: "REJECT_AND_REPLAN" },
    humanGate: {
      gateId: "gate-cockpit",
      status: "AWAITING_MANUAL_CONFIRMATION",
      allowedActions: [],
    },
    allowedActions: {
      resourceType: "OrderIntent",
      allowedActions: ["VIEW"],
      denialReasons: ["BACKEND_CAPABILITY_NOT_PUBLISHED"],
      revision: "revision-cockpit",
      requiresStepUp: false,
      reasonRequired: true,
      expiresAt: options.expiresAt ?? null,
    },
    providerCommandCount: 0,
    providerEventCount: 0,
    brokerSubmissionAllowed: false,
    physicalExecutionState: "NOT_SENT",
    ackIsFill: false,
    route: "/execution/orders/intent-cockpit",
  } as unknown as NonNullable<LiveTradingModel["orderIntent"]>;

  return {
    ...base,
    orderIntent,
    gateActions: [],
    gateBlockedReason: "Le backend n’a publié aucune capability Human Gate.",
  };
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node));
}

function findElement(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child)) return child;
    const nested = findElement(child.props.children as ReactNode, predicate);
    if (nested) return nested;
  }
  return null;
}

function textContent(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return textContent(child.props.children);
    return "";
  }).join("");
}
