import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, MetricCard, MetricStrip, PageHeading, ProgressBar, ReplayChart, StatusTag, TechnicalDetails } from "@/components/operations";
import { useOperationsEvents, useReplay } from "@/hooks/useOperations";
import { gptProcessLabel, replayLabel } from "@/lib/presentation";
import type { OperationsEvent } from "@/operationsTypes";

export default function ReplayRunPage() {
  useOperationsEvents();
  const { runId = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplay(id);
  const [selected, setSelected] = useState<OperationsEvent | null>(null);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  const result = data.run.metrics.totalR;
  const hasResult = result !== null && result !== undefined && Number.isFinite(Number(result));
  const resultMode = String(data.run.metrics.resultMode || "pending");
  const resultDetail = resultMode === "mark_to_market"
    ? `${Number(data.run.metrics.realizedR || 0).toFixed(2)} R réalisé · ${Number(data.run.metrics.unrealizedR || 0).toFixed(2)} R latent`
    : hasResult && !data.run.resultEligible
      ? "évolue jusqu’à la clôture du run"
      : undefined;
  return <section className="view workspace-view replay-run-v3">
    <Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: data.run.tradingDate || data.run.name }]}/>
    <PageHeading eyebrow="Replay détaillé" title={replayLabel(data.run.sourceId || id)} subtitle={data.run.name} backTo="/replay" actions={<><button className="secondary-btn" disabled={query.isFetching} onClick={() => query.refetch()}>{query.isFetching ? "Actualisation…" : "Actualiser"}</button><StatusTag status={data.run.status}/></>}/>
    <MetricStrip className="metric-grid--compact"><MetricCard label="Progression journée" value={`${data.run.progress}%`} detail={`${formatReplayCheckpoint(data.run.currentReplayTime)} / ${formatReplayCheckpoint(data.run.endTime)}`}/><MetricCard label="Processus matérialisés" value={`${data.run.metrics.stepsDone || 0}/${data.run.metrics.stepsTotal || 0}`} detail={`${Number(data.run.metrics.processProgress || 0)} % du flux généré`}/><MetricCard label="Process GPT" value={data.gptProcesses.length}/><MetricCard label={data.run.resultEligible ? "Résultat certifié" : resultMode === "mark_to_market" ? "R courant" : "Résultat provisoire"} value={hasResult ? `${Number(result).toFixed(2)} R` : "En calcul"} detail={resultDetail} tone={!hasResult ? "neutral" : Number(result) >= 0 ? "positive" : "negative"}/></MetricStrip>
    <ProgressBar value={data.run.progress}/>
    <div className="inline-actions"><Link className="primary-btn" to={`/replay/runs/${encodeURIComponent(id)}/days/${data.run.tradingDate}`}>Sessions de la journée</Link><Link className="secondary-btn" to={`/operations/workflows/${encodeURIComponent(data.run.id)}`}>Contrôler le workflow</Link></div>
    <div className="replay-session-context-strip"><span>JOURNÉE <strong>{data.run.tradingDate || "—"}</strong></span><span>FENÊTRE <strong>{formatReplayCheckpoint(data.run.startTime)} → {formatReplayCheckpoint(data.run.endTime)}</strong></span><span>CUTOFF LU <strong>{formatReplayCheckpoint(data.run.currentReplayTime)}</strong></span><span>PHASE <strong>{data.run.currentPhase || data.run.session || "—"}</strong></span><span>SOURCE <strong>PostgreSQL</strong></span></div>
    <div className="replay-session-workbench"><ReplayChart prices={data.priceSeries} events={data.timeline} runId={id} onSelect={setSelected}/><aside className="replay-session-rail">
      <Card className="workspace-panel"><h2>Conclusions GPT</h2>{!data.conclusions.length ? <p className="muted-copy">Aucune conclusion GPT matérialisée.</p> : data.conclusions.map(item => <Link className="conclusion-item" key={item.processId} to={`/replay/runs/${encodeURIComponent(id)}/gpt/${encodeURIComponent(item.processId)}`}><strong>{item.conclusion}</strong><span>Inspecter →</span></Link>)}</Card>
      <Card className="workspace-panel"><h2>Processus GPT</h2>{!data.gptProcesses.length ? <p className="muted-copy">Aucun processus lié.</p> : data.gptProcesses.map(process => <Link className="gpt-row" key={process.id} to={`/replay/runs/${encodeURIComponent(id)}/gpt/${encodeURIComponent(process.id)}`}><div><strong>{gptProcessLabel(process.id)}</strong><small>{process.workflow} · tentative {process.attempt}/{process.maxAttempts || "—"}</small></div><StatusTag status={process.status}/></Link>)}</Card>
    </aside></div>
    <TechnicalDetails items={[
      { label: "Run", value: id },
      { label: "Référence source", value: data.run.sourceId },
      { label: "Workflow", value: data.run.id },
    ]}/>
    <section id="timeline-events" className="replay-terminal-section"><header><div><p className="eyebrow">Journal consolidé</p><h2>Timeline complète</h2></div><span>{data.timeline.length} événements</span></header><EventTimeline events={data.timeline} runId={id} selectedId={selected?.id} onSelect={setSelected}/></section>
  </section>;
}

function formatReplayCheckpoint(value?: string | null) {
  if (!value) return "—";
  const match = String(value).match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value;
}
