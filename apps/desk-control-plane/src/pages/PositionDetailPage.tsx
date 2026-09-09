import { useParams } from "react-router-dom";
import { useFrontView } from "@/domains/front-api/repositories";
import { operatorCode } from "@/design-system/operatorVocabulary";
import { JourneyBackLink } from "@/features/trading-journey/JourneyNavigation";
import { JourneyFreshness, JourneyMessage, JourneyProvenance, useJourneySurface } from "@/features/trading-journey/JourneySurface";
import { PositionReading } from "@/features/trading-journey/PositionReading";

export function PositionDetailPage() {
  useJourneySurface();
  const { positionId } = useParams();
  const query = useFrontView("position-detail", { positionId });
  const envelope = query.data;
  const matches = envelope && envelope.data.identity.positionId === positionId && envelope.data.position.positionId === positionId;
  return <div className="desk-journey position-detail-page" data-testid="position-journey">
    <JourneyBackLink fallback="/portfolio" />
    {query.isLoading ? <div className="dj-loading" role="status">Chargement de la position…</div> : null}
    {query.isError || (!query.isLoading && !matches) ? <JourneyMessage title="Position indisponible" retry={() => void query.refetch()}>Le desk n’a pas fourni la position demandée. Aucune position de remplacement n’est affichée.</JourneyMessage> : null}
    {!query.isError && envelope && matches ? <>
      <header className="dj-header"><div><h1>{envelope.data.position.symbol} · {operatorCode(envelope.data.position.side)}</h1><p>Suivi de position · {operatorCode(envelope.data.summary.state)}</p></div><div className="dj-header-actions"><button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>Actualiser la position</button></div></header>
      <JourneyFreshness meta={envelope.meta} />
      <PositionReading data={envelope.data} />
      <JourneyProvenance meta={envelope.meta} />
    </> : null}
  </div>;
}
