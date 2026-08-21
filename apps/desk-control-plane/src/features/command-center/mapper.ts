import type { CommandCenterView } from "@/domains/front-api/viewModels";
import type { ViewEnvelope } from "@/shared/contracts";
import type { CommandCenterKpi, CommandCenterModel, CommandCenterTone } from "./model";

export function toCommandCenterModel(envelope: ViewEnvelope<CommandCenterView>): CommandCenterModel {
  return {
    meta: envelope.meta,
    source: envelope.data,
    kpis: kpiProjection(envelope.data),
    truthLabel: envelope.meta.availability ?? (envelope.meta.stale ? "STALE" : "AVAILABLE"),
    truthTone: truthTone(envelope.meta.availability, envelope.meta.stale),
  };
}

function kpiProjection(data: CommandCenterView): readonly CommandCenterKpi[] {
  return [
    {
      id: "health",
      label: "Santé globale du desk",
      value: healthLabel(data.summary.deskStatus),
      detail: data.summary.deskStatus === "NOMINAL" ? "Monitoring nominal" : "Voir les limitations",
      tone: statusTone(data.summary.deskStatus),
      route: "/operations/observability",
    },
    {
      id: "workers",
      label: "Workers de recherche",
      value: pair(data.summary.activeResearchAgents, data.summary.expectedResearchAgents),
      detail: "actifs / attendus",
      tone: nullableTone(data.summary.activeResearchAgents),
      route: "/research/agents",
    },
    {
      id: "strategies",
      label: "Instances de stratégie (SHADOW)",
      value: displayNumber(data.summary.activeStrategies),
      detail: "instances actives",
      tone: nullableTone(data.summary.activeStrategies),
      route: "/strategies",
    },
    {
      id: "human-gate",
      label: "File Human Gate",
      value: displayNumber(data.summary.pendingCommands),
      detail: "OrderIntent en attente",
      tone: data.summary.pendingCommands ? "warning" : nullableTone(data.summary.pendingCommands),
      route: "/orders",
    },
    {
      id: "incidents",
      label: "Incidents critiques",
      value: displayNumber(data.summary.criticalIncidents),
      detail: data.summary.criticalIncidents === null ? "Source incidents indisponible" : data.summary.criticalIncidents ? "ouverts" : "Aucun incident critique",
      tone: data.summary.criticalIncidents === null ? "warning" : data.summary.criticalIncidents ? "danger" : "success",
      route: "/execution/incidents",
    },
    {
      id: "provider-safety",
      label: "Sécurité Provider",
      value: providerSafetyLabel(data.summary.providerSafety),
      detail: data.summary.providerSafety === "NO_BROKER_SIDE_EFFECT" ? "Aucun effet côté courtier" : "Contrat non publié",
      tone: data.summary.providerSafety === "NO_BROKER_SIDE_EFFECT" ? "success" : "warning",
      route: "/execution/providers",
    },
  ];
}

export function statusTone(value: string): CommandCenterTone {
  const status = value.toUpperCase();
  if (["OK", "NOMINAL", "FRESH", "HEALTHY", "READY", "APPROVED", "DONE", "FILLED"].includes(status)) return "success";
  if (["CRITICAL", "DOWN", "FAILED", "REJECTED", "BREACH", "STOP"].includes(status)) return "danger";
  if (["DEGRADED", "STALE", "DELAYED", "WATCH", "WAIT", "PARTIAL", "AWAITING", "UNKNOWN", "UNAVAILABLE"].some((item) => status.includes(item))) return "warning";
  return "info";
}

export function truthTone(availability: string | undefined, stale = false): CommandCenterTone {
  if (stale) return "warning";
  const status = String(availability || "UNKNOWN").toUpperCase();
  if (["AVAILABLE", "KNOWN", "HEALTHY"].includes(status)) return "success";
  if (["CONNECTED_EMPTY", "DISABLED_BY_POLICY", "NOT_APPLICABLE_CURRENT_MODE", "MARKET_CLOSED", "LAST_KNOWN"].includes(status)) return "info";
  if (["UNAVAILABLE", "FAILED", "DOWN"].includes(status)) return "danger";
  return "warning";
}

export function displayNumber(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("fr-FR").format(value);
}

export function displayDecimal(value: number | null, suffix = "") {
  return value === null ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

export function displayTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function pair(value: number | null, expected: number | null) {
  return `${displayNumber(value)} / ${displayNumber(expected)}`;
}

function nullableTone(value: number | null): CommandCenterTone {
  return value === null ? "warning" : "info";
}

export function healthLabel(value: string) {
  if (value === "NOMINAL") return "Opérationnelle";
  if (value === "DEGRADED") return "Dégradée";
  return value === "STOPPED" ? "Arrêtée" : "État non publié";
}

function providerSafetyLabel(value: string) {
  return value === "NO_BROKER_SIDE_EFFECT" ? "Aucun effet\ncôté broker" : "Politique non publiée";
}
