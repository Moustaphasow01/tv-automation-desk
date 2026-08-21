import { groupRoutesByNavigation, type VNextNavGroup } from "@/app/routes";

export const NAV_GROUP_LABELS: Record<VNextNavGroup, string> = {
  pilotage: "Pilotage",
  live: "Direct",
  operations: "Opérations",
  research: "Recherche",
  strategy: "Stratégies",
  replay: "Rejeu",
  performance: "Performance",
  execution: "Exécution & Risque",
  governance: "Gouvernance"
};

export const groupedNavigation = groupRoutesByNavigation();
