import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FaBalanceScale,
  FaBolt,
  FaChartLine,
  FaCodeBranch,
  FaExclamationTriangle,
  FaFingerprint,
  FaLayerGroup,
  FaPause,
  FaProjectDiagram,
  FaRoute,
  FaShieldAlt,
  FaSlidersH
} from "react-icons/fa";
import { DeskButton, TrackedCommandReceipt } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { presentPermission } from "@/design-system/labels";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { StrategyDetailView } from "@/domains/front-api/viewModels";

type StrategyAction = StrategyDetailView["commandActions"][number];
type StrategyIdentity = StrategyDetailView["identity"];

export function StrategyDetailPage() {
  const { strategyId } = useParams();
  const query = useFrontView("strategy-detail", { strategyId });
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <StrategyDetailLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Fiche stratégie indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune stratégie" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/strategy-detail`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const requestedStrategyId = strategyId ?? data.identity.strategyId;
  const idMismatch = requestedStrategyId !== data.identity.strategyId;

  const confirmAction = async (action: StrategyAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildStrategyDetailCommand(action, data.identity));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "STRATEGY_DETAIL_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page strategy-detail-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title={data.identity.name}
        description={`${data.identity.family} · ${data.identity.executionMode} · ${data.identity.runtimeStatus} · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to="/strategies">Retour catalogue</Link>
            <Link className="operator-primary-action" to={`/strategies/${data.identity.strategyId}/compare`}>Comparer versions</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs stratégie">
        <KpiCard label="SCORE STRATÉGIE" value={`${data.summary.strategyScore}`} delta={`${data.identity.scientificStatus} · ${data.identity.tier}`} tone="success" />
        <KpiCard label="NET 30J" value={formatSignedR(data.summary.netR30d)} delta={`${data.summary.trades30d} trades`} tone="success" />
        <KpiCard label="PARITÉ LIVE/REPLAY" value={`${data.summary.liveParityPct}%`} delta="Gate LIVE backend" tone={data.summary.liveParityPct >= 90 ? "success" : "warning"} />
        <KpiCard label="RISQUE ALLOUÉ" value={`${data.summary.riskAllocationPct}%`} delta={`${data.riskAllocation.usedPct}% utilisé`} tone="warning" />
        <KpiCard label="INSTANCES EN COURS" value={`${data.summary.runningInstances}`} delta={`${data.summary.activeVersions} versions actives`} tone="info" />
        <KpiCard label="SIGNAUX OUVERTS" value={`${data.summary.openSignals}`} delta={`${data.identity.strategyInstanceId}`} tone="accent" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Identité, spec et runtime">
        <Card title="Identité & lignée" actions={<InlineAction>Définition</InlineAction>} density="compact" tone={idMismatch ? "warning" : "neutral"}>
          <div className="strategy-detail-identity">
            {idMismatch ? (
              <article className="strategy-detail-warning">
                <FaShieldAlt />
                <div><strong>ID demandé différent du mock actif</strong><small>{requestedStrategyId} → {data.identity.strategyId}</small></div>
              </article>
            ) : null}
            <article className="strategy-detail-thesis">
              <FaProjectDiagram />
              <div>
                <strong>{data.identity.thesis}</strong>
                <small>{data.definition.dslVersion} · {data.definition.strategySpecId}</small>
              </div>
            </article>
            <div className="strategy-detail-id-grid">
              <MetricBox label="Définition" value={compactId(data.identity.strategyDefinitionId)} />
              <MetricBox label="Version" value={compactId(data.identity.strategyVersionId)} />
              <MetricBox label="Instance" value={compactId(data.identity.strategyInstanceId)} />
              <MetricBox label="Runtime Bundle" value={compactId(data.identity.runtimeBundleId)} />
              <MetricBox label="Expérience" value={compactId(data.definition.sourceExperimentId)} />
              <MetricBox label="Run source" value={compactId(data.definition.sourceRunId)} />
            </div>
            <div className="strategy-detail-tags">
              {data.definition.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </div>
        </Card>

        <Card title="Spec stratégie & règles" actions={<InlineAction>Règles</InlineAction>} density="compact">
          <div className="strategy-detail-spec">
            <div className="strategy-detail-model-grid">
              <MetricBox label="Entrée" value={data.strategySpec.entryModel} />
              <MetricBox label="Stop" value={data.strategySpec.stopModel} />
              <MetricBox label="Cible" value={data.strategySpec.targetModel} />
              <MetricBox label="Invalidation" value={data.strategySpec.invalidationModel} />
            </div>
            <div className="strategy-detail-rule-list">
              {data.strategySpec.rules.map((rule) => (
                <article key={rule.ruleId}>
                  <FaBolt />
                  <div><strong>{rule.label}</strong><small>{rule.expression}</small></div>
                  <b>{rule.weightPct}%</b>
                  <StatusBadge tone={rule.state === "ACTIVE" ? "success" : rule.state === "WATCH" ? "warning" : "neutral"}>{rule.type}</StatusBadge>
                </article>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Versions, instances & niveaux" actions={<InlineAction>Runtime</InlineAction>} density="compact">
          <div className="strategy-detail-runtime">
            <div className="strategy-detail-version-list">
              {data.versions.map((version) => (
                <article key={version.strategyVersionId}>
                  <div><strong>{version.label}</strong><small>{version.changeSummary}</small></div>
                  <b>{formatSignedR(version.expectancyR)}</b>
                  <StatusBadge tone={versionTone(version.status)}>{version.status}</StatusBadge>
                </article>
              ))}
            </div>
            <div className="strategy-detail-instance-list">
              {data.instances.map((instance) => (
                <article key={instance.strategyInstanceId}>
                  <FaRoute />
                  <div><strong>{instance.mode} · {instance.runtimeStatus}</strong><small>{compactId(instance.runtimeBundleId)} · {instance.account}</small></div>
                  <span>{instance.riskAllocationPct}%</span>
                </article>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Performance, signaux et actions">
        <Card title="Performance, régimes & allocation" actions={<InlineAction>Risque</InlineAction>} density="compact">
          <div className="strategy-detail-performance">
            {data.performance.map((bucket) => (
              <article key={bucket.scope}>
                <strong>{bucket.scope}</strong>
                <small>{bucket.trades} trades · PF {bucket.profitFactor.toFixed(2)} · Gain {bucket.winRatePct}%</small>
                <b className={bucket.netR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(bucket.netR)}</b>
                <ProgressBar value={Math.min(100, Math.max(0, bucket.parityPct ?? bucket.profitFactor * 45))} tone={bucket.scope === "LIVE" ? "warning" : "accent"} />
              </article>
            ))}
          </div>
          <div className="strategy-detail-regime-list">
            {data.regimes.map((regime) => (
              <article key={regime.regimeId}>
                <FaLayerGroup />
                <div><strong>{regime.label}</strong><small>{regime.note}</small></div>
                <b className={regime.expectancyR >= 0 ? "text-success" : "text-danger"}>{regime.expectancyR.toFixed(2)} R</b>
                <StatusBadge tone={regime.status === "FAVOURABLE" ? "success" : regime.status === "AVOID" ? "danger" : "warning"}>{regime.status}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Signaux, trades & corrélations" actions={<InlineAction>Signal Bus</InlineAction>} density="compact">
          <div className="strategy-detail-signal-list">
            {data.signals.map((signal) => (
              <article key={signal.signalId}>
                <FaChartLine />
                <div><strong>{signal.symbol} {signal.direction} · {signal.state}</strong><small>{signal.ruleHits.join(" · ")}</small></div>
                <b>{signal.confidence}%</b>
              </article>
            ))}
          </div>
          <div className="strategy-detail-trade-list">
            {data.trades.map((trade) => (
              <article key={trade.tradeId}>
                <span>{formatTime(trade.openedAt)}</span>
                <div><strong>{trade.symbol} {trade.side}</strong><small>{trade.exitReason}</small></div>
                <b className={trade.pnlR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(trade.pnlR)}</b>
              </article>
            ))}
          </div>
          <div className="strategy-detail-correlation-list">
            {data.correlations.map((correlation) => (
              <article key={correlation.target}>
                <span>{compactId(correlation.target)}</span>
                <ProgressBar value={correlation.correlationPct} tone={correlation.status === "BLOCK" ? "danger" : correlation.status === "WATCH" ? "warning" : "success"} />
                <strong>{correlation.correlationPct}%</strong>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Contraintes, incidents & actions" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="strategy-detail-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande stratégie</small>
              <strong>{command ? `ACCEPTED · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <div className="strategy-detail-constraint-list">
            {data.constraints.map((constraint) => (
              <article key={constraint.constraintId}>
                <FaShieldAlt />
                <div><strong>{constraint.label}</strong><small>{constraint.value}</small></div>
                <StatusBadge tone={constraint.status === "PASS" ? "success" : constraint.status === "BLOCK" ? "danger" : "warning"}>{constraint.status}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="strategy-detail-actions">
            <TrackedCommandReceipt command={command} />
            {data.commandActions.map((action) => (
              <article key={action.actionId}>
                <span>{action.commandType.includes("pause") ? <FaPause /> : action.commandType.includes("risk") ? <FaSlidersH /> : <FaCodeBranch />}</span>
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
          <div className="strategy-detail-incidents">
            {data.incidents.map((incident) => (
              <article key={incident.incidentId}>
                <FaExclamationTriangle />
                <div><strong>{incident.title}</strong><small>{incident.detail}</small></div>
                <StatusBadge tone={incident.severity === "HIGH" ? "danger" : incident.severity === "MEDIUM" ? "warning" : "neutral"}>{incident.status}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

export function buildStrategyDetailCommand(action: StrategyAction, identity: StrategyIdentity): SubmitDeskCommandInput {
  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: identity.strategyVersionId,
    reason: `Strategy detail action confirmed: ${action.label}`,
    payload: {
      strategyId: identity.strategyId,
      strategyDefinitionId: identity.strategyDefinitionId,
      strategyVersionId: identity.strategyVersionId,
      strategyInstanceId: identity.strategyInstanceId,
      runtimeBundleId: identity.runtimeBundleId,
      actionId: action.actionId,
      ...action.payload
    }
  };
}

function StrategyDetailLoading() {
  return (
    <div className="operator-page strategy-detail-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function versionTone(status: StrategyDetailView["versions"][number]["status"]) {
  if (status === "VALIDATED") return "success";
  if (status === "DRAFT") return "warning";
  if (status === "REJECTED" || status === "RETIRED") return "danger";
  return "neutral";
}

function permissionTone(permission: StrategyAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function permissionLabel(permission: StrategyAction["permission"]) {
  return presentPermission(permission).label;
}

function compactId(value: string) {
  return value
    .replace("strategy_", "strategy:")
    .replace("strdef_", "def:")
    .replace("strver_", "ver:")
    .replace("strinst_", "inst:")
    .replace("rtbundle_", "rt:")
    .replace("exp_", "exp:")
    .replace("run_research_", "run:");
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
