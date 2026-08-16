import { useEffect, useRef, useState } from "react";
import { FaCheck, FaHourglassHalf, FaLock, FaTimes } from "react-icons/fa";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { HumanGateAction } from "@/features/order-intent/model";
import { LivePanel } from "./LiveTradingPanels";
import type { LiveTradingModel } from "./model";

export function LiveHumanGate({ model, onSubmit, submittingActionId, command, error }: {
  model: LiveTradingModel;
  onSubmit(action: HumanGateAction, reason: string): Promise<void>;
  submittingActionId: string | null;
  command: CommandAccepted | null;
  error: string | null;
}) {
  const [pending, setPending] = useState<HumanGateAction | null>(null);
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const confirm = model.gateActions.find((action) => action.action === "CONFIRM");
  const reject = model.gateActions.find((action) => action.action === "REJECT");
  const status = liveHumanGateStatus(model);

  const request = (action: HumanGateAction | undefined) => {
    if (!action || action.permission !== "ALLOWED") return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReason("");
    setPending(action);
  };

  const submit = async () => {
    if (!pending || (pending.requiresReason && !reason.trim())) return;
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

  return <LivePanel title="Human Execution Gate" className="lt-panel--gate"><div className="lt-gate-status"><FaHourglassHalf aria-hidden="true" /><strong>{status}</strong><span>{model.orderIntent ? "This OrderIntent will not be sent until the backend accepts an operator decision." : model.gateBlockedReason}</span></div><div className="lt-gate-actions"><button type="button" className="lt-gate-confirm" disabled={!confirm || confirm.permission !== "ALLOWED" || Boolean(submittingActionId)} onClick={() => request(confirm)}><FaCheck />Confirm</button><button type="button" className="lt-gate-reject" disabled={!reject || reject.permission !== "ALLOWED" || Boolean(submittingActionId)} onClick={() => request(reject)}><FaTimes />Reject</button></div><p className="lt-gate-helper"><FaLock aria-hidden="true" />{model.gateActions.length ? "Capability et allowedActions publiés par le backend." : model.gateBlockedReason}</p>{command ? <p className="lt-gate-receipt" role="status">Commande {command.commandId} · {command.status}</p> : null}{error ? <p className="lt-gate-error" role="alert">{error}</p> : null}{pending ? <div ref={dialogRef} className="lt-gate-dialog" role="alertdialog" aria-modal="true" aria-labelledby="lt-gate-dialog-title"><strong id="lt-gate-dialog-title">{pending.label}</strong><p>{pending.impactPreview}</p><dl><div><dt>OrderIntent</dt><dd>{model.orderIntent?.portfolioOrderIntentId}</dd></div><div><dt>Instrument</dt><dd>{model.orderIntent?.symbol}</dd></div><div><dt>Quantity</dt><dd>{model.orderIntent?.quantity}</dd></div><div><dt>Environment</dt><dd>{pending.environment}</dd></div></dl><label>Motif opérateur<input value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label><small>Révision attendue : {pending.expectedRevision}</small><div><button type="button" onClick={() => setPending(null)}>Cancel</button><button type="button" disabled={pending.requiresReason && !reason.trim()} onClick={() => void submit()}>Confirm request</button></div></div> : null}</LivePanel>;
}

export function liveHumanGateStatus(model: LiveTradingModel): string {
  return model.orderIntent?.humanGate.status ?? "CONNECTED_EMPTY";
}
