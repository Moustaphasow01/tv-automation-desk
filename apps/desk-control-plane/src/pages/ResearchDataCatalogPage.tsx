import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaDatabase,
  FaExclamationTriangle,
  FaFingerprint,
  FaLink,
  FaProjectDiagram,
  FaRedo,
  FaSearch,
  FaShieldAlt,
  FaSitemap,
  FaTable,
  FaTools
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { presentGateState, presentOperatorText, presentPermission } from "@/design-system/labels";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { ResearchDataCatalogView } from "@/domains/front-api/viewModels";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";

type DataAction = ResearchDataCatalogView["commandActions"][number];
type DatasetRow = ResearchDataCatalogView["datasets"][number];
type FeatureRow = ResearchDataCatalogView["features"][number];

export function ResearchDataCatalogPage() {
  const query = useFrontView("research-data-catalog");
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <ResearchDataLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Catalogue données & features indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune projection data" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/research-data-catalog`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;

  const confirmAction = async (action: DataAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Research data action confirmed: ${action.label}`,
        payload: action.payload
      });
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "RESEARCH_DATA_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page research-data-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Catalogue données & features"
        description={`Datasets, instruments, features, lignée et qualité point-in-time · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to="/research">Research Lab</Link>
            <Link className="operator-primary-action" to="/research/runs/run_research_mnq_oos_fold_18_24">Run lié</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Catalogue données & features">
        <KpiCard label="DATASETS" value={`${data.summary.datasets}`} delta="source de vérité" tone="info" />
        <KpiCard label="INSTRUMENTS" value={`${data.summary.instruments}`} delta="catalogués" tone="accent" />
        <KpiCard label="FEATURES" value={`${data.summary.features}`} delta="versionnées" tone="success" />
        <KpiCard label="QUALITY" value={`${data.summary.qualityOkPct}%`} delta="OK pondéré" tone="success" />
        <KpiCard label="GAPS" value={`${data.summary.openGaps}`} delta="ouverts" tone={data.summary.openGaps > 0 ? "warning" : "success"} />
        <KpiCard label="LINEAGE" value={`${data.summary.lineageEdges}`} delta="edges vérifiés" tone="neutral" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Datasets, instruments et lignée">
        <Card title="Datasets canoniques" actions={<InlineAction>Zoom dataset</InlineAction>} density="compact">
          <div className="research-data-dataset-list">
            {data.datasets.map((dataset) => (
              <DatasetCard key={dataset.datasetId} dataset={dataset} />
            ))}
          </div>
        </Card>

        <Card title="Instruments & couverture" actions={<InlineAction>Instruments</InlineAction>} density="compact">
          <div className="research-data-instrument-grid">
            {data.instruments.map((instrument) => (
              <article key={instrument.symbol}>
                <FaTable />
                <div>
                  <strong>{instrument.symbol}</strong>
                  <small>{instrument.assetClass} · {instrument.sessionTemplate}</small>
                  <span>{compactId(instrument.primaryDatasetId)} · {instrument.timezone}</span>
                </div>
                <ProgressBar value={instrument.coveragePct} label={`${instrument.symbol} couverture`} tone={instrument.coveragePct >= 90 ? "success" : "warning"} />
                <StatusBadge tone={qualityTone(instrument.quality)}>{instrument.quality}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Lignée point-in-time" actions={<InlineAction>Graphe</InlineAction>} density="compact">
          <div className="research-data-lineage">
            {data.lineage.map((edge) => (
              <article key={edge.edgeId}>
                <FaProjectDiagram />
                <div>
                  <strong>{edge.from}</strong>
                  <small>{edge.relation} → {edge.to}</small>
                </div>
                <StatusBadge tone={lineageTone(edge.status)}>{edge.status}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Features, incidents et actions data">
        <Card title="Catalogue de features" actions={<InlineAction>Features</InlineAction>} density="compact">
          <div className="research-data-feature-list">
            {data.features.map((feature) => (
              <FeatureCard key={feature.featureId} feature={feature} dataset={datasetById(data.datasets, feature.datasetId)} />
            ))}
          </div>
        </Card>

        <Card title="Qualité, gaps & anti-anticipation" actions={<InlineAction>Audit</InlineAction>} density="compact">
          <div className="research-data-quality-panel">
            <div className="research-data-quality-grid">
              {data.datasets.map((dataset) => (
                <MetricBox
                  key={dataset.datasetId}
                  label={compactId(dataset.datasetId)}
                  value={`${dataset.gaps} gap${dataset.gaps > 1 ? "s" : ""} · ${dataset.lookaheadStatus}`}
                />
              ))}
            </div>
            <div className="research-data-incidents">
              {data.incidents.map((incident) => {
                const dataset = datasetById(data.datasets, incident.datasetId);
                return (
                  <article key={incident.incidentId}>
                    <FaExclamationTriangle />
                    <div>
                      <strong>{incident.title}</strong>
                      <small>{dataset?.label ?? incident.datasetId} · {incident.retryable ? "réessayable" : "manuel"}</small>
                    </div>
                    <StatusBadge tone={severityTone(incident.severity)}>{incident.severity}</StatusBadge>
                  </article>
                );
              })}
            </div>
            <article className="research-data-proof">
              <FaShieldAlt />
              <div>
                <strong>Garde anti-anticipation</strong>
                <small>Chaque dataset/feature expose `pointInTime`, provenance, cutoff status et version pour préserver la parité run/replay/live.</small>
              </div>
            </article>
          </div>
        </Card>

        <Card title="Actions data" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="research-data-actions">
            {data.commandActions.map((action) => {
              const dataset = datasetById(data.datasets, action.datasetId);
              return (
                <article key={action.actionId}>
                  <span>{actionIcon(action.commandType)}</span>
                  <div>
                    <strong>{action.label}</strong>
                    <small>{dataset?.label ?? action.datasetId} · {action.commandType}</small>
                  </div>
                  <StatusBadge tone={permissionTone(action.permission)}>{presentPermission(action.permission).label}</StatusBadge>
                  <DeskButton
                    variant="primary"
                    disabled={action.permission !== "ALLOWED" || submittingActionId === action.actionId}
                    onClick={() => confirmAction(action)}
                  >
                    {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                  </DeskButton>
                </article>
              );
            })}
          </div>
          <div className="research-data-command-result">
            <FaFingerprint />
            <div>
              <strong>{command ? `Commande ${command.status}` : commandError ? "Commande rejetée" : "Aucune commande envoyée"}</strong>
              <small>{command?.commandId ?? commandError ?? "Toute mutation data reste async, idempotente et auditée côté BFF."}</small>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ResearchDataLoading() {
  return (
    <div className="operator-page research-data-page">
      <OperatorPageHeader title="Catalogue données & features" description="Chargement de la projection data foundation." />
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => (
          <KpiCard key={index} label="LOADING" value="—" state="loading" />
        ))}
      </section>
    </div>
  );
}

function DatasetCard({ dataset }: { dataset: DatasetRow }) {
  return (
    <article className={`research-data-dataset-card research-data-dataset-card--${dataset.quality.toLowerCase()}`}>
      <header>
        <FaDatabase />
        <div>
          <strong>{dataset.label}</strong>
          <small>{dataset.version} · {dataset.granularity}</small>
        </div>
        <StatusBadge tone={qualityTone(dataset.quality)}>{dataset.quality}</StatusBadge>
      </header>
      <p>{presentOperatorText(dataset.source)}</p>
      <div className="research-data-dataset-meta">
        <MetricBox label="Période" value={dataset.period} />
        <MetricBox label="Frais" value={dataset.freshness} />
        <MetricBox label="PIT" value={presentGateState(dataset.pointInTime ? "PASS" : "FAIL").label} />
        <MetricBox label="Anticipation" value={dataset.lookaheadStatus} />
      </div>
    </article>
  );
}

function FeatureCard({ feature, dataset }: { feature: FeatureRow; dataset?: DatasetRow }) {
  return (
    <article>
      <FaSitemap />
      <div>
        <strong>{feature.label}</strong>
        <small>{feature.family} · {feature.version} · {dataset?.label ?? feature.datasetId}</small>
        <span>{feature.usedBy}</span>
      </div>
      <StatusBadge tone={qualityTone(feature.quality)}>{feature.quality}</StatusBadge>
      <StatusBadge tone={lookaheadTone(feature.lookaheadStatus)}>{feature.lookaheadStatus}</StatusBadge>
    </article>
  );
}

function datasetById(datasets: readonly DatasetRow[], datasetId: string) {
  return datasets.find((dataset) => dataset.datasetId === datasetId);
}

function actionIcon(commandType: string) {
  if (commandType.includes("recompute")) return <FaRedo />;
  if (commandType.includes("audit")) return <FaSearch />;
  if (commandType.includes("invalidate")) return <FaTools />;
  return <FaLink />;
}

function qualityTone(quality: "OK" | "WATCH" | "DEGRADED") {
  if (quality === "OK") return "success";
  if (quality === "WATCH") return "warning";
  return "danger";
}

function lookaheadTone(status: "PASS" | "WATCH" | "FAIL") {
  if (status === "PASS") return "success";
  if (status === "WATCH") return "warning";
  return "danger";
}

function lineageTone(status: "OK" | "WATCH" | "BLOCKED") {
  if (status === "OK") return "success";
  if (status === "WATCH") return "warning";
  return "danger";
}

function severityTone(severity: "LOW" | "MEDIUM" | "HIGH") {
  if (severity === "HIGH") return "danger";
  if (severity === "MEDIUM") return "warning";
  return "info";
}

function permissionTone(permission: DataAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function compactId(value: string) {
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 11)}…${value.slice(-7)}`;
}
