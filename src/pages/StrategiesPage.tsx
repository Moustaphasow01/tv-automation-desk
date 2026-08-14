import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { EmptyWorkspace, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
import {
  buildStrategyV2OverviewViewModel,
  type StrategyV2OverviewViewModel,
  type StrategyV2RuntimeInstanceRow,
  type StrategyV2SignalRow,
} from "@/features/strategy-v2/viewModel";
import { operationsKeys } from "@/hooks/useOperations";

const SIGNAL_FILTERS = { limit: 50 };

export default function StrategiesPage() {
  const queryClient = useQueryClient();
  const registry = useQuery({
    queryKey: operationsKeys.strategyV2Overview({ limit: 500 }),
    queryFn: () => operationsApi.getStrategyV2Overview({ limit: 500 }),
    refetchInterval: 30_000,
  });
  const signals = useQuery({
    queryKey: operationsKeys.strategyV2Signals(SIGNAL_FILTERS),
    queryFn: () => operationsApi.listStrategyV2Signals(SIGNAL_FILTERS),
    refetchInterval: 15_000,
    retry: false,
  });
  const legacy = useQuery({
    queryKey: operationsKeys.strategies,
    queryFn: operationsApi.listStrategies,
    retry: false,
  });
  const consumeSignal = useMutation({
    mutationFn: (signalOutboxId: string) => operationsApi.consumeStrategyV2Signal(signalOutboxId, {
      consumerId: "front-transition-panel",
      idempotencyKey: `front-consume-${signalOutboxId}-${Date.now()}`,
      reason: "Operator consumed Strategy Signal Bus item from transitional front",
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: operationsKeys.strategyV2Signals(SIGNAL_FILTERS) }),
  });

  if (registry.isLoading) return <LoadingView/>;
  if (registry.isError || !registry.data) return <ErrorView message={registry.error?.message || "Registry Strategy v2 indisponible"} retry={() => registry.refetch()}/>;

  const view = buildStrategyV2OverviewViewModel(registry.data, legacy.data, signals.data);
  return <StrategiesContent
    view={view}
    legacyError={legacy.isError}
    signalsState={{ loading: !signals.data && !signals.isError, fetching: signals.isFetching, error: signals.error?.message || null }}
    consumeSignal={(signalId) => consumeSignal.mutate(signalId)}
    consuming={consumeSignal.isPending}
  />;
}

function StrategiesContent({ view, legacyError, signalsState, consumeSignal, consuming }: {
  view: StrategyV2OverviewViewModel;
  legacyError: boolean;
  signalsState: { loading: boolean; fetching: boolean; error: string | null };
  consumeSignal: (signalOutboxId: string) => void;
  consuming: boolean;
}) {
  return <section className="view workspace-view strategies-v3 strategy-v2-page">
    <PageHeading
      eyebrow="Strategy Kernel V2"
      title="Stratégies & instances"
      subtitle="Registre canonique des stratégies data-driven : définitions, versions, instances SHADOW/PAPER/LIVE et audit."
      actions={<Link className="secondary-btn" to="/performance/analysis">Performance historique</Link>}
    />

    <MetricStrip className="metric-grid--compact">
      {view.metrics.map(metric => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone}/>)}
    </MetricStrip>

    <Card className="workspace-panel strategy-source-panel">
      <div>
        <p className="eyebrow">{view.sourceLabel}</p>
        <h2>Source canonique de gouvernance</h2>
        <p>{view.sourceDetail}</p>
      </div>
      <span className="terminal-counter">MAJ {view.generatedAt}</span>
    </Card>

    <div className="strategy-runtime-grid">
      <RuntimeInstancesPanel rows={view.instanceRows}/>
      <SignalBusPanel rows={view.signalRows} count={view.signalSummary.count} state={signalsState} onConsume={consumeSignal} consuming={consuming}/>
    </div>

    <StrategyCatalog view={view}/>

    {legacyError && <p className="muted-copy">Performance historique legacy indisponible : la gouvernance Strategy v2 reste affichée sans fallback inventé.</p>}
  </section>;
}

function RuntimeInstancesPanel({ rows }: { rows: StrategyV2RuntimeInstanceRow[] }) {
  return <Card className="workspace-panel strategy-instance-overview-panel">
    <header><div><p className="eyebrow">Instances runtime</p><h2>SHADOW / PAPER / LIVE</h2></div><span className="terminal-counter">{rows.length}</span></header>
    {!rows.length ? <EmptyWorkspace title="Aucune instance runtime" text="Aucune instance Strategy Kernel n’est persistée pour le moment."/> : <div className="data-table-wrap">
      <table className="data-table strategy-runtime-table">
        <thead><tr><th>Instance</th><th>Stratégie</th><th>Mode</th><th>Runtime</th><th>Dérive live</th><th>Scope</th><th>Compte</th><th>Approval</th></tr></thead>
        <tbody>{rows.map(instance => <tr key={instance.id}>
          <td data-label="Instance"><strong>{instance.shortId}</strong><small>{instance.versionLabel}</small></td>
          <td data-label="Stratégie"><strong>{instance.strategyName}</strong><small>{instance.heartbeat}</small></td>
          <td data-label="Mode"><StatusTag status={instance.mode}/></td>
          <td data-label="Runtime"><StatusTag status={instance.runtime}/></td>
          <td data-label="Dérive"><StatusTag status={instance.driftStatus}/><small>{instance.driftDetail}</small></td>
          <td data-label="Scope"><strong>{instance.scope}</strong><small>{instance.sessions}</small></td>
          <td data-label="Compte">{instance.account}</td>
          <td data-label="Approval"><code>{instance.approval}</code></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </Card>;
}

function SignalBusPanel({ rows, count, state, onConsume, consuming }: { rows: StrategyV2SignalRow[]; count: number; state: { loading: boolean; fetching: boolean; error: string | null }; onConsume: (signalId: string) => void; consuming: boolean }) {
  return <Card className="workspace-panel strategy-signal-panel">
    <header><div><p className="eyebrow">Signal Bus</p><h2>Outbox décisionnelle réelle</h2></div><span className="terminal-counter">{state.fetching ? "sync…" : `${count}`}</span></header>
    <SignalBusBody rows={rows} state={state} onConsume={onConsume} consuming={consuming}/>
  </Card>;
}

function SignalBusBody({ rows, state, onConsume, consuming }: { rows: StrategyV2SignalRow[]; state: { loading: boolean; error: string | null }; onConsume: (signalId: string) => void; consuming: boolean }) {
  if (state.error) return <p className="muted-copy">Bus de signaux indisponible : {state.error}</p>;
  if (state.loading) return <p className="muted-copy">Chargement des signaux Strategy Kernel…</p>;
  if (!rows.length) return <EmptyWorkspace title="Aucun signal pending" text="La file outbox est vide : le front n’invente aucun signal."/>;
  return <div className="data-table-wrap"><table className="data-table strategy-signal-table">
    <thead><tr><th>Signal</th><th>Mode</th><th>Marché</th><th>État</th><th>Résumé</th><th>Expiration</th><th><span className="sr-only">Action</span></th></tr></thead>
    <tbody>{rows.map(signal => <SignalRow key={signal.id} signal={signal} onConsume={onConsume} consuming={consuming}/>)}</tbody>
  </table></div>;
}

function SignalRow({ signal, onConsume, consuming }: { signal: StrategyV2SignalRow; onConsume: (signalId: string) => void; consuming: boolean }) {
  return <tr>
    <td data-label="Signal"><strong>{signal.shortId}</strong><small>{signal.signalId} · {signal.correlationId}</small></td>
    <td data-label="Mode"><StatusTag status={signal.mode}/></td>
    <td data-label="Marché"><strong>{signal.instrument} {signal.direction}</strong><small>{signal.confidence}</small></td>
    <td data-label="État"><StatusTag status={signal.status}/></td>
    <td data-label="Résumé"><span>{signal.summary}</span><small>{signal.shortInstanceId}</small></td>
    <td data-label="Expiration"><strong>{signal.expiresAt}</strong><small>{signal.generatedAt}</small></td>
    <td data-label="Action">{signal.canConsume && <button className="text-btn" disabled={consuming} onClick={() => onConsume(signal.id)}>Consommer</button>}</td>
  </tr>;
}

function StrategyCatalog({ view }: { view: StrategyV2OverviewViewModel }) {
  if (view.empty) return <EmptyWorkspace title="Registry Strategy v2 vide" text="Aucune Strategy Definition n’est encore persistée. Le front ne fabrique pas de stratégie : crée une définition via l’API Strategy v2 ou le futur workflow Research Lab." action={<Link className="primary-btn" to="/operations">Voir les automatisations</Link>}/>;
  return <section className="replay-terminal-section strategy-terminal-section">
    <header><div><p className="eyebrow">Catalogue V2</p><h2>Définitions, versions et runtime</h2></div><span>{view.rows.length} stratégies canoniques</span></header>
    <div className="data-table-wrap"><table className="data-table strategy-registry-table">
      <thead><tr><th>Stratégie</th><th>État</th><th>Version publiée</th><th>Runtime</th><th>Instruments</th><th>Perf. historique</th><th>Trades</th><th>Prochaine étape</th><th><span className="sr-only">Action</span></th></tr></thead>
      <tbody>{view.rows.map(strategy => <tr key={strategy.id}>
        <td data-label="Stratégie"><strong>{strategy.name}</strong><small>{strategy.externalKey} · {strategy.owner}</small></td>
        <td data-label="État"><StatusTag status={strategy.statusLabel}/></td>
        <td data-label="Version"><strong>{strategy.versionLabel}</strong><small>{strategy.versionStatus}</small></td>
        <td data-label="Runtime"><strong>{strategy.executionModes}</strong><small>{strategy.runtimeStates}</small></td>
        <td data-label="Instruments">{strategy.instruments}</td>
        <td data-label="Perf." className={performanceClass(strategy.performanceR)}>{strategy.performanceR}</td>
        <td data-label="Trades">{strategy.trades}</td>
        <td data-label="Prochaine étape"><span>{strategy.recommendedNextStep}</span></td>
        <td data-label="Action"><Link className="row-link" to={strategy.href}>Ouvrir <Icon name="arrow" size={13}/></Link></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}

function performanceClass(value: string) { return value.startsWith("-") ? "negative" : value !== "—" ? "positive" : ""; }
