import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { presentExecutionMode } from "@/design-system/labels";
import { useCommandStatus, useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { LiveManualExecutionAction } from "@/domains/front-api/viewModels";
import { buildHumanGateCommand, type HumanGateAction } from "@/features/order-intent/model";
import { LiveActivityDock } from "@/features/live-trading/LiveActivityDock";
import { LiveAttentionCenter } from "@/features/live-trading/LiveAttentionCenter";
import type { LiveSignalNavigationTarget } from "@/features/live-trading/LiveSignalInbox";
import { LiveCockpitStatusBar } from "@/features/live-trading/LiveCockpitStatusBar";
import { LiveDecisionStack } from "@/features/live-trading/LiveDecisionStack";
import { LiveFocusMode } from "@/features/live-trading/LiveFocusMode";
import { normalizeFocusDashboardPeriod, type LiveFocusDashboardPeriod } from "@/features/live-trading/focusDashboardModel";
import { buildManualExecutionCommand } from "@/features/live-trading/focusModel";
import { readLiveFocusPreference, writeLiveFocusPreference } from "@/features/live-trading/focusPreferences";
import { commandForCurrentGate, type GateCommandBinding } from "@/features/live-trading/LiveHumanGate";
import { LiveMarketLens } from "@/features/live-trading/LiveMarketLens";
import { LiveTradingHeader } from "@/features/live-trading/LiveTradingHeader";
import { InstrumentChartPanel } from "@/features/live-trading/chart/LiveMarketChart";
import { toLiveTradingModel } from "@/features/live-trading/mapper";
import { operatorStateForSignal } from "@/features/live-trading/signalOperatorState";
import "@/features/live-trading/live-trading.css";
import "@/features/live-trading/live-cockpit.css";
import "@/features/live-trading/live-continuity.css";
import "@/features/live-trading/live-operator-experience.css";

export function LiveTradingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const marketScope = useMemo(() => ({
    instrument: searchParams.get("instrument") || undefined,
    timeframe: searchParams.get("timeframe") || undefined,
  }), [searchParams]);
  const selectedSignalId = searchParams.get("signalId");
  const focusMode = searchParams.get("focus") === "1";
  const focusDashboardPeriod = normalizeFocusDashboardPeriod(searchParams.get("focusPeriod"));
  const chartAt = searchParams.get("chartAt");
  const chartSurfaceRef = useRef<HTMLElement>(null);
  const decisionSurfaceRef = useRef<HTMLElement>(null);
  const deskQuery = useFrontView("live-trading");
  const chartQuery = useFrontView("live-trading", marketScope, {
    preservePreviousData: true,
    queryScope: "market-series",
    refetchInterval: 60_000,
  });
  const focusQuery = useFrontView("live-focus", marketScope, {
    preservePreviousData: true,
    queryScope: "live-focus",
    refetchInterval: 60_000,
    enabled: focusMode,
  });
  const repository = useFrontViewRepository();
  const [commandBinding, setCommandBinding] = useState<GateCommandBinding | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const initialChartAlignmentDone = useRef(false);
  const focusRestoreScroll = useRef<number | null>(null);
  const autoOpenedDecision = useRef<string | null>(null);
  const model = useMemo(() => {
    if (!deskQuery.data) return null;
    const deskModel = toLiveTradingModel(deskQuery.data, { signalId: selectedSignalId });
    if (!chartQuery.data) return deskModel;
    const chartModel = toLiveTradingModel(chartQuery.data, { signalId: selectedSignalId });
    const chartTheoretical = chartModel.selectedTheoreticalExecution;
    const selectedTheoreticalExecution = chartTheoretical?.portfolioOrderIntentId === deskModel.selectedTheoreticalExecution?.portfolioOrderIntentId
      ? chartTheoretical
      : deskModel.selectedTheoreticalExecution;
    return { ...deskModel, marketSeries: chartModel.marketSeries, selectedTheoreticalExecution };
  }, [chartQuery.data, deskQuery.data, selectedSignalId]);
  const currentOrderIntentId = model?.orderIntent?.portfolioOrderIntentId ?? null;
  const actionable = Boolean(model && [...model.source.signals, ...model.source.canonicalRuntime.latestSignals]
    .some((signal) => operatorStateForSignal(model, signal).code === "ACTIONABLE"));
  const command = commandForCurrentGate(commandBinding, currentOrderIntentId, model?.gateActions ?? []);
  const commandStatus = useCommandStatus(command?.commandId ?? null);

  useEffect(() => {
    if (!model || initialChartAlignmentDone.current || searchParams.has("instrument")) return;
    const signalInstrument = model.latestSignal?.symbol;
    if (!signalInstrument || !model.marketSeries.supportedInstruments.some((item) => item.toUpperCase() === signalInstrument.toUpperCase())) return;
    initialChartAlignmentDone.current = true;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (next.has("instrument")) return next;
      next.set("instrument", signalInstrument);
      return next;
    }, { replace: true });
  }, [model, searchParams, setSearchParams]);

  const updateMarketScope = (nextScope: { instrument?: string; timeframe?: string }) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextScope.instrument) next.set("instrument", nextScope.instrument);
      if (nextScope.timeframe) next.set("timeframe", nextScope.timeframe);
      return next;
    }, { replace: true });
  };

  const updateFocusDashboardPeriod = (period: LiveFocusDashboardPeriod) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (period === "TODAY") next.delete("focusPeriod");
      else next.set("focusPeriod", period.toLowerCase());
      return next;
    }, { replace: true });
  };

  const enterFocus = useCallback(() => {
    focusRestoreScroll.current = window.scrollY;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("focus", "1");
      writeLiveFocusPreference({ enabled: true, instrument: next.get("instrument"), timeframe: next.get("timeframe"), scrollY: window.scrollY });
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const exitFocus = useCallback(() => {
    const stored = readLiveFocusPreference();
    const restore = focusRestoreScroll.current ?? stored.scrollY ?? 0;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("focus");
      writeLiveFocusPreference({ enabled: false, instrument: next.get("instrument"), timeframe: next.get("timeframe"), scrollY: restore });
      return next;
    }, { replace: true });
    window.requestAnimationFrame(() => window.scrollTo({ top: restore, behavior: "auto" }));
  }, [setSearchParams]);

  const selectSignal = (target: LiveSignalNavigationTarget) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("signalId", target.signalId);
      next.delete("chartAt");
      return next;
    }, { replace: true });
    focusSurface(decisionSurfaceRef.current);
  };

  const showSignalOnChart = (target: LiveSignalNavigationTarget) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("signalId", target.signalId);
      next.set("instrument", target.instrument);
      next.set("chartAt", target.at);
      const normalizedTimeframe = normalizeSignalTimeframe(target.timeframe);
      if (normalizedTimeframe && model?.marketSeries.supportedTimeframes.some((value) => normalizeSignalTimeframe(value) === normalizedTimeframe)) {
        next.set("timeframe", normalizedTimeframe);
      }
      return next;
    }, { replace: true });
    focusSurface(chartSurfaceRef.current);
  };

  const clearSignal = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("signalId");
      return next;
    }, { replace: true });
  };

  const submitGateAction = async (action: HumanGateAction, reason: string) => {
    const orderIntentId = model?.orderIntent?.portfolioOrderIntentId;
    if (!orderIntentId) {
      setCommandError("HUMAN_GATE_ORDER_INTENT_MISSING");
      return;
    }
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildHumanGateCommand(action, reason));
      setCommandBinding({
        orderIntentId,
        actionId: action.actionId,
        expectedRevision: action.expectedRevision,
        receipt: accepted,
      });
      await deskQuery.refetch();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "HUMAN_GATE_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  const submitManualExecutionAction = async (action: LiveManualExecutionAction, input: { price?: number | null; quantity?: number | null; reason?: string }) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      await repository.submitCommand(buildManualExecutionCommand(action, input));
      await deskQuery.refetch();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "MANUAL_EXECUTION_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  useEffect(() => {
    const onFocusShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (!focusMode && event.key.toLowerCase() === "f") { event.preventDefault(); enterFocus(); }
    };
    document.addEventListener("keydown", onFocusShortcut);
    return () => document.removeEventListener("keydown", onFocusShortcut);
  }, [enterFocus, focusMode]);

  useEffect(() => {
    if (focusMode || !model || !readLiveFocusPreference().autoOpen) return;
    const canAct = model.gateActions.some((action) => action.permission === "ALLOWED");
    const decisionId = model.orderIntent?.portfolioOrderIntentId ?? model.latestSignal?.signalId ?? null;
    if (!canAct || !decisionId || autoOpenedDecision.current === decisionId) return;
    autoOpenedDecision.current = decisionId;
    enterFocus();
  }, [enterFocus, focusMode, model]);

  if (deskQuery.isError && !deskQuery.data) return <LiveTradingFailure message={(deskQuery.error as Error).message} retry={() => deskQuery.refetch()} />;
  if (deskQuery.isLoading || !model) return <LiveTradingLoading />;

  if (focusMode) {
    if (focusQuery.isError && !focusQuery.data) return <LiveTradingFailure message={(focusQuery.error as Error).message} retry={() => focusQuery.refetch()} />;
    if (focusQuery.isLoading || !focusQuery.data) return <LiveTradingLoading />;
    return <LiveFocusMode
      model={model}
      focus={focusQuery.data.data}
      busy={Boolean(submittingActionId)}
      error={commandError}
      projectionError={focusQuery.isError}
      requestedScope={marketScope}
      dashboardPeriod={focusDashboardPeriod}
      chartLoading={chartQuery.isFetching}
      chartError={chartQuery.isError ? (chartQuery.error as Error).message : null}
      onExit={exitFocus}
      onScopeChange={updateMarketScope}
      onDashboardPeriodChange={updateFocusDashboardPeriod}
      onSelectDecision={(signalId) => {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("signalId", signalId);
          next.set("focus", "1");
          return next;
        }, { replace: true });
      }}
      onSubmitGate={submitGateAction}
      onSubmitManual={submitManualExecutionAction}
    />;
  }

  return (
    <div
      className="lt-page lt-cockpit"
      data-testid="live-trading-golden-master"
      data-operator-state={model.operator.status}
      data-actionable={actionable ? "true" : "false"}
      data-design-seed="c87167ea"
    >
      <LiveTradingHeader model={model} onRefresh={() => { void deskQuery.refetch(); void chartQuery.refetch(); }} refreshing={deskQuery.isFetching || chartQuery.isFetching} onEnterFocus={enterFocus} />
      <LiveCockpitStatusBar model={model} requestedScope={marketScope} scopeUpdating={chartQuery.isFetching} onScopeChange={updateMarketScope} />
      <LiveAttentionCenter model={model} />
      <div className="lt-cockpit__workspace" aria-label="Cockpit Live Trading semi-manuel">
        <aside className="lt-cockpit__market" aria-label="Lecture du marché">
          <LiveMarketLens model={model} />
        </aside>
        <section ref={chartSurfaceRef} className="lt-cockpit__canvas" aria-label="Graphique de marché et plan de trade" tabIndex={-1}>
          <InstrumentChartPanel
            model={model}
            onScopeChange={updateMarketScope}
            showScopeControls={false}
            requestedScope={marketScope}
            loading={chartQuery.isFetching}
            error={chartQuery.isError ? (chartQuery.error as Error).message : null}
            focusAt={chartAt}
          />
        </section>
        <aside ref={decisionSurfaceRef} className="lt-cockpit__decision" aria-label="Dossier de décision courant" tabIndex={-1}>
          <LiveDecisionStack
            model={model}
            onSubmit={submitGateAction}
            submittingActionId={submittingActionId}
            command={command}
            commandStatus={commandStatus.data?.status ?? command?.status ?? null}
            error={commandError}
            onScopeChange={updateMarketScope}
          />
        </aside>
        <LiveActivityDock
          model={model}
          selectedSignalId={selectedSignalId}
          onSelectSignal={selectSignal}
          onClearSignal={clearSignal}
          onShowOnChart={showSignalOnChart}
        />
      </div>
      <div className="lt-accessible-status" aria-live="polite">Projection {model.truth.label}. Mode {presentExecutionMode(model.mode.executionMode).label}. Validation opérateur {model.mode.humanGateRequired ? "requise" : "non requise"}.</div>
    </div>
  );
}

function focusSurface(element: HTMLElement | null) {
  window.setTimeout(() => {
    element?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    element?.focus({ preventScroll: true });
  }, 80);
}

function normalizeSignalTimeframe(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/^M/, "");
  if (!normalized) return null;
  if (["H1", "1H", "60"].includes(normalized)) return "60";
  if (["H4", "4H", "240"].includes(normalized)) return "240";
  return normalized;
}

function LiveTradingLoading() {
  return <div className="lt-page lt-page--loading" aria-busy="true" aria-live="polite"><div className="lt-loading-header" /><div className="lt-loading-policy" /><div className="lt-loading-grid">{Array.from({ length: 8 }, (_, index) => <div key={index} />)}</div></div>;
}

function LiveTradingFailure({ retry }: { message: string; retry(): void }) {
  return <div className="lt-page lt-page--failure"><section role="alert"><strong>Live Trading indisponible</strong><p>La projection opérationnelle n’a pas pu être chargée. Aucune donnée locale ne remplace la réponse du backend.</p><button type="button" onClick={retry}>Réessayer</button><details><summary>Que faire ?</summary><p>Réessayez, puis consultez l’écran Incidents si la projection ne revient pas.</p></details></section></div>;
}
