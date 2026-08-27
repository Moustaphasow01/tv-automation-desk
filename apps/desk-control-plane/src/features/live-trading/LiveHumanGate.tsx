import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaCheck, FaHourglassHalf, FaLock, FaTimes } from "react-icons/fa";
import type { CommandAccepted, CommandStatus } from "@/domains/realtime/commandRuntime";
import { TrackedCommandReceipt } from "@/design-system/actions";
import { presentAvailability } from "@/design-system/labels";
import type { HumanGateAction } from "@/features/order-intent/model";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { displayTime } from "./mapper";
import { LivePanel } from "./LiveTradingPanels";
import type { LiveTradingModel } from "./model";

export function LiveHumanGate({ model, onSubmit, submittingActionId, command, commandStatus, error, embedded = false }: {
  model: LiveTradingModel;
  onSubmit(action: HumanGateAction, reason: string): Promise<void>;
  submittingActionId: string | null;
  command: CommandAccepted | null;
  commandStatus?: CommandStatus | null;
  error: string | null;
  embedded?: boolean;
}) {
  const [pending, setPending] = useState<HumanGateAction | null>(null);
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const confirm = model.gateActions.find((action) => action.action === "CONFIRM");
  const reject = model.gateActions.find((action) => action.action === "REJECT");
  const resolvedCommandStatus = commandStatus ?? command?.status ?? null;
  const actionsLocked = Boolean(submittingActionId) || commandLocksGateActions(resolvedCommandStatus);
  const status = liveHumanGateStatus(model);
  const statusLabel = status === "CONNECTED_EMPTY" ? presentAvailability(status).label : presentBackendStatus(status).label;

  const request = (action: HumanGateAction | undefined) => {
    if (!action || action.permission !== "ALLOWED" || actionsLocked) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReason("");
    setPending(action);
  };

  const submit = async () => {
    if (!pending || actionsLocked || (pending.requiresReason && !reason.trim())) return;
    await onSubmit(pending, reason);
    setPending(null);
    setReason("");
  };

  useEffect(() => {
    if (!pending || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPending(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [pending]);

  return <LivePanel title="Human Gate d'exécution" className={`lt-panel--gate${embedded ? " lt-panel--embedded" : ""}`} expandable={!embedded}><div className="lt-gate-status"><FaHourglassHalf aria-hidden="true" /><strong className="lt-gate-status__badge">{statusLabel}</strong><span>{model.orderIntent ? "Cet OrderIntent ne sera transmis qu'après une décision opérateur acceptée par le backend." : model.gateBlockedReason}</span></div>{model.orderIntent ? <dl className="lt-gate-meta"><div><dt>Initié par</dt><dd>Moteur de stratégie</dd></div><div><dt>Demandé à</dt><dd>{displayTime(model.orderIntent.createdAt ?? null)}</dd></div><div><dt>Expire dans</dt><dd>{formatExpiry(model.orderIntent.allowedActions.expiresAt)}</dd></div></dl> : null}<div className="lt-gate-actions"><button type="button" className="lt-gate-confirm" disabled={!confirm || confirm.permission !== "ALLOWED" || actionsLocked} onClick={() => request(confirm)}><FaCheck />Confirmer</button><button type="button" className="lt-gate-reject" disabled={!reject || reject.permission !== "ALLOWED" || actionsLocked} onClick={() => request(reject)}><FaTimes />Rejeter</button></div><Link className="lt-gate-audit-link" to="/events">Voir l'audit</Link><p className="lt-gate-helper"><FaLock aria-hidden="true" />{commandLocksGateActions(resolvedCommandStatus) ? "Commande déjà transmise : les actions restent verrouillées jusqu’à un échec terminal autorisant un nouvel essai." : model.gateActions.length ? "Capability et allowedActions publiés par le backend." : model.gateBlockedReason}</p><TrackedCommandReceipt command={command} />{error ? <p className="lt-gate-error" role="alert">{error}</p> : null}{pending ? <div ref={dialogRef} className="lt-gate-dialog" role="alertdialog" aria-modal="true" aria-labelledby="lt-gate-dialog-title"><strong id="lt-gate-dialog-title">{pending.label}</strong><p>{pending.impactPreview}</p><dl><div><dt>OrderIntent</dt><dd>{model.orderIntent?.portfolioOrderIntentId}</dd></div><div><dt>Instrument</dt><dd>{orderIntentInstrument(model.orderIntent)}</dd></div><div><dt>Quantité</dt><dd>{model.orderIntent?.quantity}</dd></div><div><dt>Environnement</dt><dd>{pending.environment}</dd></div></dl><label>Motif opérateur<input value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label><small>Révision attendue : {pending.expectedRevision}</small><div><button type="button" onClick={() => setPending(null)}>Annuler</button><button type="button" disabled={actionsLocked || (pending.requiresReason && !reason.trim())} onClick={() => void submit()}>Confirmer la demande</button></div></div> : null}</LivePanel>;
}

export type GateCommandBinding = {
  orderIntentId: string;
  actionId: string;
  expectedRevision: string;
  receipt: CommandAccepted;
};

export function commandForCurrentGate(
  binding: GateCommandBinding | null,
  orderIntentId: string | null,
  actions: readonly HumanGateAction[],
): CommandAccepted | null {
  if (!binding || !orderIntentId || binding.orderIntentId !== orderIntentId) return null;
  return actions.some((action) => (
    action.actionId === binding.actionId
    && action.expectedRevision === binding.expectedRevision
  )) ? binding.receipt : null;
}

const RETRYABLE_COMMAND_FAILURES = new Set(["FAILED", "CONFLICT", "REJECTED", "CANCELLED", "TIMED_OUT"]);

export function commandLocksGateActions(status: string | null): boolean {
  return Boolean(status) && !RETRYABLE_COMMAND_FAILURES.has(status as string);
}

function orderIntentInstrument(intent: LiveTradingModel["orderIntent"]): string {
  if (!intent) return "—";
  return intent.symbol ?? (intent as { instrument?: string }).instrument ?? "—";
}

export function liveHumanGateStatus(model: LiveTradingModel): string {
  return model.orderIntent?.humanGate.status ?? "CONNECTED_EMPTY";
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(remainingMs)) return "—";
  if (remainingMs <= 0) return "Expiré";
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
