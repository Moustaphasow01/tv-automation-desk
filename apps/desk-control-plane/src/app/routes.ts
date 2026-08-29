export type VNextNavGroup =
  | "pilotage"
  | "live"
  | "operations"
  | "research"
  | "strategy"
  | "replay"
  | "performance"
  | "execution"
  | "governance";

export type VNextRouteStatus = "foundation" | "golden-slice-pending" | "backend-gap";

export type VNextRoute = {
  path: string;
  label: string;
  title: string;
  description: string;
  navGroup: VNextNavGroup;
  capability: string;
  journey: string;
  status: VNextRouteStatus;
  viewEndpoint?: string;
  navigation?: boolean;
};

const implementedRoutes: readonly VNextRoute[] = [
  {
    path: "auth",
    label: "Accès",
    title: "Authentification opérateur",
    description: "Entrée sécurisée du Control Plane et préparation des scopes opérateur.",
    navGroup: "governance",
    capability: "auth.read",
    journey: "operator-access",
    status: "foundation",
    viewEndpoint: "/views/auth-session"
    ,navigation: false
  },
  {
    path: "command-center",
    label: "Synthèse",
    title: "Synthèse",
    description: "Vue globale lisible : santé, activité, risques, prochains événements et raccourcis de zoom.",
    navGroup: "pilotage",
    capability: "command-center.read",
    journey: "global-to-zoom",
    status: "foundation",
    viewEndpoint: "/views/command-center"
  },
  {
    path: "operations",
    label: "Opérations",
    title: "Centre d'opérations",
    description: "Files de travail, incidents, workers, claims et événements techniques exploitables.",
    navGroup: "operations",
    capability: "operations.read",
    journey: "operate-and-recover",
    status: "foundation",
    viewEndpoint: "/views/operations-queue"
  },
  {
    path: "events",
    label: "Audit",
    title: "Audit",
    description: "Journal transversal des événements métier et système, pensé pour le debug opérateur.",
    navGroup: "operations",
    capability: "events.read",
    journey: "observe",
    status: "foundation",
    viewEndpoint: "/views/events-audit"
    ,navigation: false
  },
  {
    path: "research",
    label: "Recherche",
    title: "Recherche",
    description: "Pilotage des expérimentations, backtests, datasets et agent researchers.",
    navGroup: "research",
    capability: "research.read",
    journey: "discover-validate-promote",
    status: "foundation",
    viewEndpoint: "/views/research-lab"
  },
  {
    path: "research/experiments/:experimentId",
    label: "Expérience",
    title: "Détail expérience",
    description: "Zoom complet d’une expérience : hypothèse, runs, métriques et décision de promotion.",
    navGroup: "research",
    capability: "research.experiment.read",
    journey: "zoom",
    status: "foundation",
    viewEndpoint: "/views/research-experiment-detail"
  },
  {
    path: "research/runs/:runId",
    label: "Run",
    title: "Détail run",
    description: "Zoom run : timeline, logs, artefacts, reproductibilité et résultat calculé.",
    navGroup: "research",
    capability: "research.run.read",
    journey: "zoom",
    status: "foundation",
    viewEndpoint: "/views/research-run-detail"
  },
  {
    path: "research/agents",
    label: "Agents",
    title: "Agents de recherche",
    description: "Rôles, files, conversations et budgets d’intelligence des agents de recherche.",
    navGroup: "research",
    capability: "research.agents.read",
    journey: "agent-supervision",
    status: "foundation",
    viewEndpoint: "/views/research-agent-fleet"
  },
  {
    path: "research/data",
    label: "Données",
    title: "Fondation données",
    description: "Datasets, lineage, couverture, splits temporels et qualité de données point-in-time.",
    navGroup: "research",
    capability: "research.data.read",
    journey: "data-governance",
    status: "foundation",
    viewEndpoint: "/views/research-data-catalog"
  },
  {
    path: "research/compute",
    label: "Compute",
    title: "Laboratoire compute",
    description: "Suivi des batches, workers compute, coûts, files et capacité de simulation.",
    navGroup: "research",
    capability: "research.compute.read",
    journey: "capacity",
    status: "foundation",
    viewEndpoint: "/views/research-compute-scheduler"
  },
  {
    path: "strategies",
    label: "Stratégies",
    title: "Stratégies",
    description: "Catalogue des stratégies, versions, instances, kernels et statuts de promotion.",
    navGroup: "strategy",
    capability: "strategies.read",
    journey: "promote-control",
    status: "foundation",
    viewEndpoint: "/views/strategy-center"
  },
  {
    path: "strategies/:strategyId",
    label: "Stratégie",
    title: "Détail stratégie",
    description: "Zoom stratégie : définition, variantes, contraintes, signaux, drift et historique.",
    navGroup: "strategy",
    capability: "strategy.read",
    journey: "zoom",
    status: "foundation",
    viewEndpoint: "/views/strategy-detail"
  },
  {
    path: "strategies/:strategyId/compare",
    label: "Comparer",
    title: "Comparaison stratégie",
    description: "Comparaison de versions et variantes avant promotion ou rollback.",
    navGroup: "strategy",
    capability: "strategy.compare",
    journey: "compare",
    status: "foundation",
    viewEndpoint: "/views/strategy-compare"
  },
  {
    path: "live",
    label: "Live",
    title: "Live",
    description: "Session live, signaux déterministes, état de marché, décisions IA et exécution simulée/live.",
    navGroup: "live",
    capability: "live.read",
    journey: "monitor-decide-execute",
    status: "foundation",
    viewEndpoint: "/views/live-trading"
  },
  {
    path: "demo-paper-readiness",
    label: "Readiness",
    title: "Préparation Démo/PAPIER",
    description: "Porte de lancement opérateur : flux durable, Sim101/AddOn, gate release et actions restantes.",
    navGroup: "pilotage",
    capability: "demo-paper.readiness.read",
    journey: "launch-control",
    status: "foundation",
    viewEndpoint: "/views/demo-paper-readiness"
  },
  {
    path: "live/signals/:signalId",
    label: "Signal",
    title: "Détail signal live",
    description: "Zoom signal : conditions déterministes, conflits, arbitrage, risk check et ordres liés.",
    navGroup: "live",
    capability: "live.signal.read",
    journey: "zoom",
    status: "foundation",
    viewEndpoint: "/views/live-signal-detail"
  },
  {
    path: "portfolio",
    label: "Portefeuille",
    title: "Portefeuille",
    description: "Risque global, allocation, netting, positions cibles et exposition multi-stratégies.",
    navGroup: "execution",
    capability: "portfolio.read",
    journey: "risk-first",
    status: "foundation",
    viewEndpoint: "/views/portfolio"
    ,navigation: false
  },
  {
    path: "orders",
    label: "Décisions",
    title: "Décisions",
    description: "Intentions d’ordre, états broker, fills, protections post-fill et réconciliation.",
    navGroup: "execution",
    capability: "orders.read",
    journey: "execution-control",
    status: "foundation",
    viewEndpoint: "/views/orders"
    ,navigation: false
  },
  {
    path: "risk",
    label: "Risque",
    title: "Risque",
    description: "Budgets, limites, circuit breakers, règles prop firm et contrôles opérateur.",
    navGroup: "execution",
    capability: "risk.read",
    journey: "protect-capital",
    status: "foundation",
    viewEndpoint: "/views/risk"
    ,navigation: false
  },
  {
    path: "execution/providers",
    label: "Fournisseurs",
    title: "Fournisseurs",
    description: "NinjaTrader, PickMyTrade, shadow mode, cutover, santé provider et fallback.",
    navGroup: "execution",
    capability: "execution.providers.read",
    journey: "provider-control",
    status: "foundation",
    viewEndpoint: "/views/execution-providers"
  },
  {
    path: "execution/incidents",
    label: "Incidents",
    title: "Incidents",
    description: "Incidents d’exécution, dead letters, retries, runbooks et preuves de résolution.",
    navGroup: "operations",
    capability: "execution.incidents.read",
    journey: "recover",
    status: "foundation",
    viewEndpoint: "/views/execution-incidents"
    ,navigation: false
  },
  {
    path: "jarvis",
    label: "Jarvis",
    title: "Jarvis",
    description: "Espace agentique pour orchestrer recherches, décisions, prompts et actions longues.",
    navGroup: "governance",
    capability: "jarvis.read",
    journey: "agentic-workspace",
    status: "foundation",
    viewEndpoint: "/views/jarvis-workspace"
  },
  {
    path: "settings",
    label: "Réglages",
    title: "Réglages",
    description: "Feature flags, modes d’environnement, préférences d’affichage et configuration opérateur.",
    navGroup: "governance",
    capability: "settings.read",
    journey: "configure",
    status: "foundation",
    viewEndpoint: "/views/operator-settings"
  },
  {
    path: "admin",
    label: "Admin",
    title: "Administration",
    description: "Administration technique protégée : droits, audit, maintenance et diagnostic avancé.",
    navGroup: "governance",
    capability: "admin.read",
    journey: "administer",
    status: "foundation",
    viewEndpoint: "/views/admin-access"
    ,navigation: false
  }
];

const backendGapRoutes: readonly VNextRoute[] = [
  wired("operations/incidents", "Incidents", "Incidents", "operations", "Incidents d'exécution et reprise opérateur.", "/views/execution-incidents"),
  wired("operations/events", "Événements & Audit", "Événements et audit", "operations", "Journal transversal et corrélations.", "/views/events-audit"),
  wired("execution/orders", "Décisions à traiter", "Décisions à traiter", "execution", "Intentions, ordres, fills et protections.", "/views/orders"),
  wired("execution/portfolio", "Portefeuille", "Portefeuille", "execution", "Expositions, positions et netting.", "/views/portfolio"),
  wired("execution/risk", "Risque", "Risque", "execution", "Budgets, limites et dépassements.", "/views/risk"),
  wired("governance/access", "Accès & Rôles", "Accès et rôles", "governance", "Session, permissions et accès courants.", "/views/admin-access"),
  wired("governance/administration", "Administration", "Administration", "governance", "Administration protégée et audit d'accès.", "/views/admin-access"),
  wired("sessions", "Sessions", "Sessions de trading", "pilotage", "Sessions, calendrier opérationnel et historique d'ouverture.", "/views/sessions"),
  wired("live/signals", "Signaux", "Signaux live", "live", "Liste filtrable des signaux publiés par le runtime.", "/views/live-trading"),
  wired("live/plan", "Plan / Setup", "Plan et setups", "live", "Plan courant, niveaux, conditions et invalidations.", "/views/live-plan"),
  wired("live/news", "Agenda & News", "Agenda et actualités", "live", "Événements macro, actuals et actualités point-in-time.", "/views/live-news"),
  wired("live/timeline", "Timeline Live", "Timeline live", "live", "Chronologie autoritaire du cycle live.", "/views/live-timeline"),
  wired("research/experiments", "Expériences", "Expériences", "research", "Catalogue et filtres des expériences de recherche.", "/views/research-experiments"),
  wired("research/candidates", "Candidats", "Candidats stratégie", "research", "Candidats, verdicts, promotions et rejets.", "/views/research-candidates"),
  wired("research/data/:datasetId", "Dataset", "Détail dataset", "research", "Lineage, couverture et qualité d'un dataset par identifiant.", "/views/research-dataset-detail"),
  wired("strategies/deployments", "Déploiements", "Déploiements stratégie", "strategy", "Instances, environnements et historique de déploiement.", "/views/strategy-deployments"),
  wired("replay", "Rejeu", "Rejeu", "replay", "Vue globale des runs et de leur progression.", "/views/replay-overview"),
  wired("replay/runs", "Runs Rejeu", "Runs Rejeu", "replay", "Liste et filtres des runs Rejeu.", "/views/replay-runs"),
  wired("replay/runs/:runId", "Run Rejeu", "Détail Rejeu", "replay", "Jour, sessions, processus GPT et trades du run.", "/views/replay-run-detail"),
  wired("replay/compare", "Comparer Rejeu", "Comparaison Rejeu", "replay", "Comparaison de baselines et variantes.", "/views/replay-compare"),
  wired("performance", "Résultats", "Résultats", "performance", "Vue consolidée, PnL en R et drawdowns.", "/views/performance-overview"),
  wired("performance/calendar", "Calendrier", "Calendrier de performance", "performance", "Résultats et drill-down par journée.", "/views/performance-calendar"),
  wired("performance/days/:dayId", "Journée", "Détail performance jour", "performance", "Trades et attribution d'une journée.", "/views/performance-day-detail"),
  wired("performance/strategies", "Par stratégie", "Performance stratégies", "performance", "Comparaison de performance par stratégie.", "/views/performance-strategies"),
  wired("performance/trades", "Trades", "Historique des trades", "performance", "Liste officielle des trades et résultats.", "/views/performance-trades"),
  wired("operations/workflows/:workflowId", "Workflow", "Détail workflow", "operations", "État, claims, transitions et audit d'un workflow.", "/views/workflow-detail"),
  wired("operations/incidents/:incidentId", "Incident", "Détail incident", "operations", "Chronologie et remédiation d'un incident par identifiant.", "/views/incident-detail"),
  wired("operations/events/:eventId", "Événement", "Détail événement", "operations", "Payload, causalité et corrélation d'un événement.", "/views/event-detail"),
  wired("operations/runbooks", "Runbooks", "Runbooks", "operations", "Procédures opérateur et automatisations de reprise.", "/views/operations-runbooks"),
  wired("operations/observability", "Observabilité", "Observabilité", "operations", "Services, latences, erreurs et SLO.", "/views/operations-observability"),
  wired("execution/orders/:orderId", "Ordre", "Détail ordre", "execution", "Cycle de vie broker d'un ordre par identifiant.", "/views/order-detail"),
  wired("execution/portfolio/positions/:positionId", "Position", "Détail position", "execution", "Cycle de vie, risque et management d'une position.", "/views/position-detail"),
  wired("execution/reconciliation", "Réconciliation", "Réconciliation", "execution", "Écarts desk/broker et preuves de réconciliation.", "/views/execution-reconciliation"),
  wired("governance/prompts", "Prompts & IA", "Prompts et contexte IA", "governance", "Registre versionné des prompts, politiques et affectations.", "/views/governance-prompts"),
  wired("governance/policies", "Politiques", "Politiques", "governance", "Politiques de risque, exécution et gouvernance.", "/views/governance-policies"),
];

export const vnextRoutes: readonly VNextRoute[] = [...implementedRoutes, ...backendGapRoutes];

export function routeDisplayName(path: string): string {
  const route = vnextRoutes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`Route is not registered: ${path}`);
  return route.label;
}

function wired(path: string, label: string, title: string, navGroup: VNextNavGroup, description: string, viewEndpoint: string): VNextRoute {
  return { path, label, title, description, navGroup, capability: capabilityForViewEndpoint(viewEndpoint), journey: "global-to-zoom", status: "foundation", viewEndpoint };
}

function capabilityForViewEndpoint(viewEndpoint: string): string {
  const capabilities: Readonly<Record<string, string>> = {
    "/views/admin-access": "admin.read",
    "/views/events-audit": "events.read",
    "/views/execution-incidents": "execution.incidents.read",
    "/views/incident-detail": "execution.incidents.read",
    "/views/live-trading": "live.read",
    "/views/order-detail": "orders.read",
    "/views/orders": "orders.read",
    "/views/portfolio": "portfolio.read",
    "/views/position-detail": "portfolio.read",
    "/views/risk": "risk.read"
    ,"/views/sessions": "sessions.read"
    ,"/views/live-plan": "live.plan.read"
    ,"/views/live-news": "live.news.read"
    ,"/views/live-timeline": "live.timeline.read"
    ,"/views/execution-reconciliation": "execution.reconciliation.read"
    ,"/views/operations-observability": "operations.observability.read"
    ,"/views/research-experiments": "research.experiments.read"
    ,"/views/research-candidates": "research.candidates.read"
    ,"/views/research-dataset-detail": "research.data.read"
    ,"/views/strategy-deployments": "strategies.deployments.read"
    ,"/views/replay-overview": "replay.read"
    ,"/views/replay-runs": "replay.read"
    ,"/views/replay-run-detail": "replay.read"
    ,"/views/replay-compare": "replay.read"
    ,"/views/performance-overview": "performance.read"
    ,"/views/performance-calendar": "performance.read"
    ,"/views/performance-day-detail": "performance.read"
    ,"/views/performance-strategies": "performance.read"
    ,"/views/performance-trades": "performance.read"
    ,"/views/workflow-detail": "operations.read"
    ,"/views/event-detail": "events.read"
    ,"/views/operations-runbooks": "operations.runbooks.read"
    ,"/views/governance-prompts": "governance.prompts.read"
    ,"/views/governance-policies": "governance.policies.read"
  };
  const capability = capabilities[viewEndpoint];
  if (!capability) throw new Error(`VNext route capability missing for ${viewEndpoint}`);
  return capability;
}

export function groupRoutesByNavigation(routes: readonly VNextRoute[] = vnextRoutes) {
  return routes.reduce<Record<VNextNavGroup, VNextRoute[]>>(
    (groups, route) => {
      groups[route.navGroup].push(route);
      return groups;
    },
    {
      pilotage: [],
      live: [],
      operations: [],
      research: [],
      strategy: [],
      replay: [],
      performance: [],
      execution: [],
      governance: []
    }
  );
}
