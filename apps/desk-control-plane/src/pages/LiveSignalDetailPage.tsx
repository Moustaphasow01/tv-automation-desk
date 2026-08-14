import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FaBalanceScale,
  FaBolt,
  FaCheckCircle,
  FaClock,
  FaDatabase,
  FaExchangeAlt,
  FaFingerprint,
  FaProjectDiagram,
  FaRobot,
  FaShieldAlt,
  FaStream
} from "react-icons/fa";
import { DeskButton, TrackedCommandReceipt } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { LiveSignalDetailView } from "@/domains/front-api/viewModels";

type SignalAction = LiveSignalDetailView["commandActions"][number];

export function LiveSignalDetailPage() {
  const { signalId } = useParams();
  const query = useFrontView("live-signal-detail", { signalId });
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : confirmer la décision affichée par le backend.");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const nowMs = useAnchoredClock(query.data?.meta.asOf ?? "2026-08-10T09:40:00.000Z");

  if (query.isLoading) {
    return <LiveSignalLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Signal indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucun signal" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/live-signal-detail`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const requestedSignalId = signalId ?? data.identity.signalId;
  const idMismatch = requestedSignalId !== data.identity.signalId;
  const remainingSec = Math.max(0, Math.floor((Date.parse(data.signal.expiresAt) - nowMs) / 1000));

  const confirmAction = async (action: SignalAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildLiveSignalCommand(action, data, reason));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "LIVE_SIGNAL_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page live-signal-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title={`${data.signal.symbol} ${data.signal.direction} · ${data.signal.state}`}
        description={`${data.identity.signalId} · ${data.signal.regime} · snapshot ${data.identity.featureSnapshotId} · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to="/live">Retour Live</Link>
            <Link className="operator-primary-action" to="/events">Ouvrir audit</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs signal live">
        <KpiCard label="SCORE SIGNAL" value={`${data.summary.signalScore}`} delta={`${data.signal.confidence}% confiance`} tone="success" />
        <KpiCard label="EXPIRATION" value={remainingSec > 0 ? formatDuration(remainingSec) : "EXPIRED"} delta={formatTime(data.signal.expiresAt)} tone={remainingSec > 0 ? "warning" : "danger"} />
        <KpiCard label="PROBA ACCEPT." value={`${data.summary.acceptanceProbabilityPct}%`} delta="DTO backend" tone="success" />
        <KpiCard label="TAILLE CIBLE" value={`${data.summary.targetQuantity}`} delta={`arrondi ${data.riskCheck.roundedQuantity} contrats`} tone="info" />
        <KpiCard label="RISQUE UTILISÉ" value={`${data.summary.riskUsedPct}%`} delta={data.riskCheck.reasonCode} detail={<ProgressBar value={data.summary.riskUsedPct} tone="success" />} tone="success" />
        <KpiCard label="CONFLITS" value={`${data.summary.conflictCount}`} delta={data.arbitration.conflictStatus} tone={data.summary.conflictCount > 0 ? "warning" : "success"} />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Contexte, prédicats et risk check">
        <Card title="Signal déterministe" actions={<InlineAction>{idMismatch ? "ID mismatch" : "Signal scope"}</InlineAction>} tone={idMismatch ? "warning" : "neutral"} density="compact">
          <div className="live-signal-identity">
            <article className="live-signal-main-ticket">
              <FaBolt />
              <div>
                <strong>{data.signal.symbol} {data.signal.direction}</strong>
                <small>{formatTime(data.signal.generatedAt)} → {formatTime(data.signal.expiresAt)}</small>
              </div>
              <StatusBadge tone={signalStateTone(data.signal.state)}>{data.signal.state}</StatusBadge>
            </article>
            <div className="live-signal-price-grid">
              <MetricBox label="Entry low" value={formatPrice(data.signal.entryZoneLow)} />
              <MetricBox label="Entry high" value={formatPrice(data.signal.entryZoneHigh)} />
              <MetricBox label="Stop" value={formatPrice(data.signal.stopPrice)} />
              <MetricBox label="Target" value={formatPrice(data.signal.targetPrice)} />
              <MetricBox label="Expectancy" value={formatSignedR(data.signal.expectancyR)} />
              <MetricBox label="RR" value={data.signal.rewardRisk.toFixed(1)} />
            </div>
            <div className="live-signal-link-grid">
              <Link to={`/strategies/${data.identity.strategyId}`}><FaProjectDiagram /> Stratégie</Link>
              <Link to={data.arbitration.portfolioRoute}><FaBalanceScale /> Portfolio</Link>
              <Link to="/events"><FaStream /> Events</Link>
            </div>
          </div>
        </Card>

        <Card title="Prédicats & Feature Snapshot" actions={<InlineAction>Point-in-time</InlineAction>} density="compact">
          <div className="live-signal-predicate-list">
            {data.predicates.map((predicate) => (
              <article key={predicate.predicateId}>
                <FaCheckCircle />
                <div><strong>{predicate.label}</strong><small>{predicate.enumCode} · {predicate.observedValue}</small></div>
                <span>{predicate.threshold}</span>
                <StatusBadge tone={predicate.status === "PASS" ? "success" : predicate.status === "FAIL" ? "danger" : "warning"}>{predicate.status}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="live-signal-feature-strip">
            <FaDatabase />
            <div>
              <strong>{data.featureSnapshot.featureSnapshotId}</strong>
              <small>{data.featureSnapshot.datasetId} · {data.featureSnapshot.hash} · cutoff {formatTime(data.featureSnapshot.cutoffAt)}</small>
            </div>
            <StatusBadge tone={data.featureSnapshot.freshness === "FRESH" ? "success" : data.featureSnapshot.freshness === "STALE" ? "danger" : "warning"}>
              {data.featureSnapshot.freshness}
            </StatusBadge>
          </div>
        </Card>

        <Card title="Portfolio Arbitration & Global Risk" actions={<InlineAction>Risk check</InlineAction>} density="compact">
          <div className="live-signal-risk-hero">
            <article>
              <FaExchangeAlt />
              <div><strong>{data.arbitration.decision} · {data.arbitration.targetQuantity} contrats</strong><small>{data.arbitration.reasonCode}</small></div>
              <b>{data.arbitration.correlationPct}%</b>
              <StatusBadge tone={data.arbitration.decision === "ACCEPTED" ? "success" : data.arbitration.decision === "SCALED" ? "warning" : "danger"}>{data.arbitration.conflictStatus}</StatusBadge>
            </article>
            <article>
              <FaShieldAlt />
              <div><strong>{data.riskCheck.status} · {data.riskCheck.limitLabel}</strong><small>{data.riskCheck.reasonCode}</small></div>
              <b>{data.riskCheck.usedPct}%</b>
              <ProgressBar value={data.riskCheck.usedPct} tone={data.riskCheck.status === "PASS" ? "success" : data.riskCheck.status === "BLOCK" ? "danger" : "warning"} />
            </article>
          </div>
          <div className="live-signal-risk-grid">
            <MetricBox label="Capital net" value={formatMoney(data.riskCheck.netCapital)} />
            <MetricBox label="Risque max" value={`${data.riskCheck.maxRiskPct}%`} />
            <MetricBox label="R cible" value={formatSignedR(data.riskCheck.targetRiskR)} />
            <MetricBox label="Contrats" value={`${data.riskCheck.roundedQuantity}`} />
          </div>
          <div className="live-signal-conflict-list">
            {data.conflicts.map((conflict) => (
              <article key={conflict.conflictId}>
                <div><strong>{conflict.label}</strong><small>{conflict.kind} · {conflict.targetId}</small></div>
                <StatusBadge tone={conflict.severity === "HIGH" ? "danger" : conflict.severity === "MEDIUM" ? "warning" : "accent"}>{conflict.resolution}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Contexte, ordres et commandes">
        <Card title="Contexte marché & positions" actions={<InlineAction>Context</InlineAction>} density="compact">
          <div className="live-signal-context-list">
            {data.context.map((item) => (
              <article key={item.contextId}>
                <div><strong>{item.label}</strong><small>{item.interpretation}</small></div>
                <b className={contextToneClass(item.tone)}>{item.value}</b>
                <StatusBadge tone={contextTone(item.tone)}>{item.tone}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="live-signal-position-list">
            {data.existingPositions.map((position) => (
              <article key={position.positionId}>
                <div><strong>{position.symbol} {position.side}</strong><small>{position.strategyInstanceId}</small></div>
                <span>{position.quantity}</span>
                <b className={position.pnlR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(position.pnlR)}</b>
                <small>{formatSignedR(position.riskR)} risk</small>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Ordres liés & audit trail" actions={<InlineAction>Orders</InlineAction>} density="compact">
          <div className="live-signal-order-list">
            {data.linkedOrders.map((order) => (
              <article key={order.orderId}>
                <div><strong>{order.side} {order.quantity} · {order.type}</strong><small>{order.orderId} · {order.brokerOrderId}</small></div>
                <span>{order.limitPrice ? formatPrice(order.limitPrice) : "MKT"}</span>
                <StatusBadge tone={order.state === "ACKED" || order.state === "FILLED" ? "success" : order.state === "REJECTED" ? "danger" : "warning"}>{order.state}</StatusBadge>
              </article>
            ))}
          </div>
          <ol className="live-signal-audit-list">
            {data.auditTrail.map((event) => (
              <li key={event.eventId} className={event.lane === "ADVISORY" ? "live-signal-audit-list__advisory" : undefined}>
                <span><FaClock />{formatTime(event.at)}</span>
                <div><strong>{event.title}</strong><small>{event.domain} · {event.eventId}</small></div>
                <StatusBadge tone={event.lane === "ADVISORY" ? "accent" : "success"}>{event.lane}</StatusBadge>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Décision opérateur" actions={<InlineAction>Command Runtime</InlineAction>} density="compact">
          <div className="live-signal-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière décision signal</small>
              <strong>{command ? `ACCEPTED · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <label className="live-signal-reason">
            <span>Reason obligatoire</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="live-signal-actions">
            <TrackedCommandReceipt command={command} />
            {data.commandActions.map((action) => (
              <article key={action.actionId}>
                <span>{actionIcon(action.decision)}</span>
                <div><strong>{action.label}</strong><small>{action.capability} · expected {compactId(data.identity.expectedVersion)}</small></div>
                <StatusBadge tone={permissionTone(action.permission)}>{action.permission}</StatusBadge>
                <DeskButton
                  variant="primary"
                  disabled={action.permission !== "ALLOWED" || reason.trim().length === 0 || submittingActionId === action.actionId}
                  onClick={() => confirmAction(action)}
                >
                  {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                </DeskButton>
              </article>
            ))}
          </div>
          <div className="live-signal-ai-shadow">
            <FaRobot />
            <div>
              <strong>AI Context Gate · {data.aiAdvisory.mode} · authority {data.aiAdvisory.authority}</strong>
              <small>{data.aiAdvisory.summary}</small>
            </div>
            <StatusBadge tone="accent">{data.aiAdvisory.recommendation}</StatusBadge>
          </div>
        </Card>
      </section>
    </div>
  );
}

export function buildLiveSignalCommand(action: SignalAction, data: LiveSignalDetailView, reason: string): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("LIVE_SIGNAL_REASON_REQUIRED"), { code: "LIVE_SIGNAL_REASON_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: data.identity.expectedVersion,
    reason: normalizedReason,
    payload: {
      signalId: data.identity.signalId,
      strategyId: data.identity.strategyId,
      strategyDefinitionId: data.identity.strategyDefinitionId,
      strategyVersionId: data.identity.strategyVersionId,
      strategyInstanceId: data.identity.strategyInstanceId,
      runtimeBundleId: data.identity.runtimeBundleId,
      sessionId: data.identity.sessionId,
      correlationId: data.identity.correlationId,
      featureSnapshotId: data.identity.featureSnapshotId,
      actionId: action.actionId,
      decision: action.decision,
      ...action.payload
    }
  };
}

function LiveSignalLoading() {
  return (
    <div className="operator-page live-signal-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function useAnchoredClock(anchorIso: string) {
  const anchorMs = Date.parse(anchorIso);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [anchorIso]);

  return (Number.isNaN(anchorMs) ? Date.now() : anchorMs) + elapsedMs;
}

function actionIcon(decision: SignalAction["decision"]) {
  if (decision === "TAKE") return <FaBolt />;
  if (decision === "TAKE_REDUCED") return <FaBalanceScale />;
  if (decision === "REJECT") return <FaShieldAlt />;
  return <FaClock />;
}

function signalStateTone(state: LiveSignalDetailView["signal"]["state"]) {
  if (state === "ARBITRATED" || state === "ORDERED" || state === "FILLED") return "success";
  if (state === "REJECTED" || state === "EXPIRED") return "danger";
  return "accent";
}

function contextTone(tone: LiveSignalDetailView["context"][number]["tone"]) {
  if (tone === "POSITIVE") return "success";
  if (tone === "NEGATIVE") return "danger";
  if (tone === "WATCH") return "warning";
  return "neutral";
}

function contextToneClass(tone: LiveSignalDetailView["context"][number]["tone"]) {
  if (tone === "POSITIVE") return "text-success";
  if (tone === "NEGATIVE") return "text-danger";
  if (tone === "WATCH") return "text-warning";
  return "";
}

function permissionTone(permission: SignalAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
    notation: "compact"
  }).format(value);
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function compactId(value: string) {
  if (value.length <= 24) return value;
  return `${value.slice(0, 11)}…${value.slice(-8)}`;
}
