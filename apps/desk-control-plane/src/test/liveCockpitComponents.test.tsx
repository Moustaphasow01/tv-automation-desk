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
import { LiveFocusJournal } from "@/features/live-trading/LiveFocusJournal";
import { catalystMilestoneLabel, LiveFocusMode } from "@/features/live-trading/LiveFocusMode";
import { buildFocusQueueItems, buildFocusSignalFlowItems, filterFocusQueueItems } from "@/features/live-trading/focusJournalModel";
import { focusTradePlanFromCard } from "@/features/live-trading/focusTradePlan";
import { commandForCurrentGate, commandLocksGateActions } from "@/features/live-trading/LiveHumanGate";
import { toLiveTradingModel } from "@/features/live-trading/mapper";
import type { LiveTradingModel } from "@/features/live-trading/model";
import type { LiveFocusView } from "@/domains/front-api/viewModels";
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
    expect(markup).toContain("Expiration de votre validation");
    expect(markup).toContain("Semi-manuel");
    expect(markup).toContain("Auto désactivée");
  });

  it("labels a past Human Gate deadline as expired instead of presenting it as the next milestone", () => {
    const base = cockpitModel();
    const model = withOrderIntent(base, { expiresAt: "2026-01-01T10:00:00.000Z" });
    model.meta = { ...model.meta, asOf: "2026-08-27T15:30:00.000Z" };

    const markup = render(<LiveCockpitStatusBar model={model} onScopeChange={() => undefined} />);

    expect(markup).toContain("Validation expirée");
    expect(markup).not.toContain("Expiration de votre validation");
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

    expect(markup).toContain("Lecture seule après contrôle du risque");
    expect(markup).toContain("Quantité autorisée");
    expect(markup).toContain("507,5");
    expect(markup).toContain("505,75");
    expect(markup).toContain("T1 511");
    expect(markup).not.toContain("[object Object]");
    expect(markup).toContain("Valider l’ordre proposé");
    expect(markup).toContain("Refuser");
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
    expect(markup).toContain("Non publié");
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

  it("keeps Live Focus centered on operational prices and makes the chart explicit", () => {
    const model = cockpitModel();
    const markup = render(
      <LiveFocusMode
        model={model}
        focus={focusView()}
        busy={false}
        error={null}
        requestedScope={{ instrument: "ZC", timeframe: "15" }}
        dashboardPeriod="TODAY"
        chartLoading={false}
        chartError={null}
        onExit={() => undefined}
        onScopeChange={() => undefined}
        onDashboardPeriodChange={() => undefined}
        onSelectDecision={() => undefined}
        onSubmitGate={noopSubmit}
        onSubmitManual={noopSubmit}
      />,
    );

    expect(markup).toContain("Prix opérationnels");
    expect(markup).toContain("Afficher le graphique");
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).not.toContain("lt-panel--chart");
    expect(markup).not.toMatch(/>\s*ON\s*</);
    expect(markup).not.toMatch(/>\s*OFF\s*</);
    expect(markup).not.toContain("No setup");
    expect(markup).not.toContain("Macro blackout");
  });

  it("keeps the journal accessible even before the first signal", () => {
    const markup = render(<LiveFocusJournal focus={focusView()} selectedSignalId={null} onSelectDecision={() => undefined} onOpenTrade={() => undefined} onOpenChart={() => undefined} />);
    expect(markup).toContain("Prêts à poser &amp; historique");
    expect(markup).toContain("Liste verticale des tickets");
    expect(markup).toContain("tabindex=\"0\"");
    expect(markup).toContain("Aucun ordre prêt à poser");
    expect(markup).toContain("Filtrer par état");
    expect(markup).toContain("Signaux filtrés avant ticket");
  });

  it("renders Live Focus labels and ticket values as separated decision cells", () => {
    const model = withOrderIntent(cockpitModel());
    const markup = render(
      <LiveFocusMode
        model={model}
        focus={{
          ...focusView(),
          operatorJourneyState: { ...focusView().operatorJourneyState, stage: "E" },
        }}
        busy={false}
        error={null}
        requestedScope={{ instrument: "ZC", timeframe: "15" }}
        dashboardPeriod="TODAY"
        chartLoading={false}
        chartError={null}
        onExit={() => undefined}
        onScopeChange={() => undefined}
        onDashboardPeriodChange={() => undefined}
        onSelectDecision={() => undefined}
        onSubmitGate={noopSubmit}
        onSubmitManual={noopSubmit}
      />,
    );

    expect(markup).toContain("class=\"is-market-level\"><small>Entrée</small><strong>");
    expect(markup).toContain("class=\"is-market-level is-danger\"><small>Stop</small><strong>");
    expect(markup).toContain("class=\"is-market-level is-success");
    expect(markup).toContain("class=\"live-focus__copy-action\"");
    expect(markup).toContain("Résumé du brief");
    expect(markup).not.toContain("ENTRÉE");
    expect(markup).not.toContain("OBJECTIF 1");
  });

  it("localizes backend market-context fallback copy in the operator presentation", () => {
    const focus = focusView();
    const markup = render(
      <LiveFocusMode
        model={cockpitModel()}
        focus={{ ...focus, marketDeskBrief: { ...focus.marketDeskBrief, headline: "Market context unavailable" } }}
        busy={false}
        error={null}
        requestedScope={{ instrument: "ZC", timeframe: "15" }}
        dashboardPeriod="TODAY"
        chartLoading={false}
        chartError={null}
        onExit={() => undefined}
        onScopeChange={() => undefined}
        onDashboardPeriodChange={() => undefined}
        onSelectDecision={() => undefined}
        onSubmitGate={noopSubmit}
        onSubmitManual={noopSubmit}
      />,
    );

    expect(markup).toContain("Contexte de marché indisponible");
    expect(markup).not.toContain("Market context unavailable");
  });

  it("presents a catalyst with its date and temporal state", () => {
    expect(catalystMilestoneLabel("2026-09-01T14:45:00.000Z", "2026-09-01T14:30:00.000Z"))
      .toMatch(/^À venir · .*1 sept\..*16:45$/);
    expect(catalystMilestoneLabel("2026-09-01T14:15:00.000Z", "2026-09-01T14:30:00.000Z"))
      .toMatch(/^Passé · .*1 sept\..*16:15$/);
  });

  it("keeps terminal ticket actions truthful and all Focus reasons in French", () => {
    const focus = {
      ...focusView(),
      tradeCards: [focusTradeCard()],
      whyNoTrade: {
        ...focusView().whyNoTrade,
        topReasons: ["NO_HUMAN_ACTION_REQUIRED"],
        nextRelevantEventAt: "2026-09-01T14:45:00.000Z",
      },
    } satisfies LiveFocusView;
    const markup = render(
      <LiveFocusMode
        model={withOrderIntent(cockpitModel())}
        focus={focus}
        busy={false}
        error={null}
        requestedScope={{ instrument: "ZW", timeframe: "15" }}
        dashboardPeriod="TODAY"
        chartLoading={false}
        chartError={null}
        onExit={() => undefined}
        onScopeChange={() => undefined}
        onDashboardPeriodChange={() => undefined}
        onSelectDecision={() => undefined}
        onSubmitGate={noopSubmit}
        onSubmitManual={noopSubmit}
      />,
    );

    expect(markup).toContain("Aucune action humaine requise");
    expect(markup).toContain("Calendrier · catalyseur de référence");
    expect(markup).toContain("À venir ·");
    expect(markup).toContain("Voir le dossier");
    expect(markup).not.toContain("No human action required");
    expect(markup).not.toContain("Valider / refuser");
  });

  it.each(["intent-cockpit", "intent-other", ""])("binds the gate action to selected ticket %s", (selectedId) => {
    const model = withOrderIntent(cockpitModel());
    model.gateActions = [{
      action: "CONFIRM",
      actionId: "confirm-other",
      label: "Valider ce dossier uniquement",
      commandType: "execution.order_intent.confirm",
      environment: "PAPER",
      permission: "ALLOWED",
      requiresConfirmation: true,
      requiresReason: true,
      expectedRevision: "other-revision",
      impactPreview: "test",
      payload: { portfolioOrderIntentId: "intent-cockpit" },
    }];
    const activeCard = { ...focusTradeCard(), orderIntentId: selectedId, operatorState: "AWAITING_MANUAL_CONFIRMATION", terminal: false, terminalReason: null, actionable: true, expiredByTime: false, temporalState: "NEW", lifecycleLabel: "À décider", priority: "ACTIONABLE" as const, denialReasons: [], expiresAt: "2099-09-01T16:00:00.000Z" };
    const markup = render(
      <LiveFocusMode
        model={model}
        focus={{ ...focusView(), tradeCards: [activeCard] }}
        busy={false}
        error={null}
        requestedScope={{ instrument: "ZW", timeframe: "15" }}
        dashboardPeriod="TODAY"
        chartLoading={false}
        chartError={null}
        onExit={() => undefined}
        onScopeChange={() => undefined}
        onDashboardPeriodChange={() => undefined}
        onSelectDecision={() => undefined}
        onSubmitGate={noopSubmit}
        onSubmitManual={noopSubmit}
      />,
    );

    if (selectedId === "intent-cockpit") expect(markup).toContain("Valider ce dossier uniquement");
    else expect(markup).not.toContain("Valider ce dossier uniquement");
  });

  it("retains the last Focus projection but blocks operator actions after a refresh failure", () => {
    const model = withOrderIntent(cockpitModel());
    model.gateActions = ["CONFIRM", "REJECT"].map((action) => ({
      action,
      actionId: `${action.toLowerCase()}-intent-cockpit`,
      label: action === "CONFIRM" ? "Valider ce dossier uniquement" : "Refuser ce dossier",
      commandType: action === "CONFIRM" ? "execution.order_intent.confirm" : "execution.order_intent.reject",
      environment: "PAPER",
      permission: "ALLOWED",
      requiresConfirmation: true,
      requiresReason: true,
      expectedRevision: "revision-cockpit",
      impactPreview: "test",
      payload: { portfolioOrderIntentId: "intent-cockpit" },
    })) as LiveTradingModel["gateActions"];
    const activeCard = { ...focusTradeCard(), orderIntentId: "intent-cockpit", operatorState: "AWAITING_MANUAL_CONFIRMATION", terminal: false, terminalReason: null, actionable: true, expiredByTime: false, temporalState: "NEW", lifecycleLabel: "À décider", priority: "ACTIONABLE" as const, denialReasons: [], expiresAt: "2099-09-01T16:00:00.000Z" };
    const markup = render(
      <LiveFocusMode
        model={model}
        focus={{ ...focusView(), asOf: "not-a-date", tradeCards: [activeCard] }}
        busy={false}
        error={null}
        projectionError
        requestedScope={{ instrument: "ZW", timeframe: "15" }}
        dashboardPeriod="TODAY"
        chartLoading={false}
        chartError={null}
        onExit={() => undefined}
        onScopeChange={() => undefined}
        onDashboardPeriodChange={() => undefined}
        onSelectDecision={() => undefined}
        onSubmitGate={noopSubmit}
        onSubmitManual={noopSubmit}
      />,
    );

    expect(markup).toContain("Ticket d’action");
    expect(markup).toContain("ZW pullback");
    expect(markup).toContain("dernière projection conservée, arrêtée au Horodatage non publié");
    expect(markup).toContain("Les actions opérateur sont temporairement bloquées");
    expect(markup).not.toContain("Valider ce dossier uniquement");
    expect(markup).not.toContain("Refuser ce dossier");
  });

  it("selects the journal ticket by canonical signal ID after chronological sorting", () => {
    const selected = focusTradeCard();
    const recent = { ...selected, orderIntentId: "intent-recent", signalId: "signal-recent", createdAt: "2026-09-01T13:55:00.000Z" };
    const focus = { ...focusView(), tradeCards: [selected, recent] };
    expect(buildFocusQueueItems(focus).map((item) => item.signalId)).toEqual(["signal-recent", "signal-expired"]);
    const markup = render(<LiveFocusJournal focus={focus} selectedSignalId={selected.signalId} onSelectDecision={() => undefined} onOpenTrade={() => undefined} onOpenChart={() => undefined} />);
    const selectedTicket = markup.match(/<article[^>]+aria-current="true"[^>]*>[\s\S]*?<\/article>/)?.[0];
    expect(selectedTicket).toContain("01/09 15:45");
    expect(selectedTicket).not.toContain("01/09 15:55");
    expect(markup).toContain("<dt>Échéance</dt><dd>01/09 16:00</dd>");
    expect(markup).toContain("aria-label=\"Plan d’ordre ZW\"");
    expect(markup).toContain("<dt>Type</dt><dd>Ordre limite</dd>");
    expect(markup).toContain("<dt>Entrée</dt><dd>754</dd>");
    expect(markup).toContain("<dt>Stop</dt><dd>752,25</dd>");
    expect(markup).toContain("<dt>Obj. 1</dt><dd>756,75</dd>");
    expect(markup).toContain("<dt>Obj. 2</dt><dd>758,5</dd>");
    expect(markup).not.toContain("<main");
  });

  it("preserves terminal authority and missing values while filtering journal rows", () => {
    const original = { ...focusView(), tradeCards: [{ ...focusTradeCard(), expectedR: null, asOf: "" }] };
    const focus = structuredClone(original);
    const items = buildFocusQueueItems(focus);
    expect(filterFocusQueueItems(items, "ACTIONABLE", "ALL", "")).toEqual([]);
    expect(filterFocusQueueItems(items, "EXPIRED", "ZW", "intent-expired")).toHaveLength(1);
    expect(filterFocusQueueItems(items, "ALL", "ZC", "")).toEqual([]);
    expect(items[0].rLine).toBe("R prévisionnel non publié");
    expect(items[0].freshnessLine).toBe("Non publiée");
    expect(items[0].actionable).toBe(false);
    expect(focus).toEqual(original);
  });

  it("formats backend price-zone objects in ticket previews and details", () => {
    const rangeCard: LiveFocusView["tradeCards"][number] = {
      ...focusTradeCard(),
      riskAuthorizedPlan: {
        orderType: "LIMIT",
        entry: { low: 753.5, high: 754, price: 753.75, availability: "KNOWN" },
        stop: { limitPrice: 752.25 },
        targets: [{ min_price: 756.5, max_price: 757 }, { targetPrice: 758.5 }],
      },
    };
    const [item] = buildFocusQueueItems({ ...focusView(), tradeCards: [rangeCard] });
    const plan = focusTradePlanFromCard(rangeCard);

    expect(item.levelLine).toContain("entrée 753,75");
    expect(item.orderPlan?.entry).toBe("753,75");
    expect(item.orderPlan?.stop).toBe("752,25");
    expect(item.orderPlan?.target1).toBe("756,5–757");
    expect(item.orderPlan?.target2).toBe("758,5");
    expect(plan.entry).toBe("753,75");
    expect(plan.stop).toBe("752,25");
    expect(plan.targets).toEqual(["756,5–757", "758,5"]);
    expect(`${item.levelLine} ${JSON.stringify(item.orderPlan)} ${JSON.stringify(plan)}`).not.toContain("[object Object]");
  });

  it("keeps expired qualified dossiers in the Focus history without presenting them as a ticket to place", () => {
    const model = withOrderIntent(cockpitModel(), { expiresAt: "2026-09-01T14:00:00.000Z" });
    model.meta = { ...model.meta, asOf: "2026-09-01T14:30:00.000Z" };
    model.gateActions = [];
    model.selectedTheoreticalExecution = null;
    const markup = render(
      <LiveFocusMode
        model={model}
        focus={{
          ...focusView(),
          operatorJourneyState: { ...focusView().operatorJourneyState, stage: "B" },
          whyNoTrade: { ...focusView().whyNoTrade, stageCounts: { signals: 1, orderIntents: 1 } },
          tradeCards: [focusTradeCard()],
          selectedTrade: null,
        }}
        busy={false}
        error={null}
        requestedScope={{ instrument: "ZW", timeframe: "15" }}
        dashboardPeriod="TODAY"
        chartLoading={false}
        chartError={null}
        onExit={() => undefined}
        onScopeChange={() => undefined}
        onDashboardPeriodChange={() => undefined}
        onSelectDecision={() => undefined}
        onSubmitGate={noopSubmit}
        onSubmitManual={noopSubmit}
      />,
    );

    expect(markup).toContain("Dossier non actionnable");
    expect(markup).toContain("Historique — ne pas poser");
    expect(markup).toContain("Plan d’ordre ZW");
    expect(markup).toContain("Obj. 2");
    expect(markup).toContain("TICKETS OPÉRATEUR");
    expect(markup).toContain("signal 15:45:00");
    expect(markup).toContain("<div class=\"live-focus__instrument\"><small>Instrument</small><strong>ZW</strong><span>Achat</span></div>");
    expect(markup).toContain("<dt>Échéance</dt>");
    expect(markup).toContain("Dossier expiré, annulé, rejeté ou déjà clôturé");
    expect(markup).not.toContain("maintenir Entrée");
  });

  it("turns the Live Focus queue into a filterable operator journal with traceable tickets", () => {
    const model = withOrderIntent(cockpitModel(), { expiresAt: "2026-09-01T14:00:00.000Z" });
    model.meta = { ...model.meta, asOf: "2026-09-01T14:30:00.000Z" };
    model.gateActions = [];
    const focus = {
      ...focusView(),
      tradeCards: [focusTradeCard()],
      observedOpportunities: [{
        opportunityId: "observed-zw-1",
        signalId: "signal-observed-zw-1",
        instrument: "ZW",
        side: "SHORT",
        strategyName: "ZW breakdown watch",
        status: "OBSERVED",
        statusLabel: "Observé",
        terminal: false,
        reasonCodes: ["CONTEXT_WAIT"],
        createdAt: "2026-09-01T14:12:00.000Z",
        expiresAt: "2026-09-01T14:45:00.000Z",
        strategyProposedPlan: {
          order_type: "LIMIT",
          entry: { price: 548.25 },
          stop: { price: 550.5 },
          targets: [{ price: 545.5 }, { price: 543.75 }],
        },
        diagnosticOnly: true,
        route: "/live/signals/signal-observed-zw-1",
        source: "strategy-signal-outbox",
        asOf: "2026-09-01T14:30:00.000Z",
        availability: "AVAILABLE",
      }],
    } satisfies LiveFocusView;
    expect(buildFocusQueueItems(focus)).toHaveLength(1);
    expect(buildFocusSignalFlowItems(focus)).toHaveLength(1);
    const markup = render(
      <LiveFocusMode
        model={model}
        focus={focus}
        busy={false}
        error={null}
        requestedScope={{ instrument: "ZW", timeframe: "15" }}
        dashboardPeriod="TODAY"
        chartLoading={false}
        chartError={null}
        onExit={() => undefined}
        onScopeChange={() => undefined}
        onDashboardPeriodChange={() => undefined}
        onSelectDecision={() => undefined}
        onSubmitGate={noopSubmit}
        onSubmitManual={noopSubmit}
      />,
    );

    expect(markup).toContain("Rechercher dans le journal");
    expect(markup).toContain("Filtrer par état");
    expect(markup).toContain("Filtrer par instrument");
    expect(markup).toContain("Exporter");
    expect(markup).toContain("Résumé des tickets");
    expect(markup).toContain("Progression du ticket");
    expect(markup).toContain("Historique — ne pas poser");
    expect(markup).toContain("Signaux filtrés avant ticket");
    expect(markup).toContain("Bloqué à</span> Context Gate");
    expect(markup).toContain("Le contexte marché demande d’attendre avant toute qualification.");
    expect(markup).toContain("aria-label=\"Plan d’ordre ZW\"");
    expect(markup).toContain("<dt>Type</dt><dd>Ordre limite</dd>");
    expect(markup).toContain("<dt>Entrée</dt><dd>754</dd>");
    expect(markup).toContain("<dt>Stop</dt><dd>752,25</dd>");
    expect(markup).toContain("<dt>Obj. 1</dt><dd>756,75</dd>");
    expect(markup).toContain("<dt>Obj. 2</dt><dd>758,5</dd>");
    expect(markup).not.toContain("<dt>Entrée</dt><dd>548,25</dd>");
    expect(markup).not.toContain("<dt>Stop</dt><dd>550,5</dd>");
    expect(markup).not.toContain("<dt>Obj. 1</dt><dd>545,5</dd>");
    expect(markup).not.toContain("<dt>Obj. 2</dt><dd>543,75</dd>");
    expect(markup).toContain("Graphique");
    expect(markup).toContain("Dossier");
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

function focusView(): LiveFocusView {
  return {
    schemaVersion: "live_focus_view_v1",
    universe: "US_GRAINS_CBOT",
    asOf: "2026-09-01T14:30:00.000Z",
    safety: { autoExecutionEnabled: false, physicalLiveEnabled: false, humanGateRequired: true, authority: "BACKEND" },
    session: { marketState: "OPEN", marketSession: "CBOT_GRAINS_RTH", exchangeTimezone: "America/Chicago", marketDate: "2026-09-01", sessionStart: null, sessionEnd: null, nextEligibleAt: null, asOf: "2026-09-01T14:30:00.000Z", source: "data_readiness.market_session" },
    marketContext: { status: "AVAILABLE", sourceStates: [], reasonCodes: ["GRAINS_CONTEXT_READY"], globalBias: "NEUTRAL", marketRegime: "RANGE", volatilityRegime: "NORMAL" },
    marketDeskBrief: { status: "AVAILABLE", headline: "Marché surveillé", operatorSummary: "Le Desk observe les grains et attend une opportunité qualifiée.", whatDeskWants: ["PULLBACK"], whatDeskAvoids: ["MACRO_BLACKOUT"] },
    briefHistory: [],
    whyNoTrade: { whyNoTradeSummaryId: "why-1", status: "EXPLAINED", topReasons: ["NO_SETUP"], stageCounts: { signals: 2, orderIntents: 0 }, blockingConditions: [], nextExpectedEvaluationAt: null, nextContextRefreshAt: null, nextRelevantEventAt: null, reasonCodes: ["NO_SETUP"] },
    operatorJourneyState: { stage: "B", rawStatus: "WATCHING", sourceObjectType: "MarketContextSnapshot", sourceObjectId: null, asOf: "2026-09-01T14:30:00.000Z", reasonCodes: ["NO_SETUP"] },
    tradeCards: [],
    observedOpportunities: [],
    selectedTrade: null,
    catalysts: [],
    marketSeries: undefined,
    watchlist: undefined,
    sourceStates: [],
    contextWorker: { taskType: "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH", lane: "live", cadenceMinutes: { marketOpen: 30, marketClosed: 60 }, timeoutMs: 780000, modelPolicy: {}, taskCount: 1, successCount: 1, failureCount: 0, activeCount: 0, lastCompletedAt: "2026-09-01T14:20:00.000Z", lastSuccessfulBriefAt: "2026-09-01T14:20:00.000Z", briefAgeSeconds: 600, retryCount: 0, averageLatencyMs: 1200, totalTokens: 0, costMicrosUsd: 0 },
    nextActions: [],
    technical: { source: "front-api/live-focus", sourceDataCutoff: "2026-09-01T14:30:00.000Z", revision: 1 },
  };
}

function focusTradeCard(): LiveFocusView["tradeCards"][number] {
  return {
    tradeCardId: "focus-trade-expired",
    targetPositionId: "target-expired",
    orderIntentId: "intent-expired",
    humanGateId: "gate-expired",
    strategyDefinitionId: "strategy-def-expired",
    strategyVersionId: "strategy-version-expired",
    strategyInstanceId: "strategy-instance-expired",
    signalId: "signal-expired",
    contextDecisionId: "context-expired",
    portfolioDecisionId: "portfolio-expired",
    riskDecisionId: "risk-expired",
    providerCommandId: null,
    positionId: null,
    tradeId: null,
    instrument: "ZW",
    side: "LONG",
    strategyName: "ZW pullback",
    setup: "PULLBACK",
    createdAt: "2026-09-01T13:45:00.000Z",
    expiresAt: "2026-09-01T14:00:00.000Z",
    operatorState: "EXPIRED",
    theoreticalState: "PENDING_ENTRY",
    authorizedQuantity: 1,
    riskAmount: 125,
    expectedR: 1.4,
    priority: "TERMINAL",
    attentionReason: null,
    allowedActions: [],
    denialReasons: ["HUMAN_GATE_EXPIRED"],
    actionable: false,
    temporalState: "EXPIRED",
    expiredByTime: true,
    lifecycleLabel: "Fenêtre expirée",
    terminalReason: "HUMAN_GATE_EXPIRED",
    actionPolicy: {},
    strategyProposedPlan: { orderType: "LIMIT", entry: { price: 754 }, stop: { price: 752.25 }, targets: [{ price: 756.75 }, { price: 758.5 }] },
    contextAdjustedPlan: null,
    riskAuthorizedPlan: { orderType: "LIMIT", entry: { price: 754 }, stop: { price: 752.25 }, targets: [{ price: 756.75 }, { price: 758.5 }] },
    theoreticalResult: null,
    operatorResult: null,
    realizedR: null,
    realizedPnL: null,
    closeReason: null,
    revision: 4,
    route: "/execution/orders/intent-expired",
    correlationId: "corr-expired",
    reasonCodes: ["RISK_PASS"],
    whyThisTrade: {},
    source: "portfolio-order-intent",
    asOf: "2026-09-01T14:30:00.000Z",
    availability: "AVAILABLE",
    terminal: true,
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
