import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBalanceScale,
  FaBolt,
  FaChartBar,
  FaCheckCircle,
  FaLayerGroup,
  FaShieldAlt
} from "react-icons/fa";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import {
  presentCommandEligibility,
  presentEventTone,
  presentExecutionMode,
  presentGateState,
  presentHealth,
  presentRuntimeStatus,
  presentVersionStatus
} from "@/design-system/labels";
import { InlineAction } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { OperatorMenu } from "@/shell/OperatorMenu";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { StrategyCenterView } from "@/domains/front-api/viewModels";
import "@/features/strategy-center/strategy-center.css";

type StrategyRow = StrategyCenterView["strategies"][number];
type Inspector = StrategyCenterView["selectedInspector"];

export function StrategyCenterPage() {
  const { session } = useOperatorSession();
  const [selection, setSelection] = useState<{ strategyId?: string; strategyVersionId?: string }>({});
  const query = useFrontView("strategy-center", selection);
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [perfTab, setPerfTab] = useState<"r-multiple" | "distribution">("r-multiple");

  const inspector = query.data?.data.selectedInspector ?? null;

  // Bootstrap: once the backend auto-selects a default strategy, re-fetch scoped
  // to its exact strategyId + strategyVersionId so gates/equity/lineage resolve.
  useEffect(() => {
    if (!selection.strategyId && inspector?.strategyId) {
      setSelection({ strategyId: inspector.strategyId, strategyVersionId: realId(inspector.strategyVersionId) });
    }
  }, [selection.strategyId, inspector?.strategyId, inspector?.strategyVersionId]);

  const selectStrategy = (row: StrategyRow) => {
    setCommand(null);
    setCommandError(null);
    setSelection({ strategyId: row.strategyId, strategyVersionId: realId(row.strategyVersionId) });
  };

  if (query.isLoading) return <StrategyCenterLoading />;

  if (query.isError) {
    return (
      <Card title="Centre des stratégies indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data || !inspector) {
    return (
      <Card title="Aucune donnée stratégie" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/strategy-center`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;

  const requestShadowTest = async () => {
    setSubmitting(true);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildStrategyShadowTestCommand(inspector));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "STRATEGY_COMMAND_FAILED");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sc-page" data-testid="strategy-center-golden-master">
      <header className="sc-header">
        <div className="sc-header__title">
          <h1>Strategy Center</h1>
          <p>Catalogue, gates de promotion et gouvernance des stratégies</p>
        </div>
        <div className="sc-header__divider" aria-hidden="true" />
        <div className="sc-header__counts">
          <div className="sc-header__count"><small>Total</small><strong>{data.summary.totalStrategies}</strong></div>
          <div className="sc-header__count"><small>Live</small><strong>{data.summary.liveStrategies}</strong></div>
          <div className="sc-header__count"><small>Paper</small><strong>{data.summary.paperStrategies}</strong></div>
          <div className="sc-header__count"><small>Watchlist</small><strong>{data.summary.watchlistStrategies}</strong></div>
        </div>
        <OperatorMenu variant="command-center" displayName={session?.principal.displayName ?? "Session non authentifiée"} roleLabel={session?.principal.roles[0] ?? "Lecture seule"} />
      </header>

      <div className="sc-workspace">
        <ViewTruthBanner meta={meta} />

        <div className="sc-grid">
          <div className="sc-catalog-column">
            <div className="sc-kpi-mini">
              <article><small>Profit factor moyen</small><strong>{data.summary.averageProfitFactor.toFixed(2)}</strong></article>
              <article><small>Drawdown moyen</small><strong>{formatSignedR(data.summary.averageDrawdownR)}</strong></article>
              <article><small>Expectancy moyenne</small><strong>{data.summary.averageExpectancyR.toFixed(2)} R</strong></article>
              <article><small>Suspendues</small><strong>{data.summary.suspendedStrategies}</strong></article>
            </div>

            <section className="sc-panel" aria-label="Catalogue stratégies">
              <header><h2>Catalogue stratégies</h2><small>{data.strategies.length}</small></header>
              <div className="sc-panel__body" style={{ padding: 0 }}>
                <div className="sc-catalog-list">
                  {data.strategies.map((row) => (
                    <button
                      key={row.strategyId}
                      type="button"
                      className={`sc-catalog-row${row.strategyId === inspector.strategyId ? " sc-catalog-row--active" : ""}`}
                      onClick={() => selectStrategy(row)}
                    >
                      <strong>{row.name}</strong>
                      <div className="sc-catalog-row__badges">
                        <StatusBadge tone={runtimeTone(row.runtimeStatus)}>{presentRuntimeStatus(row.runtimeStatus).label}</StatusBadge>
                      </div>
                      <small>{row.family} · {row.instruments.join("/")} · PF {row.profitFactor.toFixed(2)} · {formatSignedR(row.lastOosR)}</small>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="sc-panel" aria-label="Distribution lifecycle">
              <header><h2>Distribution du cycle de vie</h2></header>
              <div className="sc-panel__body">
                <div className="strategy-lifecycle-list">
                  {data.lifecycleDistribution.map((item) => (
                    <article key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.count}</strong>
                      <ProgressBar value={item.pct} tone={lifecycleTone(item.label)} />
                      <small>{item.pct}%</small>
                    </article>
                  ))}
                </div>
                <div className="strategy-lifecycle-warning">
                  <FaShieldAlt />
                  <span>Le passage LIVE reste soumis aux gates backend et aux permissions opérateur.</span>
                </div>
              </div>
            </section>
          </div>

          <div className="sc-inspector-column">
            <section className="sc-panel" aria-label="Identité stratégie sélectionnée">
              <header><h2>{data.strategies.find((item) => item.strategyId === inspector.strategyId)?.name ?? inspector.strategyId}</h2><small>{inspector.strategyVersionId}</small></header>
              <div className="sc-panel__body">
                <p>{inspector.thesis}</p>
                <div className="sc-meta-grid">
                  <MetaItem label="Instruments" value={inspector.meta.instruments.join(", ") || null} />
                  <MetaItem label="Timeframe" value={inspector.meta.timeframe} />
                  <MetaItem label="Session" value={inspector.meta.sessionScope.join(", ") || null} />
                  <MetaItem label="Auteur" value={inspector.meta.owner} />
                  <MetaItem label="Publiée le" value={formatDate(inspector.meta.publishedAt)} />
                  <MetaItem label="Build / Hash" value={inspector.meta.compiledArtifactHash} monospace />
                  <MetaItem label="Mode déploiement" value={presentExecutionMode(inspector.meta.executionMode).label} />
                  <MetaItem label="Compte" value={inspector.meta.accountScope} />
                </div>
                <div className="sc-meta-grid">
                  <MetaItem label="Modèle d'entrée" value={inspector.spec.entryModel} />
                  <MetaItem label="Modèle de stop" value={inspector.spec.stopModel} />
                  <MetaItem label="Modèle de cible" value={inspector.spec.targetModel} />
                  <MetaItem label="Modèle de risque" value={inspector.spec.riskModel} />
                </div>
                {inspector.rulesSummary.length ? (
                  <div className="strategy-rules">
                    {inspector.rulesSummary.map((rule) => <span key={rule}><FaCheckCircle />{rule}</span>)}
                  </div>
                ) : null}
                <div className="strategy-command-box">
                  <div>
                    <small>Éligibilité commande</small>
                    <strong>{presentCommandEligibility(inspector.currentCommandEligibility).label}</strong>
                    {command ? <span className="text-success">Acceptée · {command.commandId}</span> : null}
                    {commandError ? <span className="text-danger">{commandError}</span> : null}
                  </div>
                  <button className="operator-primary-action" disabled={submitting || inspector.currentCommandEligibility === "READ_ONLY"} onClick={requestShadowTest} type="button">
                    {submitting ? "Envoi..." : "Demander shadow test"}
                  </button>
                </div>
              </div>
            </section>

            <section className="sc-panel" aria-label="Progression des gates de promotion">
              <header><h2>Progression des gates</h2><small>G0 → G7</small></header>
              <div className="sc-panel__body">
                {inspector.gates.map((gate, index) => (
                  <div key={gate.label} className={`sc-gate-row sc-gate-row--${gate.state.toLowerCase()}`}>
                    <span className="sc-gate-index">{index}</span>
                    <div className="sc-gate-label">
                      <strong>{gate.label}</strong>
                      {gate.detail ? <small title={gate.detail}>{gate.detail}</small> : null}
                    </div>
                    <StatusBadge tone={presentGateState(gate.state).tone}>{presentGateState(gate.state).label}</StatusBadge>
                  </div>
                ))}
              </div>
            </section>

            <section className="sc-panel" aria-label="Validation et performance">
              <header>
                <h2>Validation &amp; Performance</h2>
                <div className="sc-perf-tabs">
                  <button type="button" className={`sc-perf-tab${perfTab === "r-multiple" ? " sc-perf-tab--active" : ""}`} onClick={() => setPerfTab("r-multiple")}>R-Multiple</button>
                  <button type="button" className={`sc-perf-tab${perfTab === "distribution" ? " sc-perf-tab--active" : ""}`} onClick={() => setPerfTab("distribution")}>Distribution</button>
                </div>
              </header>
              <div className="sc-panel__body">
                {inspector.performance.availability === "AVAILABLE" && inspector.performance.series.length ? (
                  perfTab === "r-multiple"
                    ? <EquityChart series={inspector.performance.series} />
                    : <DrawdownDistribution series={inspector.performance.series} />
                ) : (
                  <p className="sc-lineage-empty">Aucune série de performance publiée pour cette version.</p>
                )}
                <div className="sc-perf-metrics">
                  <article><small>Expectancy</small><strong>{inspector.performance.expectancyR.toFixed(2)} R</strong></article>
                  <article><small>Profit Factor</small><strong>{inspector.performance.profitFactor.toFixed(2)}</strong></article>
                  <article><small>Win Rate</small><strong>{inspector.performance.winRatePct}%</strong></article>
                  <article><small>Max DD</small><strong>{formatSignedR(inspector.performance.maxDrawdownR)}</strong></article>
                  <article><small>OOS R</small><strong>{formatSignedR(inspector.performance.oosR)}</strong></article>
                  <article><small>Échantillon</small><strong>{inspector.performance.series.length || "—"}</strong></article>
                </div>
              </div>
            </section>

            <section className="sc-panel" aria-label="Instances runtime">
              <header><h2>Instances runtime</h2><small>{inspector.runtimeInstances.length}</small></header>
              <div className="sc-panel__body">
                {inspector.runtimeInstances.length ? (
                  <table className="sc-instances-table">
                    <thead>
                      <tr><th>Instance</th><th>Instruments</th><th>Mode</th><th>État</th><th>Santé</th><th>Signaux (jour)</th><th>Dernier heartbeat</th></tr>
                    </thead>
                    <tbody>
                      {inspector.runtimeInstances.map((instance) => (
                        <tr key={instance.strategyInstanceId}>
                          <td>{shortId(instance.strategyInstanceId)}</td>
                          <td>{instance.instruments.join(", ") || "—"}</td>
                          <td><StatusBadge tone={modeTone(instance.mode)}>{presentExecutionMode(instance.mode).label}</StatusBadge></td>
                          <td><StatusBadge tone={runtimeTone(instance.runtimeStatus)}>{presentRuntimeStatus(instance.runtimeStatus).label}</StatusBadge></td>
                          <td><StatusBadge tone={healthTone(instance.health)}>{presentHealth(instance.health).label}</StatusBadge></td>
                          <td>{instance.signalsToday}</td>
                          <td>{formatDateTime(instance.lastHeartbeatAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="sc-lineage-empty">Aucune instance runtime pour cette stratégie.</p>
                )}
              </div>
            </section>

            <section className="sc-panel" aria-label="Lignée de recherche">
              <header><h2>Lignée de recherche</h2></header>
              <div className="sc-panel__body">
                {inspector.lineage.length ? (
                  <div className="sc-lineage-flow">
                    {inspector.lineage.map((node, index) => (
                      <div key={`${node.nodeType}_${node.id}`} style={{ display: "flex", alignItems: "center" }}>
                        <div className="sc-lineage-node">
                          <small>{lineageNodeLabel(node.nodeType)}</small>
                          <strong title={node.id}>{shortId(node.id)}</strong>
                          <span>{formatDate(node.at)}</span>
                        </div>
                        {index < inspector.lineage.length - 1 ? <span className="sc-lineage-arrow">→</span> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sc-lineage-empty">Aucune lignée research publiée : cette version n'est pas reliée à un candidat research_candidates.</p>
                )}
              </div>
            </section>
          </div>
        </div>

        <section className="operator-grid operator-grid--bottom" aria-label="Performance et événements stratégie">
          <Card title="Performance par famille" actions={<InlineAction>Analyse famille</InlineAction>} density="compact">
            <div className="strategy-family-list">
              {data.performanceByFamily.map((family) => (
                <article key={family.family}>
                  <span><FaLayerGroup /></span>
                  <div><strong>{family.family}</strong><small>{family.strategies} stratégies · DD {formatSignedR(family.drawdownR)}</small></div>
                  <b>PF {family.averageProfitFactor.toFixed(2)}</b>
                  <span className={family.expectancyR >= 0 ? "text-success" : "text-danger"}>{family.expectancyR.toFixed(2)} R</span>
                  <ProgressBar value={Math.min(100, family.averageProfitFactor * 42)} tone="accent" />
                </article>
              ))}
            </div>
          </Card>

          <Card title="Top stratégies & parité live/replay" actions={<InlineAction>Comparer versions</InlineAction>} density="compact">
            <div className="strategy-top-list">
              {data.topStrategies.map((strategy, index) => (
                <Link key={strategy.strategyId} to={`/strategies/${strategy.strategyId}`}>
                  <span>{index + 1}</span>
                  <div><strong>{strategy.name}</strong><small>OOS {formatSignedR(strategy.oosR)} · parité {strategy.liveParityPct}%</small></div>
                  <b>{strategy.score}</b>
                  <ProgressBar value={strategy.liveParityPct} tone={strategy.liveParityPct >= 85 ? "success" : "warning"} />
                </Link>
              ))}
            </div>
          </Card>

          <Card title="Événements récents" actions={<InlineAction>Journal stratégie</InlineAction>} density="compact">
            <ol className="strategy-events">
              {data.recentEvents.map((event) => (
                <li key={event.eventId}>
                  <span><FaBolt />{formatTime(event.at)}</span>
                  <div><strong>{event.title}</strong><small>{event.detail}</small></div>
                  <StatusBadge tone={event.tone === "HIGH" ? "danger" : event.tone === "WATCH" ? "warning" : "accent"}>{presentEventTone(event.tone).label}</StatusBadge>
                </li>
              ))}
            </ol>
            <div className="strategy-compare-actions">
              <Link to={`/strategies/${inspector.strategyId}/compare`}><FaBalanceScale /> Comparer versions</Link>
              <Link to="/research"><FaChartBar /> Voir origine Research</Link>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

export function buildStrategyShadowTestCommand(inspector: Inspector): SubmitDeskCommandInput {
  return {
    commandType: "strategy.lifecycle.request_shadow_test",
    environment: "MOCK",
    expectedVersion: inspector.strategyVersionId,
    reason: "Operator requested from Strategy Center cockpit",
    payload: {
      strategyId: inspector.strategyId,
      strategyDefinitionId: inspector.strategyDefinitionId,
      strategyVersionId: inspector.strategyVersionId,
      strategyInstanceId: inspector.strategyInstanceId,
      runtimeBundleId: inspector.runtimeBundleId
    }
  };
}

function MetaItem({ label, value, monospace }: { label: string; value: string | null; monospace?: boolean }) {
  const unavailable = !value || value === "unavailable";
  return (
    <div className="sc-meta-item">
      <small>{label}</small>
      <strong data-unavailable={unavailable || undefined} style={monospace ? { fontFamily: "ui-monospace, monospace" } : undefined} title={value ?? undefined}>
        {unavailable ? "Non publié" : value}
      </strong>
    </div>
  );
}

function EquityChart({ series }: { series: Inspector["performance"]["series"] }) {
  const points = useMemo(() => {
    const values = series.map((point) => point.cumulativeR);
    const min = Math.min(0, ...values);
    const max = Math.max(...values, 0.01);
    const range = max - min || 1;
    const width = 600;
    const height = 120;
    return series
      .map((point, index) => {
        const x = (index / Math.max(1, series.length - 1)) * width;
        const y = height - ((point.cumulativeR - min) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series]);
  return (
    <svg className="sc-perf-chart" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Courbe d'equity research">
      <polyline points={points} fill="none" stroke="var(--sc-blue)" strokeWidth="2" />
    </svg>
  );
}

function DrawdownDistribution({ series }: { series: Inspector["performance"]["series"] }) {
  const bars = useMemo(() => series.map((point) => point.drawdownR), [series]);
  const min = Math.min(...bars, 0);
  return (
    <svg className="sc-perf-chart" viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Distribution des drawdowns">
      {bars.map((value, index) => {
        const barWidth = 600 / Math.max(1, bars.length);
        const height = min === 0 ? 0 : (value / min) * 110;
        return <rect key={index} x={index * barWidth} y={120 - height} width={Math.max(1, barWidth - 1)} height={height} fill="var(--sc-red)" />;
      })}
    </svg>
  );
}

function lineageNodeLabel(nodeType: Inspector["lineage"][number]["nodeType"]) {
  switch (nodeType) {
    case "HYPOTHESIS": return "Hypothèse";
    case "EXPERIMENT": return "Expérience";
    case "RUN": return "Run";
    case "CANDIDATE": return "Candidat";
    case "STRATEGY_VERSION": return "Version";
    case "INSTANCE": return "Instance";
    default: return nodeType;
  }
}

function StrategyCenterLoading() {
  return (
    <div className="sc-page">
      <div className="sc-workspace">
        <section className="operator-kpi-strip">
          {Array.from({ length: 4 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
        </section>
      </div>
    </div>
  );
}

function modeTone(mode: StrategyRow["executionMode"]) {
  if (mode === "LIVE") return "success" as const;
  if (mode === "PAPER") return "warning" as const;
  return "accent" as const;
}

function runtimeTone(status: StrategyRow["runtimeStatus"]) {
  if (status === "RUNNING") return "success" as const;
  if (status === "FAILED") return "danger" as const;
  if (status === "PAUSED") return "warning" as const;
  return "accent" as const;
}

function healthTone(health: StrategyRow["liveHealth"]) {
  if (health === "OK") return "success" as const;
  if (health === "DEGRADED") return "danger" as const;
  if (health === "OFF") return "neutral" as const;
  return "warning" as const;
}

function lifecycleTone(label: string) {
  if (label === "LIVE") return "success" as const;
  if (label === "PAPER" || label === "WATCHLIST") return "warning" as const;
  return "accent" as const;
}

function realId(value: string | undefined): string | undefined {
  return value && value !== "none" && value !== "unavailable" ? value : undefined;
}

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDate(value: string | null) {
  if (!value || value === "unavailable") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(value: string) {
  if (!value || value === "unavailable") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
