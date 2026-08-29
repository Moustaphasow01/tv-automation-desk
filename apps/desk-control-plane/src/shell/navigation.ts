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
  section: DeskNavigationSection;
  icon: DeskNavigationIcon;
  mobile?: boolean;
};

const primaryNavigationSeed: readonly DeskNavigationSeed[] = [
  { path: "command-center", section: "Surveiller", icon: "overview", mobile: true },
  { path: "live", section: "Surveiller", icon: "live", mobile: true },
  { path: "orders", section: "Décider", icon: "decisions", mobile: true },
  { path: "portfolio", section: "Décider", icon: "portfolio" },
  { path: "risk", section: "Décider", icon: "risk" },
  { path: "strategies", section: "Améliorer", icon: "strategies" },
  { path: "research", section: "Améliorer", icon: "research" },
  { path: "replay", section: "Améliorer", icon: "replay" },
  { path: "performance", section: "Améliorer", icon: "performance" },
  { path: "execution/providers", section: "Exploiter", icon: "providers" },
  { path: "execution/incidents", section: "Exploiter", icon: "incidents", mobile: true },
  { path: "events", section: "Exploiter", icon: "audit" },
  { path: "jarvis", section: "Système", icon: "jarvis" },
  { path: "settings", section: "Système", icon: "settings" },
];

export const DESK_NAVIGATION_SECTIONS: readonly DeskNavigationSection[] = ["Surveiller", "Décider", "Améliorer", "Exploiter", "Système"];

export const deskPrimaryNavigation = primaryNavigationSeed.map((seed) => {
  const route = vnextRoutes.find((candidate) => candidate.path === seed.path);
  if (!route) throw new Error(`Primary navigation route is not registered: ${seed.path}`);
  if (route.path.includes(":")) throw new Error(`Dynamic route cannot be primary navigation: ${route.path}`);
  return {
    ...seed,
    label: route.label,
    to: `/${route.path}`,
    routeLabel: route.label,
    title: route.title,
    group: route.navGroup,
    capability: route.capability,
  } as const;
});
