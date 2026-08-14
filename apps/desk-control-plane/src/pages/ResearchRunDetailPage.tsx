import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FaBalanceScale,
  FaCodeBranch,
  FaDownload,
  FaExchangeAlt,
  FaFingerprint,
  FaRandom,
  FaRedo,
  FaShieldAlt,
  FaTachometerAlt
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, Sparkline, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { ResearchRunDetailView } from "@/domains/front-api/viewModels";

type RunAction = ResearchRunDetailView["commandActions"][number];
type RunVerdict = ResearchRunDetailView["regimePerformance"][number]["verdict"];

export function ResearchRunDetailPage() {
  const { runId } = useParams();
  const query = useFrontView("research-run-detail", { runId });
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <ResearchRunLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Run detail indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucun run" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/research-run-detail`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const requestedRunId = runId ?? data.run.runId;
  const idMismatch = requestedRunId !== data.run.runId;

  const confirmAction = async (action: RunAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Research run action confirmed: ${action.label}`,
        payload: action.payload
      });
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "RESEARCH_RUN_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page research-run-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Run Report"
        description={`${compactId(data.run.runId)} · ${data.run.reproducibility} · ${data.run.engineVersion} · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to={`/research/experiments/${data.run.experimentId}`}>Expérience</Link>
            <Link className="operator-primary-action" to="/research">Retour Research</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs run detail">
        <KpiCard label="TOTAL R" value={formatSignedR(data.summary.totalR)} delta={`${data.summary.trades} trades`} tone={data.summary.totalR >= 0 ? "success" : "danger"} />
        <KpiCard label="MAX DD" value={formatSignedR(data.summary.maxDrawdownR)} delta="drawdown officiel" tone="warning" />
        <KpiCard label="WIN RATE" value={`${data.summary.winRatePct}%`} delta={`PF ${data.summary.profitFactor.toFixed(2)}`} tone="info" />
        <KpiCard label="SHARPE" value={data.summary.sharpe.toFixed(2)} delta={`MAE ${formatSignedR(data.summary.avgMaeR)}`} tone="info" />
        <KpiCard label="COSTS" value={formatSignedR(data.summary.costR + data.summary.slippageR)} delta="slippage + frais" tone="warning" />
        <KpiCard label="LOCK" value={data.run.reproducibility} delta={`seed ${data.run.seed}`} tone={data.run.reproducibility === "LOCKED" ? "success" : "warning"} />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Reproductibilité, equity et distributions">
        <Card title="Run identity & reproducibility" actions={<InlineAction>Hashes</InlineAction>} density="compact" tone={idMismatch ? "warning" : "neutral"}>
          <div className="research-run-identity">
            {idMismatch ? (
              <article className="research-run-warning">
                <FaShieldAlt />
                <div><strong>Run demandé différent du mock actif</strong><small>{requestedRunId} → {data.run.runId}</small></div>
              </article>
            ) : null}
            <div className="research-run-metrics">
              <MetricBox label="Run" value={compactId(data.run.runId)} />
              <MetricBox label="Dataset" value={data.run.datasetId} />
              <MetricBox label="Hash" value={data.run.datasetHash} />
              <MetricBox label="Strategy version" value={data.run.strategyVersionId} />
              <MetricBox label="Runtime" value={data.run.runtimeVersion} />
              <MetricBox label="Status" value={data.run.status} />
            </div>
            <div className="research-run-params">
              {data.parameters.map((param) => (
                <article key={param.key}>
                  <small>{param.key}</small>
                  <strong>{String(param.value)}</strong>
                </article>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Equity, distribution & benchmark" actions={<InlineAction>Comparer</InlineAction>} density="compact">
          <div className="research-run-equity">
            <Sparkline points={data.equityCurve} tone={data.summary.totalR >= 0 ? "success" : "danger"} />
            <div className="research-run-benchmark">
              <MetricBox label="Baseline" value={compactId(data.benchmark.baselineRunId)} />
              <MetricBox label="Delta R" value={formatSignedR(data.benchmark.deltaR)} />
              <MetricBox label="Delta DD" value={formatSignedR(data.benchmark.deltaDrawdownR)} />
              <MetricBox label="Verdict" value={data.benchmark.verdict} />
            </div>
          </div>
          <div className="research-run-distribution">
            {data.distribution.map((bucket) => (
              <article key={bucket.bucket}>
                <strong>{bucket.bucket}</strong>
                <small>{bucket.count} trades</small>
                <b className={bucket.pnlR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(bucket.pnlR)}</b>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Régimes, heures & ambiguïtés" actions={<InlineAction>Audit</InlineAction>} density="compact">
          <div className="research-run-regimes">
            {data.regimePerformance.map((regime) => (
              <article key={regime.regimeId}>
                <FaTachometerAlt />
                <div><strong>{regime.label}</strong><small>{regime.trades} trades · Sharpe {regime.sharpe.toFixed(2)}</small></div>
                <b className={regime.pnlR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(regime.pnlR)}</b>
                <StatusBadge tone={verdictTone(regime.verdict)}>{regime.verdict}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="research-run-hours">
            {data.hourlyPerformance.map((hour) => (
              <article key={hour.hourLabel}>
                <small>{hour.hourLabel}</small>
                <strong className={hour.pnlR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(hour.pnlR)}</strong>
                <span>{hour.trades}T</span>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Trades, ambiguïtés et commandes">
        <Card title="Trade list officielle" actions={<InlineAction>Trades</InlineAction>} density="compact">
          <div className="research-run-trade-list">
            {data.trades.map((trade) => (
              <article key={trade.tradeId}>
                <FaExchangeAlt />
                <div><strong>{trade.symbol} {trade.side} · {formatSignedR(trade.pnlR)}</strong><small>{formatTime(trade.openedAt)}→{formatTime(trade.closedAt)} · {trade.regime}</small></div>
                <span>{trade.entry.toFixed(2)}→{trade.exit.toFixed(2)}</span>
                <StatusBadge tone={trade.pnlR >= 0 ? "success" : "danger"}>{trade.pnlR >= 0 ? "WIN" : "LOSS"}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="MAE/MFE, coûts & ambiguïtés" actions={<InlineAction>Intrabar</InlineAction>} density="compact">
          <div className="research-run-risk-grid">
            <MetricBox label="Avg MAE" value={formatSignedR(data.summary.avgMaeR)} />
            <MetricBox label="Avg MFE" value={formatSignedR(data.summary.avgMfeR)} />
            <MetricBox label="Slippage" value={formatSignedR(data.summary.slippageR)} />
            <MetricBox label="Frais" value={formatSignedR(data.summary.costR)} />
          </div>
          <div className="research-run-ambiguity">
            {data.ambiguity.map((item) => (
              <article key={item.ambiguityId}>
                <FaRandom />
                <div><strong>{item.reason}</strong><small>{formatTime(item.barTime)} · {item.ambiguityId}</small></div>
                <StatusBadge tone={item.resolution === "CONSERVATIVE" ? "warning" : item.resolution === "SKIP" ? "danger" : "success"}>{item.resolution}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Actions run" actions={<InlineAction>Command Runtime</InlineAction>} density="compact">
          <div className="research-run-actions">
            {data.commandActions.map((action) => (
              <article key={action.actionId}>
                <span>{action.commandType.includes("export") ? <FaDownload /> : action.commandType.includes("replay") ? <FaRedo /> : <FaCodeBranch />}</span>
                <div><strong>{action.label}</strong><small>{action.commandType} · {action.requiresConfirmation ? "confirm" : "instant"}</small></div>
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
          <div className="research-run-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande run</small>
              <strong>{command ? `ACCEPTED · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <div className="research-run-proof">
            <FaBalanceScale />
            <span>Le front affiche uniquement le DTO run : hash, seed, versions, métriques et trade list viennent de la projection backend.</span>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ResearchRunLoading() {
  return (
    <div className="operator-page research-run-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function verdictTone(verdict: RunVerdict) {
  if (verdict === "PASS") return "success";
  if (verdict === "FAIL") return "danger";
  return "warning";
}

function permissionTone(permission: RunAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function permissionLabel(permission: RunAction["permission"]) {
  return permission === "STEP_UP_REQUIRED" ? "STEP-UP" : permission;
}

function compactId(value: string) {
  return value
    .replace("run_research_", "run:")
    .replace("exp_", "exp:")
    .replace("mission_research_", "mission:")
    .replace("strver_", "ver:");
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} R`;
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
