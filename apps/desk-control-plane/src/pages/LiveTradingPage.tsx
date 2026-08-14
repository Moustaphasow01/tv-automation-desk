import { Link } from "react-router-dom";
import {
  FaBolt,
  FaBroadcastTower,
  FaCheckCircle,
  FaExchangeAlt,
  FaExclamationTriangle,
  FaRobot,
  FaShieldAlt,
  FaStream,
  FaSyncAlt
} from "react-icons/fa";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView } from "@/domains/front-api/repositories";
import type { LiveTradingView } from "@/domains/front-api/viewModels";

type LiveSignal = LiveTradingView["signals"][number];
type LiveOrder = LiveTradingView["orders"][number];
type LivePosition = LiveTradingView["positions"][number];

export function LiveTradingPage() {
  const query = useFrontView("live-trading");

  if (query.isLoading) {
    return <LiveTradingLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Live Trading indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée live" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/live-trading`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;

  return (
    <div className="operator-page live-trading-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Live Trading & Risk"
        description={`${data.session.tradingDate} · ${data.session.phase} · prochain monitor ${formatTime(data.session.nextMonitorAt)} · chemin déterministe autoritaire.`}
        actions={
          <>
            <Link to="/demo-paper-readiness">Readiness PAPER</Link>
            <Link className="operator-primary-action" to="/execution/incidents">Voir les incidents</Link>
          </>
        }
      />

      <Card
        title={data.launchGate.status === "READY" ? "Agents PAPER autorisés" : "Agents PAPER bloqués"}
        eyebrow="Launch gate démo/PAPER"
        tone={data.launchGate.status === "READY" ? "success" : "danger"}
        density="compact"
        actions={<StatusBadge tone={data.launchGate.status === "READY" ? "success" : "danger"}>{data.launchGate.status}</StatusBadge>}
      >
        <div className="live-launch-gate">
          <div className="live-launch-gate__summary">
            <div>
              <strong>{data.launchGate.status === "READY" ? "Le chemin live peut recevoir les agents en Simulation/PAPER." : "Le desk reste fail-closed avant tout ordre Sim101."}</strong>
              <small>Décision release : <code>{data.launchGate.finalDecision}</code></small>
            </div>
            <div>
              <small>Dernier contrôle {formatTime(data.launchGate.checkedAt)}</small>
              <small>Gate global : <code>{data.launchGate.releaseCheckCommand}</code></small>
            </div>
          </div>
          <div className="live-launch-gate__components" aria-label="Composants décision release">
            {data.launchGate.components.map((component) => (
              <article key={component.componentId}>
                <StatusBadge tone={component.status === "READY" ? "success" : component.status === "BLOCKED" ? "danger" : "warning"}>{component.status}</StatusBadge>
                <div>
                  <strong>{component.label}</strong>
                  <small>{component.blockers.length ? component.blockers.join(" · ") : component.componentId}</small>
                </div>
              </article>
            ))}
          </div>
          <div className="live-launch-gate__checks" aria-label="Contrôles lancement démo PAPER">
            {data.launchGate.checks.map((check) => (
              <article key={check.id}>
                <StatusBadge tone={check.ok ? "success" : "danger"}>{check.ok ? "OK" : "BLOCK"}</StatusBadge>
                <div>
                  <strong>{check.label}</strong>
                  <small>{check.id} · {check.detail}</small>
                </div>
              </article>
            ))}
          </div>
          {data.launchGate.blockers.length ? (
            <ol className="live-launch-gate__blockers">
              {data.launchGate.blockers.slice(0, 4).map((blocker) => (
                <li key={blocker.id}>
                  <strong>{blocker.title}</strong>
                  <span>{blocker.evidence}</span>
                  <small>{blocker.action}</small>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </Card>

      <section className="operator-kpi-strip" aria-label="Indicateurs Live Trading">
        <KpiCard label="SIGNAUX DU JOUR" value={`${data.summary.signalsToday}`} delta={`${data.signals.length} actifs dans le bus`} tone="info" />
        <KpiCard label="TRADES EXÉCUTÉS" value={`${data.summary.tradesExecuted}`} delta={`${data.fills.length} fills récents`} tone="success" />
        <KpiCard label="TAUX ACCEPTATION" value={formatPercent(data.summary.acceptanceRatePct)} delta="Arbitrage portfolio" tone="success" />
        <KpiCard label="RISQUE UTILISÉ" value={formatPercent(data.summary.riskUsedPct)} delta="Calcul officiel backend" detail={<ProgressBar value={data.summary.riskUsedPct} tone="warning" />} tone="warning" />
        <KpiCard label="EXPO CORRÉLÉE" value={formatPercent(data.summary.correlatedExposurePct)} delta="Snapshot portfolio" tone="info" />
        <KpiCard label="DRAWDOWN LIVE" value={formatSignedR(data.summary.liveDrawdownR)} delta={`Projection ${meta.latencyMs} ms`} tone="warning" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Pipeline, signaux et risque">
        <Card title="Pipeline déterministe" actions={<InlineAction>Voir Event Explorer</InlineAction>} density="compact">
          <ol className="live-pipeline">
            {data.pipeline.map((step) => (
              <li key={step.stepId} className={`live-pipeline__step live-pipeline__step--${step.status.toLowerCase()}`}>
                <span>{pipelineIcon(step.status)}</span>
                <div><strong>{step.label}</strong><small>{step.detail}</small></div>
                <b>{step.latencyMs} ms</b>
                <StatusBadge tone={liveStatusTone(step.status)}>{step.status}</StatusBadge>
              </li>
            ))}
            {!data.pipeline.length ? <li className="data-empty-state">Pipeline détaillé non publié par le backend.</li> : null}
          </ol>
        </Card>

        <Card title="Signal Bus temps réel" actions={<InlineAction>Signaux</InlineAction>} density="compact">
          <DataTable rows={data.signals} rowKey={(row) => row.signalId} columns={signalColumns} />
          <MobileDataList
            rows={data.signals}
            rowKey={(row) => row.signalId}
            renderTitle={(row) => `${row.symbol} ${row.direction}`}
            renderMeta={(row) => `${row.state} · ${row.strategyId}`}
            renderBody={(row) => `${row.regime} · ${row.ruleHits.join(", ")}`}
          />
          <div className="live-ai-advisory">
            <FaRobot />
            <div><strong>AI Context Gate · {data.aiAdvisory.mode}</strong><small>{data.aiAdvisory.summary}</small></div>
          </div>
        </Card>

        <Card title="Arbitrage & Global Risk" actions={<InlineAction>Risk Center</InlineAction>} density="compact">
          <div className="live-arbitration-list">
            {data.arbitrations.map((arbitration) => (
              <article key={arbitration.arbitrationId}>
                <span><FaExchangeAlt /></span>
                <div><strong>{arbitration.decision} · {arbitration.targetQuantity} lot(s)</strong><small>{arbitration.reasonCode}</small></div>
                <b>{formatPercent(arbitration.correlationPct)}</b>
                <StatusBadge tone={arbitration.decision === "ACCEPTED" ? "success" : arbitration.decision === "SCALED" ? "warning" : "danger"}>
                  {arbitration.conflictStatus}
                </StatusBadge>
              </article>
            ))}
            {!data.arbitrations.length ? <p className="data-empty-state">Aucune décision d’arbitrage canonique publiée.</p> : null}
          </div>
          <div className="live-risk-list">
            {data.riskChecks.map((risk) => (
              <article key={risk.riskCheckId}>
                <div><strong>{risk.limitLabel}</strong><small>{risk.reasonCode}</small></div>
                <span>{formatPercent(risk.usedPct)}</span>
                <ProgressBar value={risk.usedPct} tone={risk.status === "BLOCK" ? "danger" : risk.status === "WATCH" ? "warning" : "success"} />
                <StatusBadge tone={risk.status === "PASS" ? "success" : risk.status === "BLOCK" ? "danger" : "warning"}>{risk.status}</StatusBadge>
              </article>
            ))}
            {!data.riskChecks.length ? <p className="data-empty-state">Aucun contrôle risque canonique publié.</p> : null}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Ordres, providers et timeline">
        <Card title="Orders, fills & positions" actions={<InlineAction>Orders</InlineAction>} density="compact">
          <div className="live-order-position-grid">
            <DataTable rows={data.orders} rowKey={(row) => row.orderId} columns={orderColumns} />
            <div className="live-position-list">
              {data.positions.map((position) => (
                <article key={position.positionId}>
                  <div><strong>{position.symbol} {position.side}</strong><small>{position.strategyInstanceId}</small></div>
                  <span>{position.quantity}</span>
                  <span className={position.pnlR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(position.pnlR)}</span>
                  <StatusBadge tone={position.protectionStatus === "PROTECTED" ? "success" : position.protectionStatus === "PENDING" ? "warning" : "danger"}>{position.protectionStatus}</StatusBadge>
                </article>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Providers & reconciliation" actions={<InlineAction>Providers</InlineAction>} density="compact">
          <div className="live-provider-list">
            {data.providers.map((provider) => (
              <article key={provider.providerId}>
                <span><FaBroadcastTower /></span>
                <div><strong>{provider.label}</strong><small>{provider.mode} · heartbeat {formatTime(provider.lastHeartbeatAt)}</small></div>
                <b>{provider.latencyMs} ms</b>
                <StatusBadge tone={provider.status === "OK" ? "success" : provider.status === "DEGRADED" ? "warning" : "danger"}>{provider.status}</StatusBadge>
              </article>
            ))}
            {!data.providers.length ? <p className="data-empty-state">Aucun état provider canonique publié.</p> : null}
          </div>
          <div className="live-incidents">
            {data.incidents.map((incident) => (
              <article key={incident.incidentId}>
                <FaExclamationTriangle />
                <div><strong>{incident.title}</strong><small>{incident.detail}</small></div>
                <StatusBadge tone={incident.severity === "HIGH" ? "danger" : incident.severity === "MEDIUM" ? "warning" : "accent"}>{incident.severity}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Timeline live de bout en bout" actions={<InlineAction>Timeline complète</InlineAction>} density="compact">
          <ol className="live-end-to-end-timeline">
            {data.timeline.map((event) => (
              <li key={event.eventId}>
                <span><FaStream />{formatTime(event.at)}</span>
                <div><strong>{event.title}</strong><small>{event.step} · {event.detail}</small></div>
                <StatusBadge tone={event.tone === "HIGH" ? "danger" : event.tone === "WATCH" ? "warning" : "accent"}>{event.tone}</StatusBadge>
              </li>
            ))}
          </ol>
          <div className="live-safe-actions">
            <Link to="/portfolio"><FaShieldAlt /> Exposition portfolio</Link>
            <Link to="/execution/incidents"><FaSyncAlt /> Réconciliation</Link>
          </div>
        </Card>
      </section>
    </div>
  );
}

const signalColumns = [
  { key: "signal", header: "Signal", render: (row: LiveSignal) => <SignalCell row={row} /> },
  { key: "strategy", header: "Stratégie", render: (row: LiveSignal) => row.strategyId },
  { key: "side", header: "Côté", render: (row: LiveSignal) => <StatusBadge tone={row.direction === "LONG" ? "success" : "danger"}>{row.direction}</StatusBadge> },
  { key: "state", header: "État", render: (row: LiveSignal) => <StatusBadge tone={signalStateTone(row.state)}>{row.state}</StatusBadge> },
  { key: "conf", header: "Conf.", align: "right" as const, render: (row: LiveSignal) => `${row.confidence}%` },
  { key: "rr", header: "RR", align: "right" as const, render: (row: LiveSignal) => row.rewardRisk.toFixed(1) },
  { key: "exp", header: "Exp.", align: "right" as const, render: (row: LiveSignal) => `${row.expectancyR.toFixed(2)} R` }
] as const;

const orderColumns = [
  { key: "order", header: "Order", render: (row: LiveOrder) => <OrderCell row={row} /> },
  { key: "provider", header: "Provider", render: (row: LiveOrder) => row.providerId.replace("provider_", "") },
  { key: "side", header: "Side", render: (row: LiveOrder) => <StatusBadge tone={row.side === "BUY" ? "success" : "danger"}>{row.side}</StatusBadge> },
  { key: "type", header: "Type", render: (row: LiveOrder) => row.type },
  { key: "qty", header: "Qté", align: "right" as const, render: (row: LiveOrder) => row.quantity },
  { key: "state", header: "État", render: (row: LiveOrder) => <StatusBadge tone={orderStateTone(row.state)}>{row.state}</StatusBadge> }
] as const;

function SignalCell({ row }: { row: LiveSignal }) {
  return (
    <Link className="live-table-link" to={`/live/signals/${row.signalId}`}>
      <strong>{row.symbol} {row.direction}</strong>
      <small>{row.signalId} · {row.regime}</small>
    </Link>
  );
}

function OrderCell({ row }: { row: LiveOrder }) {
  return (
    <Link className="live-table-link" to={`/execution/orders/${encodeURIComponent(row.orderId)}`}>
      <strong>{row.symbol} · {row.brokerOrderId}</strong>
      <small>{row.orderId}</small>
    </Link>
  );
}

function LiveTradingLoading() {
  return (
    <div className="operator-page live-trading-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function pipelineIcon(status: LiveTradingView["pipeline"][number]["status"]) {
  if (status === "OK") return <FaCheckCircle />;
  if (status === "BLOCKED") return <FaExclamationTriangle />;
  return <FaBolt />;
}

function liveStatusTone(status: LiveTradingView["pipeline"][number]["status"]) {
  if (status === "OK") return "success" as const;
  if (status === "BLOCKED") return "danger" as const;
  if (status === "WATCH") return "warning" as const;
  return "accent" as const;
}

function signalStateTone(state: LiveSignal["state"]) {
  if (state === "FILLED" || state === "ORDERED" || state === "ARBITRATED") return "success" as const;
  if (state === "REJECTED" || state === "EXPIRED") return "danger" as const;
  return "accent" as const;
}

function orderStateTone(state: LiveOrder["state"]) {
  if (state === "FILLED" || state === "ACKED") return "success" as const;
  if (state === "REJECTED" || state === "CANCELLED") return "danger" as const;
  if (state === "PARTIAL" || state === "SENT") return "warning" as const;
  return "accent" as const;
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
