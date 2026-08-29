import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "..");
const readSource = (path: string) => readFileSync(resolve(sourceRoot, path), "utf8");

describe("page semantic accessibility regressions", () => {
  it("keeps one application main landmark and exposes the Command Center workspace as a region", () => {
    const shell = readSource("shell/DeskShell.tsx");
    const commandCenter = readSource("pages/CommandCenterPage.tsx");
    const app = readSource("app/App.tsx");
    const explorers = readSource("pages/ExplorerPages.tsx");

    expect(shell).toContain('<main className="desk-content" id="main-content"');
    expect(commandCenter).not.toContain('<main className="cc-workspace"');
    expect(commandCenter).toContain('<div className="cc-workspace" role="region" aria-label="Command Center du Trading Desk">');
    expect(app).not.toContain('<main className="route-loading"');
    expect(explorers).not.toContain('<main className="route-loading"');
  });

  it.each([
    ["pages/ReplayPage.tsx", "Rejeu"],
    ["pages/ExecutionIncidentsPage.tsx", "Incidents &amp; Opérations"],
    ["pages/EventsAuditPage.tsx", "Chronologie &amp; Audit"],
    ["pages/PortfolioPage.tsx", "Portefeuille &amp; Positions"],
    ["pages/JarvisWorkspacePage.tsx", "Espace Jarvis"],
    ["pages/LiveSignalsPage.tsx", "Signaux live"],
    ["pages/AdminAccessPage.tsx", "Accès administrateur"],
    ["pages/OperatorSettingsPage.tsx", "Réglages opérateur"],
  ])("keeps a level-one heading in asynchronous states of %s", (path, title) => {
    const source = readSource(path);

    expect(source).toContain(`<h1 className="sr-only">${title}</h1>`);
  });

  it("keeps a level-one heading in the global and explorer loading states", () => {
    expect(readSource("app/App.tsx")).toContain('<h1 className="sr-only">Chargement de la vue</h1>');
    expect(readSource("pages/ExplorerPages.tsx")).toContain('<h1 className="sr-only">{title}</h1>');
  });

  it("keeps one canonical responsive navigation with three persisted desktop modes", () => {
    const shell = readSource("shell/DeskShell.tsx");
    const navigation = readSource("shell/navigation.ts");

    expect(shell).toContain('type NavigationMode = "expanded" | "compact" | "hidden"');
    expect(shell).toContain('const NAVIGATION_MODE_KEY = "desk.navigation.mode.v1"');
    expect(shell).toContain("deskPrimaryNavigation.filter((route) => route.mobile).slice(0, 4)");
    expect(navigation.match(/const primaryNavigationSeed/g)).toHaveLength(1);
  });

  it("does not manufacture Human Gate commands from an item status", () => {
    const orders = readSource("pages/OrdersPage.tsx");

    expect(orders).not.toContain('expectedVersion: "unavailable"');
    expect(orders).not.toContain('selected.status === "AWAITING_MANUAL_CONFIRMATION" ? (\n                    <>');
    expect(orders).toContain("seules les actions et révisions publiées par le backend");
  });
});
