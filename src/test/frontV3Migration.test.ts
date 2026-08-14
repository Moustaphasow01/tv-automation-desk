import { describe, expect, it } from "vitest";
import { navigationSpaces } from "@/navigation";
import { frontV3FeatureFlags, frontV3MigrationForSpace, frontV3MigrationPlan } from "@/features/front-migration/manifest";

describe("Front V3 migration manifest", () => {
  it("couvre chaque espace de navigation actuel", () => {
    expect(frontV3MigrationPlan.map(space => space.currentSpaceId)).toEqual(navigationSpaces.map(space => space.id));
  });

  it("garde les flags V3 désactivés par défaut avec rollback par configuration", () => {
    expect(frontV3FeatureFlags.length).toBeGreaterThan(0);
    for (const flag of frontV3FeatureFlags) {
      expect(flag.defaultState).toBe("disabled");
      expect(flag.rollback).toBe("disable_flag");
    }
  });

  it("déclare un rollback et des dépendances API pour chaque écran migrable", () => {
    for (const space of frontV3MigrationPlan) {
      expect(space.fallbackSpacePath).toMatch(/^\//);
      for (const screen of space.screens) {
        expect(screen.rollbackPath).toBe(screen.currentPath);
        expect(screen.featureFlag).toMatch(/^front\.v3\./);
        expect(screen.apiDependencies.length).toBeGreaterThan(0);
      }
    }
  });

  it("relie la navigation runtime au plan de coexistence", () => {
    const replay = navigationSpaces.find(space => space.id === "replay")!;
    expect(replay.v3Migration).toEqual(frontV3MigrationForSpace("replay"));
    expect(replay.v3Migration.pilot).toBe(true);
    expect(replay.v3Migration.screens.some(screen => screen.pattern === "zoom")).toBe(true);
  });
});
