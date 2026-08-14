export type FrontV3CurrentSpaceId = "today" | "replay" | "performance" | "operations" | "execution" | "settings";

export type FrontV3TargetSpace =
  | "Aujourd'hui"
  | "Replay"
  | "Performance"
  | "Opérations"
  | "Stratégies"
  | "Research"
  | "Données"
  | "Exécution"
  | "Gouvernance";

export type FrontV3MigrationPhase = "legacy" | "coexistence" | "candidate" | "cutover" | "retired";

export type FrontV3ScreenPattern = "global" | "zoom" | "detail";

export interface FrontV3FeatureFlag {
  key: string;
  defaultState: "disabled" | "enabled";
  rollback: "disable_flag";
  owner: FrontV3TargetSpace;
}

export interface FrontV3ScreenMigration {
  currentPath: string;
  currentLabel: string;
  targetSpace: FrontV3TargetSpace;
  targetPath: string;
  pattern: FrontV3ScreenPattern;
  phase: FrontV3MigrationPhase;
  featureFlag: string;
  rollbackPath: string;
  apiDependencies: string[];
}

export interface FrontV3SpaceMigration {
  currentSpaceId: FrontV3CurrentSpaceId;
  currentLabel: string;
  targetSpaces: FrontV3TargetSpace[];
  pilot: boolean;
  featureFlag: string;
  fallbackSpacePath: string;
  screens: FrontV3ScreenMigration[];
}

export const frontV3FeatureFlags: FrontV3FeatureFlag[] = [
  flag("front.v3.shell.enabled", "Gouvernance"),
  flag("front.v3.today.enabled", "Aujourd'hui"),
  flag("front.v3.replay.enabled", "Replay"),
  flag("front.v3.performance.enabled", "Performance"),
  flag("front.v3.operations.enabled", "Opérations"),
  flag("front.v3.execution.enabled", "Exécution"),
  flag("front.v3.strategy.enabled", "Stratégies"),
  flag("front.v3.research.enabled", "Research"),
  flag("front.v3.data.enabled", "Données"),
  flag("front.v3.governance.enabled", "Gouvernance"),
];

export const frontV3MigrationPlan: FrontV3SpaceMigration[] = [
  {
    currentSpaceId: "today",
    currentLabel: "Aujourd’hui",
    targetSpaces: ["Aujourd'hui"],
    pilot: false,
    featureFlag: "front.v3.today.enabled",
    fallbackSpacePath: "/live",
    screens: [
      screen("/dashboard", "Vue d’ensemble", "Aujourd'hui", "/v3/today", "global", "coexistence", "front.v3.today.enabled", [
        "/api/v1/live-desk/current",
        "/api/v1/operations/summary",
        "/api/v1/events",
      ]),
      screen("/live", "Session en direct", "Aujourd'hui", "/v3/today/session", "zoom", "coexistence", "front.v3.today.enabled", [
        "/api/v1/live-desk/current",
        "/api/v1/events",
      ]),
      screen("/live/master", "Analyse initiale", "Aujourd'hui", "/v3/today/master", "detail", "legacy", "front.v3.today.enabled", [
        "/api/v1/live-desk/current",
      ]),
      screen("/live/monitors", "Suivis", "Aujourd'hui", "/v3/today/monitors", "detail", "legacy", "front.v3.today.enabled", [
        "/api/v1/live-desk/current",
      ]),
      screen("/live/thesis", "Plan actif", "Aujourd'hui", "/v3/today/plan", "detail", "legacy", "front.v3.today.enabled", [
        "/api/v1/live-desk/current",
      ]),
    ],
  },
  {
    currentSpaceId: "replay",
    currentLabel: "Replay",
    targetSpaces: ["Replay"],
    pilot: true,
    featureFlag: "front.v3.replay.enabled",
    fallbackSpacePath: "/replay",
    screens: [
      screen("/replay", "Journées de test", "Replay", "/v3/replay", "global", "candidate", "front.v3.replay.enabled", [
        "/api/v1/replays",
        "/api/v1/events",
      ]),
      screen("/replay/compare", "Comparer", "Replay", "/v3/replay/compare", "zoom", "coexistence", "front.v3.replay.enabled", [
        "/api/v1/replays",
        "/api/v1/performance/overview",
      ]),
      screen("/replay/runs/:runId", "Run Replay", "Replay", "/v3/replay/runs/:runId", "zoom", "candidate", "front.v3.replay.enabled", [
        "/api/v1/replays/{runId}",
        "/api/v1/events",
      ]),
    ],
  },
  {
    currentSpaceId: "performance",
    currentLabel: "Performance",
    targetSpaces: ["Performance"],
    pilot: false,
    featureFlag: "front.v3.performance.enabled",
    fallbackSpacePath: "/performance/analysis",
    screens: [
      screen("/performance/analysis", "Analyse", "Performance", "/v3/performance", "global", "coexistence", "front.v3.performance.enabled", [
        "/api/v1/performance/overview",
      ]),
      screen("/performance", "Calendrier", "Performance", "/v3/performance/calendar", "zoom", "coexistence", "front.v3.performance.enabled", [
        "/api/v1/performance/overview",
      ]),
      screen("/history", "Archives", "Performance", "/v3/performance/history", "detail", "legacy", "front.v3.performance.enabled", [
        "/api/v1/history",
      ]),
    ],
  },
  {
    currentSpaceId: "operations",
    currentLabel: "Opérations",
    targetSpaces: ["Opérations", "Gouvernance"],
    pilot: true,
    featureFlag: "front.v3.operations.enabled",
    fallbackSpacePath: "/operations",
    screens: [
      screen("/operations", "Automatisations", "Opérations", "/v3/operations", "global", "candidate", "front.v3.operations.enabled", [
        "/api/v1/operations/summary",
        "/api/v1/workflows",
        "/api/v1/events",
      ]),
      screen("/operations/agents", "Agents IA", "Opérations", "/v3/operations/agents", "zoom", "coexistence", "front.v3.operations.enabled", [
        "/api/v1/agent-runtime/overview",
      ]),
      screen("/operations/incidents", "Incidents", "Opérations", "/v3/operations/incidents", "zoom", "candidate", "front.v3.operations.enabled", [
        "/api/v1/incidents",
      ]),
      screen("/operations/runbooks", "Procédures", "Gouvernance", "/v3/governance/runbooks", "zoom", "coexistence", "front.v3.governance.enabled", [
        "/api/v1/runbooks",
      ]),
    ],
  },
  {
    currentSpaceId: "execution",
    currentLabel: "Exécution",
    targetSpaces: ["Exécution"],
    pilot: false,
    featureFlag: "front.v3.execution.enabled",
    fallbackSpacePath: "/operations/execution",
    screens: [
      screen("/operations/execution", "NinjaTrader", "Exécution", "/v3/execution", "global", "legacy", "front.v3.execution.enabled", [
        "/api/v1/execution/overview",
        "/api/v1/execution/actions",
      ]),
    ],
  },
  {
    currentSpaceId: "settings",
    currentLabel: "Réglages",
    targetSpaces: ["Stratégies", "Research", "Données", "Gouvernance"],
    pilot: false,
    featureFlag: "front.v3.governance.enabled",
    fallbackSpacePath: "/strategies",
    screens: [
      screen("/strategies", "Stratégie & contrats", "Stratégies", "/v3/strategies", "global", "coexistence", "front.v3.strategy.enabled", [
        "/api/v1/strategy-v2/overview",
      ]),
      screen("/research", "Research Lab", "Research", "/v3/research", "global", "coexistence", "front.v3.research.enabled", [
        "/api/v1/research/overview",
      ]),
      screen("/data-foundation", "Data Foundation", "Données", "/v3/data", "global", "coexistence", "front.v3.data.enabled", [
        "/api/v1/data-foundation/overview",
      ]),
      screen("/prompt-registry", "Prompt Registry", "Gouvernance", "/v3/governance/prompts", "zoom", "coexistence", "front.v3.governance.enabled", [
        "/api/v1/prompt-registry/overview",
      ]),
    ],
  },
];

export function frontV3MigrationForSpace(spaceId: FrontV3CurrentSpaceId): FrontV3SpaceMigration {
  const migration = frontV3MigrationPlan.find(item => item.currentSpaceId === spaceId);
  if (!migration) throw new Error(`Front V3 migration plan missing for ${spaceId}`);
  return migration;
}

function flag(key: string, owner: FrontV3TargetSpace): FrontV3FeatureFlag {
  return { key, defaultState: "disabled", rollback: "disable_flag", owner };
}

function screen(
  currentPath: string,
  currentLabel: string,
  targetSpace: FrontV3TargetSpace,
  targetPath: string,
  pattern: FrontV3ScreenPattern,
  phase: FrontV3MigrationPhase,
  featureFlag: string,
  apiDependencies: string[],
): FrontV3ScreenMigration {
  return {
    currentPath,
    currentLabel,
    targetSpace,
    targetPath,
    pattern,
    phase,
    featureFlag,
    rollbackPath: currentPath,
    apiDependencies,
  };
}
