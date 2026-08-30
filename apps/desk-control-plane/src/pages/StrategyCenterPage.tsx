import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { routeDisplayName } from "@/app/routes";
import {
  FaBalanceScale,
  FaCheckCircle,
  FaChartBar,
  FaLock,
  FaSearch,
  FaSpinner
} from "react-icons/fa";
import { Card, ProgressBar, StatusBadge } from "@/design-system/primitives";
import {
  presentCommandEligibility,
  presentExecutionMode,
  presentGateState,
  presentHealth,
  presentRuntimeStatus
} from "@/design-system/labels";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { OperatorMenu } from "@/shell/OperatorMenu";
import { commandShortcutLabel } from "@/shell/DeskCommandPalette";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { StrategyCenterView } from "@/domains/front-api/viewModels";
import "@/features/strategy-center/strategy-center.css";

type StrategyRow = StrategyCenterView["strategies"][number];
type Inspector = StrategyCenterView["selectedInspector"];

const STRATEGIES_PER_PAGE = 8;
type CatalogFilter = "ALL" | "SHADOW" | "PAPER" | "VALIDATED" | "RETIRED";
const EMPTY_STRATEGIES: readonly StrategyRow[] = [];

export function StrategyCenterPage() {
  const { session } = useOperatorSession();
  const realtime = useContext(RealtimeContext);
  const [selection, setSelection] = useState<{ strategyId?: string; strategyVersionId?: string }>({});
  const query = useFrontView("strategy-center", selection);
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [perfTab, setPerfTab] = useState<"r-multiple" | "distribution">("r-multiple");
  const [search, setSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>("ALL");
  const [catalogPage, setCatalogPage] = useState(1);

  const inspector = query.data?.data.selectedInspector ?? null;

  // Bootstrap: once the backend auto-selects a default strategy, re-fetch scoped
  // to its exact strategyId + strategyVersionId so gates/equity/lineage resolve.
  useEffect(() => {
    if (!selection.strategyId && inspector?.strategyId) {
      setSelection({ strategyId: inspector.strategyId, strategyVersionId: realId(inspector.strategyVersionId) });
    }
  }, [selection.strategyId, inspector?.strategyId, inspector?.strategyVersionId]);

  const strategies = query.data?.data.strategies ?? EMPTY_STRATEGIES;

  const filteredStrategies = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("fr");
    return strategies.filter((row) => {
      if (catalogFilter === "SHADOW" && row.executionMode !== "SHADOW") return false;
      if (catalogFilter === "PAPER" && row.executionMode !== "PAPER") return false;
      if (catalogFilter === "VALIDATED" && row.versionStatus !== "VALIDATED") return false;
      if (catalogFilter === "RETIRED" && row.versionStatus !== "RETIRED") return false;
      if (!needle) return true;
      return `${row.name} ${row.family} ${row.instruments.join(" ")}`.toLocaleLowerCase("fr").includes(needle);
    });
  }, [strategies, search, catalogFilter]);

  const totalCatalogPages = Math.max(1, Math.ceil(filteredStrategies.length / STRATEGIES_PER_PAGE));
  const pagedStrategies = useMemo(() => {
    const page = Math.min(catalogPage, totalCatalogPages);
    return filteredStrategies.slice((page - 1) * STRATEGIES_PER_PAGE, page * STRATEGIES_PER_PAGE);
  }, [filteredStrategies, catalogPage, totalCatalogPages]);

  const selectStrategy = (row: StrategyRow) => {
    setCommand(null);
    setCommandError(null);
    setSelection({ strategyId: row.strategyId, strategyVersionId: realId(row.strategyVersionId) });
  };

  const setFilter = (filter: CatalogFilter) => { setCatalogFilter(filter); setCatalogPage(1); };

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
      <Card title="Aucune donnée stratégie" eyebrow="ÉTAT VIDE" state="empty" density="compact">
        <p>Le catalogue des stratégies n’est pas encore publié.</p>
      </Card>
    );
  }

  const { data } = query.data;

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

  const selectedName = data.strategies.find((item) => item.strategyId === inspector.strategyId)?.name ?? inspector.strategyId;

  return (
    <div className="sc-page" data-testid="strategy-center-golden-master">
      <header className="sc-header">
        <div className="sc-header__title">
          <h1>{routeDisplayName("strategies")}</h1>
          <p>Catalogue, étapes de promotion et gouvernance</p>
        </div>
        <div className="sc-header__search">
          <FaSearch aria-hidden="true" color="var(--sc-muted)" />
          <input
            type="search"
            placeholder="Rechercher une stratégie, famille, instrument..."
            value={search}
            onChange={(event) => { setSearch(event.target.value); setCatalogPage(1); }}
          />
          <kbd>{commandShortcutLabel()}</kbd>
        </div>
        <span className="sc-header__pill">{session?.summary.environment ?? "—"}</span>
        <div className="sc-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
        <OperatorMenu variant="command-center" displayName={session?.principal.displayName ?? "Session non authentifiée"} roleLabel={session?.principal.roles[0] ?? "Lecture seule"} />
      </header>

      <div className="sc-workspace">
        <section className="sc-kpi-strip" aria-label="Indicateurs Centre des stratégies">
          <article className="sc-kpi-card"><small>Stratégies</small><strong>{data.summary.totalStrategies}</strong><span>Suspendues {data.summary.suspendedStrategies}</span></article>
          <article className="sc-kpi-card"><small>En direct</small><strong>{data.summary.liveStrategies}</strong></article>
          <article className="sc-kpi-card"><small>Simulation</small><strong>{data.summary.paperStrategies}</strong></article>
          <article className="sc-kpi-card"><small>Liste de suivi</small><strong>{data.summary.watchlistStrategies}</strong></article>
          <article className="sc-kpi-card"><small>Profit factor moyen</small><strong>{data.summary.averageProfitFactor.toFixed(2)}</strong><span>DD {formatSignedR(data.summary.averageDrawdownR)}</span></article>
        </section>

        <div className="sc-grid">
          <div className="sc-column">
            <section className="sc-panel" aria-label="Catalogue stratégies">
              <header><h2>Catalogue</h2><small>{filteredStrategies.length}</small></header>
              <div className="sc-filter-pills" role="group" aria-label="Filtrer le catalogue des stratégies">
                <FilterPill active={catalogFilter === "ALL"} onClick={() => setFilter("ALL")}>Tous <strong>{strategies.length}</strong></FilterPill>
                <FilterPill active={catalogFilter === "SHADOW"} onClick={() => setFilter("SHADOW")}>Observation seule <strong>{strategies.filter((s) => s.executionMode === "SHADOW").length}</strong></FilterPill>
                <FilterPill active={catalogFilter === "PAPER"} onClick={() => setFilter("PAPER")}>Simulation <strong>{strategies.filter((s) => s.executionMode === "PAPER").length}</strong></FilterPill>
                <FilterPill active={catalogFilter === "VALIDATED"} onClick={() => setFilter("VALIDATED")}>Validées <strong>{strategies.filter((s) => s.versionStatus === "VALIDATED").length}</strong></FilterPill>
                <FilterPill active={catalogFilter === "RETIRED"} onClick={() => setFilter("RETIRED")}>Archivées <strong>{strategies.filter((s) => s.versionStatus === "RETIRED").length}</strong></FilterPill>
              </div>
              <div className="sc-panel__body" style={{ padding: 0 }}>
                <div className="sc-catalog-list">
                  {pagedStrategies.map((row) => (
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
                      <small>{row.family} · {row.instruments.join("/")} · {row.timeframe} · PF {row.profitFactor.toFixed(2)} · {formatSignedR(row.lastOosR)}</small>
                    </button>
                  ))}
                  {!pagedStrategies.length ? <p className="sc-lineage-empty">Aucune stratégie ne correspond à ce filtre.</p> : null}
                </div>
                {totalCatalogPages > 1 ? (
                  <div className="sc-pagination">
                    <span>Page {Math.min(catalogPage, totalCatalogPages)} / {totalCatalogPages}</span>
                    <div className="sc-pagination__pages">
                      <button type="button" disabled={catalogPage <= 1} onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}>‹</button>
                      {Array.from({ length: totalCatalogPages }, (_, index) => index + 1).map((page) => (
                        <button key={page} type="button" aria-current={page === catalogPage} onClick={() => setCatalogPage(page)}>{page}</button>
                      ))}
                      <button type="button" disabled={catalogPage >= totalCatalogPages} onClick={() => setCatalogPage((page) => Math.min(totalCatalogPages, page + 1))}>›</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <div className="sc-column">
            <section className="sc-panel" aria-label="Identité stratégie sélectionnée">
              <div className="sc-panel__body">
                <div className="sc-detail-title">
                  <h2>{selectedName}</h2>
                  <StatusBadge tone={versionTone(inspector.meta.executionMode)}>{presentExecutionMode(inspector.meta.executionMode).label}</StatusBadge>
                  <small style={{ color: "var(--sc-muted)", fontSize: 11 }} title={inspector.strategyVersionId}>Version {formatDate(inspector.meta.publishedAt)}</small>
                </div>
                <p className="sc-detail-thesis">{inspector.thesis}</p>

                <div className="sc-action-row">
                  <button
                    type="button"
                    className="sc-action-row__primary"
                    disabled={submitting || inspector.currentCommandEligibility === "READ_ONLY"}
                    onClick={requestShadowTest}
                  >
                    {submitting ? "Envoi..." : "Demander un test en observation"}
                  </button>
                  <Link to={`/strategies/${inspector.strategyId}/compare`}><FaBalanceScale aria-hidden="true" /> Comparer versions</Link>
                  <Link to="/research"><FaChartBar aria-hidden="true" /> Voir la recherche</Link>
                </div>

                <div className="sc-meta-grid">
                  <MetaItem label="Instruments" value={inspector.meta.instruments.join(", ") || null} />
                  <MetaItem label="Unité de temps" value={inspector.meta.timeframe} />
                  <MetaItem label="Session" value={inspector.meta.sessionScope.join(", ") || null} />
                  <MetaItem label="Auteur" value={inspector.meta.owner} />
                  <MetaItem label="Publiée le" value={formatDate(inspector.meta.publishedAt)} />
                  <MetaItem label="Version de calcul" value={inspector.meta.compiledArtifactHash ? "Version certifiée" : null} />
                  <MetaItem label="Mode déploiement" value={presentExecutionMode(inspector.meta.executionMode).label} />
                  <MetaItem label="Compte" value={inspector.meta.accountScope} />
                </div>
                <div className="sc-meta-grid">
                  <MetaItem label="Règle d'entrée" value={inspector.spec.entryModel} />
                  <MetaItem label="Règle de stop" value={inspector.spec.stopModel} />
                  <MetaItem label="Règle d'objectif" value={inspector.spec.targetModel} />
                  <MetaItem label="Dimensionnement" value={inspector.spec.riskModel} />
                </div>
                {inspector.rulesSummary.length ? (
                  <div className="strategy-rules">
                    {inspector.rulesSummary.map((rule) => <span key={rule}><FaCheckCircle />{rule}</span>)}
                  </div>
                ) : null}
                <div className="sc-command-box">
                  <div>
                    <small>Actions possibles</small>
                    <strong>{presentCommandEligibility(inspector.currentCommandEligibility).label}</strong>
                  </div>
                  {command ? <span className="text-success" title={command.commandId}>Commande acceptée</span> : null}
                  {commandError ? <span className="text-danger">{commandError}</span> : null}
                </div>
              </div>
            </section>

            <section className="sc-panel" aria-label="Validation et performance">
              <header>
                <h2>Validation &amp; Performance</h2>
                <div className="sc-perf-tabs">
                  <button type="button" className={`sc-perf-tab${perfTab === "r-multiple" ? " sc-perf-tab--active" : ""}`} onClick={() => setPerfTab("r-multiple")}>Equity Curve</button>
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

            <section className="sc-panel" aria-label="Lignée de recherche">
              <header><h2>Lignée de recherche</h2></header>
              <div className="sc-panel__body">
                {inspector.lineage.length ? (
                  <div className="sc-lineage-flow">
                    {inspector.lineage.map((node, index) => (
                      <div key={`${node.nodeType}_${node.id}_${index}`} style={{ display: "flex", alignItems: "flex-start" }}>
                        <div className="sc-lineage-node">
                          <span className="sc-lineage-node__icon"><FaCheckCircle /></span>
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

          <div className="sc-column">
            <section className="sc-panel" aria-label="Progression des gates de promotion">
              <header><h2>Progression des gates</h2><small>G0 → G7</small></header>
              <div className="sc-panel__body">
                {inspector.gates.map((gate, index) => (
                  <div key={gate.label} className={`sc-gate-row sc-gate-row--${gate.state.toLowerCase()}`}>
                    <span className="sc-gate-icon">{gateIcon(gate.state, index)}</span>
                    <div className="sc-gate-label">
                      <strong>{gate.label}</strong>
                      {gate.detail ? <small title={gate.detail}>{gate.detail}</small> : null}
                    </div>
                    <StatusBadge tone={presentGateState(gate.state).tone}>{presentGateState(gate.state).label}</StatusBadge>
                  </div>
                ))}
              </div>
            </section>

            <section className="sc-panel" aria-label="Instances runtime">
              <header><h2>Instances runtime</h2><small>{inspector.runtimeInstances.length}</small></header>
              <div className="sc-panel__body">
                {inspector.runtimeInstances.length ? (
                  <table className="sc-instances-table">
                    <thead>
                      <tr><th>Instance</th><th>Mode</th><th>État</th><th>Santé</th><th>Signaux</th></tr>
                    </thead>
                    <tbody>
                      {inspector.runtimeInstances.map((instance) => (
                        <tr key={instance.strategyInstanceId}>
                          <td>{shortId(instance.strategyInstanceId)}</td>
                          <td><StatusBadge tone={modeTone(instance.mode)}>{presentExecutionMode(instance.mode).label}</StatusBadge></td>
                          <td><StatusBadge tone={runtimeTone(instance.runtimeStatus)}>{presentRuntimeStatus(instance.runtimeStatus).label}</StatusBadge></td>
                          <td><StatusBadge tone={healthTone(instance.health)}>{presentHealth(instance.health).label}</StatusBadge></td>
                          <td>{instance.signalsToday}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="sc-lineage-empty">Aucune instance runtime pour cette stratégie.</p>
                )}
              </div>
            </section>
          </div>
        </div>
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

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`sc-filter-pill${active ? " sc-filter-pill--active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
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

function gateIcon(state: Inspector["gates"][number]["state"], index: number) {
  if (state === "PASS") return <FaCheckCircle />;
  if (state === "WATCH") return <FaSpinner />;
  if (state === "FAIL") return "!";
  if (index === 0) return <FaLock />;
  return index;
}

function StrategyCenterLoading() {
  return (
    <div className="sc-page">
      <div className="sc-workspace">
        <section className="sc-kpi-strip">
          {Array.from({ length: 5 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
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

function versionTone(mode: Inspector["meta"]["executionMode"]) {
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

function realId(value: string | undefined): string | undefined {
  return value && value !== "none" && value !== "unavailable" ? value : undefined;
}

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatDate(value: string | null) {
  if (!value || value === "unavailable") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
