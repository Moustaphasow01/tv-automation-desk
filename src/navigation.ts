import type { IconName } from "@/components/common";

export interface NavigationItem {
  to: string;
  label: string;
  description: string;
  icon: IconName;
}

export interface NavigationSpace extends NavigationItem {
  id: "today" | "replay" | "performance" | "operations" | "execution" | "settings";
  matches: (pathname: string) => boolean;
  items: NavigationItem[];
}

const todayItems: NavigationItem[] = [
  item("/dashboard", "Vue d’ensemble", "Santé, session et priorités", "chart"),
  item("/live", "Session en direct", "Décision courante et marché", "live"),
  item("/master", "Analyse initiale", "Document Master de la session", "master"),
  item("/monitors", "Suivis", "Évolutions du plan actif", "monitor"),
  item("/thesis", "Plan actif", "Thèse et invalidations", "brain"),
  item("/setup", "Position", "Setup et cycle de vie", "position"),
  item("/timeline", "Journal", "Décisions dans l’ordre", "timeline"),
  item("/news", "Agenda & actualités", "Macro, événements et risques", "news"),
  item("/alerts", "Alertes de session", "Historique des alertes LIVE", "bell"),
  item("/sessions", "Phases de marché", "Découpage horaire de la journée", "clock"),
];

const replayItems: NavigationItem[] = [
  item("/replay", "Journées de test", "Préparer et suivre les replays", "layers"),
  item("/replay/compare", "Comparer", "Comparer deux exécutions", "change"),
];

const performanceItems: NavigationItem[] = [
  item("/performance/analysis", "Analyse", "Résultats, risque et distributions", "chart"),
  item("/performance", "Calendrier", "Résultats journaliers en R", "calendar"),
  item("/history", "Archives", "Sessions et mémoire du desk", "database"),
];

const operationsItems: NavigationItem[] = [
  item("/operations", "Automatisations", "Workflows et état global", "monitor"),
  item("/operations/claim-lanes", "Files GPT", "LIVE et Replay séparés", "layers"),
  item("/operations/observability", "Activité GPT", "Claims, délais et coûts", "chart"),
  item("/operations/incidents", "Incidents", "Alertes qui demandent une action", "alert"),
  item("/operations/notifications", "Notifications", "Messages et escalades", "bell"),
  item("/operations/runbooks", "Procédures", "Guides d’intervention", "layers"),
];

const executionItems: NavigationItem[] = [
  item("/operations/execution", "NinjaTrader", "Sim101, ordres et positions", "position"),
];

const settingsItems: NavigationItem[] = [
  item("/strategies", "Stratégie & contrats", "Versions actives et compatibilité", "settings"),
  item("/audit", "Qualité des données", "Sources, couverture et contrôles", "audit"),
];

export const navigationSpaces: NavigationSpace[] = [
  space("today", "/live", "Aujourd’hui", "Piloter la session courante", "live", todayItems, pathname =>
    ["/", "/dashboard", "/live", "/sessions", "/master", "/monitors", "/thesis", "/setup", "/timeline", "/news", "/alerts"].some(path => pathname === path)),
  space("replay", "/replay", "Replay", "Tester des journées passées", "layers", replayItems, pathname =>
    pathname.startsWith("/replay")),
  space("performance", "/performance/analysis", "Performance", "Mesurer les résultats", "chart", performanceItems, pathname =>
    pathname.startsWith("/performance") || pathname.startsWith("/history")),
  space("operations", "/operations", "Opérations", "Surveiller les automatisations", "monitor", operationsItems, pathname =>
    pathname.startsWith("/operations") && !pathname.startsWith("/operations/execution")),
  space("execution", "/operations/execution", "Exécution", "Gérer NinjaTrader Sim101", "position", executionItems, pathname =>
    pathname.startsWith("/operations/execution")),
  space("settings", "/strategies", "Réglages", "Stratégie, contrats et qualité", "settings", settingsItems, pathname =>
    pathname.startsWith("/strategies") || pathname === "/audit"),
];

export const navigationCatalog: Array<{ label: string; items: NavigationItem[] }> =
  navigationSpaces.map(({ label, items }) => ({ label, items }));

export function activeNavigationSpace(pathname: string) {
  return navigationSpaces.find(spaceItem => spaceItem.matches(pathname)) || navigationSpaces[0];
}

function item(to: string, label: string, description: string, icon: IconName): NavigationItem {
  return { to, label, description, icon };
}

function space(
  id: NavigationSpace["id"],
  to: string,
  label: string,
  description: string,
  icon: IconName,
  items: NavigationItem[],
  matches: NavigationSpace["matches"],
): NavigationSpace {
  return { id, to, label, description, icon, items, matches };
}
