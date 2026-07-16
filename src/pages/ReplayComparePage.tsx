import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { operationsKeys, useReplays } from "@/hooks/useOperations";

export default function ReplayComparePage() {
  const replays = useReplays();
  const [selected, setSelected] = useState<string[]>([]);
  const comparison = useQuery({ queryKey: [...operationsKeys.replays, "compare", selected], queryFn: () => operationsApi.compareReplays(selected), enabled: selected.length >= 2 });
  const selectedItems = useMemo(() => replays.data?.items.filter(item => selected.includes(item.sourceId)) || [], [replays.data, selected]);
  if (replays.isLoading) return <LoadingView/>;
  if (replays.isError || !replays.data) return <ErrorView message={replays.error?.message || "Comparateur indisponible"} retry={() => replays.refetch()}/>;
  const toggle = (id: string) => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : value.length < 8 ? [...value, id] : value);
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: "Comparaison" }]}/><PageHeading eyebrow="A/B replay" title="Comparer les exécutions" subtitle="Jusqu’à huit variantes ou tentatives, à partir des résultats canoniques." backTo="/replay"/>
    <Card className="workspace-panel"><h2>Sélection · {selected.length}/8</h2><div className="comparison-picker">{replays.data.items.map(item => <label key={item.id} className={selected.includes(item.sourceId) ? "selected" : ""}><input type="checkbox" checked={selected.includes(item.sourceId)} onChange={() => toggle(item.sourceId)}/><div><strong>{item.tradingDate} · {item.session || item.kind}</strong><small>{item.variantId || item.sourceId}</small></div><StatusTag status={item.status}/></label>)}</div></Card>
    {selected.length < 2 ? <Card className="workspace-empty"><h3>Sélectionnez au moins deux runs</h3><p>La comparaison sera demandée au backend dès que deux exécutions seront cochées.</p></Card> : comparison.isLoading ? <LoadingView/> : comparison.isError ? <ErrorView message={comparison.error.message} retry={() => comparison.refetch()}/> : <Card className="workspace-panel"><h2>Matrice comparative</h2><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Run</th><th>État</th><th>Progression</th><th>Résultat</th><th>Étapes</th><th>GPT</th></tr></thead><tbody>{selectedItems.map(item => <tr key={item.id}><td><strong>{item.tradingDate} · {item.session}</strong><small>{item.variantId}</small></td><td><StatusTag status={item.status}/></td><td>{item.progress}%</td><td>{Number(item.metrics.totalR || 0).toFixed(2)} R</td><td>{item.metrics.stepsDone || 0}/{item.metrics.stepsTotal || 0}</td><td>{item.metrics.gptProcesses || 0}</td></tr>)}</tbody></table></div></Card>}
  </section>;
}
