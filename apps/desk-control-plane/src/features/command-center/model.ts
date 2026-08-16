import type { CommandCenterView } from "@/domains/front-api/viewModels";
import type { ViewMeta } from "@/shared/contracts";

export type CommandCenterTone = "neutral" | "info" | "success" | "warning" | "danger";

export type CommandCenterKpi = {
  id: "health" | "workers" | "strategies" | "human-gate" | "incidents" | "provider-safety";
  label: string;
  value: string;
  detail: string;
  tone: CommandCenterTone;
  route: string;
};

export type CommandCenterModel = {
  meta: ViewMeta;
  source: CommandCenterView;
  kpis: readonly CommandCenterKpi[];
  truthLabel: string;
  truthTone: CommandCenterTone;
};

export type DeskControlCommand = "desk.status" | "desk.doctor" | "desk.start" | "desk.stop" | "desk.restart";

export type DeskControlCapability = {
  commandType: string;
  allowed: boolean;
  brokerExecution: boolean;
};
