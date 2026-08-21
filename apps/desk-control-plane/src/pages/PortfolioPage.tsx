import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, ProgressBar, Sparkline, StatusBadge } from "@/design-system/primitives";
import { presentExecutionMode, presentHealth } from "@/design-system/labels";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView } from "@/domains/front-api/repositories";
import type { BrokerPosition, VirtualAllocation } from "@/domains/front-api/viewModels";
import type { DataValue } from "@/shared/contracts";

export function PortfolioPage() {
  const query = useFrontView("portfolio");

  if (query.isLoading) {
    return <PortfolioLoadingState />;
  }

  if (query.isError) {
    return (
      <Card title="Portefeuille indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée portefeuille" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/portfolio`.</p>
      </Card>
    );
  }

  const portfolio = query.data.data;

  return (
    <div className="portfolio-page">
      <ViewTruthBanner meta={query.data.meta} />
      <section className="portfolio-titlebar">
        <div>
          <h1>Portefeuille &amp; Positions</h1>
          <p>Exposition consolidée, allocations virtuelles, netting broker et attribution du PnL.</p>
        </div>
        <div className="portfolio-actions" aria-label="Disponibilité des actions portefeuille">
          <span>Actions indisponibles · aucun contrat de commande backend</span>
        </div>
      </section>

      <section className="portfolio-kpi-strip" aria-label="KPIs portefeuille">
        <KpiCard
          label="EQUITY DU PORTEFEUILLE"
          value={formatDataValue(portfolio.summaryTruth.equity, formatCurrencyCompact)}
          delta={portfolio.equityCurve.length ? `${formatSignedMillions(portfolio.summary.dailyR)} aujourd’hui` : "Historique equity indisponible"}
          detail={portfolio.equityCurve.length ? <Sparkline points={portfolio.equityCurve} tone="success" /> : undefined}
          tone="success"
        />
        <KpiCard
          label="EXPOSITION BRUTE"
          value={formatDataValue(portfolio.summaryTruth.grossExposureUsd, formatCurrencyCompact)}
          delta="Ratio non publié par le backend"
        />
        <KpiCard
          label="EXPOSITION NETTE"
          value={formatDataValue(portfolio.summaryTruth.netExposureUsd, formatCurrencyCompact)}
          delta="Ventilation disponible dans les panneaux"
          tone="info"
        />
        <KpiCard
          label="PNL LATENT"
          value={formatDataValue(portfolio.summaryTruth.unrealizedPnl, formatSignedCurrency)}
          delta="Valeur consolidée backend"
          tone="success"
        />
        <KpiCard
          label="RISQUE UTILISÉ"
          value={formatDataValue(portfolio.summaryTruth.riskUsedPct, (value) => `${formatDecimal(value)}%`)}
          delta="Budget nominal non publié"
          detail={hasDataValue(portfolio.summaryTruth.riskUsedPct) ? <ProgressBar value={portfolio.summaryTruth.riskUsedPct.value} tone="warning" /> : undefined}
          tone="warning"
        />
        <KpiCard
          label="EXPOSITION CORRÉLÉE"
          value={formatDataValue(portfolio.summaryTruth.correlatedExposurePct, (value) => `${formatDecimal(value)}%`)}
          delta="Seuil backend non publié"
          tone="danger"
        />
      </section>

      <section className="portfolio-grid portfolio-grid--top" aria-label="Exposition et positions">
        <Card
          title="Carte d’exposition consolidée"
          actions={<span className="inline-label">Classes d’actifs</span>}
          density="compact"
        >
          <div className="exposure-treemap">
            {portfolio.exposureTree.length ? portfolio.exposureTree.map((item) => (
              <article key={item.id} className={`treemap-tile treemap-tile--${item.id}`}>
                <strong>{item.label}</strong>
                <span>{item.group}</span>
                <div>
                  <b>{formatCurrencyCompact(item.valueUsd)} · {formatDecimal(item.weightPct)}%{item.side === "NET" ? "" : " ·"}</b>
                  {item.side === "NET" ? null : <small>{item.side}</small>}
                </div>
              </article>
            )) : <p className="empty-state">Valeurs monétaires d’exposition non publiées par le backend.</p>}
          </div>
        </Card>

        <Card
          title="Positions consolidées broker"
          actions={<InlineLink>Voir toutes les positions</InlineLink>}
          density="compact"
        >
          <DataTable
            rows={portfolio.brokerPositions}
            rowKey={(row) => `${row.positionId}_${row.account}_${row.instrument}`}
            columns={brokerColumns}
          />
          <MobileDataList
            rows={portfolio.brokerPositions}
            rowKey={(row) => `${row.positionId}_${row.account}_${row.instrument}`}
            renderTitle={(row) => `${row.instrument} ${row.side}`}
            renderMeta={(row) => `${row.quantity} · ${row.reconciliationStatus}`}
            renderBody={(row) => `${formatSignedCurrency(row.unrealizedPnl)} · ${protectionLabel(row)}`}
          />
        </Card>

        <Card
          title="Concentration & corrélations"
          actions={<InlineLink>Matrice complète</InlineLink>}
          density="compact"
        >
          {portfolio.correlationMatrix.cells.length ? (
            <>
              <CorrelationMatrix instruments={portfolio.correlationMatrix.instruments} cells={portfolio.correlationMatrix.cells} />
              <div className="portfolio-mini-metrics">
                <MetricBox label="Paire la plus corrélée" value={portfolio.correlationMatrix.topPair} />
                <MetricBox label="Corrélation portefeuille" value={formatDecimal(portfolio.correlationMatrix.portfolioCorrelation)} />
                <MetricBox label="Diversification" value={formatDecimal(portfolio.correlationMatrix.diversificationScore)} />
              </div>
            </>
          ) : <p className="empty-state">Matrice non publiée par le backend.</p>}
        </Card>
      </section>

      <section className="portfolio-grid portfolio-grid--bottom" aria-label="Réconciliation et attribution">
        <Card
          title="Allocations virtuelles par stratégie"
          actions={<InlineLink>Attribution complète</InlineLink>}
          density="compact"
        >
          <DataTable
            rows={portfolio.virtualAllocations}
            rowKey={(row) => row.allocationId ?? `${row.strategyInstanceId}_${row.instrument}_${row.virtualQuantity}`}
            columns={allocationColumns}
          />
        </Card>

        <Card
          title="Broker netting & réconciliation"
          actions={<InlineLink>Réconcilier maintenant</InlineLink>}
          density="compact"
        >
          {query.data.meta.warnings?.includes("portfolio-reconciliation:PARTIAL") ? <p className="empty-state">Réconciliation quantitative partielle : le backend ne publie pas encore les quantités cible, broker et delta.</p> : <div className="reconciliation-grid">
            <MetricBox label="Cible desk" value={portfolio.reconciliation.targetDeskQuantity} />
            <MetricBox label="Réel broker" value={portfolio.reconciliation.brokerRealQuantity} />
            <MetricBox label="Delta" value={portfolio.reconciliation.deltaQuantity} />
            <MetricBox label="État" value={portfolio.reconciliation.status} />
            <MetricBox label="Ordres en transit" value={portfolio.reconciliation.ordersInFlight} />
            <MetricBox label="Dernier contrôle" value={formatTime(portfolio.reconciliation.asOf)} />
          </div>}
        </Card>

        <Card
          title="Attribution du PnL & du risque"
          actions={<InlineLink>Rapport détaillé</InlineLink>}
          density="compact"
        >
          <div className="attribution-list">
            {portfolio.attribution.items.map((item, index) => (
              <article key={item.strategyInstanceId} className={`attribution-item attribution-item--${index + 1}`}>
                <strong>{item.label}</strong>
                <ProgressBar value={item.riskPct} tone="accent" />
                <span className={item.pnlR >= 0 ? "text-success" : "text-danger"}>{formatAttributionPnl(item.pnlR)}</span>
              </article>
            ))}
          </div>
          <div className="attribution-metrics">
            <MetricBox label="Meilleur contributeur" value={portfolio.attribution.bestContributor} />
            <MetricBox label="Risque Top 3" value={`${formatDecimal(portfolio.attribution.top3RiskPct)}%`} />
            <MetricBox label="Diversification PnL" value={formatDecimal(portfolio.attribution.diversificationScore)} />
          </div>
          <div className="portfolio-timeline-card">
            <div className="portfolio-timeline-card__header">
              <strong>TIMELINE PORTEFEUILLE</strong>
              <InlineLink>Voir toute la timeline</InlineLink>
            </div>
            <ol className="portfolio-horizontal-timeline">
              {portfolio.timeline.map((event, index) => (
                <li key={event.id} className={`timeline-event timeline-event--${index + 1}`}>
                  <span>{formatTime(event.at)}</span>
                  <strong>{event.title}</strong>
                  <small>{event.description}</small>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </section>
    </div>
  );
}

function InlineLink({ children }: { children: ReactNode }) {
  return <span className="inline-label">{children}</span>;
}

function MetricBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="metric-box">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function CorrelationMatrix({
  instruments,
  cells
}: {
  instruments: readonly string[];
  cells: readonly { from: string; to: string; value: number }[];
}) {
  return (
    <div className="correlation-shell">
      <div
        className="correlation-grid"
        style={{ gridTemplateColumns: `36px repeat(${instruments.length}, minmax(0, 1fr))` } as CSSProperties}
      >
        <span className="correlation-corner" />
        {instruments.map((instrument) => (
          <b key={`col_${instrument}`} className="correlation-axis-label">{instrument}</b>
        ))}
        {instruments.map((rowInstrument) => (
          <Fragment key={`row_${rowInstrument}`}>
            <b className="correlation-axis-label correlation-axis-label--row">{rowInstrument}</b>
            {instruments.map((columnInstrument) => {
              const cell = cells.find((candidate) => candidate.from === rowInstrument && candidate.to === columnInstrument);
              const value = cell?.value ?? 0;
              return (
                <span
                  key={`${rowInstrument}_${columnInstrument}`}
                  className={matrixTone(value, rowInstrument === columnInstrument)}
                  title={`${rowInstrument}/${columnInstrument}: ${value}`}
                >
                  {value.toFixed(2).replace(".", ",")}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const brokerColumns = [
  { key: "account", header: "Compte", render: (row: BrokerPosition) => formatAccount(row.account) },
  { key: "instrument", header: "Instrument", render: (row: BrokerPosition) => <strong><Link to={`/execution/portfolio/positions/${encodeURIComponent(row.positionId)}`}>{row.instrument}</Link></strong> },
  { key: "side", header: "Côté", render: (row: BrokerPosition) => <StatusBadge tone={row.side === "LONG" ? "success" : row.side === "SHORT" ? "danger" : "neutral"}>{row.side}</StatusBadge> },
  { key: "quantity", header: "Qté", align: "right" as const, render: (row: BrokerPosition) => formatQuantity(row.quantity) },
  { key: "avg", header: "Prix moy.", align: "right" as const, render: (row: BrokerPosition) => formatPrice(row.averagePrice) },
  { key: "mark", header: "Mark", align: "right" as const, render: (row: BrokerPosition) => formatPrice(row.markPrice) },
  { key: "pnl", header: "PnL", align: "right" as const, render: (row: BrokerPosition) => <span className={row.unrealizedPnl >= 0 ? "text-success" : "text-danger"}>{formatSignedCurrency(row.unrealizedPnl)}</span> },
  { key: "risk", header: "Risque", align: "right" as const, render: (row: BrokerPosition) => `${formatDecimal(row.riskR)} M €` },
  { key: "protection", header: "Protection", render: (row: BrokerPosition) => <StatusBadge tone={row.protectionStatus === "PROTECTED" ? "success" : row.protectionStatus === "PENDING" ? "warning" : "danger"}>{protectionLabel(row)}</StatusBadge> },
  { key: "reconciliation", header: "Réconciliation", render: (row: BrokerPosition) => <StatusBadge tone={row.reconciliationStatus === "MATCHED" ? "success" : "warning"}>{reconciliationLabel(row)}</StatusBadge> }
] as const;

const allocationColumns = [
  { key: "strategy", header: "Instance stratégie", render: (row: VirtualAllocation) => <StrategyCell row={row} /> },
  { key: "instrument", header: "Instrument", render: (row: VirtualAllocation) => row.instrument },
  { key: "quantity", header: "Qté virtuelle", align: "right" as const, render: (row: VirtualAllocation) => row.virtualQuantity > 0 ? `+${row.virtualQuantity}` : row.virtualQuantity },
  { key: "exposure", header: "Exposition", align: "right" as const, render: (row: VirtualAllocation) => formatCurrencyCompact(row.exposureUsd) },
  { key: "pnl", header: "PnL attribué", align: "right" as const, render: (row: VirtualAllocation) => <span className={row.attributedPnlR >= 0 ? "text-success" : "text-danger"}>{formatAllocationPnl(row)}</span> },
  { key: "risk", header: "Risque", align: "right" as const, render: (row: VirtualAllocation) => `${formatDecimal(row.riskPct)} M €` },
  { key: "mode", header: "Mode", render: (row: VirtualAllocation) => <StatusBadge tone={row.executionMode === "LIVE" ? "success" : row.executionMode === "PAPER" ? "accent" : "neutral"}>{presentExecutionMode(row.executionMode).label}</StatusBadge> },
  { key: "health", header: "État", render: (row: VirtualAllocation) => <StatusBadge tone={row.health === "OK" ? "success" : "warning"}>{presentHealth(row.health).label}</StatusBadge> }
] as const;

function StrategyCell({ row }: { row: VirtualAllocation }) {
  return <span className="strategy-cell"><strong>{row.strategyName}</strong><small>{row.strategyInstanceId}</small></span>;
}

function PortfolioLoadingState() {
  return (
    <div className="portfolio-page">
      <section className="portfolio-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} state="loading" density="compact">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </Card>
        ))}
      </section>
    </div>
  );
}

function formatCurrencyCompact(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    return `${sign}${formatDecimal(abs / 1_000_000)} M €`;
  }
  if (abs >= 1_000) {
    return `${sign}${formatDecimal(abs / 1_000)} K €`;
  }
  return `${sign}${new Intl.NumberFormat("fr-FR").format(abs)} €`;
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
  return "Indisponible";
}

function hasDataValue(value: DataValue<number>): value is Extract<DataValue<number>, { state: "KNOWN" | "STALE" }> {
  return value.state === "KNOWN" || value.state === "STALE";
}

function formatSignedCurrency(value: number) {
  return `${value >= 0 ? "+" : "−"}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.abs(value))} €`;
}

function formatSignedMillions(value: number) {
  return `${value >= 0 ? "+" : "−"}${formatDecimal(Math.abs(value))} M €`;
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: value >= 1 ? 1 : 2, maximumFractionDigits: 2 }).format(value);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: value < 10 ? 4 : 2,
    maximumFractionDigits: value < 10 ? 5 : 2
  }).format(value);
}

function formatQuantity(value: number) {
  return Math.abs(value) >= 1_000_000 ? `${value / 1_000_000}M` : `${value}`;
}

function formatAccount(value: string) {
  return ({ Sim101: "SIM-001", Sim102: "SIM-002", Sim103: "SIM-003" } as Record<string, string>)[value] ?? value.toUpperCase();
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
  return `${value >= 0 ? "+" : "−"}${formatDecimal(Math.abs(value))} K€`;
}

function matrixTone(value: number, diagonal: boolean) {
  if (diagonal) return "matrix-diagonal";
  if (value >= 0.65) return "matrix-hot";
  if (value >= 0.4) return "matrix-positive-strong";
  if (value > 0 && value < 0.2) return "matrix-positive-low";
  if (value > 0) return "matrix-positive";
  if (value < 0) return "matrix-negative";
  return "matrix-neutral";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
