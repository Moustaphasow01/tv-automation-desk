import { Card } from "@/design-system/primitives";
import { operatorCode } from "@/design-system/operatorVocabulary";
import { JourneyLink } from "@/features/trading-journey/JourneyNavigation";
import { JourneyDisclosure, JourneyProvenance, JourneySection } from "@/features/trading-journey/JourneySurface";
import { parisTime } from "@/features/live-trading/workspace/workspaceModel";
import type { OrderIntentDossier } from "./model";
import { AuthorityStageCard, DataMetric, ExecutionAuthorityPanel, ProviderLifecycleTimeline, ReconciliationPanel, TechnicalInspector } from "./components";

export function OrderDossierEvidence({ dossier }: { dossier: OrderIntentDossier }) {
  return <>
    <JourneyDisclosure title="Comprendre les décisions du desk">
      <div className="order-dossier__stage-grid"><AuthorityStageCard stage={dossier.contextGate} /><AuthorityStageCard stage={dossier.portfolioArbitration} /><AuthorityStageCard stage={dossier.globalRisk} /></div>
      <div className="dj-reading-grid"><ExecutionAuthorityPanel dossier={dossier} /><Card title="Origine du plan" density="compact"><div className="order-dossier__metrics-grid"><DataMetric label="Version de stratégie" value={dossier.strategy.strategyVersion} /><DataMetric label="Créé à" value={dossier.executionPlan.createdAt} /><DataMetric label="Quantité autorisée" value={dossier.targetPosition.authorizedQuantity} /><DataMetric label="Compte" value={dossier.targetPosition.account} /></div></Card></div>
    </JourneyDisclosure>
    <JourneyDisclosure title="Consulter les preuves d’exécution et le rapprochement">
      <div className="order-dossier__evidence-grid"><Card title="Événements du fournisseur" density="compact"><ProviderLifecycleTimeline events={dossier.providerLifecycle} /></Card><Card title="Exécutions publiées par le courtier" density="compact">
        {dossier.fills.length ? <div className="order-dossier__fill-list">{dossier.fills.map((fill) => <article key={fill.fillId}><span><strong>{fill.quantity} à {fill.price}</strong><small>Exécution confirmée</small></span><time dateTime={fill.filledAt}>{parisTime(fill.filledAt, true)}</time></article>)}</div> : <p className="dj-empty">Aucune exécution publiée. Une validation ou un accusé de réception ne prouve pas une exécution.</p>}
      </Card><ReconciliationPanel reconciliation={dossier.reconciliation} /></div>
    </JourneyDisclosure>
    <JourneySection title="Poursuivre le dossier"><div className="dj-record-list">{dossier.relations.map((relation) => <JourneyLink key={`${relation.label}-${relation.id}`} to={relation.route} title={relation.id}><strong>{operatorCode(relation.label)}</strong><span>Ouvrir</span></JourneyLink>)}</div>{!dossier.relations.length ? <p className="dj-empty">Aucun dossier lié publié.</p> : null}</JourneySection>
    <JourneyDisclosure title="Références et provenance"><TechnicalInspector dossier={dossier} /></JourneyDisclosure>
    <JourneyProvenance meta={dossier.meta} />
  </>;
}
