import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, DataSourceBadge, ErrorView, Icon, LoadingView } from "@/components/common";
import { EmptyWorkspace, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
import { buildPromptRegistryViewModel } from "@/features/prompt-registry/viewModel";

export default function PromptRegistryPage() {
  const registry = useQuery({
    queryKey: ["prompt-registry", "overview"],
    queryFn: operationsApi.getPromptRegistryOverview,
    refetchInterval: 60_000,
  });

  if (registry.isLoading) return <LoadingView title="Chargement Prompt Registry" message="Lecture des seeds, bindings et hashes prompts." source="GIT SEED + API"/>;
  if (registry.isError) return <ErrorView message={registry.error.message} retry={() => registry.refetch()}/>;

  const view = buildPromptRegistryViewModel(registry.data);

  return <section className="view workspace-view prompt-registry-page">
    <PageHeading
      eyebrow="Agents"
      title="Prompt Registry"
      subtitle="Versions, compositions, bindings, parité hash et préparation rollback des prompts Live/Replay."
      actions={<><DataSourceBadge label="GIT SEED + API" detail="aucun mock"/><button className="secondary-btn" onClick={() => registry.refetch()}><Icon name="refresh" size={14}/>Actualiser</button></>}
    />

    <MetricStrip className="metric-grid--compact">
      {view.metrics.map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail}/>)}
    </MetricStrip>

    {view.source && <Card className="workspace-panel strategy-source-panel">
      <div>
        <p className="eyebrow">{view.source.parityMode}</p>
        <h2>{view.source.writeApiEnabled ? "Commandes activées" : "Commandes verrouillées"}</h2>
        <p>{view.source.writeApiReason}</p>
      </div>
      <span className="terminal-counter">MAJ {view.generatedAt}</span>
    </Card>}

    <Card className="workspace-panel">
      <header className="panel-heading"><div><p className="eyebrow">Live / Replay</p><h2>Compositions publiées</h2></div></header>
      {view.prompts.length ? <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>Prompt</th><th>Déploiement</th><th>Parité</th><th>Hash</th><th>Consommateurs</th><th>Évaluation</th></tr></thead>
        <tbody>{view.prompts.map((prompt) => <tr key={prompt.promptKey}>
          <td data-label="Prompt"><strong>{prompt.label}</strong><small>{prompt.sourceShort} · {prompt.sourceBytes?.toLocaleString("fr-FR") || "—"} octets</small></td>
          <td data-label="Déploiement"><StatusTag status={prompt.deploymentStage}/><small>{prompt.semanticVersion} · {prompt.runtimeStack}</small></td>
          <td data-label="Parité"><StatusTag status={prompt.parityStatus}/><small>{prompt.actualSourceSha256 === prompt.renderedSha256 ? "source = rendu" : "drift détecté"}</small></td>
          <td data-label="Hash"><strong>{prompt.hashShort}</strong><small>{prompt.compositionKey}</small></td>
          <td data-label="Consommateurs">{prompt.consumerCount} fichier(s)<small>{prompt.contractCount} contrat(s)</small></td>
          <td data-label="Évaluation"><StatusTag status={prompt.evaluation.status}/><small>{prompt.evaluation.reason}</small></td>
        </tr>)}</tbody>
      </table></div> : <EmptyWorkspace title="Aucun prompt registry" text="Le seed Git PRM-005 n’est pas disponible côté API."/>}
    </Card>

    <Card className="workspace-panel">
      <header className="panel-heading"><div><p className="eyebrow">Dette contrôlée</p><h2>Prompts dynamiques à remplacer</h2></div></header>
      {view.dynamicPrompts.length ? <ul className="terminal-list">{view.dynamicPrompts.map((prompt, index) => <li key={String(prompt.prompt_key || index)}>
        <span><strong>{String(prompt.prompt_key || "prompt dynamique")}</strong><small>{String(prompt.pinning_requirement || "snapshot registry requis")}</small></span>
        <StatusTag status={prompt.must_be_replaced_by_registry ? "REPLACE" : "OK"}/>
      </li>)}</ul> : <p className="muted-copy">Aucun prompt dynamique legacy déclaré.</p>}
    </Card>
  </section>;
}
