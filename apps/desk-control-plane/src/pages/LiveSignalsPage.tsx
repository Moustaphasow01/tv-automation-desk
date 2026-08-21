import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, StatusBadge } from "@/design-system/primitives";
import { ViewTruthBanner } from "@/design-system/states";
import { OperatorPageHeader } from "@/design-system/workspace";
import { useFrontView } from "@/domains/front-api/repositories";
import { presentSignalState } from "@/design-system/labels";
import type { LiveTradingView } from "@/domains/front-api/viewModels";

type Signal = LiveTradingView["signals"][number];

export function LiveSignalsPage() {
  const query = useFrontView("live-trading");
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const signals = useMemo(() => {
    const rows = query.data?.data.signals ?? [];
    const needle = search.trim().toLowerCase();
    return needle ? rows.filter((row) => `${row.symbol} ${row.strategyId} ${row.state} ${row.direction}`.toLowerCase().includes(needle)) : rows;
  }, [query.data, search]);

  if (query.isLoading) return <Card title="Chargement des signaux" state="loading" density="compact"><div className="skeleton-line" /></Card>;
  if (query.isError) return <Card title="Signaux indisponibles" tone="danger" density="compact"><p>{(query.error as Error).message}</p><button type="button" onClick={() => query.refetch()}>Réessayer</button></Card>;
  if (!query.data) return <Card title="Aucun signal" state="empty" density="compact"><p>La projection live est vide.</p></Card>;

  const { data, meta } = query.data;
  const accepted = data.signals.filter((item) => ["ARBITRATED", "ORDERED", "FILLED"].includes(item.state)).length;
  const rejected = data.signals.filter((item) => ["REJECTED", "EXPIRED"].includes(item.state)).length;
  return (
    <div className="operator-page live-signals-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Signaux live"
        description={`${data.session.tradingDate} · ${data.session.phase} · données ${data.session.marketDataStatus}`}
        actions={<Link className="operator-primary-action" to="/live">Retour session</Link>}
      />
      <section className="operator-kpi-strip" aria-label="Indicateurs signaux">
        <KpiCard label="TOTAL" value={`${data.signals.length}`} delta="Projection backend" />
        <KpiCard label="ACCEPTÉS" value={`${accepted}`} delta="Arbitrés, ordonnés ou remplis" tone="success" />
        <KpiCard label="REJETÉS / EXPIRÉS" value={`${rejected}`} delta="Décisions terminales" tone={rejected ? "warning" : "neutral"} />
        <KpiCard label="ORDRES LIÉS" value={`${data.orders.length}`} delta="Ordres visibles" tone="info" />
        <KpiCard label="FILLS" value={`${data.fills.length}`} delta="Exécutions visibles" tone="info" />
        <KpiCard label="LATENCE BFF" value={`${meta.latencyMs} ms`} delta={`asOf ${formatTime(meta.asOf)}`} />
      </section>
      <Card title="Signal Bus" eyebrow="ZOOM PAR ID" density="compact">
        <label className="table-search"><span>Rechercher</span><input value={search} onChange={(event) => { const value = event.target.value; setSearchParams(value ? { q: value } : {}, { replace: true }); }} placeholder="Symbole, stratégie, état…" /></label>
        {signals.length ? (
          <>
            <DataTable rows={signals} rowKey={(row) => row.signalId} columns={columns} />
            <MobileDataList rows={signals} rowKey={(row) => row.signalId} renderTitle={(row) => `${row.symbol} ${row.direction}`} renderMeta={(row) => `${row.strategyId} · ${row.state}`} renderBody={(row) => <Link to={`/live/signals/${row.signalId}`}>Ouvrir le détail</Link>} />
          </>
        ) : <p>Aucun signal ne correspond au filtre courant.</p>}
      </Card>
    </div>
  );
}

const columns = [
  { key: "signal", header: "Signal", render: (row: Signal) => <Link className="live-table-link" to={`/live/signals/${row.signalId}`}><strong>{row.symbol} {row.direction}</strong><small>{row.signalId}</small></Link> },
  { key: "strategy", header: "Stratégie", render: (row: Signal) => row.strategyId },
  { key: "state", header: "État", render: (row: Signal) => <StatusBadge tone={signalTone(row.state)}>{presentSignalState(row.state).label}</StatusBadge> },
  { key: "confidence", header: "Confiance", align: "right" as const, render: (row: Signal) => `${row.confidence}%` },
  { key: "expectancy", header: "Expectancy", align: "right" as const, render: (row: Signal) => `${row.expectancyR.toFixed(2)} R` },
  { key: "created", header: "Créé", render: (row: Signal) => formatTime(row.createdAt) },
] as const;

function signalTone(state: Signal["state"]) {
  if (["ARBITRATED", "ORDERED", "FILLED"].includes(state)) return "success" as const;
  if (["REJECTED", "EXPIRED"].includes(state)) return "danger" as const;
  return "accent" as const;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
