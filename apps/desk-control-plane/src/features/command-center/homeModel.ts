import type { CommandCenterView } from "@/domains/front-api/viewModels";
import type { ViewEnvelope } from "@/shared/contracts";
import { displayNumber, healthLabel } from "./mapper";

export function homeSummary(envelope: ViewEnvelope<CommandCenterView>) {
  const { data, meta } = envelope;
  const available = !meta.stale && meta.availability === "AVAILABLE";
  const count = (value: number | null) => available && value !== null && Number.isFinite(value) ? displayNumber(value) : "À vérifier";
  return [
    { label: "Décisions en attente", value: data.humanGate.available ? count(data.summary.pendingCommands) : "À vérifier", to: "/orders", tone: "neutral" },
    { label: "Positions ouvertes", value: count(data.risk.openPositions), to: "/portfolio", tone: "neutral" },
    { label: "Incidents critiques", value: count(data.summary.criticalIncidents), to: "/execution/incidents", tone: available && (data.summary.criticalIncidents ?? 0) > 0 ? "danger" : "neutral" },
    { label: "État du desk", value: available ? healthLabel(data.summary.deskStatus) : "À vérifier", to: "/command-center?view=supervision", tone: available && data.summary.deskStatus === "NOMINAL" ? "success" : "warning" },
  ];
}

export function homeDecisionMessage(data: CommandCenterView) {
  if (!data.humanGate.available || data.summary.pendingCommands === null) return "La file de décision n’est pas disponible. Vérifiez sa source avant de conclure qu’aucune action n’est attendue.";
  if (data.summary.pendingCommands === 0) return "Aucune décision en attente dans la file publiée. Vous pouvez poursuivre l’observation dans Focus.";
  return "Des décisions sont en attente. Ouvrez la file pour vérifier les termes et les autorisations en vigueur.";
}
