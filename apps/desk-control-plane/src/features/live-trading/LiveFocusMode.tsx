import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FaArrowLeft, FaChartLine, FaCheck, FaClipboard, FaExclamationTriangle, FaInfoCircle, FaLock, FaQuestionCircle, FaRegCircle, FaTimes, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import type { LiveFocusView, LiveManualExecutionAction } from "@/domains/front-api/viewModels";
import { presentExecutionMode } from "@/design-system/labels";
import { operatorCode, operatorCopy, operatorReason } from "@/design-system/operatorVocabulary";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import type { HumanGateAction } from "@/features/order-intent/model";
import { displayTime, displayValue } from "./mapper";
import { readLiveFocusSoundProfile, writeLiveFocusSoundProfile, type LiveFocusSoundEvent, type LiveFocusSoundProfile } from "./focusPreferences";
import { focusTradePlan, focusTradePlanFromCard } from "./focusTradePlan";
import { gateTiming } from "./LiveHumanGate";
import type { LiveTradingModel } from "./model";
import { InstrumentChartPanel } from "./chart/LiveMarketChart";
import { LiveFocusJournal, FocusQueueTimeline } from "./LiveFocusJournal";
import { buildFocusDashboard, type LiveFocusDashboardPeriod } from "./focusDashboardModel";
import { FocusDashboard } from "./FocusDashboard";
import { buildFocusTradeTimeline, focusCardActionable, focusCardStatus, focusCardTerminal, focusExpirationLabel } from "./focusJournalModel";
import { formatTradePlanPrice } from "./tradePlanFormat";
import "./live-focus.css";

type PendingAction =
  | { kind: "gate"; action: HumanGateAction }
  | { kind: "manual"; action: LiveManualExecutionAction };

type FocusTicketPresentation = {
  mode: "actionable" | "historical" | "observed" | "empty";
  eyebrow: string;
  title: string;
  description: string;
  orbitLabel: string;
  statusLabel: string;
  statusDetail: string;
  tone: "neutral" | "info" | "warning" | "success" | "danger";
  operatorActionable: boolean;
  warning: string | null;
};

export function LiveFocusMode({ model, focus, busy, error, requestedScope, dashboardPeriod, chartLoading, chartError, onExit, onScopeChange, onDashboardPeriodChange, onSelectDecision, onSubmitGate, onSubmitManual }: {
  model: LiveTradingModel;
  focus: LiveFocusView;
  busy: boolean;
  error: string | null;
  requestedScope: { instrument?: string; timeframe?: string };
  dashboardPeriod: LiveFocusDashboardPeriod;
  chartLoading: boolean;
  chartError: string | null;
  onExit(): void;
  onScopeChange(scope: { instrument?: string; timeframe?: string }): void;
  onDashboardPeriodChange(period: LiveFocusDashboardPeriod): void;
  onSelectDecision(signalId: string): void;
  onSubmitGate(action: HumanGateAction, reason: string): Promise<void>;
  onSubmitManual(action: LiveManualExecutionAction, input: { price?: number | null; quantity?: number | null; reason?: string }): Promise<void>;
}) {
  const realtime = useContext(RealtimeContext);
  const state = resolveBackendFocusState(focus, model);
  const queue = useMemo(() => focus.tradeCards, [focus.tradeCards]);
  const selectedIndex = Math.max(0, queue.findIndex((item) => item.signalId === model.latestSignal?.signalId));
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [drawer, setDrawer] = useState<"brief" | "trade" | "chart" | null>(null);
  const [drawerCardId, setDrawerCardId] = useState<string | null>(null);
  const [soundProfile, setSoundProfile] = useState(readLiveFocusSoundProfile);
  const holdTimer = useRef<number | null>(null);
  const gateConfirm = useMemo(() => model.gateActions.find((action) => action.action === "CONFIRM" && action.permission === "ALLOWED"), [model.gateActions]);
  const gateReject = useMemo(() => model.gateActions.find((action) => action.action === "REJECT" && action.permission === "ALLOWED"), [model.gateActions]);
  const manualActions = useMemo(() => model.selectedTheoreticalExecution?.manualExecution?.allowedActions ?? [], [model.selectedTheoreticalExecution?.manualExecution?.allowedActions]);
  const primaryManual = useMemo(() => manualActions.find((action) => ["REPORT_PLACED", "REPORT_FILLED", "REPORT_CLOSED"].includes(action.action) && action.permission === "ALLOWED"), [manualActions]);
  const skipManual = useMemo(() => manualActions.find((action) => action.action === "REPORT_SKIPPED" && action.permission === "ALLOWED"), [manualActions]);
  const stopManual = useMemo(() => manualActions.find((action) => action.action === "REPORT_STOP_PLACED" && action.permission === "ALLOWED"), [manualActions]);
  const primary = useMemo(() => gateConfirm ? ({ kind: "gate", action: gateConfirm } as const) : primaryManual ? ({ kind: "manual", action: primaryManual } as const) : null, [gateConfirm, primaryManual]);
  const selectedCard = queue[selectedIndex] ?? focus.selectedTrade;
  const plan = selectedCard ? focusTradePlanFromCard(selectedCard) : focusTradePlan(model);
  const drawerCard = drawerCardId
    ? queue.find((card) => card.orderIntentId === drawerCardId || card.tradeCardId === drawerCardId || card.signalId === drawerCardId) ?? selectedCard
    : selectedCard;
  const timing = gateTiming(
    selectedCard?.createdAt ?? model.orderIntent?.createdAt ?? model.latestSignal?.createdAt ?? null,
    selectedCard?.expiresAt ?? model.orderIntent?.allowedActions.expiresAt ?? model.latestSignal?.expiresAt ?? null,
    realtime?.now ?? new Date(model.meta.asOf),
  );
  const dashboard = useMemo(() => buildFocusDashboard(focus, dashboardPeriod), [dashboardPeriod, focus]);
  const ticket = resolveFocusTicketPresentation(model, focus, plan, timing, primary);
  useFocusPerception({ model, stateCode: state.code, stateLabel: state.label, timingLabel: timing.label, timingUrgency: timing.urgency, soundProfile });

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    html.classList.add("desk-live-focus-document");
    body.classList.add("desk-live-focus-document");
    root?.classList.add("desk-live-focus-root");
    return () => {
      html.classList.remove("desk-live-focus-document");
      body.classList.remove("desk-live-focus-document");
      root?.classList.remove("desk-live-focus-root");
    };
  }, []);

  const request = useCallback((action: PendingAction | null) => {
    if (!action || busy) return;
    setPending(action);
  }, [busy]);

  const selectRelative = useCallback((delta: number) => {
    if (queue.length < 2) return;
    const next = queue[(selectedIndex + delta + queue.length) % queue.length];
    if (next?.signalId) onSelectDecision(next.signalId);
  }, [onSelectDecision, queue, selectedIndex]);

  const copyPlan = useCallback(async () => {
    const value = focusClipboardText(model);
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [model]);

  useEffect(() => {
    const clearHold = () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (pending) setPending(null);
        else if (showHelp) setShowHelp(false);
        else if (drawer) setDrawer(null);
        else onExit();
        return;
      }
      if (pending || showHelp || drawer) return;
      if (["ArrowDown", "ArrowUp"].includes(event.key) && target?.closest("[data-focus-scroll]")) return;
      if (event.key === "?") { event.preventDefault(); setShowHelp((value) => !value); }
      if (event.key.toLowerCase() === "g") { event.preventDefault(); setDrawer("chart"); }
      if (event.key === "ArrowDown") { event.preventDefault(); selectRelative(1); }
      if (event.key === "ArrowUp") { event.preventDefault(); selectRelative(-1); }
      if (event.key.toLowerCase() === "c") { event.preventDefault(); void copyPlan(); }
      if (event.key.toLowerCase() === "r" && gateReject) { event.preventDefault(); request({ kind: "gate", action: gateReject }); }
      if (event.key.toLowerCase() === "s" && stopManual) { event.preventDefault(); request({ kind: "manual", action: stopManual }); }
      if (event.key === "Enter" && primary && holdTimer.current === null) {
        event.preventDefault();
        holdTimer.current = window.setTimeout(() => { request(primary); holdTimer.current = null; }, 400);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === "Enter") clearHold(); };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => { clearHold(); document.removeEventListener("keydown", onKeyDown); document.removeEventListener("keyup", onKeyUp); };
  }, [copyPlan, drawer, gateReject, onExit, pending, primary, request, selectRelative, showHelp, stopManual]);

  return (
    <div className={`live-focus live-focus--${state.code.toLowerCase()} lt-tone--${state.tone}`} data-testid="live-focus-mode" data-focus-state={state.code}>
      <header className="live-focus__header">
        <div className="live-focus__identity"><span className="live-focus__mark" aria-hidden="true">◆</span><div><small>DIRECT DESK · FOCUS OPÉRATEUR</small><strong>{state.label}</strong></div></div>
        <div className="live-focus__policy"><span>{operatorCode(model.mode.environment)}</span><span>{presentExecutionMode(model.mode.executionMode).label}</span><span>Exécution automatique {model.mode.autoExecutionEnabled ? "active" : "désactivée"}</span></div>
        {state.code === "C" ? <div className="live-focus__countdown" data-urgency={timing.urgency} aria-label={`Temps restant ${timing.label}`}><strong>⏱ {timing.label}</strong><span aria-hidden="true"><i style={{ width: `${timing.remainingPct}%` }} /></span></div> : null}
        <time dateTime={realtime?.now?.toISOString()}><strong>{realtime?.now ? formatEtClock(realtime.now) : "—"}</strong><small>NEW YORK</small></time>
        <button type="button" className="live-focus__return" onClick={onExit}><FaArrowLeft aria-hidden="true" />Retour au direct <kbd>Esc</kbd></button>
      </header>

      <FocusMissionRibbon model={model} focus={focus} state={state} timingLabel={timing.label} />

      <FocusDashboard dashboard={dashboard} period={dashboardPeriod} onPeriodChange={onDashboardPeriodChange} />

      <div className="live-focus__body">
        <section className="live-focus__brief" aria-labelledby="live-focus-brief-title" tabIndex={0} data-focus-scroll>
          <QuestionNumber value="01" />
          <div className="live-focus__section-copy"><p className="eyebrow">QUE SE PASSE-T-IL ?</p><h1 id="live-focus-brief-title">Brief opérationnel</h1></div>
          <FocusBrief focus={focus} onOpen={() => setDrawer("brief")} />
        </section>

        <section className="live-focus__decision" data-ticket-mode={ticket.mode} aria-labelledby="live-focus-action-title" tabIndex={0} data-focus-scroll>
          <div className="live-focus__decision-head">
            <QuestionNumber value="02" />
            <div className="live-focus__section-copy"><p className="eyebrow">{ticket.eyebrow}</p><h2 id="live-focus-action-title">{ticket.title}</h2><p>{formatOperatorParagraph(ticket.description)}</p></div>
            <div className="live-focus__state-orbit" aria-label={`État Focus ${state.code} ${state.label}`}><span>{state.code}</span><strong>{state.label}</strong><small>{ticket.orbitLabel}</small></div>
          </div>
          <FocusTicket plan={plan} timingLabel={timing.label} ticket={ticket} />
          <div className="live-focus__actions" aria-label="Actions autorisées par le backend">
            {primary && ticket.operatorActionable ? <button type="button" className="live-focus__primary-action" disabled={busy} onClick={() => request(primary)}><FaCheck aria-hidden="true" />{operatorCopy(primary.action.label)}<kbd>maintenir Entrée</kbd></button> : null}
            {gateReject ? <button type="button" disabled={busy} onClick={() => request({ kind: "gate", action: gateReject })}><FaTimes aria-hidden="true" />Refuser<kbd>R</kbd></button> : null}
            {skipManual ? <button type="button" disabled={busy} onClick={() => request({ kind: "manual", action: skipManual })}><FaRegCircle aria-hidden="true" />Non exécuté</button> : null}
            {stopManual ? <button type="button" disabled={busy} onClick={() => request({ kind: "manual", action: stopManual })}><FaLock aria-hidden="true" />Stop placé<kbd>S</kbd></button> : null}
            <button type="button" className="live-focus__copy-action live-focus__primary-action" onClick={() => void copyPlan()}><FaClipboard aria-hidden="true" />{copied ? "Copié" : "Copier le plan"}<kbd>C</kbd></button>
            {selectedCard ? <button type="button" onClick={() => { setDrawerCardId(selectedCard.orderIntentId); setDrawer("trade"); }}><FaInfoCircle aria-hidden="true" />Voir le dossier</button> : null}
          </div>
          {ticket.warning ? <p className="live-focus__integrity-warning" role="alert"><FaExclamationTriangle aria-hidden="true" />{ticket.warning}</p> : null}
          {!primary && !gateReject && !skipManual ? <p className="live-focus__locked"><FaLock aria-hidden="true" />{model.gateBlockedReason}</p> : null}
          {error ? <p className="live-focus__error" role="alert">La commande a échoué. Le Focus a rechargé la vérité backend et n’a créé aucun état local de remplacement.</p> : null}
          <div className="live-focus__decision-support">
            <article className="live-focus__support-card" aria-labelledby="live-focus-situation-title">
              <div className="live-focus__support-title"><small>OÙ EN SUIS-JE ?</small><h3 id="live-focus-situation-title">{state.headline}</h3></div>
              {state.code === "B" ? <FocusPipeline focus={focus} /> : <FocusPosition model={model} />}
            </article>
            <article className="live-focus__support-card" aria-labelledby="live-focus-market-title">
              <div className="live-focus__support-title"><small>QUE FAIT LE MARCHÉ ?</small><h3 id="live-focus-market-title">Prix opérationnels</h3></div>
              <FocusMarketSummary
                model={model}
                focus={focus}
                requestedScope={requestedScope}
                chartVisible={drawer === "chart"}
                onToggleChart={() => setDrawer("chart")}
              />
            </article>
          </div>
        </section>

        <LiveFocusJournal
          focus={focus}
          selectedSignalId={model.latestSignal?.signalId ?? null}
          onOpenChart={() => setDrawer("chart")}
          onOpenTrade={(card) => {
            if (card.signalId) onSelectDecision(card.signalId);
            setDrawerCardId(card.orderIntentId);
            setDrawer("trade");
          }}
          onSelectDecision={onSelectDecision}
        />
      </div>
      <footer className="live-focus__footer"><span><kbd>↑</kbd><kbd>↓</kbd> dossiers</span><span><kbd>G</kbd> graphique</span><span><kbd>C</kbd> copier</span><span><kbd>R</kbd> refuser</span><span><kbd>S</kbd> stop placé</span><button type="button" className="live-focus__sound" aria-pressed={soundProfile.enabled} onClick={() => { const next = writeLiveFocusSoundProfile({ ...soundProfile, enabled: !soundProfile.enabled }); setSoundProfile(next); }}>{soundProfile.enabled ? <FaVolumeUp aria-hidden="true" /> : <FaVolumeMute aria-hidden="true" />}{soundProfile.enabled ? "Sons actifs" : "Sons coupés"}</button><button type="button" className="live-focus__help-trigger" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}><FaQuestionCircle aria-hidden="true" />Raccourcis <kbd>?</kbd></button><span className="live-focus__session">Séance {focus.whyNoTrade.stageCounts.signals ?? 0} signaux · {focus.whyNoTrade.stageCounts.orderIntents ?? 0} ordres proposés · {focus.tradeCards.filter(focusCardActionable).length} à décider · {model.signalFunnel.theoreticalTracked} suivis</span><small>{focus.session.marketSession} · arrêté à {displayTime(focus.asOf)}</small></footer>
      {pending ? <FocusActionDialog pending={pending} model={model} busy={busy} onCancel={() => setPending(null)} onSubmitGate={async (action, reason) => { await onSubmitGate(action, reason); setPending(null); }} onSubmitManual={async (action, input) => { await onSubmitManual(action, input); setPending(null); }} /> : null}
      {showHelp ? <FocusHelpDialog profile={soundProfile} onChange={(next) => { setSoundProfile(writeLiveFocusSoundProfile(next)); }} onClose={() => setShowHelp(false)} /> : null}
      {drawer === "brief" ? <FocusBriefDrawer focus={focus} onClose={() => setDrawer(null)} /> : null}
      {drawer === "trade" && drawerCard ? <FocusTradeDrawer card={drawerCard} onClose={() => setDrawer(null)} /> : null}
      {drawer === "chart" ? <FocusChartDrawer model={model} requestedScope={requestedScope} chartLoading={chartLoading} chartError={chartError} onScopeChange={onScopeChange} onClose={() => setDrawer(null)} /> : null}
    </div>
  );
}

function FocusBrief({ focus, onOpen }: { focus: LiveFocusView; onOpen(): void }) {
  const brief = focus.marketDeskBrief;
  const context = brief.operatorSummary;
  const preferred = brief.whatDeskWants?.map((item) => operatorCopy(item)) ?? [];
  const vigilance = [...(brief.whatDeskAvoids ?? []), ...focus.whyNoTrade.topReasons].map((reason) => operatorReason(reason));
  const contextStatus = presentMarketContextStatus(brief.status);
  return <div className="live-focus__brief-grid" data-status={brief.status}>
    <article className="live-focus__calendar"><small>Calendrier · prochain catalyseur</small><p>{focus.whyNoTrade.nextRelevantEventAt ? displayTime(focus.whyNoTrade.nextRelevantEventAt) : "Aucun catalyseur couvert n’est publié."}</p></article>
    <article className="live-focus__brief-headline"><small>Résumé du brief</small><strong title={brief.headline}>{formatOperatorParagraph(brief.headline)}</strong><p>{formatOperatorParagraph(context)}</p><span data-tone={contextStatus.tone}>{contextStatus.label}</span></article>
    <article><small>État du marché</small><p>{formatOperatorParagraph(focus.marketContext.marketRegime || "Régime non publié")} · {formatOperatorParagraph(focus.marketContext.volatilityRegime || "Volatilité non publiée")} · {formatOperatorParagraph(focus.marketContext.globalBias || "Biais non publié")}</p></article>
    <article><small>Ce que le desk recherche</small><p>{preferred.length ? `Le desk privilégie ${preferred.join(", ")}.` : "Aucune famille de stratégie n’est privilégiée dans l’état publié."}</p></article>
    <article><small>Points de vigilance</small><p>{vigilance.length ? formatOperatorParagraph(`${vigilance.join(". ")}.`) : "Aucun point de vigilance supplémentaire n’est publié."}</p></article>
    <button type="button" className="live-focus__brief-open" onClick={onOpen}><FaInfoCircle aria-hidden="true" />Voir le brief complet</button>
    <small className="live-focus__brief-source">Brief {contextStatus.label} · consultatif · données arrêtées à {displayTime(focus.technical.sourceDataCutoff || focus.asOf)} · valide jusqu’à {displayTime(typeof focus.marketContext.validUntil === "string" ? focus.marketContext.validUntil : null)} · analyste {focus.contextWorker.successCount} succès / {focus.contextWorker.failureCount} échec(s)</small>
  </div>;
}

function FocusMissionRibbon({ model, focus, state, timingLabel }: { model: LiveTradingModel; focus: LiveFocusView; state: ReturnType<typeof resolveBackendFocusState>; timingLabel: string }) {
  const activeTradeCount = focus.tradeCards.filter(focusCardActionable).length;
  const selectedTicket = focus.tradeCards.find((card) => card.signalId === model.latestSignal?.signalId)
    ?? focus.selectedTrade
    ?? focus.tradeCards.find(focusCardActionable)
    ?? null;
  const ticketLabel = selectedTicket ? `${selectedTicket.instrument} · ${operatorCode(selectedTicket.side)}` : "Aucun ticket prêt";
  const freshness = displayTime(focus.technical.sourceDataCutoff || focus.asOf);
  const nextAction = activeTradeCount > 0 ? "Décision opérateur à vérifier" : focus.whyNoTrade.topReasons.map((reason) => operatorReason(reason)).join(" · ") || "Surveillance active";
  return <section className="live-focus__mission-ribbon" aria-label="Résumé instantané du mode Focus">
    <div className="live-focus__mission-status">
      <small>ÉTAT IMMÉDIAT</small>
      <strong>{state.headline}</strong>
      <span>{nextAction}</span>
    </div>
    <dl>
      <div><dt>Ticket suivi</dt><dd>{ticketLabel}</dd></div>
      <div><dt>Dossiers à décider</dt><dd>{String(activeTradeCount)}</dd></div>
      <div><dt>Fenêtre</dt><dd>{timingLabel}</dd></div>
      <div><dt>Données arrêtées à</dt><dd>{freshness}</dd></div>
    </dl>
  </section>;
}

function FocusMarketSummary({ model, focus, requestedScope, chartVisible, onToggleChart }: {
  model: LiveTradingModel;
  focus: LiveFocusView;
  requestedScope: { instrument?: string; timeframe?: string };
  chartVisible: boolean;
  onToggleChart(): void;
}) {
  const lastCandle = model.marketSeries.points.at(-1);
  const activeInstrument = model.marketSeries.instrument ?? requestedScope.instrument ?? "Instrument non publié";
  const activeTimeframe = focusTimeframeLabel(model.marketSeries.timeframe ?? requestedScope.timeframe);
  const marketState = operatorCode(focus.session.marketState, "État de séance non publié");
  const availability = presentMarketContextStatus(model.marketSeries.availability);
  return <div className="live-focus__market-summary" aria-label="Prix opérationnels publiés par le backend">
    <div className="live-focus__market-head">
      <div>
        <small>PRIX OPÉRATIONNELS</small>
        <strong>{activeInstrument} · {activeTimeframe}</strong>
        <span>{availability.label} · {marketState} · source {operatorCode(model.marketSeries.source, "non publiée")}</span>
      </div>
      <button type="button" className="live-focus__chart-toggle" aria-expanded={chartVisible} onClick={onToggleChart}>
        <FaChartLine aria-hidden="true" />
        {chartVisible ? "Masquer le graphique" : "Afficher le graphique"}
        <kbd>G</kbd>
      </button>
    </div>
    {lastCandle ? (
      <dl className="live-focus__market-strip">
        <Fact label="Dernier" value={displayValue(lastCandle.close)} />
        <Fact label="Ouverture" value={displayValue(lastCandle.open)} />
        <Fact label="Plus haut" value={displayValue(lastCandle.high)} />
        <Fact label="Plus bas" value={displayValue(lastCandle.low)} />
        <Fact label="Volume" value={displayValue(lastCandle.volume)} />
        <Fact label="Bougie" value={displayTime(lastCandle.timestamp)} />
      </dl>
    ) : <p className="live-focus__market-empty">Aucune bougie exploitable n’est publiée pour ce périmètre.</p>}
    <small className="live-focus__market-footnote">Le Focus affiche le périmètre du dossier. La watchlist complète reste dans le Live.</small>
  </div>;
}

function presentMarketContextStatus(rawStatus: string) {
  const status = rawStatus.trim().toUpperCase();
  if (status === "AVAILABLE") return { label: "Disponible", tone: "success" as const };
  if (status === "PARTIAL") return { label: "Partiel", tone: "warning" as const };
  if (status === "STALE") return { label: "Périmé", tone: "warning" as const };
  if (status === "INVALIDATED") return { label: "Invalidé", tone: "warning" as const };
  if (status === "DISABLED_BY_POLICY") return { label: "Désactivé par politique", tone: "neutral" as const };
  if (status === "UNAVAILABLE") return { label: "Indisponible", tone: "danger" as const };
  return presentBackendStatus(rawStatus);
}

function FocusBriefDrawer({ focus, onClose }: { focus: LiveFocusView; onClose(): void }) {
  const brief = focus.marketDeskBrief;
  const contextStatus = presentMarketContextStatus(brief.status);
  const currentZones = recordRows(brief.opportunityZones ?? focus.marketContext.opportunityZones);
  const noTradeZones = recordRows(brief.noTradeZones ?? focus.marketContext.noTradeZones);
  return <FocusDrawer title="Brief marché & Desk" subtitle={`${contextStatus.label} · ${displayTime(focus.technical.sourceDataCutoff)}`} onClose={onClose}>
    <section><h3>Lecture opérateur</h3><p>{formatOperatorParagraph(brief.operatorSummary)}</p><p>{formatOperatorParagraph(valueText(brief.marketInterpretation, "Interprétation non publiée"))}</p></section>
    <section><h3>Intention du Desk</h3><p>{formatOperatorParagraph(valueText(brief.deskIntent, "Intention non publiée"))}</p><TagList values={stringRows(brief.whatDeskWants)} empty="Aucune famille privilégiée" /></section>
    <section><h3>Pourquoi aucun trade ?</h3><TagList values={focus.whyNoTrade.topReasons.map((reason) => operatorReason(reason))} empty="Aucun blocage publié" /></section>
    <section className="live-focus-drawer__columns"><div><h3>Zones d’opportunité</h3><ZoneList zones={currentZones} /></div><div><h3>Zones à éviter</h3><ZoneList zones={noTradeZones} /></div></section>
    <section><h3>Sources et fraîcheur</h3><div className="live-focus-drawer__source-grid">{focus.sourceStates.map((source, index) => <article key={valueText(source.sourceId, String(index))}><strong>{valueText(source.sourceId, "Source")}</strong><span>{operatorCode(valueText(source.status, "UNKNOWN"))}</span><small>{displayTime(valueText(source.dataCutoff ?? source.asOf, null))}</small></article>)}</div></section>
    <section><h3>Analyste contextuel</h3><dl className="live-focus-drawer__facts"><Fact label="Tâches" value={String(focus.contextWorker.taskCount)} /><Fact label="Succès" value={String(focus.contextWorker.successCount)} /><Fact label="Échecs" value={String(focus.contextWorker.failureCount)} /><Fact label="Relances" value={String(focus.contextWorker.retryCount)} /><Fact label="Latence moyenne" value={focus.contextWorker.averageLatencyMs === null ? "Non mesurée" : `${Math.round(focus.contextWorker.averageLatencyMs)} ms`} /><Fact label="Tokens" value={String(focus.contextWorker.totalTokens)} /></dl></section>
    <section><h3>Historique de séance</h3><ol className="live-focus-drawer__history">{focus.briefHistory.length ? focus.briefHistory.map((item) => <li key={item.marketDeskBriefId} data-current={item.current}><div><strong>{item.current ? "Brief actuel" : "Historique"}</strong><span>{operatorCode(item.status)}</span></div><small>{displayTime(item.createdAt)} → {displayTime(item.validUntil)} · {item.invalidationReason ? operatorReason(item.invalidationReason) : "aucune invalidation publiée"}</small></li>) : <li><small>Aucun brief historique publié.</small></li>}</ol></section>
  </FocusDrawer>;
}

function FocusTradeDrawer({ card, onClose }: { card: LiveFocusView["tradeCards"][number]; onClose(): void }) {
  const why = card.whyThisTrade ?? {};
  const terminal = focusCardTerminal(card);
  const expirationLabel = focusExpirationLabel(card.expiresAt, card.asOf, terminal);
  const timeline = buildFocusTradeTimeline(card, card.asOf);
  return <FocusDrawer title={`${card.instrument} · ${operatorCode(card.side)}`} subtitle={`${operatorCopy(card.strategyName)} · ${presentBackendStatus(card.operatorState).label}`} onClose={onClose}>
    <section className="live-focus-drawer__verdict" data-terminal={terminal ? "true" : "false"}><small>{terminal ? "Historique — ne pas poser" : "Dossier qualifié"}</small><strong>{focusCardStatus(card)}</strong><p>{terminal ? "La fenêtre de décision est fermée : ce dossier reste consultable pour audit uniquement." : "Les termes publiés ci-dessous sont issus du backend et restent immuables après Risk."}</p><FocusQueueTimeline steps={timeline} /></section>
    <section><h3>Résumé</h3><dl className="live-focus-drawer__facts"><Fact label="Quantité autorisée" value={valueText(card.authorizedQuantity, "Non publiée")} /><Fact label="R attendu" value={card.expectedR === null ? "Non publié" : `${card.expectedR.toFixed(2)} R`} /><Fact label="Échéance" value={expirationLabel} /><Fact label="Suivi théorique" value={operatorCode(card.theoreticalState)} /></dl></section>
    <section><h3>Pourquoi ce trade ?</h3><dl className="live-focus-drawer__explanation"><Fact label="Direction" value={operatorReason(valueText(why.whyDirection, "NOT_AVAILABLE"))} /><Fact label="Setup" value={operatorCopy(valueText(why.whySetup, "NOT_AVAILABLE"))} /><Fact label="Pourquoi maintenant" value={operatorReason(valueText(why.whyNow, "NOT_AVAILABLE"))} /><Fact label="Réduction" value={operatorReason(valueText(why.whatWasReduced, "NOT_AVAILABLE"))} /></dl></section>
    <section><h3>Comparaison des plans</h3><div className="live-focus-drawer__plans"><PlanSnapshot title="Plan proposé par la stratégie" plan={card.strategyProposedPlan} /><PlanSnapshot title="Plan ajusté par le contexte" plan={card.contextAdjustedPlan} /><PlanSnapshot title="Plan autorisé par le risque" plan={card.riskAuthorizedPlan} /></div></section>
    <section className="live-focus-drawer__columns"><div><h3>Contexte & portefeuille</h3><TagList values={stringRows(why.whyContextAccepted).concat(stringRows(why.whyPortfolioSelected))} empty="Preuves non publiées" /></div><div><h3>Risque global</h3><TagList values={stringRows(why.whyRiskAuthorized)} empty="Raisons de risque non publiées" /></div></section>
    <section><h3>Gate opérateur</h3><p>{presentBackendStatus(card.operatorState).label}. Les actions ci-dessous restent exclusivement pilotées par les autorisations publiées par le backend.</p><TagList values={card.allowedActions.map((action) => operatorCopy(action))} empty={card.denialReasons.map((reason) => operatorReason(reason)).join(" · ") || "Aucune action autorisée"} /></section>
    <section className="live-focus-drawer__columns"><div><h3>Résultat théorique</h3><p>{card.realizedR === null || card.realizedR === undefined ? "Non publié" : `${card.realizedR > 0 ? "+" : ""}${card.realizedR.toFixed(2)} R`}</p><small>{operatorCode(card.closeReason, "Dossier non clôturé")}</small></div><div><h3>Résultat opérateur</h3><p>{card.operatorResult ? operatorCode(valueText(card.operatorResult.status, "Publié")) : "Non déclaré"}</p></div></section>
    <section><h3>Audit et filiation</h3><dl className="live-focus-drawer__ids"><Fact label="Signal" value={card.signalId ?? "Non publié"} /><Fact label="Contexte" value={card.contextDecisionId ?? "Non publié"} /><Fact label="Portefeuille" value={card.portfolioDecisionId ?? "Non publié"} /><Fact label="Risque" value={card.riskDecisionId ?? "Non publié"} /><Fact label="Position cible" value={card.targetPositionId} /><Fact label="Intention d’ordre" value={card.orderIntentId} /><Fact label="Gate humain" value={card.humanGateId} /><Fact label="Source" value={card.source} /><Fact label="Révision" value={valueText(card.revision, "Non publiée")} /><Fact label="Corrélation" value={card.correlationId ?? "Non publiée"} /></dl></section>
  </FocusDrawer>;
}

function FocusChartDrawer({ model, requestedScope, chartLoading, chartError, onScopeChange, onClose }: {
  model: LiveTradingModel;
  requestedScope: { instrument?: string; timeframe?: string };
  chartLoading: boolean;
  chartError: string | null;
  onScopeChange(scope: { instrument?: string; timeframe?: string }): void;
  onClose(): void;
}) {
  return <FocusDrawer title="Graphique du dossier" subtitle={`${model.marketSeries.instrument ?? requestedScope.instrument ?? "Instrument non publié"} · ${focusTimeframeLabel(model.marketSeries.timeframe ?? requestedScope.timeframe)}`} onClose={onClose}>
    <section className="live-focus-drawer__chart">
      <InstrumentChartPanel model={model} onScopeChange={onScopeChange} requestedScope={requestedScope} loading={chartLoading} error={chartError} />
    </section>
  </FocusDrawer>;
}

function FocusDrawer({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose(): void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return <div className="live-focus-drawer__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="live-focus-drawer" role="dialog" aria-modal="true" aria-labelledby="live-focus-drawer-title"><header><div><small>{subtitle}</small><h2 id="live-focus-drawer-title">{title}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer le dossier"><FaTimes aria-hidden="true" /></button></header><div className="live-focus-drawer__body">{children}</div></aside></div>;
}

function PlanSnapshot({ title, plan }: { title: string; plan?: Record<string, unknown> | null }) {
  const source = plan ?? {};
  const targets = recordRows(source.targets).map((item) => formatTradePlanPrice(item.price ?? item.value ?? item.targetPrice ?? item.target_price ?? item, "—"));
  return <article data-available={Boolean(plan)}><strong>{title}</strong><dl><Fact label="Entrée" value={formatTradePlanPrice(source.entry ?? source.entryPrice ?? source.entry_price, "Non publiée")} /><Fact label="Stop" value={formatTradePlanPrice(source.stop ?? source.stopPrice ?? source.stop_price, "Non publié")} /><Fact label="Objectifs" value={targets.length ? targets.join(" · ") : "Non publiés"} /></dl></article>;
}

function ZoneList({ zones }: { zones: readonly Record<string, unknown>[] }) { return zones.length ? <ul className="live-focus-drawer__zones">{zones.map((zone, index) => <li key={valueText(zone.zoneId, String(index))}><strong>{valueText(zone.instrument, "—")} · {operatorCode(valueText(zone.direction, "TOUS"))}</strong><span>{valueText(zone.minPrice, "—")} → {valueText(zone.maxPrice, "—")}</span></li>)}</ul> : <p>Aucune zone publiée.</p>; }
function TagList({ values, empty }: { values: readonly string[]; empty: string }) { return values.length ? <ul className="live-focus-drawer__tags">{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul> : <p>{empty}</p>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function recordRows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : []; }
function recordValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringRows(value: unknown): string[] { return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : []; }
function valueText(value: unknown, fallback: string | null = "Non publié"): string { const normalized = value === null || value === undefined ? "" : String(value).trim(); return normalized || (fallback ?? ""); }

function FocusPosition({ model }: { model: LiveTradingModel }) {
  const row = model.selectedTheoreticalExecution;
  const outcome = row?.outcomeAttribution;
  return <dl className="live-focus__position">
    <div><dt>Décision</dt><dd>{operatorCode(model.orderIntent?.humanGate.status ?? model.latestSignal?.effectiveState ?? model.latestSignal?.state, "Aucune")}</dd></div>
    <div><dt>Suivi théorique</dt><dd>{operatorCode(row?.status, "Aucun")}</dd></div>
    <div><dt>Exécution opérateur</dt><dd>{operatorCode(row?.manualExecution?.status ?? row?.manualExecutionStatus, "Non déclarée")}{row?.manualExecution?.stopPlacement?.placed ? " · stop posé" : ""}</dd></div>
    <div><dt>{row?.tradeStatus && row.tradeStatus !== "CLOSED" ? "R en direct" : "Résultat officiel"}</dt><dd>{row?.tradeStatus && row.tradeStatus !== "CLOSED" && row.liveMark?.currentR !== null && row.liveMark?.currentR !== undefined ? `${row.liveMark.currentR > 0 ? "+" : ""}${row.liveMark.currentR.toFixed(2)} R` : row?.resultR === null || row?.resultR === undefined ? "Non publié" : `${row.resultR > 0 ? "+" : ""}${row.resultR.toFixed(2)} R`}</dd></div>
    <div><dt>Attribution</dt><dd>{operatorCode(outcome?.status, "En attente")}</dd></div>
  </dl>;
}

function FocusPipeline({ focus }: { focus: LiveFocusView }) {
  const counts = focus.whyNoTrade.stageCounts;
  const stages = [
    { label: "Le desk a repéré quelque chose", published: Number(counts.signals || 0) > 0, result: `${counts.signals || 0} signal(s)` },
    { label: "Le contexte est-il favorable ?", published: Number(counts.contextAccepted || 0) > 0, result: `${counts.contextAccepted || 0} admis · ${counts.contextWait || 0} en attente · ${counts.contextRejected || 0} refusés` },
    { label: "Est-ce compatible avec le portefeuille ?", published: Number(counts.portfolioSelected || 0) > 0, result: `${counts.portfolioSelected || 0} sélection(s)` },
    { label: "Quel ordre exactement ?", published: Number(counts.orderIntents || 0) > 0, result: `${counts.orderIntents || 0} ordre(s) proposé(s)` },
    { label: "À vous de valider", published: focus.tradeCards.some(focusCardActionable), result: `${focus.tradeCards.filter(focusCardActionable).length} dossier(s) à décider` },
  ];
  const firstUnpublished = stages.findIndex((stage) => !stage.published);
  return <ol className="live-focus__pipeline" aria-label="Progression publiée de la décision">
    {stages.map((stage, index) => {
      const status = stage.published ? "published" : index === firstUnpublished ? "awaiting-publication" : "waiting";
      return <li key={stage.label} data-status={status}><span aria-hidden="true">{stage.published ? "✓" : index === firstUnpublished ? "◐" : "○"}</span><div><strong>{stage.label}</strong><small>{stage.result ?? (index === firstUnpublished ? "Pas encore évalué" : "Bloqué en amont")}</small></div></li>;
    })}
  </ol>;
}

function resolveBackendFocusState(focus: LiveFocusView, model: LiveTradingModel) {
  const stage = focus.operatorJourneyState.stage;
  const code = ["A", "B", "C", "D", "E", "F"].includes(stage) ? stage : "B";
  const labels: Record<string, { label: string; headline: string; instruction: string; tone: "neutral" | "info" | "warning" | "success" }> = {
    A: { label: "MARCHÉ HORS SESSION", headline: "Le Desk attend la prochaine fenêtre CBOT", instruction: focus.whyNoTrade.topReasons.map((reason) => operatorReason(reason)).join(" · ") || "Aucune action requise.", tone: "neutral" },
    B: { label: "SURVEILLANCE", headline: "Le Desk cherche un setup qualifié", instruction: focus.whyNoTrade.topReasons.map((reason) => operatorReason(reason)).join(" · ") || "Les moteurs déterministes évaluent le marché.", tone: "info" },
    C: { label: "OPPORTUNITÉ OBSERVÉE", headline: "Un signal traverse les filtres", instruction: "Cette opportunité reste diagnostique tant qu’elle n’a pas produit une position cible, un ordre proposé et une validation humaine.", tone: "warning" },
    D: { label: "ARBITRAGE", headline: "Portfolio et Risk évaluent le dossier", instruction: "Aucune action opérateur avant publication du plan autorisé.", tone: "warning" },
    E: { label: "DOSSIER QUALIFIÉ", headline: "Le dossier canonique est prêt", instruction: "Contrôlez les termes immuables et l’autorité de validation humaine.", tone: "success" },
    F: { label: "ACTION HUMAINE", headline: "Une décision opérateur est attendue", instruction: "Confirmer ne signifie ni accusé broker ni exécution.", tone: "success" },
  };
  return { code, ...labels[code] };
}

function resolveFocusTicketPresentation(
  model: LiveTradingModel,
  focus: LiveFocusView,
  plan: ReturnType<typeof focusTradePlan>,
  timing: ReturnType<typeof gateTiming>,
  primary: PendingAction | null,
): FocusTicketPresentation {
  const selectedCard = focus.tradeCards.find((card) => card.signalId === model.latestSignal?.signalId)
    ?? focus.selectedTrade
    ?? focus.tradeCards[0]
    ?? null;
  const terminal = Boolean(selectedCard && focusCardTerminal(selectedCard)) || timing.expired;
  const operatorActionable = Boolean(primary && plan.actionable && !terminal);
  const signalLabel = selectedCard ? `${selectedCard.instrument} · ${operatorCode(selectedCard.side)}` : model.latestSignal ? `${model.latestSignal.symbol} · ${operatorCode(model.latestSignal.direction)}` : "Surveillance Desk";
  const statusLabel = selectedCard ? focusCardStatus(selectedCard) : model.operator.label;
  const statusDetail = selectedCard
    ? `${operatorCopy(selectedCard.strategyName)} · signal ${displayTime(selectedCard.createdAt)} · expiration ${displayTime(selectedCard.expiresAt)}`
    : model.orderIntent
      ? `${operatorCode(model.orderIntent.side)} · quantité ${model.orderIntent.quantity} · expiration ${displayTime(model.orderIntent.allowedActions.expiresAt)}`
      : model.latestSignal
        ? `${model.latestSignal.symbol} ${operatorCode(model.latestSignal.direction)} · expiration ${displayTime(model.latestSignal.expiresAt)}`
        : "Aucun dossier qualifié publié.";

  if (operatorActionable) {
    return {
      mode: "actionable",
      eyebrow: "À DÉCIDER",
      title: "Ticket d’action",
      description: "Le backend publie un dossier post-risque et une action opérateur ouverte. Confirmer ne signifie jamais fill broker.",
      orbitLabel: signalLabel,
      statusLabel: "Prêt à décider",
      statusDetail,
      tone: "success",
      operatorActionable: true,
      warning: null,
    };
  }

  if (selectedCard || model.orderIntent) {
    return {
      mode: "historical",
      eyebrow: "À CONSULTER",
      title: "Dossier non actionnable",
      description: "Ce dossier reste utile pour l’audit, mais il ne doit pas être posé depuis le Focus car sa fenêtre est fermée ou aucune capability n’est publiée.",
      orbitLabel: signalLabel,
      statusLabel: terminal ? "Historique — ne pas poser" : statusLabel,
      statusDetail,
      tone: terminal ? "warning" : "info",
      operatorActionable: false,
      warning: terminal
        ? "Dossier expiré, annulé, rejeté ou déjà clôturé : ne pas poser. Ouvrir le dossier uniquement pour audit."
        : "Dossier qualifié publié, mais aucune action opérateur n’est autorisée par le backend à cet instant.",
    };
  }

  if (model.latestSignal || focus.observedOpportunities.length) {
    const observedCount = Math.max(focus.observedOpportunities.length, model.latestSignal ? 1 : 0);
    return {
      mode: "observed",
      eyebrow: "SURVEILLANCE",
      title: "Aucun ordre prêt à poser",
      description: "Des signaux moteur existent, mais ils restent dans le flux filtré tant qu’ils n’ont pas produit Position cible, OrderIntent et Human Gate.",
      orbitLabel: "Flux signaux",
      statusLabel: "Aucune action opérateur",
      statusDetail: `${observedCount} signal(s) non qualifié(s) visibles dans le flux d’audit.`,
      tone: "info",
      operatorActionable: false,
      warning: "Ne pas poser ces signaux : seuls les tickets publiés par le backend dans la file opérateur sont actionnables.",
    };
  }

  return {
    mode: "empty",
    eyebrow: "SURVEILLANCE",
    title: "Aucun ticket à traiter",
    description: "Le Desk surveille le marché ; aucun signal n’a franchi tous les filtres jusqu’au Human Gate.",
    orbitLabel: "Surveillance Desk",
    statusLabel: "Aucune action",
    statusDetail: "Aucun dossier qualifié publié.",
    tone: "neutral",
    operatorActionable: false,
    warning: null,
  };
}

function FocusTicket({ plan, timingLabel, ticket }: { plan: ReturnType<typeof focusTradePlan>; timingLabel: string; ticket: FocusTicketPresentation }) {
  if (ticket.mode === "observed" || ticket.mode === "empty") {
    return <div className="live-focus__ticket live-focus__ticket--incomplete" data-plan-authority="UNAVAILABLE" data-ticket-mode={ticket.mode}>
      <div className="live-focus__ticket-status" data-tone={ticket.tone}><small>État opérateur</small><strong>{ticket.statusLabel}</strong><span>{ticket.statusDetail}</span></div>
      <div className="live-focus__ticket-empty"><strong>Aucun plan d’ordre opérateur.</strong><span>Les niveaux Entrée / Stop / Objectifs apparaissent ici uniquement après publication backend d’un dossier Risk → OrderIntent → Human Gate.</span></div>
      <TicketValue label="Fenêtre" value={timingLabel} />
    </div>;
  }
  return <div className={`live-focus__ticket${ticket.operatorActionable ? "" : " live-focus__ticket--incomplete"}`} data-plan-authority={plan.authority} data-ticket-mode={ticket.mode}>
    <div className="live-focus__ticket-status" data-tone={ticket.tone}><small>État opérateur</small><strong>{ticket.statusLabel}</strong><span>{ticket.statusDetail}</span></div>
    <div className="live-focus__plan-authority"><small>Provenance</small><strong>{plan.authorityLabel}</strong></div>
    <div className="live-focus__instrument"><small>Instrument</small><strong>{plan.instrument}</strong><span>{operatorCode(plan.side)}</span></div>
    <TicketValue label="Type" value={operatorCode(plan.orderType)} />
    <TicketValue label="Quantité" value={plan.quantity} missing={plan.quantity === "Non publiée"} />
    <TicketValue label="Entrée" value={plan.entry} missing={plan.entry === "Non publiée"} />
    <TicketValue label="Stop" value={plan.stop} missing={plan.stop === "Non publié"} tone="danger" />
    {plan.targets.length ? plan.targets.map((target, index) => <TicketValue key={`${target}-${index}`} label={`Objectif ${index + 1}`} value={target} tone="success" />) : <TicketValue label="Objectif 1" value="Non publié" missing tone="success" />}
    <TicketValue label="R attendu" value={plan.expectedR} missing={plan.expectedR === "Non publié"} />
    <TicketValue label="Fenêtre" value={timingLabel} />
  </div>;
}

function TicketValue({ label, value, missing = false, tone }: { label: string; value: string; missing?: boolean; tone?: "danger" | "success" }) {
  const isMarketLevel = label === "Entrée" || label === "Stop" || label.startsWith("Objectif");
  const isDecisionValue = label === "Quantité" || label === "R attendu";
  const className = [
    isMarketLevel ? "is-market-level" : "",
    isDecisionValue ? "is-decision-value" : "",
    tone ? `is-${tone}` : "",
    missing ? "is-missing" : "",
  ].filter(Boolean).join(" ");
  return <div className={className}><small>{label}</small><strong>{missing ? "Non publié" : value}</strong></div>;
}

function FocusActionDialog({ pending, model, busy, onCancel, onSubmitGate, onSubmitManual }: {
  pending: PendingAction;
  model: LiveTradingModel;
  busy: boolean;
  onCancel(): void;
  onSubmitGate(action: HumanGateAction, reason: string): Promise<void>;
  onSubmitManual(action: LiveManualExecutionAction, input: { price?: number | null; quantity?: number | null; reason?: string }): Promise<void>;
}) {
  const row = model.selectedTheoreticalExecution;
  const [reason, setReason] = useState(pending.kind === "gate" && pending.action.action === "CONFIRM" ? "Dossier autorisé par l’opérateur en mode semi-manuel." : "");
  const [price, setPrice] = useState(row?.entry?.toString() ?? "");
  const [quantity, setQuantity] = useState(row?.quantity?.toString() ?? model.orderIntent?.quantity?.toString() ?? "");
  const action = pending.action;
  const requiresPrice = pending.kind === "manual" && pending.action.requiresPrice;
  const requiresQuantity = pending.kind === "manual" && pending.action.requiresQuantity;
  const canSubmit = !busy
    && (!action.requiresReason || reason.trim().length > 0)
    && (!requiresPrice || Number.isFinite(Number(price)))
    && (!requiresQuantity || Number(quantity) > 0);
  return <div className="live-focus-dialog__backdrop" role="presentation"><section className="live-focus-dialog" role="alertdialog" aria-modal="true" aria-labelledby="focus-dialog-title"><header><div><small>Action auditée</small><h2 id="focus-dialog-title">{operatorCopy(action.label)}</h2></div><button type="button" onClick={onCancel}>Fermer</button></header><p>{operatorCopy(action.impactPreview)}</p><dl><div><dt>Ordre proposé</dt><dd title={model.orderIntent?.portfolioOrderIntentId ?? row?.portfolioOrderIntentId ?? undefined}>{row ? `${row.instrument} · ${operatorCode(row.side)}` : "Non publié"}</dd></div><div><dt>Instrument</dt><dd>{row?.instrument ?? model.latestSignal?.symbol ?? "—"}</dd></div><div><dt>Révision</dt><dd>{action.expectedRevision}</dd></div></dl>{requiresPrice ? <label>Prix réellement obtenu<input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} autoFocus /></label> : null}{requiresQuantity ? <label>Quantité réellement exécutée<input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus={!requiresPrice} /></label> : null}<label>Motif / note<input value={reason} onChange={(event) => setReason(event.target.value)} autoFocus={!requiresPrice && !requiresQuantity} /></label><small>Cette action ne modifie jamais le plan après contrôle du risque ni le suivi théorique.</small><footer><button type="button" onClick={onCancel}>Annuler</button><button type="button" className="live-focus-dialog__confirm" disabled={!canSubmit} onClick={() => void (pending.kind === "gate" ? onSubmitGate(pending.action, reason) : onSubmitManual(pending.action, { price: price ? Number(price) : null, quantity: quantity ? Number(quantity) : null, reason }))}>{busy ? "Transmission…" : "Confirmer la déclaration"}</button></footer></section></div>;
}

function FocusHelpDialog({ profile, onChange, onClose }: { profile: LiveFocusSoundProfile; onChange(profile: LiveFocusSoundProfile): void; onClose(): void }) {
  const shortcuts = [["F", "ouvrir Focus"], ["Échap", "retour cockpit"], ["G", "afficher le graphique"], ["maintenir Entrée", "action principale"], ["R", "refuser"], ["C", "copier le ticket"], ["↑ / ↓", "changer de décision"], ["S", "stop placé"], ["?", "aide"]];
  const events: { key: LiveFocusSoundEvent; label: string }[] = [{ key: "decision", label: "Décision prenable" }, { key: "expiry", label: "Expiration imminente" }, { key: "expired", label: "Décision expirée" }, { key: "fill", label: "Exécution confirmée" }, { key: "stop", label: "Stop touché" }];
  return <div className="live-focus-dialog__backdrop" role="presentation"><section className="live-focus-dialog live-focus-help" role="dialog" aria-modal="true" aria-labelledby="focus-help-title"><header><div><small>MODE FOCUS</small><h2 id="focus-help-title">Raccourcis et perception</h2></div><button type="button" onClick={onClose} autoFocus>Fermer</button></header><div className="live-focus-help__shortcuts">{shortcuts.map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}</div><div className="live-focus-help__sound"><button type="button" aria-pressed={profile.enabled} onClick={() => onChange({ ...profile, enabled: !profile.enabled })}>Sons globaux · {profile.enabled ? "Activés" : "Désactivés"}</button><button type="button" aria-pressed={profile.doNotDisturb} onClick={() => onChange({ ...profile, doNotDisturb: !profile.doNotDisturb })}>Ne pas déranger · {profile.doNotDisturb ? "Activé" : "Désactivé"}</button>{events.map((event) => <button key={event.key} type="button" aria-pressed={profile.events[event.key]} onClick={() => onChange({ ...profile, events: { ...profile.events, [event.key]: !profile.events[event.key] } })}>{event.label} · {profile.events[event.key] ? "Activé" : "Désactivé"}</button>)}</div><small>Le mode « ne pas déranger » laisse toujours passer l’expiration imminente et le stop touché.</small></section></div>;
}

function QuestionNumber({ value }: { value: string }) { return <span className="live-focus__question" aria-hidden="true">{value}</span>; }
function formatEtClock(date: Date) { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date); }
function useFocusPerception({ model, stateCode, stateLabel, timingLabel, timingUrgency, soundProfile }: { model: LiveTradingModel; stateCode: string; stateLabel: string; timingLabel: string; timingUrgency: string; soundProfile: LiveFocusSoundProfile }) {
  const originalTitle = useRef<string | null>(null);
  const originalFavicon = useRef<string | null>(null);
  const previousState = useRef<string | null>(null);
  const remindedExpiry = useRef<string | null>(null);
  const instrument = model.selectedTheoreticalExecution?.instrument ?? model.latestSignal?.symbol ?? "Desk";
  const direction = model.selectedTheoreticalExecution?.side ?? model.latestSignal?.direction ?? "";
  const directionLabel = operatorCode(direction, "");
  const liveR = model.selectedTheoreticalExecution?.liveMark?.currentR;
  const resultR = model.selectedTheoreticalExecution?.resultR;

  useEffect(() => {
    originalTitle.current = document.title;
    originalFavicon.current = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? null;
    return () => {
      if (originalTitle.current) document.title = originalTitle.current;
      const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
      if (favicon && originalFavicon.current) favicon.href = originalFavicon.current;
    };
  }, []);
  useEffect(() => {
    const value = stateCode === "C" ? `● ${instrument} ${directionLabel} — ${timingLabel}`
      : stateCode === "E" ? `◆ ${instrument}${liveR === null || liveR === undefined ? "" : ` ${signedR(liveR)}`}`
        : stateCode === "F" ? `⊘ ${instrument}${resultR === null || resultR === undefined ? "" : ` ${signedR(resultR)}`}`
          : `${stateLabel} · ${instrument}`;
    document.title = `${value} · Focus Desk`;
    setFocusFavicon(stateCode);
  }, [directionLabel, instrument, liveR, resultR, stateCode, stateLabel, timingLabel]);
  useEffect(() => {
    if (previousState.current !== stateCode) {
      const event = focusSoundEvent(stateCode, model.selectedTheoreticalExecution?.status ?? null);
      if (event && focusSoundAllowed(soundProfile, event)) playFocusTone(event === "stop" ? 190 : event === "expired" ? 220 : event === "fill" ? 620 : 440);
      if (document.hidden && ["C", "F"].includes(stateCode)) sendFocusNotification(stateCode === "C" ? "Décision prenable" : "Décision terminée", `${instrument} ${direction}`);
      previousState.current = stateCode;
    }
  }, [direction, instrument, model.selectedTheoreticalExecution?.status, soundProfile, stateCode]);
  useEffect(() => {
    const expiryId = model.orderIntent?.allowedActions.expiresAt ?? null;
    if (stateCode !== "C" || timingUrgency !== "urgent" || !expiryId || remindedExpiry.current === expiryId) return;
    remindedExpiry.current = expiryId;
    if (focusSoundAllowed(soundProfile, "expiry")) playFocusTone(330);
    if (document.hidden) sendFocusNotification("Décision bientôt expirée", `${instrument} · ${timingLabel}`);
  }, [instrument, model.orderIntent?.allowedActions.expiresAt, soundProfile, stateCode, timingLabel, timingUrgency]);
}
function focusSoundEvent(stateCode: string, theoreticalStatus: string | null): LiveFocusSoundEvent | null {
  if (stateCode === "C") return "decision";
  if (stateCode === "E") return "fill";
  if (stateCode !== "F") return null;
  const status = String(theoreticalStatus ?? "").toUpperCase();
  if (status === "STOP_HIT") return "stop";
  return status.includes("EXPIRED") ? "expired" : null;
}
function focusSoundAllowed(profile: LiveFocusSoundProfile, event: LiveFocusSoundEvent): boolean {
  if (!profile.enabled || !profile.events[event]) return false;
  return !profile.doNotDisturb || event === "expiry" || event === "stop";
}
function signedR(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(2)} R`; }
function formatOperatorParagraph(value: unknown) {
  return operatorCopy(valueText(value, ""), "").replace(/-?0?\.\d{5,}/g, (rawValue) => {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue) || Math.abs(numericValue) >= 1) return rawValue;
    return `${(numericValue * 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  });
}
function focusTimeframeLabel(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/^M/, "");
  if (!normalized) return "unité non publiée";
  if (["H1", "1H", "60"].includes(normalized)) return "H1";
  if (["H4", "4H", "240"].includes(normalized)) return "H4";
  if (["D", "D1", "1D", "1440"].includes(normalized)) return "D1";
  return `M${normalized}`;
}
function setFocusFavicon(stateCode: string) {
  const color = stateCode === "C" || stateCode === "D" ? "#f1b84b" : stateCode === "E" ? "#4dd59c" : stateCode === "F" ? "#ff6c79" : "#41d7e5";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#05131c"/><circle cx="32" cy="32" r="18" fill="none" stroke="${color}" stroke-width="6"/><circle cx="32" cy="32" r="6" fill="${color}"/></svg>`;
  const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ?? document.createElement("link");
  favicon.rel = "icon";
  favicon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  if (!favicon.parentNode) document.head.appendChild(favicon);
}
function playFocusTone(frequency: number) {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.08, context.currentTime + .02);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .2);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch { /* Browser audio policy can legitimately block non-essential sound. */ }
}
function sendFocusNotification(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  new Notification(title, { body, tag: "desk-live-focus" });
}
function focusClipboardText(model: LiveTradingModel): string {
  const plan = focusTradePlan(model);
  return [
    `${plan.instrument} ${operatorCode(plan.side)}`,
    `Provenance : ${plan.authorityLabel}`,
    `Type : ${operatorCode(plan.orderType)}`,
    `Quantité : ${plan.quantity}`,
    `Entrée : ${plan.entry}`,
    `Stop : ${plan.stop}`,
    ...plan.targets.map((target, index) => `Objectif ${index + 1} : ${target}`),
    `R attendu : ${plan.expectedR}`,
  ].join("\n");
}
