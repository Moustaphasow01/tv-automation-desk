import { useContext, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, KpiCard } from "@/design-system/primitives";
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
  const instrument = readable(dossier.signal.instrument, "OrderIntent");
  const side = readable(dossier.signal.side, "");
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
        description="De la décision stratégie à la preuve broker, sans recalcul ni mutation des termes validés."
        actions={<><button type="button" className="order-dossier__ticket-toggle" aria-pressed={ticketMode} onClick={() => setTicketMode((value) => !value)}>{ticketMode ? "Voir le dossier complet" : "Mode ticket d’exécution"}</button><Link to="/execution/orders">Retour aux ordres</Link><Link to="/operations/events">Audit global</Link></>}
      />

      {dossier.degradedReadOnly ? (
        <div className="order-dossier__degraded" role="status">
          <strong>Mode dégradé · lecture seule</strong>
          <span>La dernière projection reste consultable, mais les actions sensibles sont indisponibles tant que l'autorité backend n'est pas complète et fraîche.</span>
          <small>asOf {dossier.meta.asOf}</small>
        </div>
      ) : null}

      <section className="operator-kpi-strip" aria-label="Synthèse du dossier d'exécution">
        <KpiCard label="LIFECYCLE" value={lifecycle.label} delta={lifecycle.helper} tone={lifecycle.tone} />
        <KpiCard label="ORDONNÉ" value={`${dossier.brokerSummary.orderedQuantity}`} delta="projection ordre" />
        <KpiCard label="EXÉCUTÉ" value={`${dossier.brokerSummary.filledQuantity}`} delta={`${dossier.brokerSummary.fillCount} fill(s)`} tone={dossier.brokerSummary.filledQuantity > 0 ? "success" : "neutral"} />
        <KpiCard label="RESTANT" value={`${dossier.brokerSummary.remainingQuantity}`} delta="quantité broker" tone={dossier.brokerSummary.remainingQuantity > 0 ? "warning" : "neutral"} />
        <KpiCard label="PROTECTION" value={dossier.brokerSummary.protectionStatus} delta="état backend" />
        <KpiCard label="HUMAN GATE" value={dossier.humanGate.actions.length ? "Disponible" : "Indisponible"} delta="backend-driven" tone={dossier.humanGate.actions.length ? "warning" : "neutral"} />
      </section>

      <section className="order-dossier__expiry" data-tone={expiryTone(remainingSec)} aria-label="Temps restant avant expiration de la décision">
        <span>Fenêtre de décision</span>
        <strong>{formatCountdown(remainingSec)}</strong>
        <small>{expiresAt ? `Échéance backend ${formatTime(expiresAt)}` : "Échéance non publiée par le backend"}</small>
      </section>

      {ticketMode ? (
        <section className="order-dossier__ticket-focus" aria-label="Ticket d'exécution semi-manuel">
          <div className="order-dossier__ticket-instruction">
            <strong>{instrument} {side}</strong>
            <span>Recopiez uniquement les termes autorisés ci-dessous. La confirmation du Human Gate ne constitue jamais un fill broker.</span>
          </div>
          <div className="order-dossier__decision-grid">
            <ReadonlyTradeTerms dossier={dossier} />
            <HumanExecutionGatePanel gate={dossier.humanGate} onSubmit={submitGateAction} submittingActionId={submittingActionId} command={command} error={commandError} />
          </div>
        </section>
      ) : null}

      {!ticketMode ? <><nav className="order-dossier__lineage" aria-label="Lineage du dossier" tabIndex={0}>
        {["Signal", "Filtre de contexte", "Portefeuille", "Risque global", "Cible", "OrderIntent", "Human Gate", "Fournisseur", "Broker", "Réconciliation"].map((label, index) => (
          <span key={label}><b>{String(index + 1).padStart(2, "0")}</b>{label}</span>
        ))}
      </nav>

      <section className="order-dossier__overview-grid" aria-label="Identité, stratégie et autorité">
        <Card title="Identité & lignée de la stratégie" eyebrow="IDS CANONIQUES" density="compact">
          <div className="order-dossier__metrics-grid">
            <DataMetric label="OrderIntent" value={dossier.identity.orderIntentId} />
            <DataMetric label="Ordre" value={dossier.identity.orderId} />
            <DataMetric label="Stratégie" value={dossier.strategy.strategyId} />
            <DataMetric label="Instance" value={dossier.strategy.strategyInstanceId} />
            <DataMetric label="Version" value={dossier.strategy.strategyVersion} />
            <DataMetric label="Signal" value={dossier.signal.signalId} />
          </div>
        </Card>
        <ExecutionAuthorityPanel dossier={dossier} />
        <Card title="Position cible" eyebrow="SORTIE RISQUE" density="compact" state="partial">
          <div className="order-dossier__metrics-grid">
            <DataMetric label="TargetPosition" value={dossier.targetPosition.targetPositionId} />
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

      <section className="order-dossier__decision-grid" aria-label="Plan et Human Gate">
        <ReadonlyTradeTerms dossier={dossier} />
        <HumanExecutionGatePanel gate={dossier.humanGate} onSubmit={submitGateAction} submittingActionId={submittingActionId} command={command} error={commandError} />
      </section>

      <section className="order-dossier__evidence-grid" aria-label="Provider, broker et réconciliation">
        <Card title="Cycle de vie fournisseur" eyebrow="ÉVÉNEMENTS BACKEND" density="compact" state={dossier.providerLifecycle.length ? "nominal" : "partial"}>
          <ProviderLifecycleTimeline events={dossier.providerLifecycle} />
        </Card>
        <Card title="Preuves broker" eyebrow="FILLS" density="compact" state={dossier.fills.length ? "nominal" : "empty"}>
          {dossier.fills.length ? (
            <div className="order-dossier__fill-list">
              {dossier.fills.map((fill) => <article key={fill.fillId}><span><strong>{fill.quantity} @ {fill.price}</strong><small>{fill.fillId}</small></span><time dateTime={fill.filledAt}>{formatTime(fill.filledAt)}</time></article>)}
            </div>
          ) : <p className="empty-state">Aucun fill broker publié. Une confirmation ou un ACK ne crée pas de fill implicite.</p>}
        </Card>
        <ReconciliationPanel reconciliation={dossier.reconciliation} />
      </section>

      <section className="order-dossier__audit-grid" aria-label="Relations et audit">
        <Card title="Navigation croisée" eyebrow="LIGNÉE" density="compact">
          {dossier.relations.length ? <div className="zoom-link-list">{dossier.relations.map((relation) => <Link key={`${relation.label}-${relation.id}`} to={relation.route}><strong>{relation.label}</strong><small>{relation.id}</small></Link>)}</div> : <p className="empty-state">Aucune relation canonique publiée.</p>}
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
