import { groupRoutesByNavigation, vnextRoutes, type VNextNavGroup } from "@/app/routes";

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

export type DeskNavigationSection = "Surveiller" | "Décider" | "Améliorer" | "Exploiter" | "Système";
export type DeskNavigationIcon = "overview" | "live" | "decisions" | "portfolio" | "risk" | "strategies" | "research" | "replay" | "performance" | "providers" | "incidents" | "audit" | "jarvis" | "settings";

type DeskNavigationSeed = {
  path: string;
  label: string;
  section: DeskNavigationSection;
  icon: DeskNavigationIcon;
  mobile?: boolean;
};

const primaryNavigationSeed: readonly DeskNavigationSeed[] = [
  { path: "command-center", label: "Vue d’ensemble", section: "Surveiller", icon: "overview", mobile: true },
  { path: "live", label: "Trading en direct", section: "Surveiller", icon: "live", mobile: true },
  { path: "orders", label: "Décisions à traiter", section: "Décider", icon: "decisions", mobile: true },
  { path: "portfolio", label: "Portefeuille", section: "Décider", icon: "portfolio" },
  { path: "risk", label: "Risque", section: "Décider", icon: "risk" },
  { path: "strategies", label: "Stratégies", section: "Améliorer", icon: "strategies" },
  { path: "research", label: "Recherche", section: "Améliorer", icon: "research" },
  { path: "replay", label: "Rejeu", section: "Améliorer", icon: "replay" },
  { path: "performance", label: "Résultats", section: "Améliorer", icon: "performance" },
  { path: "execution/providers", label: "Fournisseurs", section: "Exploiter", icon: "providers" },
  { path: "execution/incidents", label: "Incidents", section: "Exploiter", icon: "incidents", mobile: true },
  { path: "events", label: "Audit", section: "Exploiter", icon: "audit" },
  { path: "jarvis", label: "Jarvis", section: "Système", icon: "jarvis" },
  { path: "settings", label: "Réglages", section: "Système", icon: "settings" },
];

export const DESK_NAVIGATION_SECTIONS: readonly DeskNavigationSection[] = ["Surveiller", "Décider", "Améliorer", "Exploiter", "Système"];

export const deskPrimaryNavigation = primaryNavigationSeed.map((seed) => {
  const route = vnextRoutes.find((candidate) => candidate.path === seed.path);
  if (!route) throw new Error(`Primary navigation route is not registered: ${seed.path}`);
  if (route.path.includes(":")) throw new Error(`Dynamic route cannot be primary navigation: ${route.path}`);
  return {
    ...seed,
    to: `/${route.path}`,
    routeLabel: route.label,
    title: route.title,
    group: route.navGroup,
    capability: route.capability,
  } as const;
});
