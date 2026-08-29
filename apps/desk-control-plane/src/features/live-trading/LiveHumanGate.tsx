import { useCallback, useContext, useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { FaCheck, FaHourglassHalf, FaLock, FaTimes, FaUndo } from "react-icons/fa";
import type { CommandAccepted, CommandStatus } from "@/domains/realtime/commandRuntime";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { TrackedCommandReceipt } from "@/design-system/actions";
import { presentAvailability } from "@/design-system/labels";
import type { HumanGateAction } from "@/features/order-intent/model";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { displayTime } from "./mapper";
import { LivePanel } from "./LiveTradingPanels";
import type { LiveTradingModel } from "./model";

const REJECT_REASONS = [
  "Prix hors zone",
  "Contexte de marché modifié",
  "Risque opérateur trop élevé",
  "Conflit avec une position",
  "Ordre non passé à temps",
] as const;

export function LiveHumanGate({ model, onSubmit, submittingActionId, command, commandStatus, error, embedded = false }: {
  model: LiveTradingModel;
  onSubmit(action: HumanGateAction, reason: string): Promise<void>;
  submittingActionId: string | null;
  command: CommandAccepted | null;
  commandStatus?: CommandStatus | null;
  error: string | null;
  embedded?: boolean;
}) {
  const realtime = useContext(RealtimeContext);
  const [pending, setPending] = useState<HumanGateAction | null>(null);
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const confirm = model.gateActions.find((action) => action.action === "CONFIRM");
  const reject = model.gateActions.find((action) => action.action === "REJECT");
  const undo = model.gateActions.find((action) => action.action === "UNDO");
  const resolvedCommandStatus = commandStatus ?? command?.status ?? null;
  const actionsLocked = Boolean(submittingActionId) || commandLocksGateActions(resolvedCommandStatus);
  const status = liveHumanGateStatus(model);
  const statusLabel = status === "CONNECTED_EMPTY" ? presentAvailability(status).label : presentBackendStatus(status).label;
  const timing = gateTiming(model.orderIntent?.createdAt ?? null, model.orderIntent?.allowedActions.expiresAt ?? null, realtime?.now ?? new Date());
  const manualDeclaration = model.mode.executionMode === "SEMI_MANUAL" && !model.mode.physicalExecutionEnabled;

  const request = useCallback((action: HumanGateAction | undefined) => {
    if (!action || action.permission !== "ALLOWED" || actionsLocked) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReason(action.action === "CONFIRM" ? "Ordre passé manuellement par l’opérateur." : "");
    setPending(action);
  }, [actionsLocked]);
  const submit = async () => {
    if (!pending || actionsLocked || (pending.requiresReason && !reason.trim())) return;
    await onSubmit(pending, reason);
    setPending(null);
    setReason("");
  };

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']") || pending) return;
      if (event.key.toLowerCase() === "g" && confirm?.permission === "ALLOWED") { event.preventDefault(); request(confirm); }
      if (event.key.toLowerCase() === "r" && reject?.permission === "ALLOWED") { event.preventDefault(); request(reject); }
    };
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, [confirm, pending, reject, request]);

  useEffect(() => {
    if (!pending || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPending(null); return; }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); returnFocusRef.current?.focus(); returnFocusRef.current = null; };
  }, [pending]);

  return (
    <LivePanel title="Human Gate d'exécution" className={`lt-panel--gate${embedded ? " lt-panel--embedded" : ""}`} expandable={!embedded}>
      <div className="lt-gate-status"><FaHourglassHalf aria-hidden="true" /><strong className="lt-gate-status__badge">{statusLabel}</strong><span>{model.orderIntent ? "Une déclaration opérateur est requise ; elle ne constitue jamais une preuve de fill broker." : model.gateBlockedReason}</span></div>
      {model.orderIntent ? <GateCountdown timing={timing} requestedAt={model.orderIntent.createdAt ?? null} expiresAt={model.orderIntent.allowedActions.expiresAt} /> : null}
      <div className="lt-gate-actions" aria-label="Actions Human Gate publiées par le backend">
        <button type="button" className="lt-gate-confirm" disabled={!confirm || confirm.permission !== "ALLOWED" || actionsLocked || timing.expired} onClick={() => request(confirm)}><FaCheck aria-hidden="true" />{manualDeclaration ? "J’ai passé l’ordre" : "Confirmer le dossier"}<kbd>G</kbd></button>
        <button type="button" className="lt-gate-reject" disabled={!reject || reject.permission !== "ALLOWED" || actionsLocked || timing.expired} onClick={() => request(reject)}><FaTimes aria-hidden="true" />Rejeter<kbd>R</kbd></button>
        {undo ? <button type="button" className="lt-gate-undo" disabled={undo.permission !== "ALLOWED" || actionsLocked} onClick={() => request(undo)}><FaUndo aria-hidden="true" />Annuler la décision</button> : null}
      </div>
      <Link className="lt-gate-audit-link" to="/events">Voir l'audit</Link>
      <p className="lt-gate-helper"><FaLock aria-hidden="true" />{gateHelper(model, resolvedCommandStatus, actionsLocked)}</p>
      <TrackedCommandReceipt command={command} />
      {resolvedCommandStatus ? <p className="lt-gate-transition" role="status" aria-live="polite">Commande opérateur : {presentBackendStatus(resolvedCommandStatus).label}. La projection sera rechargée après confirmation backend.</p> : null}
      {error ? <p className="lt-gate-error" role="alert">La commande n’a pas abouti. Vérifiez l’état du dossier et réessayez uniquement si le backend republie l’action.</p> : null}
      {pending ? <GateDecisionDialog action={pending} intent={model.orderIntent} reason={reason} dialogRef={dialogRef} actionsLocked={actionsLocked} onReasonChange={setReason} onCancel={() => setPending(null)} onSubmit={() => void submit()} /> : null}
    </LivePanel>
  );
}

function GateCountdown({ timing, requestedAt, expiresAt }: { timing: GateTiming; requestedAt: string | null; expiresAt: string | null }) {
  return <section className={`lt-gate-countdown lt-gate-countdown--${timing.urgency}`} aria-label="Fenêtre de décision"><div><small>{timing.expired ? "Fenêtre terminée" : "Temps de décision restant"}</small><strong>{timing.label}</strong><span>Demandé {displayTime(requestedAt)} · échéance {displayTime(expiresAt)}</span></div><progress max={100} value={timing.remainingPct} aria-label={`${timing.remainingPct} % de la fenêtre disponible`} /></section>;
}

function GateDecisionDialog({ action, intent, reason, dialogRef, actionsLocked, onReasonChange, onCancel, onSubmit }: {
  action: HumanGateAction;
  intent: LiveTradingModel["orderIntent"];
  reason: string;
  dialogRef: RefObject<HTMLDivElement>;
  actionsLocked: boolean;
  onReasonChange(value: string): void;
  onCancel(): void;
  onSubmit(): void;
}) {
  return <div ref={dialogRef} className="lt-gate-dialog" role="alertdialog" aria-modal="true" aria-labelledby="lt-gate-dialog-title"><strong id="lt-gate-dialog-title">{action.action === "CONFIRM" ? "Déclarer l’ordre passé" : action.label}</strong><p>{action.impactPreview}</p><dl><div><dt>OrderIntent</dt><dd>{intent?.portfolioOrderIntentId}</dd></div><div><dt>Instrument</dt><dd>{orderIntentInstrument(intent)}</dd></div><div><dt>Quantité</dt><dd>{intent?.quantity}</dd></div><div><dt>Environnement</dt><dd>{action.environment}</dd></div></dl>{action.action === "REJECT" ? <div className="lt-gate-reason-presets" aria-label="Motifs de rejet fréquents">{REJECT_REASONS.map((item) => <button key={item} type="button" aria-pressed={reason === item} onClick={() => onReasonChange(item)}>{item}</button>)}</div> : null}<label>Motif opérateur<input value={reason} onChange={(event) => onReasonChange(event.target.value)} autoFocus /></label><small>Révision attendue : {action.expectedRevision}. Cette action ne prouve ni ACK ni FILL.</small><div className="lt-gate-dialog__footer"><button type="button" onClick={onCancel}>Annuler</button><DeliberateActionSlider disabled={actionsLocked || (action.requiresReason && !reason.trim())} label={action.action === "REJECT" ? "Glisser pour rejeter" : "Glisser pour déclarer"} onComplete={onSubmit} /></div></div>;
}

function DeliberateActionSlider({ disabled, label, onComplete }: { disabled: boolean; label: string; onComplete(): void }) {
  const [value, setValue] = useState(0);
  return <label className="lt-gate-slider"><span>{label}</span><input type="range" min="0" max="100" value={value} disabled={disabled} aria-label={label} onChange={(event) => { const next = Number(event.target.value); setValue(next); if (next >= 100) { onComplete(); setValue(0); } }} /></label>;
}

export type GateTiming = { label: string; urgency: "comfortable" | "attention" | "urgent" | "expired"; remainingPct: number; expired: boolean };

export function gateTiming(createdAt: string | null, expiresAt: string | null, now: Date): GateTiming {
  const start = Date.parse(createdAt ?? "");
  const end = Date.parse(expiresAt ?? "");
  if (!Number.isFinite(end)) return { label: "Échéance non publiée", urgency: "attention", remainingPct: 0, expired: false };
  const remainingSeconds = Math.max(0, Math.floor((end - now.getTime()) / 1000));
  const durationSeconds = Number.isFinite(start) && end > start ? Math.floor((end - start) / 1000) : null;
  const remainingPct = durationSeconds ? Math.max(0, Math.min(100, Math.round((remainingSeconds / durationSeconds) * 100))) : 0;
  if (remainingSeconds <= 0) return { label: "Expiré", urgency: "expired", remainingPct: 0, expired: true };
  const label = remainingSeconds < 60 ? `${remainingSeconds} s` : `${Math.floor(remainingSeconds / 60)} min ${remainingSeconds % 60} s`;
  const urgency = remainingSeconds <= 120 ? "urgent" : remainingSeconds <= 600 ? "attention" : "comfortable";
  return { label, urgency, remainingPct, expired: false };
}

export type GateCommandBinding = { orderIntentId: string; actionId: string; expectedRevision: string; receipt: CommandAccepted };

export function commandForCurrentGate(binding: GateCommandBinding | null, orderIntentId: string | null, actions: readonly HumanGateAction[]): CommandAccepted | null {
  if (!binding || !orderIntentId || binding.orderIntentId !== orderIntentId) return null;
  if (!actions.length) return binding.receipt;
  return actions.some((action) => action.actionId === binding.actionId && action.expectedRevision === binding.expectedRevision) ? binding.receipt : null;
}

const RETRYABLE_COMMAND_FAILURES = new Set(["FAILED", "CONFLICT", "REJECTED", "CANCELLED", "TIMED_OUT"]);
export function commandLocksGateActions(status: string | null): boolean { return Boolean(status) && !RETRYABLE_COMMAND_FAILURES.has(status as string); }
export function liveHumanGateStatus(model: LiveTradingModel): string { return model.orderIntent?.humanGate.status ?? "CONNECTED_EMPTY"; }

function gateHelper(model: LiveTradingModel, status: string | null, actionsLocked: boolean): string {
  if (actionsLocked) return "Commande déjà transmise : les actions restent verrouillées jusqu’à une réponse terminale du backend.";
  if (status && RETRYABLE_COMMAND_FAILURES.has(status)) return "Le backend autorisera un nouvel essai uniquement s’il republie une action et une révision.";
  if (model.gateActions.length) return "Capabilities et allowedActions publiés par le backend. Raccourcis G et R disponibles sans soumission automatique.";
  return model.gateBlockedReason;
}

function orderIntentInstrument(intent: LiveTradingModel["orderIntent"]): string {
  if (!intent) return "—";
  return intent.symbol ?? (intent as { instrument?: string }).instrument ?? "—";
}
