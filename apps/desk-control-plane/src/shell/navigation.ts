import { groupRoutesByNavigation, type VNextNavGroup } from "@/app/routes";

export const NAV_GROUP_LABELS: Record<VNextNavGroup, string> = {
  pilotage: "Pilotage",
  live: "Live",
  operations: "Opérations",
  research: "Recherche",
  strategy: "Stratégies",
  replay: "Replay",
  performance: "Performance",
  execution: "Exécution & Risque",
  governance: "Gouvernance"
};

export const groupedNavigation = groupRoutesByNavigation();
