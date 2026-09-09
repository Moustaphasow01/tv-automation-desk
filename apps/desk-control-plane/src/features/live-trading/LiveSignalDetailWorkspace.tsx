import type { ReactNode } from "react";
import { JourneyLink as Link } from "@/features/trading-journey/JourneyNavigation";
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
} from "react-icons/fa";
import { SignalCommandPanel } from "./SignalCommandPanel";
import { SignalRelatedRecords } from "./SignalRelatedRecords";
import { positionR } from "@/features/trading-journey/positionPresentation";
import { StatusBadge } from "@/design-system/primitives";
import {
  presentArbitrationDecision,
  presentEventLane,
  presentFreshness,
  presentGateState,
  presentQueueStatus,
  presentStrategyPredicate,
  presentTradeDecision,
} from "@/design-system/labels";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { operatorCode, operatorCopy, operatorReason } from "@/design-system/operatorVocabulary";
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
  const predicates = data.predicates.filter((predicate) => !isUnavailable(predicate.enumCode) && !isUnavailable(predicate.predicateId));

  return (
    <>
      <SignalHero data={data} temporal={temporal} remainingSec={remainingSec} chartRoute={chartRoute} />

      <div className="signal-dossier-layout">
        <div className="signal-dossier-main">
          <DossierSection eyebrow="Plan proposé" title="Niveaux de la stratégie" icon={<FaBolt aria-hidden="true" />}>
            <div className="signal-trade-plan" aria-label="Plan de trade proposé par la stratégie">
              <TradeMetric label="Zone d’entrée" value={formatEntryZone(data.signal.entryZoneLow, data.signal.entryZoneHigh)} />
              <TradeMetric label="Stop" value={formatPublishedPrice(data.signal.stopPrice)} tone="danger" />
              <TradeMetric label="Cible" value={formatPublishedPrice(data.signal.targetPrice)} tone="success" />
              <TradeMetric label="Ratio rendement / risque" value={formatRatio(data.signal.rewardRisk)} />
              <TradeMetric label="Espérance de gain" value={formatSignedR(data.signal.expectancyR)} />
              <TradeMetric label="Quantité cible" value={publishedQuantity(data.summary.targetQuantity)} />
            </div>
            <p className="signal-section-note">Niveaux du signal en lecture seule. Un plan autorisé exige les décisions publiées d’arbitrage du portefeuille et de contrôle du risque.</p>
          </DossierSection>

          <DossierSection presentation="disclosure" eyebrow="Progression" title="Progression du dossier" icon={<FaRoute aria-hidden="true" />}>
            <SignalLifecycle stages={lifecycle} />
          </DossierSection>

          <DossierSection presentation="disclosure" eyebrow="Preuves" title="Pourquoi ce signal a été publié" icon={<FaCheckCircle aria-hidden="true" />} badge={`${predicates.length} règle${predicates.length > 1 ? "s" : ""}`}>
            {predicates.length ? (
              <div className="signal-evidence-list">
                {predicates.map((predicate, index) => (
                  <article key={`${predicate.predicateId}-${index}`}>
                    <StatusBadge tone={predicate.status === "PASS" ? "success" : predicate.status === "FAIL" ? "danger" : "warning"}>{presentGateState(predicate.status).label}</StatusBadge>
                    <div title={`Code de traçabilité : ${predicate.enumCode}`}><strong>{presentStrategyPredicate(predicate.enumCode).label}</strong><small>Valeur observée : {operatorCode(predicate.observedValue)}</small></div>
                    <span>{operatorCopy(predicate.threshold)}</span>
                  </article>
                ))}
              </div>
            ) : <EvidenceEmpty title="Aucun prédicat détaillé publié" detail="Le signal existe, mais son détail de règles n’est pas présent dans cette projection." />}
            <FeatureSnapshot data={data} />
          </DossierSection>

          <DossierSection presentation="disclosure" eyebrow="Autorités" title="Décisions après le signal" icon={<FaRoute aria-hidden="true" />}>
            <div className="signal-authority-grid">
              <AuthorityCard
                index="01"
                title="Contexte"
                status={data.context.length ? "Publié" : "Sans décision liée"}
                tone={data.context.length ? "info" : "neutral"}
                rows={data.context.map((item) => [operatorCopy(item.label), `${operatorCopy(item.value)} · ${operatorCopy(item.interpretation)}`])}
                empty="Aucune décision contextuelle liée par ID à ce signal."
              />
              <AuthorityCard
                index="02"
                title="Portefeuille"
                status={arbitrationPublished ? presentArbitrationDecision(data.arbitration.decision).label : "Non publié"}
                tone={arbitrationPublished ? (data.arbitration.decision === "REJECTED" ? "danger" : "success") : "neutral"}
                rows={arbitrationPublished ? [["Quantité cible", publishedQuantity(data.arbitration.targetQuantity)], ["Motif", operatorReason(data.arbitration.reasonCode)], ["Corrélation", `${data.arbitration.correlationPct}%`]] : []}
                empty="Aucun arbitrage de portefeuille lié à ce signal."
              />
              <AuthorityCard
                index="03"
                title="Risque global"
                status={riskPublished ? presentQueueStatus(data.riskCheck.status).label : "Non publié"}
                tone={riskPublished ? (data.riskCheck.status === "PASS" ? "success" : data.riskCheck.status === "BLOCK" ? "danger" : "warning") : "neutral"}
                rows={riskPublished ? [["Limite", operatorCopy(data.riskCheck.limitLabel)], ["Motif", operatorReason(data.riskCheck.reasonCode)], ["Quantité autorisée", publishedQuantity(data.riskCheck.roundedQuantity)]] : []}
                empty="Aucune décision de risque liée à ce signal."
              />
              <AuthorityCard
                index="04"
                title="Avis IA"
                status={presentTradeDecision(data.aiAdvisory.recommendation).label}
                tone="advisory"
                rows={[["Rôle", "Consultatif, sans autorité de décision"], ["Synthèse", operatorCopy(data.aiAdvisory.summary)]]}
                empty=""
              />
            </div>
          </DossierSection>

          <DossierSection presentation="disclosure" eyebrow="Filiation" title="Chronologie vérifiable" icon={<FaClock aria-hidden="true" />} badge={`${data.auditTrail.length} événement${data.auditTrail.length > 1 ? "s" : ""}`}>
            <ol className="signal-audit-timeline">
              <TimelineItem at={data.signal.generatedAt} title="Signal publié" detail={`${data.signal.symbol} · ${operatorCode(data.signal.direction)}`} tone="authoritative" />
              {data.auditTrail.map((event, index) => (
                <TimelineItem key={`${event.eventId}-${index}`} at={event.at} title={operatorCopy(event.title)} detail={operatorCopy(event.domain)} tone={event.lane === "ADVISORY" ? "advisory" : "authoritative"} route={event.route} badge={presentEventLane(event.lane).label} />
              ))}
              <TimelineItem at={data.signal.expiresAt} title="Fin de validité contractuelle" detail={temporal.effectiveState === "EXPIRED" ? "Échéance dépassée" : "Échéance future"} tone={temporal.effectiveState === "EXPIRED" ? "expired" : "pending"} />
            </ol>
          </DossierSection>
        </div>

        <aside className="signal-dossier-sidebar" aria-label="Contexte et actions du dossier">
          <DossierSection presentation="disclosure" eyebrow="Origine" title="Traçabilité" icon={<FaFingerprint aria-hidden="true" />} compact>
            <dl className="signal-identity-list">
              <IdentityRow label="Signal" value={data.identity.signalId} />
              <IdentityRow label="Stratégie" value={data.identity.strategyId} />
              <IdentityRow label="Version" value={data.identity.strategyVersionId} />
              <IdentityRow label="Instance" value={data.identity.strategyInstanceId} />
              <IdentityRow label="État instantané" value={data.identity.featureSnapshotId} />
              <IdentityRow label="Données arrêtées à" value={formatDateTime(data.featureSnapshot.cutoffAt)} />
              <IdentityRow label="Corrélation" value={data.identity.correlationId} />
            </dl>
            <nav className="signal-related-links" aria-label="Objets liés">
              {data.navigation.map((item) => <Link key={`${item.kind}-${item.route}`} to={item.route}>{item.kind === "STRATEGY" ? <FaProjectDiagram aria-hidden="true" /> : item.kind === "PORTFOLIO" ? <FaBalanceScale aria-hidden="true" /> : <FaRoute aria-hidden="true" />}{operatorCopy(item.label)}</Link>)}
              <Link to="/events"><FaRoute aria-hidden="true" /> Journal d’audit</Link>
            </nav>
          </DossierSection>

          <DossierSection eyebrow="Conséquences" title="Positions et ordres liés" icon={<FaDatabase aria-hidden="true" />} compact>
            <SignalRelatedRecords data={data} />
          </DossierSection>

          <SignalCommandPanel actions={data.commandActions} reason={reason} command={command} error={commandError} submittingActionId={submittingActionId} onReason={onReason} onConfirm={onConfirm} />
        </aside>
      </div>
    </>
  );
}

function SignalHero({ data, temporal, remainingSec, chartRoute }: { data: LiveSignalDetailView; temporal: SignalTemporalPresentation; remainingSec: number; chartRoute: string }) {
  return (
    <section className="signal-hero" data-tone={temporal.effectiveState === "EXPIRED" ? "expired" : "active"}>
      <div className="signal-hero__identity">
        <span className="signal-hero__direction">{operatorCode(data.signal.direction)}</span>
        <div><p>Signal déterministe</p><h2>{data.signal.symbol}</h2><span>{operatorCode(data.signal.regime)} · confiance {data.signal.confidence}%</span></div>
      </div>
      <div className="signal-hero__validity">
        <StatusBadge tone={temporal.tone}>{temporal.label}</StatusBadge>
        <strong>{remainingSec > 0 ? formatDuration(remainingSec) : "Fenêtre terminée"}</strong>
        <small>{remainingSec > 0 ? `Expire ${formatDateTime(data.signal.expiresAt)}` : `Expiré ${formatDateTime(data.signal.expiresAt)}`}</small>
      </div>
      <div className="signal-hero__clock">
        <span><small>Généré</small><strong>{formatDateTime(data.signal.generatedAt)}</strong></span>
        <span><small>Données arrêtées à</small><strong>{formatDateTime(data.featureSnapshot.cutoffAt)}</strong></span>
        <details><summary>Traçabilité</summary><strong title="État technique fourni par le backend">{operatorCode(temporal.backendState)}</strong></details>
      </div>
      <div className="signal-hero__actions">
        <Link to={chartRoute}><FaChartLine aria-hidden="true" /> Fenêtre du signal</Link>
        <Link to={`/live?signalId=${encodeURIComponent(data.identity.signalId)}`}><FaBolt aria-hidden="true" /> Chaîne Live</Link>
      </div>
      {temporal.mismatch ? <div className="signal-hero__warning" role="status"><FaExclamationTriangle aria-hidden="true" /><span><strong>État temporel corrigé pour l’affichage</strong>{temporal.detail} L’état d’origine reste consultable dans Traçabilité.</span></div> : null}
    </section>
  );
}

function SignalLifecycle({ stages }: { stages: readonly { label: string; state: "done" | "missing" | "pending"; detail: string }[] }) {
  return <ol className="signal-lifecycle" aria-label="Progression du signal">{stages.map((stage, index) => <li key={stage.label} data-state={stage.state}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>)}</ol>;
}

function DossierSection({ title, icon, action, badge, compact = false, presentation = "section", children }: { eyebrow: string; title: string; icon: ReactNode; action?: ReactNode; badge?: string; compact?: boolean; presentation?: "section" | "disclosure"; children: ReactNode }) {
  if (presentation === "disclosure") return <details className="dj-disclosure signal-disclosure"><summary>{title}{badge ? <small> · {badge}</small> : null}</summary><div>{children}</div></details>;
  return <section className={`signal-dossier-section${compact ? " signal-dossier-section--compact" : ""}`}><header><span className="signal-dossier-section__icon">{icon}</span><h2>{title}</h2>{badge ? <small>{badge}</small> : null}{action ? <div className="signal-dossier-section__action">{action}</div> : null}</header><div className="signal-dossier-section__body">{children}</div></section>;
}

function TradeMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" | "success" }) { return <div data-tone={tone}><small>{label}</small><strong>{value}</strong></div>; }
function FeatureSnapshot({ data }: { data: LiveSignalDetailView }) { return <div className="signal-feature-snapshot" title={`État instantané : ${data.featureSnapshot.featureSnapshotId}`}><FaDatabase aria-hidden="true" /><div><strong>État des données au déclenchement</strong><small>{operatorCopy(data.featureSnapshot.datasetId)} · arrêté à {formatDateTime(data.featureSnapshot.cutoffAt)}</small></div><StatusBadge tone={data.featureSnapshot.freshness === "FRESH" ? "success" : data.featureSnapshot.freshness === "STALE" ? "danger" : "warning"}>{presentFreshness(data.featureSnapshot.freshness).label}</StatusBadge></div>; }
function AuthorityCard({ index, title, status, tone, rows, empty }: { index: string; title: string; status: string; tone: "neutral" | "info" | "success" | "warning" | "danger" | "advisory"; rows: readonly (readonly [string, string])[]; empty: string }) { return <article className="signal-authority-card" data-tone={tone}><header><span>{index}</span><div><strong>{title}</strong><small>{status}</small></div></header>{rows.length ? <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>{empty}</p>}</article>; }
function TimelineItem({ at, title, detail, tone, route, badge }: { at: string; title: string; detail: string; tone: "authoritative" | "advisory" | "expired" | "pending"; route?: string; badge?: string }) { const content = <><time dateTime={at}>{formatDateTime(at)}</time><span className="signal-audit-timeline__dot" /><div><strong>{title}</strong><small>{detail}</small></div>{badge ? <em>{badge}</em> : null}</>; return <li data-tone={tone}>{route ? <Link to={route}>{content}</Link> : <div>{content}</div>}</li>; }
function IdentityRow({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd title={value}>{compactId(value)}</dd></div>; }
function EvidenceEmpty({ title, detail }: { title: string; detail: string }) { return <div className="signal-evidence-empty" role="status"><strong>{title}</strong><span>{detail}</span></div>; }

function lifecycleStages(data: LiveSignalDetailView, arbitrationPublished: boolean, riskPublished: boolean) {
  return [
    { label: "Signal", state: "done" as const, detail: formatDateTime(data.signal.generatedAt) },
    { label: "Contexte", state: data.context.length ? "done" as const : "missing" as const, detail: data.context.length ? `${data.context.length} preuve(s)` : "Non lié" },
    { label: "Portefeuille", state: arbitrationPublished ? "done" as const : "missing" as const, detail: arbitrationPublished ? presentArbitrationDecision(data.arbitration.decision).label : "Non publié" },
    { label: "Risque", state: riskPublished ? "done" as const : "missing" as const, detail: riskPublished ? presentQueueStatus(data.riskCheck.status).label : "Non publié" },
    { label: "Ordre", state: data.linkedOrders.length ? "done" as const : "missing" as const, detail: data.linkedOrders.length ? `${data.linkedOrders.length} lié(s)` : "Aucun" },
    { label: "Votre validation", state: data.commandActions.length ? "pending" as const : "missing" as const, detail: data.commandActions.length ? "Action disponible" : "Aucune action possible" },
  ];
}

function signalChartRoute(data: LiveSignalDetailView): string { const params = new URLSearchParams({ instrument: data.signal.symbol, signalId: data.identity.signalId, chartAt: data.featureSnapshot.cutoffAt || data.signal.generatedAt }); return `/live?${params.toString()}`; }
function isUnavailable(value: string): boolean { return !value || ["UNAVAILABLE", "UNKNOWN", "NONE"].includes(value.trim().toUpperCase()); }
function formatEntryZone(low: number | null, high: number | null): string { const left = formatPublishedPrice(low); const right = formatPublishedPrice(high); if (left === "Non publié" && right === "Non publié") return left; return left === right ? left : `${left} – ${right}`; }
function formatPublishedPrice(value: number | null): string { return Number.isFinite(value) && Number(value) > 0 ? new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(Number(value)) : "Non publié"; }
function publishedQuantity(value: number): string { return Number.isFinite(value) && value > 0 ? `${value} contrat${value > 1 ? "s" : ""}` : "Non publié"; }
function formatRatio(value: number | null): string { return Number.isFinite(value) && Number(value) > 0 ? `${Number(value).toFixed(2)} : 1` : "Non publié"; }
function formatSignedR(value: number | null): string { return positionR(value); }
function formatDuration(seconds: number): string { const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return `${minutes}m ${String(rest).padStart(2, "0")}s`; }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Non publié" : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date); }
function compactId(value: string): string { return value.length > 34 ? `${value.slice(0, 16)}…${value.slice(-12)}` : value; }
