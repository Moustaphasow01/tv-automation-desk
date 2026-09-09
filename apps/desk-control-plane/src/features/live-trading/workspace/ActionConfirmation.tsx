import { useState } from "react";
import type { FocusQueueItem } from "../focusJournalModel";
import { focusTradePlanFromCard } from "../focusTradePlan";
import { actionLabel, optionalNumber, type WorkspaceAction } from "./commandPolicy";
import { WorkspaceDialog } from "./WorkspaceDialog";
import type { WorkspaceCommand } from "./useWorkspaceCommand";
import { sideLabel } from "./workspaceModel";

export function ActionConfirmation({ action, item, account, command, valid, onClose }: {
  action: WorkspaceAction; item: FocusQueueItem; account: string; command: WorkspaceCommand; valid: boolean; onClose(): void;
}) {
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [ack, setAck] = useState(false);
  const plan = item.card ? focusTradePlanFromCard(item.card) : null;
  const requiresPrice = action.kind === "manual" && action.action.requiresPrice;
  const requiresQuantity = action.kind === "manual" && action.action.requiresQuantity;
  const validFields = (!action.action.requiresReason || reason.trim().length > 0)
    && (!requiresPrice || optionalNumber(price) !== null) && (!requiresQuantity || Number(optionalNumber(quantity)) > 0);
  return <WorkspaceDialog title={actionLabel(action)} onClose={onClose} busy={command.sending}>
    <form className="tw-action-form" onSubmit={async (event) => {
      event.preventDefault();
      if (valid && validFields && ack && await command.submit(action, { reason, price: optionalNumber(price), quantity: optionalNumber(quantity) }, item, account)) onClose();
    }}>
      <p className="tw-inline-warning">{action.kind === "manual" ? "Cette déclaration consigne une action manuelle. Elle ne prouve pas une exécution par le courtier." : "Cette décision ne signifie pas qu’un ordre est exécuté par le courtier."}</p>
      <dl className="tw-plan-grid"><div><dt>Ticket</dt><dd>{item.instrument} · {sideLabel(item.side)}</dd></div><div><dt>Environnement</dt><dd>{action.action.environment}</dd></div><div><dt>Compte</dt><dd>{account}</dd></div><div><dt>Quantité autorisée</dt><dd>{plan?.quantity ?? "Non publiée"}</dd></div><div><dt>Entrée</dt><dd>{plan?.entry ?? "Non publiée"}</dd></div><div><dt>Stop</dt><dd>{plan?.stop ?? "Non publié"}</dd></div></dl>
      <p>Objectifs : {plan?.targets.join(" / ") || "Non publiés"}</p>
      {requiresPrice ? <label>Prix réellement obtenu<input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required /></label> : null}
      {requiresQuantity ? <label>Quantité réellement traitée<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label> : null}
      <label>Motif {action.action.requiresReason ? "(requis)" : "(facultatif)"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} required={action.action.requiresReason} rows={3} /></label>
      <label className="tw-check"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />J’ai vérifié le ticket, le compte et l’environnement.</label>
      {!valid ? <p role="alert" className="tw-inline-warning">Ce ticket ne peut plus recevoir cette action. Fermez pour consulter son état actuel.</p> : null}
      {command.error ? <p role="alert" className="tw-inline-warning">{command.error}</p> : null}
      <details><summary>Référence de la décision</summary><p>{item.card?.orderIntentId}</p><p>Version {action.action.expectedRevision}</p></details>
      <footer><button type="button" onClick={onClose} disabled={command.sending}>Annuler</button><button type="submit" className="tw-primary" disabled={!valid || !validFields || !ack || command.busy}>{command.sending ? "Vérification et envoi…" : "Confirmer ma décision"}</button></footer>
    </form>
  </WorkspaceDialog>;
}
