import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { StrategyVersionChange, StrategyVersionComparison } from "@/operationsTypes";

export default function StrategyDetailPage() {
  const { strategyId = "" } = useParams();
  const id = decodeURIComponent(strategyId);
  const strategies = useQuery({ queryKey: operationsKeys.strategies, queryFn: operationsApi.listStrategies });
  const strategy = strategies.data?.items.find(item => item.id === id);
  const versions = useMemo(() => strategy?.versions || [], [strategy]);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const comparison = useQuery({ queryKey: ["operations", "strategy-compare", id, left, right], queryFn: () => operationsApi.compareStrategyVersions(id, left, right), enabled: Boolean(left && right) });
  useEffect(() => {
    if (versions.length < 2 || left || right) return;
    setLeft(versionKey(versions[1]));
    setRight(versionKey(versions[0]));
  }, [left, right, versions]);
  if (strategies.isLoading) return <LoadingView/>;
  if (strategies.isError || !strategy) return <ErrorView message={strategies.error?.message || "Stratégie introuvable"} retry={() => strategies.refetch()}/>;
  const performance = strategy.performance;
  return <section className="view workspace-view strategy-detail-v3 strategy-governance-v3"><Breadcrumbs items={[{ label: "Stratégies", to: "/strategies" }, { label: id }]}/><PageHeading eyebrow="Gouvernance stratégie" title={id} subtitle="Versions, configuration, runtime, contrats et impact de performance traçables." backTo="/strategies" actions={<Link className="primary-btn" to={`/performance/analysis?strategy=${encodeURIComponent(id)}`}>Analyser la performance</Link>}/>
    <MetricStrip className="metric-grid--compact strategy-kpi-strip"><MetricCard label="Versions" value={versions.length} detail={`${strategy.activeContracts.length} contrats actifs`}/><MetricCard label="Résultat" value={formatR(performance.totalR)} tone={performance.totalR >= 0 ? "positive" : "critical"}/><MetricCard label="Trades" value={performance.trades}/><MetricCard label="Win rate" value={performance.winRate === null ? "—" : `${(performance.winRate * 100).toFixed(1)}%`}/><MetricCard label="Max drawdown" value={formatR(performance.maxDrawdownR)} tone={performance.maxDrawdownR < 0 ? "critical" : "neutral"}/><MetricCard label="Replays" value={strategy.replayCount}/></MetricStrip>
    <div className="replay-session-context-strip"><span>CATALOGUE <strong>{strategy.catalog ? "READY" : "ABSENT"}</strong></span><span>CONFIG <strong>{strategy.config ? "READY" : "DEFAULT"}</strong></span><span>RUNTIME <strong>{strategy.runtime ? "MATERIALIZED" : "INACTIVE"}</strong></span><span>REPLAYS <strong>{strategy.replayCount}</strong></span></div>
    <div className="strategy-governance-grid"><Card className="workspace-panel strategy-version-ledger"><header><div><p className="eyebrow">Registre</p><h2>Versions publiées</h2></div><span className="terminal-counter">{versions.length}</span></header>{!versions.length ? <p className="muted-copy">Aucune version explicite.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Version</th><th>État</th><th>Création</th><th>Rôle comparaison</th></tr></thead><tbody>{versions.map((version, index) => { const key = versionKey(version); return <tr key={key || String(index)}><td><strong>{String(version.version || version.version_id)}</strong><small>{String(version.version_id || "identifiant implicite")}</small></td><td>{String(version.status || "archivée").toUpperCase()}</td><td>{formatVersionDate(version)}</td><td><div className="version-role-actions"><button className={left === key ? "active" : ""} onClick={() => setLeft(key)}>Avant</button><button className={right === key ? "active" : ""} onClick={() => setRight(key)}>Après</button></div></td></tr>; })}</tbody></table></div>}</Card><Card className="workspace-panel strategy-contract-ledger"><header><div><p className="eyebrow">Compatibilité</p><h2>Contrats actifs</h2></div><span className="terminal-counter">{strategy.activeContracts.length}</span></header>{!strategy.activeContracts.length ? <p className="muted-copy">Aucun contrat spécifique lié.</p> : <div className="version-list">{strategy.activeContracts.map(contract => <div key={`${contract.name}:${contract.version}`}><strong>{contract.name}</strong><small>v{contract.version} · {contract.status}</small></div>)}</div>}</Card></div>
    {versions.length >= 2 && <Card className="workspace-panel strategy-diff-panel"><header><div><p className="eyebrow">Contrôle de changement</p><h2>Diff de configuration</h2></div>{comparison.data && <span className="terminal-counter">{comparison.data.changes.length} changements</span>}</header><div className="strategy-diff-toolbar"><label>Avant<select value={left} onChange={event => setLeft(event.target.value)}>{versions.map((version, index) => <option key={index} value={versionKey(version)}>{String(version.version || version.version_id)}</option>)}</select></label><span>→</span><label>Après<select value={right} onChange={event => setRight(event.target.value)}>{versions.map((version, index) => <option key={index} value={versionKey(version)}>{String(version.version || version.version_id)}</option>)}</select></label></div>{left === right ? <div className="terminal-empty-state"><span>IDENTICAL_VERSION_SELECTION</span><small>Sélectionnez deux versions différentes.</small></div> : comparison.isLoading ? <p className="muted-copy">Calcul du diff canonique…</p> : comparison.isError ? <p className="form-error">{comparison.error.message}</p> : comparison.data && <StrategyDiff data={comparison.data}/>}</Card>}
    <details className="raw-inspector"><summary>Configuration courante</summary><pre>{JSON.stringify(strategy.config || strategy.catalog || strategy.stats, null, 2)}</pre></details>
  </section>;
}

function StrategyDiff({ data }: { data: StrategyVersionComparison }) {
  const groups = data.changes.reduce((counts, change) => ({ ...counts, [changeKind(change)]: (counts[changeKind(change)] || 0) + 1 }), {} as Record<string, number>);
  if (!data.changes.length) return <div className="terminal-empty-state"><span>NO_STRUCTURAL_CHANGE</span><small>Les deux versions sont structurellement identiques.</small></div>;
  return <><div className="strategy-diff-summary"><span>MODIFIÉS <strong>{groups.modified || 0}</strong></span><span>AJOUTÉS <strong>{groups.added || 0}</strong></span><span>SUPPRIMÉS <strong>{groups.removed || 0}</strong></span></div><div className="data-table-wrap"><table className="data-table strategy-diff-table"><thead><tr><th>Chemin</th><th>Avant</th><th>Après</th><th>Type</th></tr></thead><tbody>{data.changes.map(row => <tr key={row.path} data-change={changeKind(row)}><td data-label="Chemin"><strong>{row.path}</strong></td><td data-label="Avant"><code>{formatValue(row.before)}</code></td><td data-label="Après"><code>{formatValue(row.after)}</code></td><td data-label="Type"><span>{changeLabel(row)}</span></td></tr>)}</tbody></table></div></>;
}

function versionKey(version: Record<string, unknown>) { return String(version.version_id || version.version || ""); }
function formatVersionDate(version: Record<string, unknown>) { const value = version.created_at_utc || version.created_at || version.updated_at_utc || version.updated_at; return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(String(value))) : "—"; }
function changeKind(change: StrategyVersionChange) { return change.before === null ? "added" : change.after === null ? "removed" : "modified"; }
function changeLabel(change: StrategyVersionChange) { return changeKind(change) === "added" ? "AJOUT" : changeKind(change) === "removed" ? "SUPPRESSION" : "MODIFICATION"; }
function formatValue(value: unknown) { if (value === null || value === undefined) return "∅"; if (typeof value === "string") return value; return JSON.stringify(value); }
function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
