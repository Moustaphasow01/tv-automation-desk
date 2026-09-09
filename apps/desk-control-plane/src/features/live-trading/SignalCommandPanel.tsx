import { DeskButton, TrackedCommandReceipt } from "@/design-system/actions";
import { StatusBadge } from "@/design-system/primitives";
import { presentPermission } from "@/design-system/labels";
import { operatorCopy } from "@/design-system/operatorVocabulary";
import type { LiveSignalDetailView } from "@/domains/front-api/viewModels";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";

type Action = LiveSignalDetailView["commandActions"][number];
type Props = { actions: readonly Action[]; reason: string; command: CommandAccepted | null; error: string | null; submittingActionId: string | null; onReason(value: string): void; onConfirm(action: Action): void };

export function SignalCommandPanel(props: Props) {
  const { actions, reason, command, submittingActionId } = props;
  return <section className="signal-dossier-section"><header><h2>Décision opérateur</h2></header><div className="signal-dossier-section__body">
    {actions.length || command ? <>
      <div className="signal-command-state"><div><small>Dernière commande</small><strong>{command ? "Demande reçue · résultat à vérifier" : "Aucune commande confirmée"}</strong></div></div>
      {props.error ? <p className="signal-command-error" role="alert">{props.error}</p> : null}
      <label className="signal-command-reason"><span>Motif obligatoire</span><textarea value={reason} onChange={(event) => props.onReason(event.target.value)} /></label>
      <TrackedCommandReceipt command={command} />
    </> : null}
    <div className="signal-command-actions">{actions.length ? actions.map((action) => <article key={action.actionId}>
      <div title={`Droit requis : ${action.capability}`}><strong>{operatorCopy(action.label)}</strong><small>Action contrôlée par le desk</small></div>
      <StatusBadge tone={action.permission === "ALLOWED" ? "success" : action.permission === "STEP_UP_REQUIRED" ? "warning" : "danger"}>{presentPermission(action.permission).label}</StatusBadge>
      <DeskButton variant="primary" disabled={action.permission !== "ALLOWED" || !reason.trim() || submittingActionId !== null} onClick={() => props.onConfirm(action)}>{submittingActionId === action.actionId ? "Envoi…" : "Confirmer"}</DeskButton>
    </article>) : <div className="signal-evidence-empty"><strong>Aucune action autorisée</strong><span>Le desk ne publie aucune action possible pour ce signal.</span></div>}</div>
  </div></section>;
}
