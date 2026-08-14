import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import {
  Breadcrumbs,
  formatDateTime,
  formatDuration,
  MetricCard,
  MetricStrip,
  PageHeading,
  PageTabs,
  StatusTag,
  TechnicalDetails,
} from "@/components/operations";
import { operationsKeys, useObservability, useOperationsEvents } from "@/hooks/useOperations";
import { gptProcessLabel, replayLabel, workflowLabel } from "@/lib/presentation";
import type {
  AiRuntimeSettings,
  AiRuntimeSettingsActionInput,
  CodexReasoningEffort,
  GuardrailSignal,
  ObservabilityBreakdown,
  ObservabilityPolicy,
  ObservabilityPolicyActionInput,
  ObservabilityProcess,
  ObservabilityOverview,
} from "@/operationsTypes";

export default function ObservabilityPage() {
  useOperationsEvents();
  const [configuring, setConfiguring] = useState(false);
  const [configuringReasoning, setConfiguringReasoning] = useState(false);
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get("q") || "",
    scope: params.get("scope") || "",
    workflow: params.get("workflow") || "",
    worker: params.get("worker") || "",
    model: params.get("model") || "",
    status: params.get("status") || "",
    process: params.get("process") || "",
    run_id: params.get("run_id") || params.get("runId") || "",
  };
  const query = useObservability({ ...filters, limit: 300 });
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Observabilité indisponible"} retry={() => query.refetch()}/>;

  const data = query.data;
  const summary = data.summary;
  const focusedProcessId = filters.process;
  const focusedProcess = focusedProcessId ? data.items.find(item => processMatchesFocus(item, focusedProcessId)) || null : null;
  const focusProcess = (processId: string) => setParams(current => {
    const next = new URLSearchParams(current);
    next.set("process", processId);
    return next;
  }, { replace: true });
  return <section className="view workspace-view observability-v3">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Activité GPT", to: "/operations/observability" }, ...(focusedProcessId ? [{ label: gptProcessLabel(focusedProcessId) }] : [])]}/>
    <PageHeading
      eyebrow="Automation control plane"
      title="Observabilité & coûts GPT"
      subtitle="File, workers, leases, latences et consommation mesurée sur les workflows LIVE et REPLAY."
      backTo="/operations"
      actions={<>
        <button className="secondary-btn" onClick={() => setConfiguringReasoning(true)}>
          Réflexion · {reasoningEffortLabel(data.aiRuntimeSettings.reasoningEffort)}
        </button>
        <button className="secondary-btn" onClick={() => setConfiguring(true)}>Configurer les guardrails</button>
        <span className="observability-refresh">AUTO 30S · {formatDateTime(data.generatedAt)}</span>
      </>}
      tabs={<OperationsTabs/>}
    />

    <MetricStrip className="metric-strip--six observability-kpis">
      <MetricCard label="Processus" value={summary.processes} detail={`${summary.running} actifs · ${summary.queued} queue`}/>
      <MetricCard label="Leases à risque" value={data.leases.expiring + data.leases.expired} detail={`${data.leases.expired} expirées`} tone={data.leases.expired ? "critical" : data.leases.expiring ? "warning" : "positive"}/>
      <MetricCard label="Succès terminal" value={formatPercent(summary.successRate)} detail={`${summary.failed} échecs · ${summary.retries} retries`} tone={summary.failed ? "warning" : "positive"}/>
      <MetricCard label="P95 exécution" value={formatDuration(summary.p95ExecutionMs)} detail={`moy. ${formatDuration(summary.avgExecutionMs)}`}/>
      <MetricCard label="Jetons observés" value={formatTokens(summary.totalTokens)} detail={`${data.coverage.tokens.percent}% de couverture`}/>
      <MetricCard label="Coût observé" value={formatCost(summary.costUsd)} detail={`${data.coverage.cost.percent}% de couverture`} tone={summary.costUsd === null ? "warning" : "neutral"}/>
    </MetricStrip>

    <CodexWorkerFleet data={data}/>
    <CoverageRail data={data}/>
    <GuardrailBoard data={data}/>

    <div className="workspace-toolbar observability-filter-bar">
      <label>Recherche<input value={filters.q} onChange={event => setFilter("q", event.target.value)} placeholder="Process, run, worker…"/></label>
      <label>Scope<select value={filters.scope} onChange={event => setFilter("scope", event.target.value)}><option value="">LIVE + REPLAY</option>{data.facets.scopes.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Workflow<select value={filters.workflow} onChange={event => setFilter("workflow", event.target.value)}><option value="">Tous</option>{data.facets.workflows.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Worker<select value={filters.worker} onChange={event => setFilter("worker", event.target.value)}><option value="">Tous</option>{data.facets.workers.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Modèle<select value={filters.model} onChange={event => setFilter("model", event.target.value)}><option value="">Tous</option>{data.facets.models.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>État<select value={filters.status} onChange={event => setFilter("status", event.target.value)}><option value="">Tous</option>{data.facets.statuses.map(value => <option key={value}>{value}</option>)}</select></label>
      <button className="text-btn" onClick={() => query.refetch()}>Actualiser</button>
    </div>

    {focusedProcessId && <ObservabilityFocusPanel process={focusedProcess} processId={focusedProcessId}/>}

    <div className="observability-workbench">
      <Card className="observability-health-panel">
        <header><div><p className="eyebrow">SLA & transport</p><h2>Santé du pipeline</h2></div><span className={summary.slaBreaches ? "negative" : "positive"}>{summary.slaBreaches} BREACH</span></header>
        <div className="observability-health-grid">
          <HealthCell label="Queue depth" value={data.queue.depth} detail={`attente max ${formatDuration(data.queue.oldestQueuedMs)}`} tone={data.queue.oldestQueuedMs && data.queue.oldestQueuedMs > data.sla.queueWarningMs ? "warning" : "positive"}/>
          <HealthCell label="Queue moyenne" value={formatDuration(summary.avgQueueMs)} detail={`SLA ${formatDuration(data.sla.queueWarningMs)}`}/>
          <HealthCell label="Leases actives" value={data.leases.active} detail={`${data.leases.expiring} expirantes`} tone={data.leases.expiring ? "warning" : "positive"}/>
          <HealthCell label="Exécution moyenne" value={formatDuration(summary.avgExecutionMs)} detail={`SLA ${formatDuration(data.sla.executionWarningMs)}`}/>
        </div>
      </Card>
      <BreakdownPanel title="Workflows" items={data.breakdowns.workflows}/>
      <BreakdownPanel title="Workers" items={data.breakdowns.workers}/>
      <BreakdownPanel title="Modèles" items={data.breakdowns.models}/>
    </div>

    <section className="replay-terminal-section observability-process-ledger">
      <header><div><p className="eyebrow">Process ledger</p><h2>Exécutions GPT globales</h2></div><span>{data.count} lignes · aucun coût estimé</span></header>
      <ProcessTable items={data.items} focusedProcessId={focusedProcessId} onFocus={focusProcess}/>
    </section>
    <CodexReasoningModal
      open={configuringReasoning}
      settings={data.aiRuntimeSettings}
      onClose={() => setConfiguringReasoning(false)}
    />
    <GuardrailPolicyModal open={configuring} policy={data.guardrails.policy} onClose={() => setConfiguring(false)}/>
  </section>;
}

function CodexWorkerFleet({ data }: { data: ObservabilityOverview }) {
  const fleet = data.aiWorkers;
  return <Card className="codex-worker-fleet" aria-label="Services IA Codex">
    <header>
      <div><p className="eyebrow">Moteur analytique local</p><h2>Workers Codex Windows</h2></div>
      <span data-tone={fleet.degraded ? "warning" : fleet.active ? "positive" : "neutral"}>
        {fleet.active ? `${fleet.active} ACTIF${fleet.active > 1 ? "S" : ""}` : fleet.shadow ? "SHADOW" : "NON ACTIF"}
      </span>
    </header>
    <div className="codex-worker-fleet__summary">
      <span>Enregistrés <strong>{fleet.registered}/{fleet.expected}</strong></span>
      <span>Sains <strong>{fleet.healthy}</strong></span>
      <span>Shadow <strong>{fleet.shadow}</strong></span>
      <span>Dégradés <strong>{fleet.degraded}</strong></span>
      <span>Réflexion <strong>{reasoningEffortLabel(data.aiRuntimeSettings.reasoningEffort)}</strong></span>
    </div>
    <div className="codex-worker-fleet__items">
      {!fleet.items.length && <p className="empty-copy">Les services Codex ne sont pas encore enregistrés sur ce déploiement.</p>}
      {fleet.items.map(worker => <div key={worker.serviceId} data-healthy={worker.healthy}>
        <i/>
        <strong>{worker.scope === "live" ? "LIVE" : worker.scope === "replay" ? "REPLAY" : "IA"} · {worker.workerId}</strong>
        <span>{worker.mode.toUpperCase()}</span>
        <small>{worker.latestRun?.decisionSummary || worker.latestRun?.status || "Aucun cycle analytique"}</small>
        <time>{worker.heartbeatAt ? formatDateTime(worker.heartbeatAt) : "Jamais vu"}</time>
      </div>)}
    </div>
  </Card>;
}

function CodexReasoningModal({
  open,
  settings,
  onClose,
}: {
  open: boolean;
  settings: AiRuntimeSettings;
  onClose: () => void;
}) {
  return <Modal open={open} title="Niveau de réflexion Codex" onClose={onClose}>
    {open && <CodexReasoningForm key={settings.revision} settings={settings} onClose={onClose}/>}
  </Modal>;
}

function CodexReasoningForm({
  settings,
  onClose,
}: {
  settings: AiRuntimeSettings;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>(settings.reasoningEffort);
  const mutation = useMutation({
    mutationFn: operationsApi.updateAiRuntimeSettings,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: operationsKeys.all });
      onClose();
    },
  });
  const options = settings.supportedReasoningEfforts.length
    ? settings.supportedReasoningEfforts
    : (["low", "medium", "high", "xhigh", "max", "ultra"] as CodexReasoningEffort[]);
  return <ConfirmActionForm
    target="ai-runtime-settings/default"
    revision={settings.revision}
    expectedPhrase="CONFIRM_UPDATE_REASONING_EFFORT"
    confirmLabel="Appliquer aux prochaines analyses"
    onCancel={onClose}
    onConfirm={({ confirmationPhrase, reason }) => {
      const input: AiRuntimeSettingsActionInput = {
        action: "update_reasoning_effort",
        expectedRevision: settings.revision,
        reasoningEffort,
        idempotencyKey: crypto.randomUUID(),
        confirmationPhrase: confirmationPhrase as "CONFIRM_UPDATE_REASONING_EFFORT",
        reason,
      };
      return mutation.mutateAsync(input).then(() => undefined);
    }}
  >
    <div className="codex-reasoning-control">
      <div className="codex-reasoning-control__current">
        <span>Niveau actuel</span>
        <strong>{reasoningEffortLabel(settings.reasoningEffort)}</strong>
        <small>Source {settings.source} · effectif à la prochaine analyse</small>
      </div>
      <label>
        Niveau souhaité
        <select value={reasoningEffort} onChange={event => setReasoningEffort(event.target.value as CodexReasoningEffort)}>
          {options.map(value => <option value={value} key={value}>{reasoningEffortLabel(value)}</option>)}
        </select>
      </label>
      <p>
        Un niveau plus élevé améliore l’analyse des cas complexes, mais augmente généralement la durée et la consommation de jetons.
        Une analyse déjà en cours conserve son niveau de départ.
      </p>
    </div>
  </ConfirmActionForm>;
}

function reasoningEffortLabel(value: CodexReasoningEffort) {
  return ({
    low: "Faible",
    medium: "Standard",
    high: "Élevée",
    xhigh: "Très élevée",
    max: "Maximum",
    ultra: "Ultra",
  } as const)[value] || value;
}

function ObservabilityFocusPanel({ process, processId }: { process: ObservabilityProcess | null; processId: string }) {
  const incidentHref = process?.runId
    ? `/operations/incidents?run_id=${encodeURIComponent(process.runId)}`
    : `/operations/incidents?process=${encodeURIComponent(processId)}`;
  const runbookHref = process?.runId
    ? `/operations/runbooks?run_id=${encodeURIComponent(process.runId)}&status=all`
    : `/operations/runbooks?process=${encodeURIComponent(processId)}&status=all`;
  return <Card className="observability-focus-panel" aria-label="Focus process observabilité">
    <header>
      <div><p className="eyebrow">Analyse sélectionnée</p><h2>{process?.workflow ? workflowLabel(process.workflow) : gptProcessLabel(processId)}</h2></div>
      {process ? <StatusTag status={process.status}/> : <span className="terminal-code">NOT_FOUND</span>}
    </header>
    {process ? <div className="observability-focus-grid">
      <span>Analyse <strong>{gptProcessLabel(process.workItemId || process.id)}</strong></span>
      <span>Replay <strong>{process.runId ? replayLabel(process.runId) : "—"}</strong></span>
      <span>Prise en charge <strong>{process.worker ? "Attribuée" : "En attente"}</strong></span>
      <span>Lease <strong>{process.lease.state.toUpperCase()}</strong></span>
      <span>Modèle <strong>{process.telemetry.model || "N/D"}</strong></span>
    </div> : <p className="empty-copy">Aucun processus ne correspond à ce focus dans les filtres actifs.</p>}
    {process && <TechnicalDetails items={[
      { label: "Processus", value: process.id },
      { label: "Work item", value: process.workItemId },
      { label: "Run", value: process.runId },
      { label: "Worker", value: process.worker },
    ]}/>}
    <div className="observability-focus-links">
      {process?.scope === "replay" && process.runId && process.workItemId && <Link to={`/replay/runs/${encodeURIComponent(process.runId)}/gpt/${encodeURIComponent(process.workItemId)}`}>Inspecter GPT</Link>}
      {process?.runId && <Link to={`/operations/workflows/${encodeURIComponent(`replay:${process.runId}`)}`}>Workflow parent</Link>}
      <Link to={incidentHref}>Incidents liés</Link>
      <Link to={runbookHref}>Runbooks liés</Link>
      <Link to="/operations/observability">Retirer le focus</Link>
    </div>
  </Card>;
}

function OperationsTabs() {
  return <PageTabs items={[
    { label: "Cockpit", to: "/operations", end: true },
    { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" },
    { label: "Portfolio Risk", to: "/operations/portfolio-risk" },
    { label: "Observabilité", to: "/operations/observability" },
    { label: "Incidents", to: "/operations/incidents" },
    { label: "Notifications", to: "/operations/notifications" },
    { label: "Runbooks", to: "/operations/runbooks" },
  ]}/>;
}

function CoverageRail({ data }: { data: ObservabilityOverview }) {
  return <div className="observability-coverage" aria-label="Couverture de la télémétrie">
    <span>TELEMETRY COVERAGE</span>
    {([
      ["Payload", data.coverage.telemetry],
      ["Tokens", data.coverage.tokens],
      ["Cost USD", data.coverage.cost],
    ] as const).map(([label, value]) => <div key={label}><strong>{label}</strong><i><b style={{ width: `${value.percent}%` }}/></i><em>{value.available}/{value.total} · {value.percent}%</em></div>)}
    <small>Les valeurs N/D ne sont ni extrapolées ni tarifées localement.</small>
  </div>;
}

function GuardrailBoard({ data }: { data: ObservabilityOverview }) {
  const guardrails = data.guardrails;
  const daily = guardrails.budgets.daily[0] || null;
  const monthly = guardrails.budgets.monthly[0] || null;
  return <section className="guardrail-board" aria-label="Guardrails SLA et budgets GPT">
    <header>
      <div><p className="eyebrow">Active guardrails</p><h2>SLA & budgets mesurés</h2></div>
      <span data-enabled={guardrails.enabled}>{guardrails.enabled ? `POLICY R${guardrails.policy.revision}` : "DISABLED"}</span>
    </header>
    <div className="guardrail-summary">
      <GuardrailCounter label="Critiques" value={guardrails.summary.critical} tone="critical"/>
      <GuardrailCounter label="Warnings" value={guardrails.summary.warning} tone="warning"/>
      <BudgetCell label="Budget jour" period={daily} limit={guardrails.policy.dailyCostBudgetUsd}/>
      <BudgetCell label="Budget mois" period={monthly} limit={guardrails.policy.monthlyCostBudgetUsd}/>
      <GuardrailCounter label="Failure rate" value={guardrails.summary.failureRatePct === null ? "N/D" : `${guardrails.summary.failureRatePct}%`} tone={guardrails.summary.failureRatePct !== null && guardrails.summary.failureRatePct > guardrails.policy.failureRateWarningPct ? "critical" : "neutral"}/>
    </div>
    <div className="guardrail-signals">
      {!guardrails.signals.length ? <div className="guardrail-signal guardrail-signal--healthy"><i/><div><strong>Aucun signal actif</strong><small>Les seuils configurés sont respectés sur les données mesurées.</small></div></div>
        : guardrails.signals.slice(0, 8).map(signal => <GuardrailSignalRow key={signal.id} signal={signal}/>)}
    </div>
  </section>;
}

function GuardrailCounter({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong></div>;
}

function BudgetCell({ label, period, limit }: { label: string; period: ObservabilityOverview["guardrails"]["budgets"]["daily"][number] | null; limit: number | null }) {
  return <div data-tone={period?.state === "breached" ? "critical" : period?.state === "insufficient_data" ? "warning" : "neutral"}>
    <span>{label}</span><strong>{limit === null ? "NON CONFIG." : `${formatCost(period?.measuredCostUsd ?? 0)} / ${formatCost(limit)}`}</strong>
  </div>;
}

function GuardrailSignalRow({ signal }: { signal: GuardrailSignal }) {
  const content = <><i/><div><strong>{signal.title}</strong><small>{signal.message}</small></div><em>{formatGuardrailValue(signal.observedValue, signal.unit)}</em></>;
  return signal.processId && signal.runId
    ? <Link className={`guardrail-signal guardrail-signal--${signal.severity}`} to={`/replay/runs/${encodeURIComponent(signal.runId)}/gpt/${encodeURIComponent(signal.processId)}`}>{content}</Link>
    : <div className={`guardrail-signal guardrail-signal--${signal.severity}`}>{content}</div>;
}

function GuardrailPolicyModal({ open, policy, onClose }: { open: boolean; policy: ObservabilityPolicy; onClose: () => void }) {
  return <Modal open={open} title="Configurer les guardrails GPT" onClose={onClose}>
    {open && <GuardrailPolicyForm key={policy.revision} policy={policy} onClose={onClose}/>}
  </Modal>;
}

function GuardrailPolicyForm({ policy, onClose }: { policy: ObservabilityPolicy; onClose: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState({
    enabled: policy.enabled,
    queueWarningMinutes: policy.queueWarningMs / 60_000,
    executionWarningMinutes: policy.executionWarningMs / 60_000,
    leaseExpiringMinutes: policy.leaseExpiringMs / 60_000,
    telemetryCoverageWarningPct: policy.telemetryCoverageWarningPct,
    costCoverageMinimumPct: policy.costCoverageMinimumPct,
    failureRateWarningPct: policy.failureRateWarningPct,
    dailyCostBudgetUsd: policy.dailyCostBudgetUsd === null ? "" : String(policy.dailyCostBudgetUsd),
    monthlyCostBudgetUsd: policy.monthlyCostBudgetUsd === null ? "" : String(policy.monthlyCostBudgetUsd),
  });
  const mutation = useMutation({
    mutationFn: operationsApi.updateObservabilityPolicy,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: operationsKeys.all });
      onClose();
    },
  });
  const update = (field: keyof typeof draft, value: string | number | boolean) => setDraft(current => ({ ...current, [field]: value }));
  const valid = () => (
    draft.queueWarningMinutes >= 1
    && draft.executionWarningMinutes >= 1
    && draft.leaseExpiringMinutes >= .5
    && [draft.telemetryCoverageWarningPct, draft.costCoverageMinimumPct, draft.failureRateWarningPct].every(value => value >= 0 && value <= 100)
    && [draft.dailyCostBudgetUsd, draft.monthlyCostBudgetUsd].every(value => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0))
  );
  return <ConfirmActionForm
    target="observability-policy/default"
    revision={policy.revision}
    expectedPhrase="CONFIRM_UPDATE"
    confirmLabel="Enregistrer la policy"
    onCancel={onClose}
    validateExtra={valid}
    onConfirm={({ confirmationPhrase, reason }) => {
      const input: ObservabilityPolicyActionInput = {
        action: "update",
        expectedRevision: policy.revision,
        idempotencyKey: crypto.randomUUID(),
        confirmationPhrase: confirmationPhrase as "CONFIRM_UPDATE",
        reason,
        policy: {
          enabled: draft.enabled,
          queueWarningMs: Math.round(draft.queueWarningMinutes * 60_000),
          executionWarningMs: Math.round(draft.executionWarningMinutes * 60_000),
          leaseExpiringMs: Math.round(draft.leaseExpiringMinutes * 60_000),
          telemetryCoverageWarningPct: Number(draft.telemetryCoverageWarningPct),
          costCoverageMinimumPct: Number(draft.costCoverageMinimumPct),
          failureRateWarningPct: Number(draft.failureRateWarningPct),
          dailyCostBudgetUsd: draft.dailyCostBudgetUsd === "" ? null : Number(draft.dailyCostBudgetUsd),
          monthlyCostBudgetUsd: draft.monthlyCostBudgetUsd === "" ? null : Number(draft.monthlyCostBudgetUsd),
        },
      };
      return mutation.mutateAsync(input).then(() => undefined);
    }}
  >
    <div className="guardrail-policy-form">
      <label className="guardrail-policy-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => update("enabled", event.target.checked)}/><span>Guardrails actifs</span></label>
      <PolicyNumber label="Queue SLA (min)" value={draft.queueWarningMinutes} min={1} onChange={value => update("queueWarningMinutes", value)}/>
      <PolicyNumber label="Exécution SLA (min)" value={draft.executionWarningMinutes} min={1} onChange={value => update("executionWarningMinutes", value)}/>
      <PolicyNumber label="Lease expirante (min)" value={draft.leaseExpiringMinutes} min={.5} step={.5} onChange={value => update("leaseExpiringMinutes", value)}/>
      <PolicyNumber label="Couverture télémétrie (%)" value={draft.telemetryCoverageWarningPct} min={0} max={100} onChange={value => update("telemetryCoverageWarningPct", value)}/>
      <PolicyNumber label="Couverture coût minimale (%)" value={draft.costCoverageMinimumPct} min={0} max={100} onChange={value => update("costCoverageMinimumPct", value)}/>
      <PolicyNumber label="Taux d’échec max. (%)" value={draft.failureRateWarningPct} min={0} max={100} onChange={value => update("failureRateWarningPct", value)}/>
      <PolicyText label="Budget journalier USD" value={draft.dailyCostBudgetUsd} placeholder="Non configuré" onChange={value => update("dailyCostBudgetUsd", value)}/>
      <PolicyText label="Budget mensuel USD" value={draft.monthlyCostBudgetUsd} placeholder="Non configuré" onChange={value => update("monthlyCostBudgetUsd", value)}/>
    </div>
  </ConfirmActionForm>;
}

function PolicyNumber({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))}/></label>;
}

function PolicyText({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label>{label}<input type="number" value={value} min="0" step="0.0001" placeholder={placeholder} onChange={event => onChange(event.target.value)}/></label>;
}

function HealthCell({ label, value, detail, tone = "neutral" }: { label: string; value: string | number; detail: string; tone?: string }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function BreakdownPanel({ title, items }: { title: string; items: ObservabilityBreakdown[] }) {
  return <Card className="observability-breakdown">
    <header><h2>{title}</h2><span>{items.length}</span></header>
    <div>{items.slice(0, 6).map(item => <div className="observability-breakdown__row" key={item.label}>
      <strong title={item.label}>{item.label}</strong>
      <span>{item.processes} proc.</span>
      <span>{formatPercent(item.successRate)}</span>
      <span>{formatDuration(item.avgExecutionMs)}</span>
      <em>{formatCost(item.costUsd)}</em>
    </div>)}</div>
  </Card>;
}

function ProcessTable({ items, focusedProcessId, onFocus }: { items: ObservabilityProcess[]; focusedProcessId?: string; onFocus: (processId: string) => void }) {
  if (!items.length) return <Card className="workspace-empty"><h3>Aucun processus</h3><p>Aucune exécution persistée ne correspond aux filtres.</p></Card>;
  return <div className="data-table-wrap"><table className="data-table observability-process-table">
    <thead><tr><th>Scope / Workflow</th><th>État</th><th>Worker</th><th>Queue</th><th>Exécution</th><th>Lease</th><th>Modèle</th><th>Tokens</th><th>Coût</th><th><span className="sr-only">Action</span></th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id} className={focusedProcessId && processMatchesFocus(item, focusedProcessId) ? "is-selected" : ""} data-breach={item.sla.queueBreached || item.sla.executionBreached || item.sla.leaseBreached}>
      <td data-label="Workflow"><strong><i data-scope={item.scope}/>{item.workflow}</strong><small>{item.scope.toUpperCase()} · {item.tradingDate || "—"} · {item.session || "—"}</small></td>
      <td data-label="État"><StatusTag status={item.status}/><small>{item.attempts}/{item.maxAttempts || "—"} tent.</small></td>
      <td data-label="Worker"><span className="terminal-code" title={item.worker || "Non assigné"}>{item.worker || "—"}</span></td>
      <td data-label="Queue"><DurationValue value={item.queueMs} breached={item.sla.queueBreached}/></td>
      <td data-label="Exécution"><DurationValue value={item.executionMs} breached={item.sla.executionBreached}/></td>
      <td data-label="Lease"><LeaseState item={item}/></td>
      <td data-label="Modèle"><strong>{item.telemetry.model || "N/D"}</strong><small>{item.telemetry.provider || "telemetry absente"}</small></td>
      <td data-label="Tokens"><span>{formatTokens(item.telemetry.totalTokens)}</span><small>{item.telemetry.inputTokens === null ? "N/D" : `${item.telemetry.inputTokens} in · ${item.telemetry.outputTokens ?? "N/D"} out`}</small></td>
      <td data-label="Coût"><strong>{formatCost(item.telemetry.costUsd)}</strong></td>
      <td data-label="Action"><div className="observability-row-actions">
        <button className="ledger-focus-btn" type="button" onClick={() => onFocus(item.workItemId || item.id)}>Focus</button>
        {item.scope === "replay" && item.runId && item.workItemId
          ? <Link className="row-link" to={`/replay/runs/${encodeURIComponent(item.runId)}/gpt/${encodeURIComponent(item.workItemId)}`}>Inspecter <span>→</span></Link>
          : <span className="observability-live-ref" title={item.cursorId || ""}>CURSOR</span>}
      </div></td>
    </tr>)}</tbody>
  </table></div>;
}

function processMatchesFocus(item: ObservabilityProcess, processId: string) {
  return [item.id, item.workItemId, item.cursorId].filter(Boolean).map(String).includes(String(processId));
}

function DurationValue({ value, breached }: { value: number | null; breached: boolean }) {
  return <span className={breached ? "observability-breach" : ""}>{formatDuration(value)}{breached && <small>SLA</small>}</span>;
}

function LeaseState({ item }: { item: ObservabilityProcess }) {
  const labels = { none: "—", active: "ACTIVE", expiring: "EXPIRING", expired: "EXPIRED" };
  return <span className="lease-state" data-state={item.lease.state}>{labels[item.lease.state]}<small>{item.lease.state === "none" ? "" : formatDateTime(item.lease.expiresAt)}</small></span>;
}

function formatPercent(value: number | null) {
  return value === null ? "N/D" : `${Math.round(value * 100)}%`;
}

function formatTokens(value: number | null) {
  return value === null ? "N/D" : new Intl.NumberFormat("fr-FR").format(value);
}

function formatCost(value: number | null) {
  if (value === null) return "N/D";
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatGuardrailValue(value: number | null, unit: GuardrailSignal["unit"]) {
  if (value === null) return "N/D";
  if (unit === "ms") return formatDuration(Math.abs(value));
  if (unit === "percent") return `${value}%`;
  if (unit === "usd") return formatCost(value);
  return new Intl.NumberFormat("fr-FR").format(value);
}
