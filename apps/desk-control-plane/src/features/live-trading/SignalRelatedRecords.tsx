import type { LiveSignalDetailView } from "@/domains/front-api/viewModels";
import { operatorCode } from "@/design-system/operatorVocabulary";
import { StatusBadge } from "@/design-system/primitives";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { JourneyLink } from "@/features/trading-journey/JourneyNavigation";
import { JourneyDisclosure } from "@/features/trading-journey/JourneySurface";
import { positionNumber, positionR } from "@/features/trading-journey/positionPresentation";
import { useProgressiveRows } from "@/features/trading-journey/useProgressiveRows";

export function SignalRelatedRecords({ data }: { data: LiveSignalDetailView }) {
  const page = useProgressiveRows(data.existingPositions, data.identity.signalId);
  return <div className="signal-related-records">
    <section><h3>Ordres proposés après contrôle du risque</h3>
      {data.linkedOrderIntents.map((intent) => <JourneyLink className="signal-related-records__link" key={intent.portfolioOrderIntentId} to={intent.route} title={intent.portfolioOrderIntentId}>
        <div><strong>{intent.instrument} · {operatorCode(intent.side)} · {positionNumber(intent.quantity)} contrat(s)</strong><small>Ouvrir le dossier</small></div>
        <StatusBadge tone="info">{presentBackendStatus(intent.state).label}</StatusBadge>
      </JourneyLink>)}
      {!data.linkedOrderIntents.length ? <p className="dj-empty">Aucun ordre proposé après contrôle du risque n’est relié à ce signal.</p> : null}
    </section>
    <section><h3>Ordres chez le courtier</h3>
      {data.linkedOrders.map((order) => <article key={order.orderId} title={order.orderId}>
        <div><strong>{operatorCode(order.side)} · {positionNumber(order.quantity)} contrat(s) · {operatorCode(order.type)}</strong><small>Ordre publié</small></div>
        <StatusBadge tone={order.state === "FILLED" ? "success" : "neutral"}>{presentBackendStatus(order.state).label}</StatusBadge>
      </article>)}
      {!data.linkedOrders.length ? <p className="dj-empty">Aucun ordre courtier publié pour ce signal. Aucune exécution n’est supposée.</p> : null}
    </section>
    <JourneyDisclosure title={`Positions présentes dans la réponse · ${data.existingPositions.length}`}>
      <p className="dj-empty">Ce périmètre publié peut inclure de l’historique ; il ne prouve pas une exposition en cours pour ce signal.</p>
      {page.visible.map((position) => <article key={position.positionId} title={position.positionId}>
        <div><strong>{operatorCode(position.symbol)} · {operatorCode(position.side)}</strong><small>Position publiée</small></div>
        <span>{positionNumber(position.quantity)} contrat(s) · {positionR(position.pnlR)}</span>
      </article>)}
      {page.hasMore ? <div className="dj-load-more"><button type="button" onClick={page.showMore}>Afficher 12 positions de plus</button><small>{page.visible.length} sur {data.existingPositions.length}</small></div> : null}
    </JourneyDisclosure>
  </div>;
}
