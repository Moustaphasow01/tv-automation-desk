import { useContext } from "react";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { operatorStatusPresentation } from "@/design-system/operatorVocabulary";
import { parisTime } from "@/features/live-trading/workspace/workspaceModel";
import type { OrderIntentDossier } from "./model";
import { presentOrderLifecycleEvidence } from "./statusRegistry";

export function OrderDossierSummary({ dossier }: { dossier: OrderIntentDossier }) {
  const lifecycle = presentOrderLifecycleEvidence(dossier.brokerSummary);
  return <dl className="dj-metrics" aria-label="État d’exécution"><div><dt>Étape publiée</dt><dd className="dj-execution-state" data-tone={lifecycle.tone}>{lifecycle.label}</dd></div><div><dt>Quantité exécutée</dt><dd>{dossier.brokerSummary.filledQuantity}</dd></div><div><dt>Quantité restante</dt><dd>{dossier.brokerSummary.remainingQuantity}</dd></div><div><dt>Protection publiée</dt><dd className="dj-execution-state">{operatorStatusPresentation(dossier.brokerSummary.protectionStatus).label}</dd></div></dl>;
}

export function OrderDossierWindow({ dossier }: { dossier: OrderIntentDossier }) {
  const realtime = useContext(RealtimeContext);
  const expiry = dossier.executionPlan.expiresAt;
  const at = expiry.state === "KNOWN" || expiry.state === "STALE" ? expiry.value : null;
  const remaining = at ? Math.floor((Date.parse(at) - (realtime?.now.getTime() ?? Date.now())) / 1000) : null;
  const expired = remaining !== null && Number.isFinite(remaining) && remaining <= 0;
  return <div className="dj-order-window" data-tone={expired ? "warning" : "neutral"}><strong>{expired ? "Fenêtre de décision terminée" : remaining === null || !Number.isFinite(remaining) ? "Échéance non publiée" : "Validité du plan"}</strong><span>{at ? parisTime(at, true) + " Paris" : "Vérifiez la validité dans les autorisations du dossier."}</span>{expired ? <span>Historique · aucune nouvelle proposition</span> : null}</div>;
}
