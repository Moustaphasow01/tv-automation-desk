import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FaBalanceScale,
  FaCodeBranch,
  FaDownload,
  FaExchangeAlt,
  FaFingerprint,
  FaRandom,
  FaRocket,
  FaUndo
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { presentPermission } from "@/design-system/labels";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { StrategyCompareView } from "@/domains/front-api/viewModels";

type CompareAction = StrategyCompareView["commandActions"][number];

export function StrategyComparePage() {
  const { strategyId } = useParams();
  const query = useFrontView("strategy-compare", { strategyId });
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <StrategyCompareLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Comparaison indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune comparaison" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/strategy-compare`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const requestedStrategyId = strategyId ?? data.strategy.strategyId;
  const idMismatch = requestedStrategyId !== data.strategy.strategyId;

  const confirmAction = async (action: CompareAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildStrategyCompareCommand(action, data));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "STRATEGY_COMPARE_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page strategy-compare-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Comparaison de stratégies"
        description={`${data.strategy.name} · ${data.summary.baseVersionId} → ${data.summary.candidateVersionId} · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to={`/strategies/${data.strategy.strategyId}`}>Fiche stratégie</Link>
            <Link className="operator-primary-action" to="/strategies">Retour catalogue</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs comparaison stratégie">
        <KpiCard label="VERDICT" value={data.summary.verdict} delta={`${data.strategy.family} · ${data.strategy.strategyDefinitionId}`} tone={data.summary.verdict === "PROMOTE" ? "success" : "warning"} />
        <KpiCard label="AMÉLIORATION NETTE" value={formatSignedR(data.summary.netImprovementR)} delta="candidat vs référence" tone="success" />
        <KpiCard label="EXPECTANCY Δ" value={formatSignedR(data.summary.expectancyDeltaR)} delta="R par trade" tone="success" />
        <KpiCard label="PF Δ" value={data.summary.profitFactorDelta.toFixed(2)} delta="profit factor" tone="success" />
        <KpiCard label="DD Δ" value={formatSignedR(data.summary.drawdownDeltaR)} delta="drawdown réduit" tone="success" />
        <KpiCard label="PARITÉ Δ" value={`${data.summary.liveParityDeltaPct}%`} delta="paper/backtest" tone="warning" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Versions et diff déterministe">
        <Card title="Versions comparées" actions={<InlineAction>{idMismatch ? "Incohérence ID" : "Paire de versions"}</InlineAction>} density="compact" tone={idMismatch ? "warning" : "neutral"}>
          <div className="strategy-compare-version-grid">
            {data.versions.map((version) => (
              <article key={version.strategyVersionId} className={`strategy-compare-version strategy-compare-version--${version.role.toLowerCase()}`}>
                <header>
                  <span>{version.role}</span>
                  <StatusBadge tone={version.role === "CANDIDATE" ? "success" : "neutral"}>{version.status}</StatusBadge>
                </header>
                <strong>{version.label}</strong>
                <small>{version.strategyVersionId}</small>
                <MetricBox label="Runtime Bundle" value={compactId(version.runtimeBundleId)} />
                <Link to={`/research/runs/${version.sourceRunId}`}>Ouvrir run source</Link>
              </article>
            ))}
          </div>
          <div className="strategy-compare-link-list">
            {data.deepLinks.map((link) => (
              <Link key={link.route} to={link.route}>
                <FaCodeBranch />
                <span>{link.label}</span>
                <small>{link.kind}</small>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Diff Spec stratégie" actions={<InlineAction>Spec diff</InlineAction>} density="compact">
          <div className="strategy-compare-diff-list">
            {data.specDiffs.map((diff) => (
              <article key={diff.diffId}>
                <FaExchangeAlt />
                <div><strong>{diff.section} · {diff.field}</strong><small>{diff.before} → {diff.after}</small></div>
                <StatusBadge tone={impactTone(diff.impact)}>{diff.impact}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="strategy-compare-param-list">
            {data.parameterDiffs.map((param) => (
              <article key={param.param}>
                <strong>{param.param}</strong>
                <small>{String(param.before)} → {String(param.after)}</small>
                <StatusBadge tone={param.changeType === "ADDED" ? "success" : param.changeType === "REMOVED" ? "warning" : "accent"}>{param.changeType}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Métriques clés" actions={<InlineAction>Metrics</InlineAction>} density="compact">
          <div className="strategy-compare-metric-list">
            {data.metricComparison.map((metric) => (
              <article key={metric.metric}>
                <strong>{metric.metric}</strong>
                <small>{metric.base} → {metric.candidate}</small>
                <b className={metric.delta >= 0 ? "text-success" : "text-danger"}>{formatMetricDelta(metric.delta, metric.metric)}</b>
                <ProgressBar value={metric.verdict === "BETTER" ? 82 : metric.verdict === "FLAT" ? 50 : 28} tone={verdictTone(metric.verdict)} />
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Régimes, divergences, coûts et actions">
        <Card title="Régimes & parité" actions={<InlineAction>Régimes</InlineAction>} density="compact">
          <div className="strategy-compare-regime-list">
            {data.regimeComparison.map((regime) => (
              <article key={regime.regimeId}>
                <FaRandom />
                <div><strong>{regime.label}</strong><small>{formatSignedR(regime.baseR)} → {formatSignedR(regime.candidateR)}</small></div>
                <b className={regime.deltaR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(regime.deltaR)}</b>
                <StatusBadge tone={verdictTone(regime.verdict)}>{regime.verdict}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="strategy-compare-parity-list">
            {data.parity.map((parity) => (
              <article key={parity.scope}>
                <strong>{parity.scope}</strong>
                <ProgressBar value={parity.candidatePct} tone={parity.status === "PASS" ? "success" : parity.status === "BLOCK" ? "danger" : "warning"} />
                <span>{parity.basePct}% → {parity.candidatePct}%</span>
                <StatusBadge tone={parity.status === "PASS" ? "success" : parity.status === "BLOCK" ? "danger" : "warning"}>{parity.status}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Trades divergents & coûts" actions={<InlineAction>Trade diff</InlineAction>} density="compact">
          <div className="strategy-compare-trade-list">
            {data.divergentTrades.map((trade) => (
              <article key={trade.tradeId}>
                <span>{formatTime(trade.at)}</span>
                <div><strong>{trade.symbol} · {trade.reason}</strong><small>{trade.baseDecision} → {trade.candidateDecision}</small></div>
                <b className={trade.deltaR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(trade.deltaR)}</b>
              </article>
            ))}
          </div>
          <div className="strategy-compare-cost-list">
            {data.costs.map((cost) => (
              <article key={cost.scope}>
                <strong>{cost.scope}</strong>
                <small>coût {formatSignedR(cost.baseCostR)} → {formatSignedR(cost.candidateCostR)} · glissement Δ {formatSignedR(cost.slippageDeltaR)}</small>
                <StatusBadge tone={verdictTone(cost.verdict)}>{cost.verdict}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Actions comparaison" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="strategy-compare-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande compare</small>
              <strong>{command ? `ACCEPTED · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <div className="strategy-compare-actions">
            {data.commandActions.map((action) => (
              <article key={action.actionId}>
                <span>{action.commandType.includes("export") ? <FaDownload /> : action.commandType.includes("rollback") ? <FaUndo /> : <FaRocket />}</span>
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
          <div className="strategy-compare-proof">
            <FaBalanceScale />
            <span>Le front affiche un diff déjà calculé par le backend : aucune métrique de promotion n’est recalculée dans l’IHM.</span>
          </div>
        </Card>
      </section>
    </div>
  );
}

export function buildStrategyCompareCommand(action: CompareAction, data: StrategyCompareView): SubmitDeskCommandInput {
  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: data.summary.candidateVersionId,
    reason: `Strategy compare action confirmed: ${action.label}`,
    payload: {
      strategyId: data.strategy.strategyId,
      strategyDefinitionId: data.strategy.strategyDefinitionId,
      baseVersionId: data.summary.baseVersionId,
      candidateVersionId: data.summary.candidateVersionId,
      actionId: action.actionId,
      ...action.payload
    }
  };
}

function StrategyCompareLoading() {
  return (
    <div className="operator-page strategy-compare-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function impactTone(impact: StrategyCompareView["specDiffs"][number]["impact"]) {
  if (impact === "POSITIVE") return "success";
  if (impact === "NEGATIVE") return "danger";
  return "warning";
}

function verdictTone(verdict: "BETTER" | "WORSE" | "FLAT") {
  if (verdict === "BETTER") return "success";
  if (verdict === "WORSE") return "danger";
  return "warning";
}

function permissionTone(permission: CompareAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function permissionLabel(permission: CompareAction["permission"]) {
  return presentPermission(permission).label;
}

function compactId(value: string) {
  return value
    .replace("strver_", "ver:")
    .replace("rtbundle_", "rt:")
    .replace("run_research_", "run:");
}

function formatMetricDelta(value: number, metric: StrategyCompareView["metricComparison"][number]["metric"]) {
  return metric.endsWith("_PCT") || metric === "FREQUENCY" ? `${value >= 0 ? "+" : ""}${value}` : formatSignedR(value);
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
