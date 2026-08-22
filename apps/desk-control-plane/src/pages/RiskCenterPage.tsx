import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBolt,
  FaChartLine,
  FaExclamationTriangle,
  FaFingerprint,
  FaLock,
  FaProjectDiagram,
  FaShieldAlt,
  FaSkullCrossbones,
  FaSlidersH,
  FaSyncAlt,
  FaTachometerAlt
} from "react-icons/fa";
import { DataTable, MobileDataList } from "@/design-system/data";
import { DeskButton, ReasonInput } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { presentGeneric, presentPermission, presentQueueStatus, presentRuntimeStatus, presentSeverity } from "@/design-system/labels";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { RiskView } from "@/domains/front-api/viewModels";

type RiskLimit = RiskView["limits"][number];
type RiskAction = RiskView["commandActions"][number];

export function RiskCenterPage() {
  const query = useFrontView("risk");
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : validation Risk Center sans ordre broker direct.");
  const [stepUpToken, setStepUpToken] = useState("");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <RiskLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Centre de risque indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée risque" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/risk`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const primaryStressAction = data.commandActions.find((action) => action.commandType === "risk.stress_test.run");
  const killSwitchAction = data.commandActions.find((action) => action.commandType === "risk.emergency.kill_switch");

  const confirmAction = async (action: RiskAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildRiskCommand(action, reason, stepUpToken));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "RISK_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page risk-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Centre de risque"
        description={`Global Risk Engine · statut ${data.summary.globalStatus} · projection ${meta.latencyMs} ms · aucune règle recalculée côté front.`}
        actions={
          <>
            <Link to="/portfolio">Portefeuille</Link>
            <Link to="/orders">Ordres</Link>
            {primaryStressAction ? (
              <DeskButton variant="primary" disabled={submittingActionId === primaryStressAction.actionId} onClick={() => confirmAction(primaryStressAction)}>
                {submittingActionId === primaryStressAction.actionId ? "Envoi..." : "Test de stress"}
              </DeskButton>
            ) : null}
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Centre de risque">
        <KpiCard label="STATUT GLOBAL" value={data.summary.globalStatus} delta="Décision backend" tone={data.summary.globalStatus === "PASS" ? "success" : "warning"} />
        <KpiCard label="RISQUE UTILISÉ" value={formatPercent(data.summary.riskUsedPct)} delta={`${formatCurrency(data.summary.grossExposureUsd)} gross`} detail={<ProgressBar value={data.summary.riskUsedPct} tone="warning" />} tone="warning" />
        <KpiCard label="PERTE JOURNALIÈRE" value={formatSignedR(data.summary.dailyLossR)} delta={`limite ${formatSignedR(data.summary.dailyLossLimitR)}`} tone="success" />
        <KpiCard label="MAX DD" value={formatSignedR(data.summary.maxDrawdownR)} delta={`trail ${formatSignedR(data.summary.trailingDrawdownR)}`} tone="warning" />
        <KpiCard label="LEVIER" value={`${data.summary.leverage.toFixed(2)}×`} delta={`${formatCurrency(data.summary.netExposureUsd)} net`} tone="info" />
        <KpiCard label="DÉPASSEMENTS" value={`${data.summary.activeBreaches}`} delta={`${data.summary.stressTestsToday} stress tests`} tone={data.summary.activeBreaches > 0 ? "warning" : "success"} />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Limites, expositions et contraintes">
        <Card title="Limites officielles" actions={<InlineAction>Backend uniquement</InlineAction>} density="compact">
          <DataTable rows={data.limits} rowKey={(row) => row.limitId} columns={limitColumns} />
          <MobileDataList
            rows={data.limits}
            rowKey={(row) => row.limitId}
            renderTitle={(row) => `${row.label} · ${row.status}`}
            renderMeta={(row) => `${row.scope} · ${row.officialSource}`}
            renderBody={(row) => `${formatRiskValue(row.usedValue, row.unit)} / ${formatRiskValue(row.limitValue, row.unit)} · marge ${formatRiskValue(row.headroomValue, row.unit)}`}
          />
          <div className="risk-source-proof">
            <FaLock />
            <span>Chaque ligne expose `officialSource`, `reasonCodes`, `changedBy` et contributeurs. Le front ne recalcule aucune limite.</span>
          </div>
        </Card>

        <Card title="Exposition & concentration" actions={<InlineAction>{data.exposures.length} classes</InlineAction>} density="compact">
          <div className="risk-exposure-map">
            {data.exposures.map((exposure) => (
              <article key={exposure.exposureId} className={`risk-exposure-map__tile risk-exposure-map__tile--${exposure.status.toLowerCase()}`}>
                <header>
                  <strong>{exposure.assetClass}</strong>
                  <StatusBadge tone={statusTone(exposure.status)}>{presentQueueStatus(exposure.status).label}</StatusBadge>
                </header>
                <b>{formatCurrency(exposure.grossUsd)}</b>
                <small>{exposure.topInstrument} · net {formatCurrency(exposure.netUsd)}</small>
                <ProgressBar value={exposure.usedPct} tone={statusTone(exposure.status)} />
              </article>
            ))}
          </div>
          <div className="risk-exposure-metrics">
            <MetricBox label="Brut" value={formatCurrency(data.summary.grossExposureUsd)} />
            <MetricBox label="Net" value={formatCurrency(data.summary.netExposureUsd)} />
            <MetricBox label="Paire principale" value={<span className="text-warning">ES/NQ · 0,82</span>} />
          </div>
        </Card>

        <Card title="Corrélation & contraintes prop" actions={<InlineAction>Contraintes</InlineAction>} density="compact">
          <div className="risk-correlation-list">
            {data.correlations.map((correlation) => (
              <article key={correlation.correlationId}>
                <FaProjectDiagram />
                <div><strong>{correlation.pair}</strong><small>{presentGeneric(correlation.reasonCode).label}</small></div>
                <b>{correlation.value.toFixed(2)}</b>
                <StatusBadge tone={statusTone(correlation.status)}>{presentQueueStatus(correlation.status).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="risk-prop-list">
            {data.propConstraints.map((constraint) => (
              <article key={constraint.constraintId}>
                <FaShieldAlt />
                <div><strong>{constraint.label}</strong><small>{constraint.rule} · reset {formatTime(constraint.nextResetAt)}</small></div>
                <span>{formatRiskValue(constraint.usedValue, constraint.unit)} / {formatRiskValue(constraint.limitValue, constraint.unit)}</span>
                <StatusBadge tone={statusTone(constraint.status)}>{presentQueueStatus(constraint.status).label}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Stress, breaches et commandes">
        <Card title="Tests de stress" actions={<InlineAction>Scénarios</InlineAction>} density="compact">
          <div className="risk-stress-list">
            {data.stressTests.map((stress) => (
              <article key={stress.stressTestId}>
                <FaChartLine />
                <div><strong>{stress.scenario}</strong><small>{stress.stressTestId} · {stress.completedAt ? formatTime(stress.completedAt) : "en cours"}</small></div>
                <span>{formatSignedR(stress.lossR)}</span>
                <StatusBadge tone={stress.state === "PASSED" ? "success" : stress.state === "FAILED" ? "danger" : "warning"}>{presentRuntimeStatus(stress.state).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="risk-stress-metrics">
            {data.stressTests.slice(0, 3).map((stress) => (
              <MetricBox key={stress.stressTestId} label={stress.scenario} value={`${stress.marginUsedPct}% margin`} />
            ))}
          </div>
        </Card>

        <Card title="Dépassements & historique" actions={<InlineAction>{data.breaches.length} alertes</InlineAction>} density="compact">
          <ol className="risk-breach-list">
            {data.breaches.map((breach) => (
              <li key={breach.breachId}>
                <span><FaExclamationTriangle />{formatTime(breach.openedAt)}</span>
                <div><strong>{breach.title}</strong><small>{breach.detail}</small></div>
                <StatusBadge tone={breach.severity === "EMERGENCY" || breach.severity === "HIGH" ? "danger" : breach.severity === "MEDIUM" ? "warning" : "accent"}>{presentQueueStatus(breach.status).label}</StatusBadge>
              </li>
            ))}
          </ol>
          <div className="risk-linked-paths">
            <Link to="/live">Chemin Live</Link>
            <Link to="/orders">Chemin Ordres</Link>
            <Link to="/events">Chemin d'audit</Link>
          </div>
        </Card>

        <Card title="Actions Risque" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="risk-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande risk</small>
              <strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <ReasonInput label="Motif obligatoire" value={reason} onChange={setReason} />
          <label className="risk-step-up">
            <span>Step-up phrase pour actions critiques</span>
            <input
              value={stepUpToken}
              onChange={(event) => setStepUpToken(event.target.value)}
              placeholder={killSwitchAction ? killSwitchAction.actionId : "actionId step-up"}
            />
          </label>
          <div className="risk-action-list">
            {data.commandActions.map((action) => (
              <article key={action.actionId} className={action.criticality === "EMERGENCY" ? "risk-action-list__emergency" : undefined}>
                <span>{actionIcon(action)}</span>
                <div><strong>{action.label}</strong><small>{action.commandType} · {action.impactSummary}</small></div>
                <StatusBadge tone={permissionTone(action.permission)}>{presentPermission(action.permission).label}</StatusBadge>
                <DeskButton
                  variant={action.criticality === "EMERGENCY" ? "emergency" : action.criticality === "HIGH" ? "danger" : "primary"}
                  disabled={isActionDisabled(action, reason, stepUpToken) || submittingActionId === action.actionId}
                  onClick={() => confirmAction(action)}
                >
                  {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                </DeskButton>
              </article>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

export function buildRiskCommand(action: RiskAction, reason: string, stepUpToken = ""): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("RISK_REASON_REQUIRED"), { code: "RISK_REASON_REQUIRED" });
  }

  if (action.permission === "DENIED") {
    throw Object.assign(new Error("RISK_PERMISSION_DENIED"), { code: "RISK_PERMISSION_DENIED" });
  }

  const normalizedStepUp = stepUpToken.trim();
  if (action.permission === "STEP_UP_REQUIRED" && normalizedStepUp !== action.actionId) {
    throw Object.assign(new Error("RISK_STEP_UP_REQUIRED"), { code: "RISK_STEP_UP_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: action.expectedVersion,
    reason: normalizedReason,
    payload: {
      actionId: action.actionId,
      criticality: action.criticality,
      impactSummary: action.impactSummary,
      stepUpAccepted: action.permission === "STEP_UP_REQUIRED",
      ...action.payload
    }
  };
}

const limitColumns = [
  { key: "limit", header: "Limite", render: (row: RiskLimit) => <LimitCell row={row} /> },
  { key: "scope", header: "Périmètre", render: (row: RiskLimit) => row.scope },
  { key: "used", header: "Utilisé", align: "right" as const, render: (row: RiskLimit) => formatRiskValue(row.usedValue, row.unit) },
  { key: "limitValue", header: "Limite", align: "right" as const, render: (row: RiskLimit) => formatRiskValue(row.limitValue, row.unit) },
  { key: "pct", header: "%", align: "right" as const, render: (row: RiskLimit) => formatPercent(row.usedPct) },
  { key: "headroom", header: "Marge disponible", align: "right" as const, render: (row: RiskLimit) => formatRiskValue(row.headroomValue, row.unit) },
  { key: "status", header: "Statut", render: (row: RiskLimit) => <StatusBadge tone={statusTone(row.status)}>{presentQueueStatus(row.status).label}</StatusBadge> }
] as const;

function LimitCell({ row }: { row: RiskLimit }) {
  return (
    <div className="risk-limit-cell">
      <strong>{row.label ?? "Limite non publiée"}</strong>
      <small>{row.officialSource ?? "Source non publiée"} · {(row.reasonCodes ?? []).map((code) => presentGeneric(code).label).join(", ")}</small>
    </div>
  );
}

function RiskLoading() {
  return (
    <div className="operator-page risk-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function isActionDisabled(action: RiskAction, reason: string, stepUpToken: string) {
  if (action.permission === "DENIED") return true;
  if (!reason.trim()) return true;
  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) return true;
  return false;
}

function actionIcon(action: RiskAction) {
  if (action.criticality === "EMERGENCY") return <FaSkullCrossbones />;
  if (action.commandType.includes("stress")) return <FaBolt />;
  if (action.commandType.includes("allocation")) return <FaSlidersH />;
  if (action.commandType.includes("ack")) return <FaSyncAlt />;
  return <FaTachometerAlt />;
}

function statusTone(status: "PASS" | "WATCH" | "BREACH" | "BLOCKED") {
  if (status === "PASS") return "success" as const;
  if (status === "WATCH") return "warning" as const;
  return "danger" as const;
}

function permissionTone(permission: RiskAction["permission"]) {
  if (permission === "ALLOWED") return "success" as const;
  if (permission === "STEP_UP_REQUIRED") return "warning" as const;
  return "danger" as const;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function formatSignedR(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  if (absolute >= 1_000_000) return `${value < 0 ? "−" : ""}${formatter.format(absolute / 1_000_000)} M$`;
  if (absolute >= 1_000) return `${value < 0 ? "−" : ""}${formatter.format(absolute / 1_000)} k$`;
  return `${value < 0 ? "−" : ""}${formatter.format(absolute)} $`;
}

function formatRiskValue(value: number, unit: RiskLimit["unit"] | RiskView["propConstraints"][number]["unit"]) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "USD") return formatCurrency(value);
  if (unit === "R") return formatSignedR(value);
  if (unit === "LOTS") return `${value.toFixed(0)} lots`;
  if (unit === "CONTRACTS") return `${value.toFixed(0)} contrats`;
  if (unit === "X") return `${value.toFixed(2)}×`;
  return `${value.toFixed(value < 1 ? 2 : 1).replace(".", ",")}%`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
