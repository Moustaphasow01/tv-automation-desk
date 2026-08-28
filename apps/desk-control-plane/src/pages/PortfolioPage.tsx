import { Fragment, useContext, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ProgressBar, StatusBadge } from "@/design-system/primitives";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useFrontView } from "@/domains/front-api/repositories";
import type { BrokerPosition, PortfolioView, VirtualAllocation } from "@/domains/front-api/viewModels";
import type { DataValue } from "@/shared/contracts";
import "@/features/portfolio/portfolio.css";

const DONUT_COLORS = ["var(--pf-blue)", "var(--pf-amber)", "var(--pf-cyan)", "var(--pf-purple)", "var(--pf-green)", "var(--pf-red)"];

export function PortfolioPage() {
  const { session } = useOperatorSession();
  const realtime = useContext(RealtimeContext);
  const query = useFrontView("portfolio");
  const [perfTab, setPerfTab] = useState<"strategy" | "instrument">("strategy");

  if (query.isLoading) return <PortfolioLoadingState />;

  if (query.isError) {
    return (
      <div className="pf-page">
        <h1 className="sr-only">Portefeuille &amp; Positions</h1>
        <div className="pf-workspace"><p className="pf-empty">Portefeuille indisponible : {(query.error as Error).message}</p></div>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="pf-page">
        <h1 className="sr-only">Portefeuille &amp; Positions</h1>
        <div className="pf-workspace"><p className="pf-empty">Le BFF ne retourne pas encore la projection `/views/portfolio`.</p></div>
      </div>
    );
  }

  const portfolio = query.data.data;
  const primaryAccount = portfolio.accountsSummary[0];

  return (
    <div className="pf-page" data-testid="portfolio-golden-master">
      <header className="pf-header">
        <div className="pf-header__title">
          <h1>Portefeuille &amp; Positions</h1>
          <p>Vue temps réel du portefeuille et gestion des positions</p>
        </div>
        <div className="pf-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
        <span className="pf-header__pill pf-header__pill--ok"><small>Réconciliation</small>{riskEngineLabel(portfolio.reconciliation.status)}</span>
        <span className="pf-header__pill"><small>Environnement</small>{session?.summary.environment ?? "—"}</span>
        {primaryAccount ? <span className="pf-header__pill"><small>Compte</small>{primaryAccount.label}</span> : null}
      </header>

      <div className="pf-workspace">
        <section className="pf-kpi-strip" aria-label="Indicateurs portefeuille">
          <KpiCell label="Net liquidation" value={formatDataValue(portfolio.summaryTruth.equity, formatCurrencyCompact)} tone="up" />
          <KpiCell label="PnL journalier" value={formatSignedR(portfolio.summary.dailyR)} tone={portfolio.summary.dailyR >= 0 ? "up" : "down"} />
          <KpiCell label="PnL latent" value={formatDataValue(portfolio.summaryTruth.unrealizedPnl, formatSignedCurrency)} tone={portfolio.summary.unrealizedPnl >= 0 ? "up" : "down"} />
          <KpiCell label="Risque ouvert" value={formatCurrencyCompact(portfolio.summary.exposureUsd)} />
          <KpiCell label="Drawdown max" value={formatSignedR(portfolio.summary.maxDrawdownR)} tone={portfolio.summary.maxDrawdownR < 0 ? "down" : undefined} />
          <KpiCell label="Positions" value={String(portfolio.summary.openPositions)} detail={`${portfolio.summary.positionsLong} Long / ${portfolio.summary.positionsShort} Short`} />
          <KpiCell label="Stratégies" value={String(portfolio.summary.strategiesWithPositions)} detail="Avec positions ouvertes" />
          <KpiCell label="Human Gate" value={String(portfolio.summary.humanGatePending)} detail="En attente" />
          <KpiCell label="Ordres en attente" value={String(portfolio.summary.pendingOrders)} detail="En cours" />
        </section>

        <div className="pf-row1">
          <section className="pf-panel" aria-label="Résumé des comptes">
            <header><h2>Comptes</h2><small>{portfolio.accountsSummary.length}</small></header>
            <div className="pf-panel__body" style={{ padding: 0 }}>
              {portfolio.accountsSummary.length ? (
                <table className="pf-table">
                  <thead><tr><th>Compte</th><th>Mode</th><th>Positions</th><th>Equity</th><th>PnL latent</th><th>Au</th></tr></thead>
                  <tbody>
                    {portfolio.accountsSummary.map((account) => (
                      <tr key={account.accountId}>
                        <td><strong>{account.label}</strong></td>
                        <td><StatusBadge tone="accent">{account.mode}</StatusBadge></td>
                        <td>{account.openPositions}</td>
                        <td>{account.equity != null ? formatCurrencyCompact(account.equity) : "—"}</td>
                        <td className={account.openPnl != null ? (account.openPnl >= 0 ? "text-success" : "text-danger") : undefined}>{account.openPnl != null ? formatSignedCurrency(account.openPnl) : "—"}</td>
                        <td>{formatTime(account.asOf)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="pf-empty">Aucun compte publié.</p>}
            </div>
          </section>

          <section className="pf-panel" aria-label="Net liquidation dans le temps">
            <header><h2>Net liquidation</h2></header>
            <div className="pf-panel__body">
              {portfolio.equityCurve.length >= 2 ? (
                <EquityChart points={portfolio.equityCurve} />
              ) : (
                <p className="pf-empty">Historique equity non publié par le backend (une seule valeur de capital disponible).</p>
              )}
            </div>
          </section>

          <section className="pf-panel" aria-label="Exposition par classe d'actifs">
            <header><h2>Exposition</h2></header>
            <div className="pf-panel__body">
              {portfolio.exposureTree.length ? (
                <div className="pf-donut-panel">
                  <Donut items={portfolio.exposureTree.map((item, index) => ({ label: item.label, value: item.weightPct, color: DONUT_COLORS[index % DONUT_COLORS.length] }))} centerLabel={formatCurrencyCompact(portfolio.summary.exposureUsd)} />
                  <ul className="pf-donut-legend">
                    {portfolio.exposureTree.map((item, index) => (
                      <li key={item.id}>
                        <span className="dot" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] } as CSSProperties} />
                        <span>{item.label}</span>
                        <strong>{formatDecimal(item.weightPct)}%</strong>
                        <small>{formatCurrencyCompact(item.valueUsd)}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <p className="pf-empty">Valeurs d’exposition par classe d’actifs non publiées par le backend.</p>}
            </div>
          </section>
        </div>

        <div className="pf-row2">
          <section className="pf-panel" aria-label="Positions broker">
            <header><h2>Positions</h2><small>{portfolio.brokerPositions.length}</small><Link to="/execution/portfolio/positions">Toutes les positions</Link></header>
            <div className="pf-panel__body" style={{ padding: 0 }}>
              <div className="pf-table-scroll">
                <table className="pf-table">
                  <thead>
                    <tr><th>Compte</th><th>Instrument</th><th>Côté</th><th>Qté</th><th>Prix moy.</th><th>Mark</th><th>PnL</th><th>Protection</th><th>Réconciliation</th></tr>
                  </thead>
                  <tbody>
                    {portfolio.brokerPositions.map((row) => (
                      <tr key={`${row.positionId}_${row.account}_${row.instrument}`}>
                        <td>{formatAccount(row.account)}</td>
                        <td><strong><Link to={`/execution/portfolio/positions/${encodeURIComponent(row.positionId)}`}>{row.instrument}</Link></strong></td>
                        <td><StatusBadge tone={row.side === "LONG" ? "success" : row.side === "SHORT" ? "danger" : "neutral"}>{row.side}</StatusBadge></td>
                        <td>{formatQuantity(row.quantity)}</td>
                        <td>{formatPrice(row.averagePrice)}</td>
                        <td>{formatPrice(row.markPrice)}</td>
                        <td className={row.unrealizedPnl >= 0 ? "text-success" : "text-danger"}>{formatSignedCurrency(row.unrealizedPnl)}</td>
                        <td><StatusBadge tone={row.protectionStatus === "PROTECTED" ? "success" : row.protectionStatus === "PENDING" ? "warning" : "danger"}>{protectionLabel(row)}</StatusBadge></td>
                        <td><StatusBadge tone={row.reconciliationStatus === "MATCHED" ? "success" : "warning"}>{reconciliationLabel(row)}</StatusBadge></td>
                      </tr>
                    ))}
                    {!portfolio.brokerPositions.length ? <tr><td colSpan={9}><p className="pf-empty">Aucune position ouverte.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="pf-panel" aria-label="Allocation par stratégie">
            <header><h2>Allocation</h2><small>Par stratégie</small></header>
            <div className="pf-panel__body">
              {portfolio.virtualAllocations.length ? (
                <div className="pf-donut-panel">
                  <Donut items={portfolio.virtualAllocations.map((item, index) => ({ label: item.strategyName, value: Math.abs(item.exposureUsd), color: DONUT_COLORS[index % DONUT_COLORS.length] }))} centerLabel={String(portfolio.virtualAllocations.length)} />
                </div>
              ) : <p className="pf-empty">Allocations virtuelles par stratégie non publiées par le backend.</p>}
            </div>
          </section>

          <section className="pf-panel" aria-label="Concentration et corrélation">
            <header><h2>Concentration</h2></header>
            <div className="pf-panel__body">
              {portfolio.correlationMatrix.cells.length ? (
                <>
                  <CorrelationMatrix instruments={portfolio.correlationMatrix.instruments} cells={portfolio.correlationMatrix.cells} />
                  <div className="pf-mini-metrics">
                    <span><small>Paire top</small><strong>{portfolio.correlationMatrix.topPair}</strong></span>
                    <span><small>Corrélation</small><strong>{formatDecimal(portfolio.correlationMatrix.portfolioCorrelation)}</strong></span>
                    <span><small>Diversification</small><strong>{formatDecimal(portfolio.correlationMatrix.diversificationScore)}</strong></span>
                  </div>
                </>
              ) : <p className="pf-empty">Matrice de corrélation non publiée par le backend.</p>}
            </div>
          </section>
        </div>

        <div className="pf-row3">
          <section className="pf-panel" aria-label="Allocations virtuelles">
            <header><h2>Allocations virtuelles</h2><small>{portfolio.virtualAllocations.length}</small></header>
            <div className="pf-panel__body" style={{ padding: 0 }}>
              {portfolio.virtualAllocations.length ? (
                <div className="pf-table-scroll">
                  <table className="pf-table">
                    <thead><tr><th>Stratégie</th><th>Instrument</th><th>Qté</th><th>Exposition</th><th>PnL</th></tr></thead>
                    <tbody>
                      {portfolio.virtualAllocations.map((row) => (
                        <tr key={row.allocationId ?? `${row.strategyInstanceId}_${row.instrument}`}>
                          <td><StrategyCell row={row} /></td>
                          <td>{row.instrument}</td>
                          <td>{row.virtualQuantity > 0 ? `+${row.virtualQuantity}` : row.virtualQuantity}</td>
                          <td>{formatCurrencyCompact(row.exposureUsd)}</td>
                          <td className={row.attributedPnlR >= 0 ? "text-success" : "text-danger"}>{formatAllocationPnl(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="pf-empty">Aucune allocation virtuelle publiée par le backend.</p>}
            </div>
          </section>

          <section className="pf-panel" aria-label="Attribution du PnL">
            <header>
              <h2>Attribution PnL</h2>
              <div className="pf-panel__tabs">
                <button type="button" className={`pf-tab${perfTab === "strategy" ? " pf-tab--active" : ""}`} onClick={() => setPerfTab("strategy")}>Stratégie</button>
                <button type="button" className={`pf-tab${perfTab === "instrument" ? " pf-tab--active" : ""}`} onClick={() => setPerfTab("instrument")}>Instrument</button>
              </div>
            </header>
            <div className="pf-panel__body">
              {portfolio.attribution.items.length ? (
                portfolio.attribution.items.map((item) => (
                  <div key={item.strategyInstanceId} className="pf-attribution-item">
                    <strong>{item.label}</strong>
                    <ProgressBar value={item.riskPct} tone="accent" />
                    <span className={item.pnlR >= 0 ? "text-success" : "text-danger"}>{formatAttributionPnl(item.pnlR)}</span>
                  </div>
                ))
              ) : <p className="pf-empty">Attribution du PnL non publiée par le backend.</p>}
            </div>
          </section>

          <section className="pf-panel" aria-label="Impact des éléments en attente">
            <header><h2>Éléments en attente</h2></header>
            <div className="pf-panel__body">
              <div className="pf-impact-list">
                <div className="pf-impact-row"><strong>Human Gate en attente</strong><span>{portfolio.summary.humanGatePending}</span></div>
                <div className="pf-impact-row"><strong>Ordres en attente</strong><span>{portfolio.summary.pendingOrders}</span></div>
              </div>
              <p className="pf-impact-note">Valeurs estimées à partir des intents et gates ouverts. Aucun impact chiffré publié par le backend.</p>
            </div>
          </section>

          <section className="pf-panel" aria-label="Activité récente">
            <header><h2>Activité récente</h2></header>
            <div className="pf-panel__body">
              {portfolio.timeline.length ? (
                <div className="pf-activity-list">
                  {portfolio.timeline.map((event) => (
                    <div key={event.id} className="pf-activity-row">
                      <time>{formatTime(event.at)}</time>
                      <div><strong>{event.title}</strong><small>{event.description}</small></div>
                    </div>
                  ))}
                </div>
              ) : <p className="pf-empty">Aucun événement portefeuille publié.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function KpiCell({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "up" | "down" }) {
  return (
    <article className={`pf-kpi-card${tone ? ` pf-kpi-card--${tone}` : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
}

function Donut({ items, centerLabel }: { items: readonly { label: string; value: number; color: string }[]; centerLabel: string }) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
  let cumulative = 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 100 100" width="120" height="120" role="img" aria-label="Répartition">
      <g transform="rotate(-90 50 50)">
        {items.map((item, index) => {
          const fraction = Math.max(0, item.value) / total;
          const dash = fraction * circumference;
          const offset = cumulative * circumference;
          cumulative += fraction;
          return <circle key={index} cx="50" cy="50" r={radius} fill="none" stroke={item.color} strokeWidth="14" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} />;
        })}
      </g>
      <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="var(--pf-text)" fontWeight="700">{centerLabel}</text>
    </svg>
  );
}

function EquityChart({ points }: { points: readonly number[] }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const width = 600;
  const height = 130;
  const path = points.map((value, index) => {
    const x = (index / Math.max(1, points.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className="pf-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Courbe de net liquidation">
      <path d={path} fill="none" stroke="var(--pf-blue)" strokeWidth="2" />
    </svg>
  );
}

function CorrelationMatrix({ instruments, cells }: { instruments: readonly string[]; cells: readonly { from: string; to: string; value: number }[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="pf-heatmap">
        <thead><tr><th /> {instruments.map((instrument) => <th key={instrument}>{instrument}</th>)}</tr></thead>
        <tbody>
          {instruments.map((rowInstrument) => (
            <Fragment key={rowInstrument}>
              <tr>
                <th>{rowInstrument}</th>
                {instruments.map((columnInstrument) => {
                  const cell = cells.find((candidate) => candidate.from === rowInstrument && candidate.to === columnInstrument);
                  const value = cell?.value ?? 0;
                  return <td key={columnInstrument} style={{ color: matrixColor(value, rowInstrument === columnInstrument) }}>{value.toFixed(2)}</td>;
                })}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StrategyCell({ row }: { row: VirtualAllocation }) {
  return <span><strong>{row.strategyName}</strong></span>;
}

function PortfolioLoadingState() {
  return (
    <div className="pf-page">
      <h1 className="sr-only">Portefeuille &amp; Positions</h1>
      <div className="pf-workspace">
        <section className="pf-kpi-strip">
          {Array.from({ length: 9 }).map((_, index) => <article key={index} className="pf-kpi-card"><div className="skeleton-line" /></article>)}
        </section>
      </div>
    </div>
  );
}

function riskEngineLabel(status: PortfolioView["reconciliation"]["status"]) {
  if (status === "SYNCHRO") return "OK";
  if (status === "PENDING") return "EN COURS";
  if (status === "MISMATCH") return "ÉCART";
  return "CRITIQUE";
}

function formatCurrencyCompact(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${formatDecimal(abs / 1_000_000)} M$`;
  if (abs >= 1_000) return `${sign}${formatDecimal(abs / 1_000)} k$`;
  return `${sign}${new Intl.NumberFormat("fr-FR").format(abs)} $`;
}

function formatDataValue(value: DataValue<number>, formatter: (data: number) => string) {
  if (value.state === "KNOWN") return formatter(value.value);
  if (value.state === "STALE") return `${formatter(value.value)} · périmé`;
  if (value.state === "PARTIAL" && value.value !== undefined) return formatter(value.value);
  if (value.state === "NOT_IMPLEMENTED") return "Non implémenté";
  if (value.state === "FORBIDDEN") return "Accès refusé";
  if (value.state === "DISCONNECTED") return "Déconnecté";
  if (value.state === "ERROR") return "Erreur";
  if (value.state === "NOT_APPLICABLE") return "Non applicable";
  if (value.state === "UNKNOWN") return "Inconnu";
  return "Non disponible";
}

function formatSignedCurrency(value: number) {
  return `${value >= 0 ? "+" : "−"}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.abs(value))} $`;
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${formatDecimal(Math.abs(value))} R`;
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 2 : 1, maximumFractionDigits: 2 }).format(value);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: value < 10 ? 4 : 2, maximumFractionDigits: value < 10 ? 5 : 2 }).format(value);
}

function formatQuantity(value: number) {
  return Math.abs(value) >= 1_000_000 ? `${value / 1_000_000}M` : `${value}`;
}

function formatAccount(value: string) {
  return ({ Sim101: "SIM-MAIN", Sim102: "SIM-SECONDARY", Sim103: "SIM-RESEARCH" } as Record<string, string>)[value] ?? value.toUpperCase();
}

function protectionLabel(row: BrokerPosition) {
  return row.protectionStatus === "PROTECTED" ? "CONFIRMÉE" : row.protectionStatus === "PENDING" ? "À VÉRIFIER" : "NON PROTÉGÉE";
}

function reconciliationLabel(row: BrokerPosition) {
  return row.reconciliationStatus === "MATCHED" ? "SYNCHRO" : row.reconciliationStatus;
}

function formatAllocationPnl(row: VirtualAllocation) {
  return `${row.attributedPnlR >= 0 ? "+" : "−"}${formatDecimal(Math.abs(row.attributedPnlR))} R`;
}

function formatAttributionPnl(value: number) {
  return `${value >= 0 ? "+" : "−"}${formatDecimal(Math.abs(value))} R`;
}

function matrixColor(value: number, diagonal: boolean) {
  if (diagonal) return "var(--pf-muted)";
  if (value >= 0.65) return "var(--pf-red)";
  if (value >= 0.4) return "var(--pf-amber)";
  if (value > 0) return "var(--pf-secondary)";
  if (value < 0) return "var(--pf-cyan)";
  return "var(--pf-muted)";
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
