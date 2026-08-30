import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaCheck, FaClipboard, FaExclamationTriangle, FaLock, FaQuestionCircle, FaRegCircle, FaTimes, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import type { LiveManualExecutionAction } from "@/domains/front-api/viewModels";
import { presentExecutionMode, presentGeneric } from "@/design-system/labels";
import { operatorCode, operatorCopy, operatorReason } from "@/design-system/operatorVocabulary";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import type { HumanGateAction } from "@/features/order-intent/model";
import { displayTime, displayValue } from "./mapper";
import { focusDecisionQueue, resolveLiveFocusState } from "./focusModel";
import { readLiveFocusSoundProfile, writeLiveFocusSoundProfile, type LiveFocusSoundEvent, type LiveFocusSoundProfile } from "./focusPreferences";
import { focusTradePlan } from "./focusTradePlan";
import { gateTiming } from "./LiveHumanGate";
import type { LiveTradingModel } from "./model";
import "./live-focus.css";

type PendingAction =
  | { kind: "gate"; action: HumanGateAction }
  | { kind: "manual"; action: LiveManualExecutionAction };

export function LiveFocusMode({ model, busy, error, onExit, onSelectDecision, onSubmitGate, onSubmitManual }: {
  model: LiveTradingModel;
  busy: boolean;
  error: string | null;
  onExit(): void;
  onSelectDecision(signalId: string): void;
  onSubmitGate(action: HumanGateAction, reason: string): Promise<void>;
  onSubmitManual(action: LiveManualExecutionAction, input: { price?: number | null; quantity?: number | null; reason?: string }): Promise<void>;
}) {
  const realtime = useContext(RealtimeContext);
  const state = resolveLiveFocusState(model);
  const queue = useMemo(() => focusDecisionQueue(model.source.portfolioOrderIntents), [model.source.portfolioOrderIntents]);
  const selectedIndex = Math.max(0, queue.findIndex((item) => item.signalId === model.latestSignal?.signalId));
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [soundProfile, setSoundProfile] = useState(readLiveFocusSoundProfile);
  const holdTimer = useRef<number | null>(null);
  const gateConfirm = model.gateActions.find((action) => action.action === "CONFIRM" && action.permission === "ALLOWED");
  const gateReject = model.gateActions.find((action) => action.action === "REJECT" && action.permission === "ALLOWED");
  const manualActions = model.selectedTheoreticalExecution?.manualExecution?.allowedActions ?? [];
  const primaryManual = manualActions.find((action) => ["REPORT_PLACED", "REPORT_FILLED", "REPORT_CLOSED"].includes(action.action) && action.permission === "ALLOWED");
  const skipManual = manualActions.find((action) => action.action === "REPORT_SKIPPED" && action.permission === "ALLOWED");
  const stopManual = manualActions.find((action) => action.action === "REPORT_STOP_PLACED" && action.permission === "ALLOWED");
  const primary = gateConfirm ? ({ kind: "gate", action: gateConfirm } as const) : primaryManual ? ({ kind: "manual", action: primaryManual } as const) : null;
  const plan = focusTradePlan(model);
  const timing = gateTiming(
    model.orderIntent?.createdAt ?? model.latestSignal?.createdAt ?? null,
    model.orderIntent?.allowedActions.expiresAt ?? model.latestSignal?.expiresAt ?? null,
    realtime?.now ?? new Date(),
  );
  useFocusPerception({ model, stateCode: state.code, stateLabel: state.label, timingLabel: timing.label, timingUrgency: timing.urgency, soundProfile });

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
        else onExit();
        return;
      }
      if (pending || showHelp) return;
      if (event.key === "?") { event.preventDefault(); setShowHelp((value) => !value); }
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
  }, [copyPlan, gateReject, onExit, pending, primary, request, selectRelative, showHelp, stopManual]);

  return (
    <div className={`live-focus live-focus--${state.code.toLowerCase()} lt-tone--${state.tone}`} data-testid="live-focus-mode" data-focus-state={state.code}>
      <header className="live-focus__header">
        <div className="live-focus__identity"><span className="live-focus__mark" aria-hidden="true">◆</span><div><small>DESK LIVE · MODE FOCUS</small><strong>{state.label}</strong></div></div>
        <div className="live-focus__policy"><span>{operatorCode(model.mode.environment)}</span><span>{presentExecutionMode(model.mode.executionMode).label}</span><span>Exécution automatique {model.mode.autoExecutionEnabled ? "active" : "désactivée"}</span></div>
        {state.code === "C" ? <div className="live-focus__countdown" data-urgency={timing.urgency} aria-label={`Temps restant ${timing.label}`}><strong>⏱ {timing.label}</strong><span aria-hidden="true"><i style={{ width: `${timing.remainingPct}%` }} /></span></div> : null}
        <time dateTime={realtime?.now?.toISOString()}><strong>{realtime?.now ? formatEtClock(realtime.now) : "—"}</strong><small>NEW YORK</small></time>
        <button type="button" className="live-focus__return" onClick={onExit}><FaArrowLeft aria-hidden="true" />Retour cockpit <kbd>Esc</kbd></button>
      </header>

      <main className="live-focus__body">
        <section className="live-focus__brief" aria-labelledby="live-focus-brief-title">
          <QuestionNumber value="01" />
          <div className="live-focus__section-copy"><p className="eyebrow">QUE SE PASSE-T-IL ?</p><h1 id="live-focus-brief-title">Brief opérationnel</h1></div>
          <FocusBrief model={model} />
        </section>

        <section className="live-focus__situation" aria-labelledby="live-focus-situation-title">
          <QuestionNumber value="02" />
          <div className="live-focus__section-copy"><p className="eyebrow">OÙ EN SUIS-JE ?</p><h2 id="live-focus-situation-title">{state.headline}</h2><p>{state.instruction}</p></div>
          <div className="live-focus__state-orbit" aria-label={`État Focus ${state.code} ${state.label}`}><span>{state.code}</span><strong>{state.label}</strong><small>{model.latestSignal ? `${model.latestSignal.symbol} · ${model.latestSignal.direction}` : "SURVEILLANCE DESK"}</small></div>
          {state.code === "B" ? <FocusPipeline model={model} /> : <FocusPosition model={model} />}
        </section>

        <section className="live-focus__action" aria-labelledby="live-focus-action-title">
          <QuestionNumber value="03" />
          <div className="live-focus__section-copy"><p className="eyebrow">QUE DOIS-JE FAIRE ?</p><h2 id="live-focus-action-title">Ticket d’action</h2></div>
          <FocusTicket plan={plan} timingLabel={timing.label} />
          <div className="live-focus__actions" aria-label="Actions autorisées par le backend">
            {primary && plan.actionable ? <button type="button" className="live-focus__primary-action" disabled={busy} onClick={() => request(primary)}><FaCheck aria-hidden="true" />{operatorCopy(primary.action.label)}<kbd>maintenir Entrée</kbd></button> : null}
            {gateReject ? <button type="button" disabled={busy} onClick={() => request({ kind: "gate", action: gateReject })}><FaTimes aria-hidden="true" />Refuser<kbd>R</kbd></button> : null}
            {skipManual ? <button type="button" disabled={busy} onClick={() => request({ kind: "manual", action: skipManual })}><FaRegCircle aria-hidden="true" />Non exécuté</button> : null}
            {stopManual ? <button type="button" disabled={busy} onClick={() => request({ kind: "manual", action: stopManual })}><FaLock aria-hidden="true" />Stop placé<kbd>S</kbd></button> : null}
            <button type="button" onClick={() => void copyPlan()}><FaClipboard aria-hidden="true" />{copied ? "Copié" : "Copier le plan"}<kbd>C</kbd></button>
          </div>
          {!plan.actionable && (model.orderIntent || model.latestSignal) ? <p className="live-focus__integrity-warning" role="alert"><FaExclamationTriangle aria-hidden="true" />Les niveaux proposés sont informatifs. Aucune déclaration d’ordre n’est possible avant publication du plan autorisé et de sa quantité.</p> : null}
          {!primary && !gateReject && !skipManual ? <p className="live-focus__locked"><FaLock aria-hidden="true" />{model.gateBlockedReason}</p> : null}
          {error ? <p className="live-focus__error" role="alert">La commande a échoué. Le Focus a rechargé la vérité backend et n’a créé aucun état local de remplacement.</p> : null}
        </section>

        {queue.length > 1 ? <nav className="live-focus__queue" aria-label="Décisions concurrentes"><span>{selectedIndex + 1}/{queue.length}</span>{queue.map((intent, index) => <button key={intent.portfolioOrderIntentId} type="button" aria-current={index === selectedIndex ? "true" : undefined} onClick={() => intent.signalId && onSelectDecision(intent.signalId)}><strong>{intent.symbol}</strong><small>{presentGeneric(intent.side).label} · {presentBackendStatus(intent.humanGate.status).label}</small></button>)}</nav> : null}
      </main>
      <footer className="live-focus__footer"><span><kbd>↑</kbd><kbd>↓</kbd> décisions</span><span><kbd>C</kbd> copier</span><span><kbd>R</kbd> refuser</span><span><kbd>S</kbd> stop placé</span><button type="button" className="live-focus__sound" aria-pressed={soundProfile.enabled} onClick={() => { const next = writeLiveFocusSoundProfile({ ...soundProfile, enabled: !soundProfile.enabled }); setSoundProfile(next); }}>{soundProfile.enabled ? <FaVolumeUp aria-hidden="true" /> : <FaVolumeMute aria-hidden="true" />}{soundProfile.enabled ? "Sons actifs" : "Sons coupés"}</button><button type="button" className="live-focus__help-trigger" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}><FaQuestionCircle aria-hidden="true" />Raccourcis <kbd>?</kbd></button><span className="live-focus__session">Séance {model.signalFunnel.rawSignals} signaux · {model.signalFunnel.orderIntents} ordres proposés · {model.signalFunnel.pendingHumanGates} à décider · {model.signalFunnel.theoreticalTracked} suivis · {model.signalFunnel.totalClosedR === null ? "R non publié" : `${model.signalFunnel.totalClosedR >= 0 ? "+" : ""}${model.signalFunnel.totalClosedR.toFixed(2)} R`}</span><small>Sources {model.meta.sources?.filter((item) => item.state === "AVAILABLE").length ?? 0} · arrêté à {displayTime(model.meta.asOf)}</small></footer>
      {pending ? <FocusActionDialog pending={pending} model={model} busy={busy} onCancel={() => setPending(null)} onSubmitGate={async (action, reason) => { await onSubmitGate(action, reason); setPending(null); }} onSubmitManual={async (action, input) => { await onSubmitManual(action, input); setPending(null); }} /> : null}
      {showHelp ? <FocusHelpDialog profile={soundProfile} onChange={(next) => { setSoundProfile(writeLiveFocusSoundProfile(next)); }} onClose={() => setShowHelp(false)} /> : null}
    </div>
  );
}

function FocusBrief({ model }: { model: LiveTradingModel }) {
  const advisory = model.source.aiAdvisory;
  const summary = operatorCopy(advisory?.summary, "");
  const context = summary || `Le marché présente une orientation ${operatorCode(model.marketIntelligence.bias).toLowerCase()} dans un régime ${operatorCode(model.marketIntelligence.regime).toLowerCase()}.`;
  const preferred = model.marketIntelligence.preferredFamilies.map((family) => operatorCopy(family));
  const vigilance = model.marketIntelligence.reasonCodes.map((reason) => operatorReason(reason));
  return <div className="live-focus__brief-grid">
    <article><small>Contexte</small><p>{context}</p></article>
    <article><small>Ce que le desk recherche</small><p>{preferred.length ? `Le desk privilégie ${preferred.join(", ").toLowerCase()}.` : "Aucune famille de stratégie n’est privilégiée dans l’état publié."}</p></article>
    <article><small>Points de vigilance</small><p>{vigilance.length ? `${vigilance.join(". ")}.` : "Aucun point de vigilance supplémentaire n’est publié."}</p></article>
    <small className="live-focus__brief-source">Avis {operatorCode(advisory?.mode ?? "OFF")} · consultatif · arrêté à {displayTime(advisory?.lastContextAt || model.meta.asOf)}</small>
  </div>;
}

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

function FocusPipeline({ model }: { model: LiveTradingModel }) {
  const stages = [
    { label: "Le desk a repéré quelque chose", published: Boolean(model.latestSignal), result: model.latestSignal ? `${presentGeneric(model.latestSignal.direction).label} · confiance ${model.latestSignal.confidence === null ? "non publiée" : `${Math.round(model.latestSignal.confidence)} %`}` : null },
    { label: "Le contexte est-il favorable ?", published: Boolean(model.latestContextDecision), result: model.latestContextDecision ? `${operatorCode(model.latestContextDecision.status)} · ${operatorCode(model.latestContextDecision.recommendation)}` : null },
    { label: "Est-ce compatible avec vos positions ?", published: Boolean(model.riskCheck), result: model.riskCheck ? operatorCode(model.riskCheck.status) : null },
    { label: "Quel ordre exactement ?", published: Boolean(model.orderIntent), result: model.orderIntent ? `${presentGeneric(model.orderIntent.side).label} · quantité ${model.orderIntent.quantity}` : null },
    { label: "À vous de valider", published: Boolean(model.orderIntent?.humanGate), result: model.orderIntent?.humanGate ? presentBackendStatus(model.orderIntent.humanGate.status).label : null },
  ];
  const firstUnpublished = stages.findIndex((stage) => !stage.published);
  return <ol className="live-focus__pipeline" aria-label="Progression publiée de la décision">
    {stages.map((stage, index) => {
      const status = stage.published ? "published" : index === firstUnpublished ? "awaiting-publication" : "waiting";
      return <li key={stage.label} data-status={status}><span aria-hidden="true">{stage.published ? "✓" : index === firstUnpublished ? "◐" : "○"}</span><div><strong>{stage.label}</strong><small>{stage.result ?? (index === firstUnpublished ? "Pas encore évalué" : "Bloqué en amont")}</small></div></li>;
    })}
  </ol>;
}

function FocusTicket({ plan, timingLabel }: { plan: ReturnType<typeof focusTradePlan>; timingLabel: string }) {
  return <div className={`live-focus__ticket${plan.actionable ? "" : " live-focus__ticket--incomplete"}`} data-plan-authority={plan.authority}>
    <div className="live-focus__plan-authority"><small>Provenance</small><strong>{plan.authorityLabel}</strong></div>
    <div className="live-focus__instrument"><small>Instrument</small><strong>{plan.instrument}</strong><span>{presentGeneric(plan.side).label}</span></div>
    <TicketValue label="Type" value={plan.orderType} />
    <TicketValue label="Quantité" value={plan.quantity} missing={plan.quantity === "Non publiée"} />
    <TicketValue label="Entrée" value={plan.entry} missing={plan.entry === "Non publiée"} />
    <TicketValue label="Stop" value={plan.stop} missing={plan.stop === "Non publié"} tone="danger" />
    {plan.targets.length ? plan.targets.map((target, index) => <TicketValue key={`${target}-${index}`} label={`Objectif ${index + 1}`} value={target} tone="success" />) : <TicketValue label="Objectif 1" value="Non publié" missing tone="success" />}
    <TicketValue label="R attendu" value={plan.expectedR} missing={plan.expectedR === "Non publié"} />
    <TicketValue label="Fenêtre" value={timingLabel} />
  </div>;
}

function TicketValue({ label, value, missing = false, tone }: { label: string; value: string; missing?: boolean; tone?: "danger" | "success" }) {
  return <div className={`${tone ? `is-${tone}` : ""}${missing ? " is-missing" : ""}`}><small>{label}</small><strong>{missing ? "Non publié" : value}</strong></div>;
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
  return <div className="live-focus-dialog__backdrop" role="presentation"><section className="live-focus-dialog" role="alertdialog" aria-modal="true" aria-labelledby="focus-dialog-title"><header><div><small>Action auditée</small><h2 id="focus-dialog-title">{operatorCopy(action.label)}</h2></div><button type="button" onClick={onCancel}>Fermer</button></header><p>{operatorCopy(action.impactPreview)}</p><dl><div><dt>Ordre proposé</dt><dd title={model.orderIntent?.portfolioOrderIntentId ?? row?.portfolioOrderIntentId ?? undefined}>{row ? `${row.instrument} · ${presentGeneric(row.side).label}` : "Non publié"}</dd></div><div><dt>Instrument</dt><dd>{row?.instrument ?? model.latestSignal?.symbol ?? "—"}</dd></div><div><dt>Révision</dt><dd>{action.expectedRevision}</dd></div></dl>{requiresPrice ? <label>Prix réellement obtenu<input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} autoFocus /></label> : null}{requiresQuantity ? <label>Quantité réellement exécutée<input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus={!requiresPrice} /></label> : null}<label>Motif / note<input value={reason} onChange={(event) => setReason(event.target.value)} autoFocus={!requiresPrice && !requiresQuantity} /></label><small>Cette action ne modifie jamais le plan après contrôle du risque ni le suivi théorique.</small><footer><button type="button" onClick={onCancel}>Annuler</button><button type="button" className="live-focus-dialog__confirm" disabled={!canSubmit} onClick={() => void (pending.kind === "gate" ? onSubmitGate(pending.action, reason) : onSubmitManual(pending.action, { price: price ? Number(price) : null, quantity: quantity ? Number(quantity) : null, reason }))}>{busy ? "Transmission…" : "Confirmer la déclaration"}</button></footer></section></div>;
}

function FocusHelpDialog({ profile, onChange, onClose }: { profile: LiveFocusSoundProfile; onChange(profile: LiveFocusSoundProfile): void; onClose(): void }) {
  const shortcuts = [["F", "ouvrir Focus"], ["Échap", "retour cockpit"], ["maintenir Entrée", "action principale"], ["R", "refuser"], ["C", "copier le ticket"], ["↑ / ↓", "changer de décision"], ["S", "stop placé"], ["?", "aide"]];
  const events: { key: LiveFocusSoundEvent; label: string }[] = [{ key: "decision", label: "Décision prenable" }, { key: "expiry", label: "Expiration imminente" }, { key: "expired", label: "Décision expirée" }, { key: "fill", label: "Fill confirmé" }, { key: "stop", label: "Stop touché" }];
  return <div className="live-focus-dialog__backdrop" role="presentation"><section className="live-focus-dialog live-focus-help" role="dialog" aria-modal="true" aria-labelledby="focus-help-title"><header><div><small>MODE FOCUS</small><h2 id="focus-help-title">Raccourcis et perception</h2></div><button type="button" onClick={onClose} autoFocus>Fermer</button></header><div className="live-focus-help__shortcuts">{shortcuts.map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}</div><div className="live-focus-help__sound"><button type="button" aria-pressed={profile.enabled} onClick={() => onChange({ ...profile, enabled: !profile.enabled })}>Sons globaux · {profile.enabled ? "ON" : "OFF"}</button><button type="button" aria-pressed={profile.doNotDisturb} onClick={() => onChange({ ...profile, doNotDisturb: !profile.doNotDisturb })}>Ne pas déranger · {profile.doNotDisturb ? "ON" : "OFF"}</button>{events.map((event) => <button key={event.key} type="button" aria-pressed={profile.events[event.key]} onClick={() => onChange({ ...profile, events: { ...profile.events, [event.key]: !profile.events[event.key] } })}>{event.label} · {profile.events[event.key] ? "ON" : "OFF"}</button>)}</div><small>Le mode « ne pas déranger » laisse toujours passer l’expiration imminente et le stop touché.</small></section></div>;
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
    const value = stateCode === "C" ? `● ${instrument} ${direction} — ${timingLabel}`
      : stateCode === "E" ? `◆ ${instrument}${liveR === null || liveR === undefined ? "" : ` ${signedR(liveR)}`}`
        : stateCode === "F" ? `⊘ ${instrument}${resultR === null || resultR === undefined ? "" : ` ${signedR(resultR)}`}`
          : `${stateLabel} · ${instrument}`;
    document.title = `${value} · Desk Focus`;
    setFocusFavicon(stateCode);
  }, [direction, instrument, liveR, resultR, stateCode, stateLabel, timingLabel]);
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
    `${plan.instrument} ${presentGeneric(plan.side).label}`,
    `Provenance : ${plan.authorityLabel}`,
    `Type : ${plan.orderType}`,
    `Quantité : ${plan.quantity}`,
    `Entrée : ${plan.entry}`,
    `Stop : ${plan.stop}`,
    ...plan.targets.map((target, index) => `Objectif ${index + 1} : ${target}`),
    `R attendu : ${plan.expectedR}`,
  ].join("\n");
}
