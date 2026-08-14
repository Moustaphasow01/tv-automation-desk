import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBalanceScale,
  FaBolt,
  FaChartBar,
  FaCheckCircle,
  FaCodeBranch,
  FaExclamationTriangle,
  FaLayerGroup,
  FaPlay,
  FaShieldAlt
} from "react-icons/fa";
import { DataTable, MobileDataList } from "@/design-system/data";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { StrategyCenterView } from "@/domains/front-api/viewModels";

type StrategyRow = StrategyCenterView["strategies"][number];

export function StrategyCenterPage() {
  const query = useFrontView("strategy-center");
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (query.isLoading) {
    return <StrategyCenterLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Strategy Center indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée stratégie" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/strategy-center`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const inspector = data.selectedInspector;

  const requestShadowTest = async () => {
    setSubmitting(true);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildStrategyShadowTestCommand(inspector));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "STRATEGY_COMMAND_FAILED");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="operator-page strategy-center-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Strategy Center"
        description="Catalogue, versioning et gouvernance des stratégies : Definition → Version → Instance → Runtime Bundle."
        actions={
          <>
            <Link to="/research">Ouvrir Research</Link>
            <Link className="operator-primary-action" to={`/strategies/${inspector.strategyId}`}>
              Ouvrir la stratégie active
            </Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Strategy Center">
        <KpiCard
          label="STRATÉGIES TOTALES"
          value={`${data.summary.totalStrategies}`}
          delta={`${data.summary.liveStrategies} live · ${data.summary.paperStrategies} paper`}
          tone="info"
        />
        <KpiCard label="LIVE" value={`${data.summary.liveStrategies}`} delta="Instances RUNNING" tone="success" />
        <KpiCard label="WATCHLIST" value={`${data.summary.watchlistStrategies}`} delta={`${data.summary.suspendedStrategies} suspendue`} tone="warning" />
        <KpiCard label="PROFIT FACTOR MOYEN" value={data.summary.averageProfitFactor.toFixed(2)} delta="Toutes familles validées" tone="success" />
        <KpiCard label="DRAWDOWN MOYEN" value={formatSignedR(data.summary.averageDrawdownR)} delta="OOS + Paper" tone="warning" />
        <KpiCard label="EXPECTANCY" value={`${data.summary.averageExpectancyR.toFixed(2)} R`} delta={`Projection ${meta.latencyMs} ms`} tone={meta.stale ? "warning" : "info"} />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Catalogue et inspector stratégie">
        <Card title="Catalogue stratégies" actions={<InlineAction>Catalogue complet</InlineAction>} density="compact">
          <DataTable rows={data.strategies} rowKey={(row) => row.strategyId} columns={strategyColumns} />
          <MobileDataList
            rows={data.strategies}
            rowKey={(row) => row.strategyId}
            renderTitle={(row) => row.name}
            renderMeta={(row) => `${row.lifecycle} · ${row.executionMode} · ${row.runtimeStatus}`}
            renderBody={(row) => `${row.instruments.join("/")} · PF ${row.profitFactor} · ${formatSignedR(row.lastOosR)}`}
          />
        </Card>

        <Card title="Inspector sélectionné" actions={<InlineAction>Détail stratégie</InlineAction>} density="compact">
          <div className="strategy-inspector">
            <div className="strategy-inspector__ids">
              <MetricBox label="Definition" value={inspector.strategyDefinitionId} />
              <MetricBox label="Version" value={inspector.strategyVersionId} />
              <MetricBox label="Instance" value={inspector.strategyInstanceId} />
              <MetricBox label="Runtime Bundle" value={inspector.runtimeBundleId} />
            </div>
            <p>{inspector.thesis}</p>
            <div className="strategy-rules">
              {inspector.rulesSummary.map((rule) => (
                <span key={rule}><FaCheckCircle />{rule}</span>
              ))}
            </div>
            <div className="strategy-gates">
              {inspector.gates.map((gate) => (
                <article key={gate.label}>
                  <span>{gateIcon(gate.state)}</span>
                  <div><strong>{gate.label}</strong></div>
                  <StatusBadge tone={gateTone(gate.state)}>{gate.state}</StatusBadge>
                </article>
              ))}
            </div>
            <div className="strategy-command-box">
              <div>
                <small>Éligibilité commande</small>
                <strong>{inspector.currentCommandEligibility}</strong>
                {command ? <span className="text-success">Acceptée · {command.commandId}</span> : null}
                {commandError ? <span className="text-danger">{commandError}</span> : null}
              </div>
              <DeskButton variant="primary" disabled={submitting || inspector.currentCommandEligibility === "READ_ONLY"} onClick={requestShadowTest}>
                {submitting ? "Envoi..." : "Demander shadow test"}
              </DeskButton>
            </div>
          </div>
        </Card>

        <Card title="Distribution lifecycle" actions={<InlineAction>Versioning</InlineAction>} density="compact">
          <div className="strategy-lifecycle-list">
            {data.lifecycleDistribution.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
                <ProgressBar value={item.pct} tone={lifecycleTone(item.label)} />
                <small>{item.pct}%</small>
              </article>
            ))}
          </div>
          <div className="strategy-lifecycle-warning">
            <FaShieldAlt />
            <span>Le passage LIVE reste soumis aux gates backend et aux permissions opérateur.</span>
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Performance et événements stratégie">
        <Card title="Performance par famille" actions={<InlineAction>Analyse famille</InlineAction>} density="compact">
          <div className="strategy-family-list">
            {data.performanceByFamily.map((family) => (
              <article key={family.family}>
                <span><FaLayerGroup /></span>
                <div><strong>{family.family}</strong><small>{family.strategies} stratégies · DD {formatSignedR(family.drawdownR)}</small></div>
                <b>PF {family.averageProfitFactor.toFixed(2)}</b>
                <span className={family.expectancyR >= 0 ? "text-success" : "text-danger"}>{family.expectancyR.toFixed(2)} R</span>
                <ProgressBar value={Math.min(100, family.averageProfitFactor * 42)} tone="accent" />
              </article>
            ))}
          </div>
        </Card>

        <Card title="Top stratégies & parité live/replay" actions={<InlineAction>Comparer versions</InlineAction>} density="compact">
          <div className="strategy-top-list">
            {data.topStrategies.map((strategy, index) => (
              <Link key={strategy.strategyId} to={`/strategies/${strategy.strategyId}`}>
                <span>{index + 1}</span>
                <div><strong>{strategy.name}</strong><small>OOS {formatSignedR(strategy.oosR)} · parité {strategy.liveParityPct}%</small></div>
                <b>{strategy.score}</b>
                <ProgressBar value={strategy.liveParityPct} tone={strategy.liveParityPct >= 85 ? "success" : "warning"} />
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Événements récents" actions={<InlineAction>Journal stratégie</InlineAction>} density="compact">
          <ol className="strategy-events">
            {data.recentEvents.map((event) => (
              <li key={event.eventId}>
                <span><FaBolt />{formatTime(event.at)}</span>
                <div><strong>{event.title}</strong><small>{event.detail}</small></div>
                <StatusBadge tone={event.tone === "HIGH" ? "danger" : event.tone === "WATCH" ? "warning" : "accent"}>{event.tone}</StatusBadge>
              </li>
            ))}
          </ol>
          <div className="strategy-compare-actions">
            <Link to={`/strategies/${inspector.strategyId}/compare`}><FaBalanceScale /> Comparer versions</Link>
            <Link to="/research"><FaChartBar /> Voir origine Research</Link>
          </div>
        </Card>
      </section>
    </div>
  );
}

export function buildStrategyShadowTestCommand(
  inspector: StrategyCenterView["selectedInspector"]
): SubmitDeskCommandInput {
  return {
    commandType: "strategy.lifecycle.request_shadow_test",
    environment: "MOCK",
    expectedVersion: inspector.strategyVersionId,
    reason: "Operator requested from Strategy Center cockpit",
    payload: {
      strategyId: inspector.strategyId,
      strategyDefinitionId: inspector.strategyDefinitionId,
      strategyVersionId: inspector.strategyVersionId,
      strategyInstanceId: inspector.strategyInstanceId,
      runtimeBundleId: inspector.runtimeBundleId
    }
  };
}

const strategyColumns = [
  { key: "name", header: "Stratégie", render: (row: StrategyRow) => <StrategyNameCell row={row} /> },
  { key: "family", header: "Famille", render: (row: StrategyRow) => row.family },
  { key: "mode", header: "Mode", render: (row: StrategyRow) => <StatusBadge tone={modeTone(row.executionMode)}>{row.executionMode}</StatusBadge> },
  { key: "version", header: "Version", render: (row: StrategyRow) => <StatusBadge tone={versionTone(row.versionStatus)}>{row.versionStatus}</StatusBadge> },
  { key: "runtime", header: "Runtime", render: (row: StrategyRow) => <StatusBadge tone={runtimeTone(row.runtimeStatus)}>{row.runtimeStatus}</StatusBadge> },
  { key: "tier", header: "Tier", render: (row: StrategyRow) => row.tier },
  { key: "pf", header: "PF", align: "right" as const, render: (row: StrategyRow) => row.profitFactor.toFixed(2) },
  { key: "win", header: "Win", align: "right" as const, render: (row: StrategyRow) => `${row.winRatePct}%` },
  { key: "dd", header: "DD", align: "right" as const, render: (row: StrategyRow) => <span className="text-warning">{formatSignedR(row.maxDrawdownR)}</span> },
  { key: "health", header: "Santé", render: (row: StrategyRow) => <StatusBadge tone={healthTone(row.liveHealth)}>{row.liveHealth}</StatusBadge> }
] as const;

function StrategyNameCell({ row }: { row: StrategyRow }) {
  return (
    <Link className="strategy-table-link" to={`/strategies/${row.strategyId}`}>
      <strong>{row.name}</strong>
      <small>{row.strategyVersionId} · {row.instruments.join("/")}</small>
    </Link>
  );
}

function StrategyCenterLoading() {
  return (
    <div className="operator-page strategy-center-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function modeTone(mode: StrategyRow["executionMode"]) {
  if (mode === "LIVE") return "success" as const;
  if (mode === "PAPER") return "warning" as const;
  return "accent" as const;
}

function versionTone(status: StrategyRow["versionStatus"]) {
  if (status === "VALIDATED") return "success" as const;
  if (status === "REJECTED" || status === "RETIRED") return "danger" as const;
  if (status === "DRAFT") return "warning" as const;
  return "neutral" as const;
}

function runtimeTone(status: StrategyRow["runtimeStatus"]) {
  if (status === "RUNNING") return "success" as const;
  if (status === "FAILED") return "danger" as const;
  if (status === "PAUSED") return "warning" as const;
  return "accent" as const;
}

function healthTone(health: StrategyRow["liveHealth"]) {
  if (health === "OK") return "success" as const;
  if (health === "DEGRADED") return "danger" as const;
  if (health === "OFF") return "neutral" as const;
  return "warning" as const;
}

function lifecycleTone(label: string) {
  if (label === "LIVE") return "success" as const;
  if (label === "PAPER" || label === "WATCHLIST") return "warning" as const;
  return "accent" as const;
}

function gateTone(state: StrategyCenterView["selectedInspector"]["gates"][number]["state"]) {
  if (state === "PASS") return "success" as const;
  if (state === "FAIL") return "danger" as const;
  return "warning" as const;
}

function gateIcon(state: StrategyCenterView["selectedInspector"]["gates"][number]["state"]) {
  if (state === "PASS") return <FaCheckCircle />;
  if (state === "FAIL") return <FaExclamationTriangle />;
  return <FaPlay />;
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
