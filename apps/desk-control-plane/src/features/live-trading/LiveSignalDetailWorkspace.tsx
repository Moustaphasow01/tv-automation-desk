import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  FaBalanceScale,
  FaBolt,
  FaChartLine,
  FaCheckCircle,
  FaClock,
  FaDatabase,
  FaExclamationTriangle,
  FaFingerprint,
  FaProjectDiagram,
  FaRoute,
  FaShieldAlt,
} from "react-icons/fa";
import { DeskButton, TrackedCommandReceipt } from "@/design-system/actions";
import { StatusBadge } from "@/design-system/primitives";
import {
  presentArbitrationDecision,
  presentEventLane,
  presentFreshness,
  presentGateState,
  presentGeneric,
  presentPermission,
  presentQueueStatus,
  presentStrategyPredicate,
  presentTradeDecision,
} from "@/design-system/labels";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { LiveSignalDetailView } from "@/domains/front-api/viewModels";
import type { SignalTemporalPresentation } from "./signalTemporalState";

type SignalAction = LiveSignalDetailView["commandActions"][number];

export function LiveSignalDetailWorkspace({
  data,
  temporal,
  remainingSec,
  reason,
  command,
  commandError,
  submittingActionId,
  onReason,
  onConfirm,
}: {
  data: LiveSignalDetailView;
  temporal: SignalTemporalPresentation;
  remainingSec: number;
  reason: string;
  command: CommandAccepted | null;
  commandError: string | null;
  submittingActionId: string | null;
  onReason(value: string): void;
  onConfirm(action: SignalAction): void;
}) {
  const chartRoute = signalChartRoute(data);
  const arbitrationPublished = !isUnavailable(data.arbitration.arbitrationId);
  const riskPublished = !isUnavailable(data.riskCheck.riskCheckId);
  const lifecycle = lifecycleStages(data, arbitrationPublished, riskPublished);

  return (
    <>
      <SignalHero data={data} temporal={temporal} remainingSec={remainingSec} chartRoute={chartRoute} />
      <SignalLifecycle stages={lifecycle} />

      <div className="signal-dossier-layout">
        <main className="signal-dossier-main">
          <DossierSection eyebrow="Plan proposé" title="Niveaux de la stratégie" icon={<FaBolt aria-hidden="true" />} action={<Link to={chartRoute}><FaChartLine aria-hidden="true" /> Revoir sur le graphique</Link>}>
            <div className="signal-trade-plan" aria-label="Plan de trade proposé par la stratégie">
              <TradeMetric label="Zone d’entrée" value={formatEntryZone(data.signal.entryZoneLow, data.signal.entryZoneHigh)} />
              <TradeMetric label="Stop" value={formatPublishedPrice(data.signal.stopPrice)} tone="danger" />
              <TradeMetric label="Cible" value={formatPublishedPrice(data.signal.targetPrice)} tone="success" />
              <TradeMetric label="Ratio rendement / risque" value={formatRatio(data.signal.rewardRisk)} />
              <TradeMetric label="Expectancy" value={formatSignedR(data.signal.expectancyR)} />
              <TradeMetric label="Quantité cible" value={publishedQuantity(data.summary.targetQuantity)} />
            </div>
            <p className="signal-section-note">Ces niveaux sont ceux du signal. Ils ne deviennent un plan autorisé qu’après publication explicite des décisions Portfolio et Risk.</p>
          </DossierSection>

          <DossierSection eyebrow="Preuves" title="Pourquoi le moteur a publié ce signal" icon={<FaCheckCircle aria-hidden="true" />} badge={`${data.predicates.length} prédicat${data.predicates.length > 1 ? "s" : ""}`}>
            {data.predicates.length ? (
              <div className="signal-evidence-list">
                {data.predicates.map((predicate, index) => (
                  <article key={`${predicate.predicateId}-${index}`}>
                    <StatusBadge tone={predicate.status === "PASS" ? "success" : predicate.status === "FAIL" ? "danger" : "warning"}>{presentGateState(predicate.status).label}</StatusBadge>
                    <div><strong>{presentStrategyPredicate(predicate.enumCode).label}</strong><small>{predicate.enumCode} · observation {predicate.observedValue}</small></div>
                    <span>{predicate.threshold}</span>
                  </article>
                ))}
              </div>
            ) : <EvidenceEmpty title="Aucun prédicat détaillé publié" detail="Le signal existe, mais son détail de règles n’est pas présent dans cette projection." />}
            <FeatureSnapshot data={data} />
          </DossierSection>

          <DossierSection eyebrow="Autorités" title="Décisions après le signal" icon={<FaRoute aria-hidden="true" />}>
            <div className="signal-authority-grid">
              <AuthorityCard
                index="01"
                title="Contexte"
                status={data.context.length ? "Publié" : "Sans décision liée"}
                tone={data.context.length ? "info" : "neutral"}
                rows={data.context.map((item) => [item.label, `${item.value} · ${item.interpretation}`])}
                empty="Aucune décision contextuelle liée par ID à ce signal."
              />
              <AuthorityCard
                index="02"
                title="Portfolio"
                status={arbitrationPublished ? presentArbitrationDecision(data.arbitration.decision).label : "Non publié"}
                tone={arbitrationPublished ? (data.arbitration.decision === "REJECTED" ? "danger" : "success") : "neutral"}
                rows={arbitrationPublished ? [["Quantité cible", String(data.arbitration.targetQuantity)], ["Motif", presentGeneric(data.arbitration.reasonCode).label], ["Corrélation", `${data.arbitration.correlationPct}%`]] : []}
                empty="Aucun arbitrage Portfolio canonique lié à ce signal."
              />
              <AuthorityCard
                index="03"
                title="Global Risk"
                status={riskPublished ? presentQueueStatus(data.riskCheck.status).label : "Non publié"}
                tone={riskPublished ? (data.riskCheck.status === "PASS" ? "success" : data.riskCheck.status === "BLOCK" ? "danger" : "warning") : "neutral"}
                rows={riskPublished ? [["Limite", data.riskCheck.limitLabel], ["Motif", presentGeneric(data.riskCheck.reasonCode).label], ["Quantité arrondie", String(data.riskCheck.roundedQuantity)]] : []}
                empty="Aucune décision Risk canonique liée à ce signal."
              />
              <AuthorityCard
                index="04"
                title="Avis IA"
                status={presentTradeDecision(data.aiAdvisory.recommendation).label}
                tone="advisory"
                rows={[["Mode", presentGeneric(data.aiAdvisory.mode).label], ["Autorité", presentGeneric(data.aiAdvisory.authority).label], ["Synthèse", data.aiAdvisory.summary]]}
                empty=""
              />
            </div>
          </DossierSection>

          <DossierSection eyebrow="Lineage" title="Chronologie vérifiable" icon={<FaClock aria-hidden="true" />} badge={`${data.auditTrail.length} événement${data.auditTrail.length > 1 ? "s" : ""}`}>
            <ol className="signal-audit-timeline">
              <TimelineItem at={data.signal.generatedAt} title="Signal publié" detail={`${data.signal.symbol} ${data.signal.direction} · ${data.identity.signalId}`} tone="authoritative" />
              {data.auditTrail.map((event, index) => (
                <TimelineItem key={`${event.eventId}-${index}`} at={event.at} title={event.title} detail={`${event.domain} · ${event.eventId}`} tone={event.lane === "ADVISORY" ? "advisory" : "authoritative"} route={event.route} badge={presentEventLane(event.lane).label} />
              ))}
              <TimelineItem at={data.signal.expiresAt} title="Fin de validité contractuelle" detail={temporal.effectiveState === "EXPIRED" ? "Échéance dépassée" : "Échéance future"} tone={temporal.effectiveState === "EXPIRED" ? "expired" : "pending"} />
            </ol>
          </DossierSection>
        </main>

        <aside className="signal-dossier-sidebar" aria-label="Contexte et actions du dossier">
          <DossierSection eyebrow="Provenance" title="Identité canonique" icon={<FaFingerprint aria-hidden="true" />} compact>
            <dl className="signal-identity-list">
              <IdentityRow label="Signal" value={data.identity.signalId} />
              <IdentityRow label="Stratégie" value={data.identity.strategyId} />
              <IdentityRow label="Version" value={data.identity.strategyVersionId} />
              <IdentityRow label="Instance" value={data.identity.strategyInstanceId} />
              <IdentityRow label="Snapshot" value={data.identity.featureSnapshotId} />
              <IdentityRow label="Cutoff" value={formatDateTime(data.featureSnapshot.cutoffAt)} />
              <IdentityRow label="Corrélation" value={data.identity.correlationId} />
            </dl>
            <nav className="signal-related-links" aria-label="Objets liés">
              {data.navigation.map((item) => <Link key={`${item.kind}-${item.route}`} to={item.route}>{item.kind === "STRATEGY" ? <FaProjectDiagram aria-hidden="true" /> : item.kind === "PORTFOLIO" ? <FaBalanceScale aria-hidden="true" /> : <FaRoute aria-hidden="true" />}{item.label}</Link>)}
              <Link to="/events"><FaRoute aria-hidden="true" /> Audit global</Link>
            </nav>
          </DossierSection>

          <DossierSection eyebrow="Conséquences" title="Positions et ordres liés" icon={<FaDatabase aria-hidden="true" />} compact>
            <RelatedRecords data={data} />
          </DossierSection>

          <DossierSection eyebrow="Action" title="Décision opérateur" icon={<FaShieldAlt aria-hidden="true" />} compact>
            <div className="signal-command-state">
              <FaFingerprint aria-hidden="true" />
              <div><small>Dernière commande</small><strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande confirmée"}</strong></div>
            </div>
            {commandError ? <p className="signal-command-error" role="alert">{commandError}</p> : null}
            <label className="signal-command-reason"><span>Motif obligatoire</span><textarea value={reason} onChange={(event) => onReason(event.target.value)} /></label>
            <TrackedCommandReceipt command={command} />
            <div className="signal-command-actions">
              {data.commandActions.length ? data.commandActions.map((action, index) => (
                <article key={`${action.actionId}-${index}`}>
                  <div><strong>{action.label}</strong><small>{action.capability}</small></div>
                  <StatusBadge tone={permissionTone(action.permission)}>{presentPermission(action.permission).label}</StatusBadge>
                  <DeskButton variant="primary" disabled={action.permission !== "ALLOWED" || !reason.trim() || submittingActionId === action.actionId} onClick={() => onConfirm(action)}>
                    {submittingActionId === action.actionId ? "Envoi…" : "Confirmer"}
                  </DeskButton>
                </article>
              )) : <EvidenceEmpty title="Aucune action autorisée" detail="Le backend ne publie aucune capability opérateur pour ce signal." />}
            </div>
          </DossierSection>
        </aside>
      </div>
    </>
  );
}

function SignalHero({ data, temporal, remainingSec, chartRoute }: { data: LiveSignalDetailView; temporal: SignalTemporalPresentation; remainingSec: number; chartRoute: string }) {
  return (
    <section className="signal-hero" data-tone={temporal.effectiveState === "EXPIRED" ? "expired" : "active"}>
      <div className="signal-hero__identity">
        <span className="signal-hero__direction">{data.signal.direction}</span>
        <div><p>Signal déterministe</p><h2>{data.signal.symbol}</h2><span>{data.signal.regime} · confiance {data.signal.confidence}%</span></div>
      </div>
      <div className="signal-hero__validity">
        <StatusBadge tone={temporal.tone}>{temporal.label}</StatusBadge>
        <strong>{remainingSec > 0 ? formatDuration(remainingSec) : "Fenêtre terminée"}</strong>
        <small>{remainingSec > 0 ? `Expire ${formatDateTime(data.signal.expiresAt)}` : `Expiré ${formatDateTime(data.signal.expiresAt)}`}</small>
      </div>
      <div className="signal-hero__clock">
        <span><small>Généré</small><strong>{formatDateTime(data.signal.generatedAt)}</strong></span>
        <span><small>Cutoff source</small><strong>{formatDateTime(data.featureSnapshot.cutoffAt)}</strong></span>
        <span><small>État backend brut</small><strong>{temporal.backendState}</strong></span>
      </div>
      <div className="signal-hero__actions">
        <Link to={chartRoute}><FaChartLine aria-hidden="true" /> Fenêtre du signal</Link>
        <Link to={`/live?signalId=${encodeURIComponent(data.identity.signalId)}`}><FaBolt aria-hidden="true" /> Chaîne Live</Link>
      </div>
      {temporal.mismatch ? <div className="signal-hero__warning" role="status"><FaExclamationTriangle aria-hidden="true" /><span><strong>État temporel corrigé pour l’affichage</strong>{temporal.detail} La valeur brute reste visible pour l’audit.</span></div> : null}
    </section>
  );
}

function SignalLifecycle({ stages }: { stages: readonly { label: string; state: "done" | "missing" | "pending"; detail: string }[] }) {
  return <ol className="signal-lifecycle" aria-label="Progression du signal">{stages.map((stage, index) => <li key={stage.label} data-state={stage.state}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>)}</ol>;
}

function DossierSection({ eyebrow, title, icon, action, badge, compact = false, children }: { eyebrow: string; title: string; icon: ReactNode; action?: ReactNode; badge?: string; compact?: boolean; children: ReactNode }) {
  return <section className={`signal-dossier-section${compact ? " signal-dossier-section--compact" : ""}`}><header><span className="signal-dossier-section__icon">{icon}</span><div><p>{eyebrow}</p><h2>{title}</h2></div>{badge ? <small>{badge}</small> : null}{action ? <div className="signal-dossier-section__action">{action}</div> : null}</header><div className="signal-dossier-section__body">{children}</div></section>;
}

function TradeMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" | "success" }) { return <div data-tone={tone}><small>{label}</small><strong>{value}</strong></div>; }
function FeatureSnapshot({ data }: { data: LiveSignalDetailView }) { return <div className="signal-feature-snapshot"><FaDatabase aria-hidden="true" /><div><strong>{data.featureSnapshot.featureSnapshotId}</strong><small>{data.featureSnapshot.datasetId} · cutoff {formatDateTime(data.featureSnapshot.cutoffAt)}</small></div><StatusBadge tone={data.featureSnapshot.freshness === "FRESH" ? "success" : data.featureSnapshot.freshness === "STALE" ? "danger" : "warning"}>{presentFreshness(data.featureSnapshot.freshness).label}</StatusBadge></div>; }
function AuthorityCard({ index, title, status, tone, rows, empty }: { index: string; title: string; status: string; tone: "neutral" | "info" | "success" | "warning" | "danger" | "advisory"; rows: readonly (readonly [string, string])[]; empty: string }) { return <article className="signal-authority-card" data-tone={tone}><header><span>{index}</span><div><strong>{title}</strong><small>{status}</small></div></header>{rows.length ? <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>{empty}</p>}</article>; }
function TimelineItem({ at, title, detail, tone, route, badge }: { at: string; title: string; detail: string; tone: "authoritative" | "advisory" | "expired" | "pending"; route?: string; badge?: string }) { const content = <><time dateTime={at}>{formatDateTime(at)}</time><span className="signal-audit-timeline__dot" /><div><strong>{title}</strong><small>{detail}</small></div>{badge ? <em>{badge}</em> : null}</>; return <li data-tone={tone}>{route ? <Link to={route}>{content}</Link> : <div>{content}</div>}</li>; }
function IdentityRow({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd title={value}>{compactId(value)}</dd></div>; }
function EvidenceEmpty({ title, detail }: { title: string; detail: string }) { return <div className="signal-evidence-empty" role="status"><strong>{title}</strong><span>{detail}</span></div>; }

function RelatedRecords({ data }: { data: LiveSignalDetailView }) {
  return <div className="signal-related-records"><section><h3>OrderIntents post-Risk</h3>{data.linkedOrderIntents.length ? data.linkedOrderIntents.map((intent) => <Link className="signal-related-records__link" key={intent.portfolioOrderIntentId} to={intent.route}><div><strong>{intent.instrument} {intent.side} · {intent.quantity}</strong><small>{intent.portfolioOrderIntentId}</small></div><StatusBadge tone="info">{presentBackendStatus(intent.state).label}</StatusBadge></Link>) : <EvidenceEmpty title="Aucun OrderIntent lié" detail="Aucun dossier post-Risk n’est relié à ce signal." />}</section><section><h3>Positions théoriques / broker</h3>{data.existingPositions.length ? data.existingPositions.map((position) => <article key={position.positionId}><div><strong>{position.symbol} {position.side}</strong><small>{position.positionId}</small></div><span>{position.quantity} · {formatSignedR(position.pnlR)}</span></article>) : <EvidenceEmpty title="Aucune position liée" detail="État vide confirmé pour ce signal." />}</section><section><h3>Ordres broker liés</h3>{data.linkedOrders.length ? data.linkedOrders.map((order) => <article key={order.orderId}><div><strong>{order.side} {order.quantity} · {order.type}</strong><small>{order.orderId}</small></div><StatusBadge tone={order.state === "FILLED" || order.state === "ACKED" ? "success" : order.state === "REJECTED" ? "danger" : "warning"}>{presentBackendStatus(order.state).label}</StatusBadge></article>) : <EvidenceEmpty title="Aucun ordre broker lié" detail="Aucun ordre physique n’est supposé tant que l’exécution reste fermée." />}</section></div>;
}

function lifecycleStages(data: LiveSignalDetailView, arbitrationPublished: boolean, riskPublished: boolean) {
  return [
    { label: "Signal", state: "done" as const, detail: formatDateTime(data.signal.generatedAt) },
    { label: "Contexte", state: data.context.length ? "done" as const : "missing" as const, detail: data.context.length ? `${data.context.length} preuve(s)` : "Non lié" },
    { label: "Portfolio", state: arbitrationPublished ? "done" as const : "missing" as const, detail: arbitrationPublished ? presentArbitrationDecision(data.arbitration.decision).label : "Non publié" },
    { label: "Risk", state: riskPublished ? "done" as const : "missing" as const, detail: riskPublished ? presentQueueStatus(data.riskCheck.status).label : "Non publié" },
    { label: "Ordre", state: data.linkedOrders.length ? "done" as const : "missing" as const, detail: data.linkedOrders.length ? `${data.linkedOrders.length} lié(s)` : "Aucun" },
    { label: "Opérateur", state: data.commandActions.length ? "pending" as const : "missing" as const, detail: data.commandActions.length ? "Action disponible" : "Aucune capability" },
  ];
}

function signalChartRoute(data: LiveSignalDetailView): string { const params = new URLSearchParams({ instrument: data.signal.symbol, signalId: data.identity.signalId, chartAt: data.featureSnapshot.cutoffAt || data.signal.generatedAt }); return `/live?${params.toString()}`; }
function isUnavailable(value: string): boolean { return !value || ["UNAVAILABLE", "UNKNOWN", "NONE"].includes(value.trim().toUpperCase()); }
function formatEntryZone(low: number | null, high: number | null): string { const left = formatPublishedPrice(low); const right = formatPublishedPrice(high); if (left === "Non publié" && right === "Non publié") return left; return left === right ? left : `${left} – ${right}`; }
function formatPublishedPrice(value: number | null): string { return Number.isFinite(value) && Number(value) > 0 ? new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value)) : "Non publié"; }
function publishedQuantity(value: number): string { return Number.isFinite(value) && value > 0 ? `${value} contrat${value > 1 ? "s" : ""}` : "Non publié"; }
function formatRatio(value: number | null): string { return Number.isFinite(value) && Number(value) > 0 ? `${Number(value).toFixed(2)} : 1` : "Non publié"; }
function formatSignedR(value: number | null): string { return Number.isFinite(value) && Number(value) !== 0 ? `${Number(value) > 0 ? "+" : "−"}${Math.abs(Number(value)).toFixed(2).replace(".", ",")} R` : "Non publié"; }
function formatDuration(seconds: number): string { const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return `${minutes}m ${String(rest).padStart(2, "0")}s`; }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Non publié" : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date); }
function compactId(value: string): string { return value.length > 34 ? `${value.slice(0, 16)}…${value.slice(-12)}` : value; }
function permissionTone(permission: SignalAction["permission"]) { if (permission === "ALLOWED") return "success"; if (permission === "STEP_UP_REQUIRED") return "warning"; return "danger"; }
