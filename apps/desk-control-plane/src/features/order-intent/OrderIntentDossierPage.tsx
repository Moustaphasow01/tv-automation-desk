import { useContext, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, KpiCard } from "@/design-system/primitives";
import { operatorCode, operatorStatusPresentation } from "@/design-system/operatorVocabulary";
import { OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { buildOrderIntentDossier } from "@/features/order-intent/mapper";
import { buildHumanGateCommand, type HumanGateAction } from "@/features/order-intent/model";
import {
  AuthorityStageCard,
  DataMetric,
  ExecutionAuthorityPanel,
  HumanExecutionGatePanel,
  ProviderLifecycleTimeline,
  ReadonlyTradeTerms,
  ReconciliationPanel,
  TechnicalInspector,
} from "@/features/order-intent/components";
import { presentOrderLifecycleEvidence } from "@/features/order-intent/statusRegistry";
import "@/features/order-intent/order-intent.css";

export function OrderIntentDossierPage() {
  const { orderId } = useParams();
  const query = useFrontView("order-detail", { orderId });
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [ticketMode, setTicketMode] = useState(false);
  const realtime = useContext(RealtimeContext);

  if (query.isLoading) return <DetailLoading />;
  if (query.isError) return <DetailError error={query.error as Error} />;
  if (!query.data) return <DetailError error={new Error("Projection absente")} />;

  const dossier = buildOrderIntentDossier(query.data);
  const lifecycle = presentOrderLifecycleEvidence(dossier.brokerSummary);
  const instrument = readable(dossier.signal.instrument, "Instrument non publié");
  const side = operatorCode(readable(dossier.signal.side, ""));
  const expiresAt = readable(dossier.executionPlan.expiresAt, "");
  const expiryMs = Date.parse(expiresAt);
  const nowMs = realtime?.now.getTime() ?? Date.parse(dossier.meta.asOf);
  const remainingSec = Number.isFinite(expiryMs) ? Math.floor((expiryMs - nowMs) / 1_000) : null;

  const submitGateAction = async (action: HumanGateAction, reason: string) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildHumanGateCommand(action, reason));
      setCommand(accepted);
      await query.refetch();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "HUMAN_GATE_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page order-dossier-page">
      <ViewTruthBanner meta={dossier.meta} />
      <OperatorPageHeader
        title={`${instrument} ${side} · dossier d'exécution`}
        description="De la décision de la stratégie à la preuve du courtier, sans recalcul ni modification des termes validés."
        actions={<><button type="button" className="order-dossier__ticket-toggle" aria-pressed={ticketMode} onClick={() => setTicketMode((value) => !value)}>{ticketMode ? "Voir le dossier complet" : "Mode ticket d’exécution"}</button><Link to="/execution/orders">Retour aux ordres</Link><Link to="/operations/events">Audit global</Link></>}
      />

      {dossier.degradedReadOnly ? (
        <div className="order-dossier__degraded" role="status">
          <strong>Mode dégradé · lecture seule</strong>
          <span>Le dernier état reste consultable, mais les actions sensibles sont indisponibles tant que les autorisations ne sont pas complètes et à jour.</span>
          <small>Arrêté à {formatTime(dossier.meta.asOf)}</small>
        </div>
      ) : null}

      <section className="operator-kpi-strip" aria-label="Synthèse du dossier d'exécution">
        <KpiCard label="Étape actuelle" value={lifecycle.label} delta={lifecycle.helper} tone={lifecycle.tone} />
        <KpiCard label="Quantité ordonnée" value={`${dossier.brokerSummary.orderedQuantity}`} delta="ordre proposé" />
        <KpiCard label="Quantité exécutée" value={`${dossier.brokerSummary.filledQuantity}`} delta={`${dossier.brokerSummary.fillCount} exécution(s)`} tone={dossier.brokerSummary.filledQuantity > 0 ? "success" : "neutral"} />
        <KpiCard label="Quantité restante" value={`${dossier.brokerSummary.remainingQuantity}`} delta="chez le courtier" tone={dossier.brokerSummary.remainingQuantity > 0 ? "warning" : "neutral"} />
        <KpiCard label="Protection" value={operatorStatusPresentation(dossier.brokerSummary.protectionStatus).label} delta="état publié" />
        <KpiCard label="Votre validation" value={dossier.humanGate.actions.length ? "Disponible" : "Indisponible"} delta="actions publiées" tone={dossier.humanGate.actions.length ? "warning" : "neutral"} />
      </section>

      <section className="order-dossier__expiry" data-tone={expiryTone(remainingSec)} aria-label="Temps restant avant expiration de la décision">
        <span>Fenêtre de décision</span>
        <strong>{formatCountdown(remainingSec)}</strong>
        <small>{expiresAt ? `Échéance ${formatTime(expiresAt)}` : "Échéance non publiée"}</small>
      </section>

      {ticketMode ? (
        <section className="order-dossier__ticket-focus" aria-label="Ticket d'exécution semi-manuel">
          <div className="order-dossier__ticket-instruction">
            <strong>{instrument} {side}</strong>
            <span>Recopiez uniquement les termes autorisés ci-dessous. Votre validation ne constitue jamais une preuve d’exécution chez le courtier.</span>
          </div>
          <div className="order-dossier__decision-grid">
            <ReadonlyTradeTerms dossier={dossier} />
            <HumanExecutionGatePanel gate={dossier.humanGate} onSubmit={submitGateAction} submittingActionId={submittingActionId} command={command} error={commandError} />
          </div>
        </section>
      ) : null}

      {!ticketMode ? <><nav className="order-dossier__lineage" aria-label="Étapes du dossier" tabIndex={0}>
        {["Signal", "Filtre de contexte", "Portefeuille", "Risque global", "Position cible", "Ordre proposé", "Votre validation", "Fournisseur", "Courtier", "Réconciliation"].map((label, index) => (
          <span key={label}><b>{String(index + 1).padStart(2, "0")}</b>{label}</span>
        ))}
      </nav>

      <section className="order-dossier__overview-grid" aria-label="Identité, stratégie et autorité">
        <Card title="Origine de l’ordre" eyebrow="TRAÇABILITÉ" density="compact">
          <div className="order-dossier__metrics-grid">
            <DataMetric label="Instrument" value={dossier.signal.instrument} />
            <DataMetric label="Sens" value={dossier.signal.side} />
            <DataMetric label="Version" value={dossier.strategy.strategyVersion} />
            <DataMetric label="Créé à" value={dossier.executionPlan.createdAt} />
          </div>
        </Card>
        <ExecutionAuthorityPanel dossier={dossier} />
        <Card title="Position cible" eyebrow="SORTIE RISQUE" density="compact" state="partial">
          <div className="order-dossier__metrics-grid">
            <DataMetric label="Position cible" value={dossier.targetPosition.targetPositionId} />
            <DataMetric label="Compte" value={dossier.targetPosition.account} />
            <DataMetric label="Quantité autorisée" value={dossier.targetPosition.authorizedQuantity} />
            <DataMetric label="Révision" value={dossier.executionPlan.expectedRevision} />
          </div>
        </Card>
      </section>

      <section className="order-dossier__stage-grid" aria-label="Décisions d'autorité">
        <AuthorityStageCard stage={dossier.contextGate} />
        <AuthorityStageCard stage={dossier.portfolioArbitration} />
        <AuthorityStageCard stage={dossier.globalRisk} />
      </section>

      <section className="order-dossier__decision-grid" aria-label="Plan et validation opérateur">
        <ReadonlyTradeTerms dossier={dossier} />
        <HumanExecutionGatePanel gate={dossier.humanGate} onSubmit={submitGateAction} submittingActionId={submittingActionId} command={command} error={commandError} />
      </section>

      <section className="order-dossier__evidence-grid" aria-label="Fournisseur, courtier et réconciliation">
        <Card title="Cycle de vie fournisseur" eyebrow="ÉVÉNEMENTS" density="compact" state={dossier.providerLifecycle.length ? "nominal" : "partial"}>
          <ProviderLifecycleTimeline events={dossier.providerLifecycle} />
        </Card>
        <Card title="Preuves du courtier" eyebrow="EXÉCUTIONS" density="compact" state={dossier.fills.length ? "nominal" : "empty"}>
          {dossier.fills.length ? (
            <div className="order-dossier__fill-list">
              {dossier.fills.map((fill) => <article key={fill.fillId} title={fill.fillId}><span><strong>{fill.quantity} à {fill.price}</strong><small>Exécution confirmée</small></span><time dateTime={fill.filledAt}>{formatTime(fill.filledAt)}</time></article>)}
            </div>
          ) : <p className="empty-state">Aucune exécution publiée par le courtier. Une validation ou un accusé de réception ne prouve pas une exécution.</p>}
        </Card>
        <ReconciliationPanel reconciliation={dossier.reconciliation} />
      </section>

      <section className="order-dossier__audit-grid" aria-label="Relations et audit">
        <Card title="Navigation croisée" eyebrow="LIGNÉE" density="compact">
          {dossier.relations.length ? <div className="zoom-link-list">{dossier.relations.map((relation) => <Link key={`${relation.label}-${relation.id}`} to={relation.route} title={relation.id}><strong>{operatorCode(relation.label)}</strong><small>Ouvrir le dossier lié</small></Link>)}</div> : <p className="empty-state">Aucune relation publiée.</p>}
        </Card>
        <Card title="Audit & provenance" eyebrow="TECHNIQUE" density="compact"><TechnicalInspector dossier={dossier} /></Card>
      </section></> : null}
    </div>
  );
}

function readable(value: { state: string; value?: string }, fallback: string): string {
  return (value.state === "KNOWN" || value.state === "STALE") && value.value ? value.value : fallback;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Heure indisponible" : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function formatCountdown(remainingSec: number | null): string {
  if (remainingSec === null) return "Non publiée";
  if (remainingSec <= 0) return "Expirée";
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function expiryTone(remainingSec: number | null): "unknown" | "expired" | "urgent" | "active" {
  if (remainingSec === null) return "unknown";
  if (remainingSec <= 0) return "expired";
  if (remainingSec <= 180) return "urgent";
  return "active";
}

function DetailLoading() { return <div className="operator-page"><Card state="loading" density="compact"><p>Chargement du dossier d'exécution…</p></Card></div>; }
function DetailError({ error }: { error: Error }) { return <div className="operator-page"><Card title="Dossier d'exécution indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact"><p>{error.message}</p><Link to="/execution/orders">Retour à la liste</Link></Card></div>; }
