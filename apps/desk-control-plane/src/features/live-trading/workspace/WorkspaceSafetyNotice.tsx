import type { LiveTradingModel } from "../model";
import { workspaceCopy } from "./workspaceModel";

/** Published incidents and missing manual stop declarations cannot be muted with alerts. */
export function WorkspaceSafetyNotice({ model }: { model: LiveTradingModel }) {
  const manualStops = model.theoreticalExecution?.rows.filter((row) => row.manualExecutionStatus === "FILLED" && !row.manualExecution?.stopPlacement?.placed) ?? [];
  const incidents = model.source.incidents.filter((incident) => incident.severity === "HIGH");
  if (!manualStops.length && !incidents.length) return null;
  return <section className="tw-safety-notice" aria-label="Vigilance sur les exécutions" role="status">
    {manualStops.map((row) => <p key={row.portfolioOrderIntentId}>{row.instrument} · entrée manuelle déclarée, sans placement de stop déclaré. Vérifiez la protection effective chez votre courtier.</p>)}
    {incidents.map((incident) => <p key={incident.incidentId}>Incident publié · {workspaceCopy(incident.title)}. {workspaceCopy(incident.detail)}</p>)}
  </section>;
}
