import { useParams } from "react-router-dom";
import { operatorCode } from "@/design-system/operatorVocabulary";
import { JourneyBackLink } from "@/features/trading-journey/JourneyNavigation";
import { JourneyDisclosure, JourneyFreshness, JourneyMessage, useJourneySurface } from "@/features/trading-journey/JourneySurface";
import { buildOrderIntentDossier } from "./mapper";
import { HumanExecutionGatePanel, ReadonlyTradeTerms } from "./components";
import { OrderDossierEvidence } from "./OrderDossierEvidence";
import { OrderDossierSummary, OrderDossierWindow } from "./OrderDossierSummary";
import { useOrderDossier } from "./useOrderDossier";
import "./order-intent.css";
import "./order-journey.css";

export function OrderIntentDossierPage() {
  const { orderId } = useParams();
  return <OrderDossierReading key={orderId} orderId={orderId} />;
}

function OrderDossierReading({ orderId }: { orderId: string | undefined }) {
  useJourneySurface();
  const state = useOrderDossier(orderId);
  const { query } = state;
  if (query.isLoading) return <div className="desk-journey"><JourneyBackLink fallback="/orders" /><div className="dj-loading" role="status">Chargement du dossier d’exécution…</div></div>;
  if (query.isError || !query.data) return <div className="desk-journey"><JourneyBackLink fallback="/orders" /><JourneyMessage title="Dossier d’exécution indisponible" retry={() => void query.refetch()}>Le desk n’a pas pu publier ce dossier. Revenez à votre séance ou réessayez ; aucune exécution n’est supposée.</JourneyMessage></div>;
  const dossier = buildOrderIntentDossier(query.data);
  const instrument = readable(dossier.signal.instrument, "Instrument non publié");
  const side = operatorCode(readable(dossier.signal.side, ""));
  const gate = <HumanExecutionGatePanel gate={dossier.humanGate} onSubmit={state.submit} submittingActionId={state.submittingActionId} command={state.command} error={state.error} />;
  const decisionAvailable = dossier.humanGate.actions.some((action) => action.permission === "ALLOWED");
  return <div className="desk-journey order-dossier-page" data-testid="order-journey">
    <JourneyBackLink fallback="/orders" />
    <header className="dj-header"><div><h1>{instrument} · {side || "Sens non publié"}</h1><p>Dossier d’exécution</p></div><div className="dj-header-actions"><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser le dossier</button></div></header>
    <JourneyFreshness meta={dossier.meta} />
    {dossier.degradedReadOnly ? <p className="dj-order-notice" role="status">Lecture seule · données à vérifier</p> : null}
    <OrderDossierWindow dossier={dossier} />
    <div className="order-dossier__decision-grid dj-order-decision" aria-label="Plan et validation opérateur"><ReadonlyTradeTerms dossier={dossier} /><div><OrderDossierSummary dossier={dossier} />{decisionAvailable || state.command || state.error ? gate : <JourneyDisclosure title="Validation · aucune action disponible">{gate}</JourneyDisclosure>}</div></div>
    {dossier.degradedReadOnly ? <JourneyDisclosure title="Pourquoi ce dossier est en lecture seule"><p>Le dernier état reste consultable. Les actions sensibles exigent des autorisations complètes et à jour.</p></JourneyDisclosure> : null}
    <OrderDossierEvidence dossier={dossier} />
  </div>;
}

function readable(value: { state: string; value?: string }, fallback: string): string {
  return (value.state === "KNOWN" || value.state === "STALE") && value.value ? value.value : fallback;
}
