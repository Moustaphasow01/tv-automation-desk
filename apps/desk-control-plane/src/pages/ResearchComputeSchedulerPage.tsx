import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBolt,
  FaClock,
  FaExclamationTriangle,
  FaFingerprint,
  FaMicrochip,
  FaPause,
  FaPlay,
  FaRedo,
  FaServer,
  FaShieldAlt,
  FaTasks
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { ResearchComputeSchedulerView } from "@/domains/front-api/viewModels";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";

type ComputeAction = ResearchComputeSchedulerView["commandActions"][number];
type ComputeJob = ResearchComputeSchedulerView["jobs"][number];
type ComputePool = ResearchComputeSchedulerView["pools"][number];

export function ResearchComputeSchedulerPage() {
  const query = useFrontView("research-compute-scheduler");
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <ResearchComputeLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Compute Scheduler indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune projection compute" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/research-compute-scheduler`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;

  const confirmAction = async (action: ComputeAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Research compute action confirmed: ${action.label}`,
        payload: action.payload
      });
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "RESEARCH_COMPUTE_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page research-compute-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Compute Scheduler"
        description={`Jobs, pools, workers, coûts et capacité LIVE réservée · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to="/research">Research Lab</Link>
            <Link className="operator-primary-action" to="/operations">Opérations</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Compute Scheduler">
        <KpiCard label="RUNNING" value={`${data.summary.runningJobs}`} delta={`${data.summary.activeWorkers} workers`} tone="success" />
        <KpiCard label="QUEUED" value={`${data.summary.queuedJobs}`} delta={`${data.summary.waitingJobs} waiting`} tone="warning" />
        <KpiCard label="DLQ" value={`${data.summary.dlqItems}`} delta="recoverable" tone={data.summary.dlqItems > 0 ? "warning" : "success"} />
        <KpiCard label="LIVE RESERVE" value={`${data.summary.liveReservedPct}%`} delta="capacité protégée" tone="success" />
        <KpiCard label="RESEARCH USED" value={`${data.summary.researchUsedPct}%`} delta="batch load" tone="accent" />
        <KpiCard label="COST" value={`$${data.summary.costTodayUsd.toFixed(2)}`} delta="today" tone="neutral" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Pools, jobs et workers">
        <Card title="Pools & capacité" actions={<InlineAction>Pools</InlineAction>} density="compact">
          <div className="research-compute-pool-list">
            {data.pools.map((pool) => (
              <PoolCard key={pool.poolId} pool={pool} />
            ))}
          </div>
        </Card>

        <Card title="Jobs scheduler" actions={<InlineAction>Jobs</InlineAction>} density="compact">
          <div className="research-compute-job-list">
            {data.jobs.map((job) => (
              <JobRow key={job.jobId} job={job} pool={poolById(data.pools, job.poolId)} />
            ))}
          </div>
        </Card>

        <Card title="Workers runtime" actions={<InlineAction>Workers</InlineAction>} density="compact">
          <div className="research-compute-worker-list">
            {data.workers.map((worker) => (
              <article key={worker.workerId}>
                <FaServer />
                <div>
                  <strong>{worker.workerId}</strong>
                  <small>{worker.kind} · {worker.poolId}</small>
                  <span>{worker.currentJobId ?? "idle"} · {formatTime(worker.heartbeatAt)}</span>
                </div>
                <ProgressBar value={Math.max(worker.cpuPct, worker.memoryPct, worker.gpuPct)} label={`${worker.workerId} load`} tone={worker.status === "DEGRADED" ? "danger" : worker.status === "IDLE" ? "neutral" : "accent"} />
                <StatusBadge tone={workerTone(worker.status)}>{worker.status}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Réservations, DLQ et commandes compute">
        <Card title="Réservations & priorité LIVE" actions={<InlineAction>Capacity</InlineAction>} density="compact">
          <div className="research-compute-reservation-list">
            {data.reservations.map((reservation) => (
              <article key={reservation.reservationId}>
                <FaShieldAlt />
                <div>
                  <strong>{reservation.label}</strong>
                  <small>{reservation.scope} · {reservation.poolId}</small>
                  <span>{reservation.reason}</span>
                </div>
                <ProgressBar value={reservation.reservedPct} label={`${reservation.label} reserved`} tone={reservation.scope === "LIVE" ? "success" : "accent"} />
                <StatusBadge tone={reservation.active ? "success" : "neutral"}>{reservation.active ? "ACTIVE" : "OFF"}</StatusBadge>
              </article>
            ))}
          </div>
          <article className="research-compute-proof">
            <FaShieldAlt />
            <div>
              <strong>LIVE first</strong>
              <small>Le scheduler expose la réserve LIVE, mais l’UI ne planifie jamais localement : toute mutation passe par Command Runtime/BFF.</small>
            </div>
          </article>
        </Card>

        <Card title="DLQ & retries" actions={<InlineAction>Recover</InlineAction>} density="compact">
          <div className="research-compute-dlq-list">
            {data.dlq.map((item) => (
              <article key={item.dlqId}>
                <FaExclamationTriangle />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.jobId} · {item.errorCode}</small>
                </div>
                <StatusBadge tone={item.retryable ? "warning" : "danger"}>{item.retryable ? "RETRY" : "BLOCK"}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="research-compute-resource-grid">
            {data.jobs.slice(0, 4).map((job) => (
              <MetricBox key={job.jobId} label={compactId(job.jobId)} value={`${job.allocatedVcpu}/${job.requestedVcpu} vCPU · ${job.allocatedMemoryGb}/${job.requestedMemoryGb} GB`} />
            ))}
          </div>
        </Card>

        <Card title="Actions compute" actions={<InlineAction>Command Runtime</InlineAction>} density="compact">
          <div className="research-compute-actions">
            {data.commandActions.map((action) => (
              <article key={action.actionId}>
                <span>{actionIcon(action.commandType)}</span>
                <div>
                  <strong>{action.label}</strong>
                  <small>{action.jobId ?? action.poolId} · {action.commandType}</small>
                </div>
                <StatusBadge tone={permissionTone(action.permission)}>{permissionLabel(action.permission)}</StatusBadge>
                <DeskButton
                  variant="primary"
                  disabled={action.permission !== "ALLOWED" || submittingActionId === action.actionId}
                  onClick={() => confirmAction(action)}
                >
                  {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                </DeskButton>
              </article>
            ))}
          </div>
          <div className="research-compute-command-result">
            <FaFingerprint />
            <div>
              <strong>{command ? `Commande ${command.status}` : commandError ? "Commande rejetée" : "Aucune commande envoyée"}</strong>
              <small>{command?.commandId ?? commandError ?? "Priorité, retry et pause pool restent async, idempotents et auditables."}</small>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ResearchComputeLoading() {
  return (
    <div className="operator-page research-compute-page">
      <OperatorPageHeader title="Compute Scheduler" description="Chargement de la projection compute." />
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => (
          <KpiCard key={index} label="LOADING" value="—" state="loading" />
        ))}
      </section>
    </div>
  );
}

function PoolCard({ pool }: { pool: ComputePool }) {
  return (
    <article className={`research-compute-pool-card research-compute-pool-card--${pool.mode.toLowerCase()}`}>
      <header>
        <FaMicrochip />
        <div>
          <strong>{pool.label}</strong>
          <small>{pool.mode} · {pool.capacityVcpu} vCPU · {pool.capacityMemoryGb} GB</small>
        </div>
        <StatusBadge tone={poolTone(pool.status)}>{pool.status}</StatusBadge>
      </header>
      <div className="research-compute-pool-bars">
        <span><small>Used</small><ProgressBar value={pool.usedPct} label={`${pool.label} used`} tone={pool.usedPct > 70 ? "warning" : "accent"} /><b>{pool.usedPct}%</b></span>
        <span><small>LIVE</small><ProgressBar value={pool.reservedForLivePct} label={`${pool.label} live reserved`} tone="success" /><b>{pool.reservedForLivePct}%</b></span>
      </div>
    </article>
  );
}

function JobRow({ job, pool }: { job: ComputeJob; pool?: ComputePool }) {
  return (
    <article>
      <FaTasks />
      <div>
        <strong>{job.label}</strong>
        <small>{compactId(job.jobId)} · {pool?.label ?? job.poolId}</small>
      </div>
      <ProgressBar value={job.progressPct} label={`${job.label} progress`} tone={job.priority === "LIVE_PROTECTED" ? "success" : job.state === "RETRYING" ? "warning" : "accent"} />
      <span>{job.eta}</span>
      <StatusBadge tone={jobTone(job.state)}>{job.state}</StatusBadge>
    </article>
  );
}

function poolById(pools: readonly ComputePool[], poolId: string) {
  return pools.find((pool) => pool.poolId === poolId);
}

function actionIcon(commandType: string) {
  if (commandType.includes("retry")) return <FaRedo />;
  if (commandType.includes("pause")) return <FaPause />;
  if (commandType.includes("priority")) return <FaBolt />;
  return <FaPlay />;
}

function poolTone(status: ComputePool["status"]) {
  if (status === "ACTIVE") return "success";
  if (status === "THROTTLED") return "warning";
  return "neutral";
}

function workerTone(status: ResearchComputeSchedulerView["workers"][number]["status"]) {
  if (status === "RUNNING") return "success";
  if (status === "DEGRADED") return "danger";
  if (status === "WAITING") return "warning";
  return "neutral";
}

function jobTone(status: ComputeJob["state"]) {
  if (status === "RUNNING" || status === "COMPLETED") return "success";
  if (status === "QUEUED" || status === "WAITING_EVENT" || status === "RETRYING") return "warning";
  return "danger";
}

function permissionTone(permission: ComputeAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function permissionLabel(permission: ComputeAction["permission"]) {
  if (permission === "ALLOWED") return "OK";
  if (permission === "STEP_UP_REQUIRED") return "STEP-UP";
  return "DENIED";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function compactId(value: string) {
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 11)}…${value.slice(-7)}`;
}
