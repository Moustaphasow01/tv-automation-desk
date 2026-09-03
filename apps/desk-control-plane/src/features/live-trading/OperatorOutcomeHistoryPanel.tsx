import { StatusBadge } from "@/design-system/primitives";
import { operatorCode } from "@/design-system/operatorVocabulary";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { LivePanel } from "./LiveTradingPanels";
import type { LiveTradingModel } from "./model";

const ATTRIBUTION_LABELS: Readonly<Record<string, string>> = {
  CAPTURED: "Capté",
  MISSED_OPPORTUNITY: "Opportunité manquée",
  AVOIDED_LOSS: "Perte évitée",
  EXECUTION_UNVERIFIED: "Exécution non vérifiée",
  NOT_TAKEN_FLAT: "Non pris · neutre",
  PENDING_OUTCOME: "Suivi en cours",
  OPERATOR_DECISION_UNKNOWN: "Décision non renseignée",
};

export function OperatorOutcomeHistoryPanel({ model }: { model: LiveTradingModel }) {
  const projection = model.theoreticalExecution;
  if (!projection?.rows.length) {
    return <LivePanel title="Décisions opérateur et résultats" className="lt-panel--operator-outcomes"><p className="lt-empty-copy">Aucun ordre proposé théorique suivi pour cette session.</p></LivePanel>;
  }
  return (
    <LivePanel title="Décisions opérateur & résultats" className="lt-panel--operator-outcomes" expandable>
      <div className="lt-operator-outcomes__summary" aria-label="Résumé d'attribution opérateur">
        <span><small>Captés</small><strong>{projection.summary.operatorCaptured ?? 0}</strong></span>
        <span><small>Manqués</small><strong>{projection.summary.operatorMissed ?? 0}</strong></span>
        <span><small>Pertes évitées</small><strong>{projection.summary.operatorAvoidedLoss ?? 0}</strong></span>
        <span><small>Non vérifiés</small><strong>{projection.summary.operatorUnverified ?? 0}</strong></span>
      </div>
      <div className="lt-operator-outcomes__table-wrap">
        <table className="lt-operator-outcomes__table">
          <thead><tr><th>Instrument</th><th>Décision</th><th>Déclaration</th><th>Résultat théorique</th><th>Attribution</th></tr></thead>
          <tbody>{projection.rows.map((row) => {
            const attribution = row.outcomeAttribution;
            const attributionStatus = attribution?.status ?? "NOT_PUBLISHED";
            const presentation = presentBackendStatus(attributionStatus);
            return <tr key={row.portfolioOrderIntentId}>
              <td><strong>{row.instrument}</strong><small>{operatorCode(row.side)} · {operatorCode(row.orderType)}</small></td>
              <td>{row.operatorDecision ?? "NON PUBLIÉE"}<small>{displayIso(row.operatorDecisionAt)}</small></td>
              <td>{row.manualExecutionStatus ?? "NON PUBLIÉE"}<small>{displayIso(row.manualExecutionAt)}</small></td>
              <td>{formatR(attribution?.theoreticalResultR ?? row.resultR)}<small>{row.latestEventType}</small></td>
              <td><StatusBadge tone={presentation.tone}>{ATTRIBUTION_LABELS[attributionStatus] ?? presentation.label}</StatusBadge><small>{attribution?.reasonCode ?? "Attribution backend non publiée"}</small></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="lt-operator-outcomes__policy">Votre validation n'est jamais assimilée à une exécution. L'attribution « capté » exige une déclaration opérateur enregistrée.</p>
    </LivePanel>
  );
}

function formatR(value: number | null): string { return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`; }
function displayIso(value?: string): string { const parsed = Date.parse(value ?? ""); return Number.isFinite(parsed) ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(parsed) : "—"; }
