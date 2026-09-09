// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSessionNavigation, useLiveSessionPanel } from "@/features/live-trading/LiveSessionNavigation";
import { SignalCommandPanel } from "@/features/live-trading/SignalCommandPanel";
import { LiveSignalDetailWorkspace } from "@/features/live-trading/LiveSignalDetailWorkspace";
import { resolveSignalTemporalState } from "@/features/live-trading/signalTemporalState";
import { liveSignalDetailView } from "@/mocks/canonicalDataset";
import { JourneyBackLink, JourneyLink } from "./JourneyNavigation";
import { JourneyFreshness, journeyAvailability } from "./JourneySurface";
import { useProgressiveRows } from "./useProgressiveRows";

vi.mock("@/design-system/actions", async () => ({
  DeskButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  TrackedCommandReceipt: () => null,
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function NavigationProbe() {
  const nav = useLiveSessionPanel();
  const location = useLocation();
  return <><LiveSessionNavigation panel={nav.panel} onSelect={nav.select} /><JourneyLink to="/execution/orders/a">Dossier</JourneyLink><output>{location.search}</output></>;
}

const receivedRows = Array.from({ length: 40 }, (_, index) => `Dossier ${index + 1}`);
function PaginationProbe({ filterKey }: { filterKey: string }) {
  const page = useProgressiveRows(receivedRows, filterKey);
  return <><ul>{page.visible.map((row) => <li key={row}>{row}</li>)}</ul>{page.hasMore ? <button onClick={page.showMore}>Afficher plus</button> : null}</>;
}

describe("Navigation and read-only signal controls", () => {
  it("puts the signal prices before its closed progression and uses operator language", async () => {
    const data = liveSignalDetailView.data;
    const temporal = resolveSignalTemporalState(data.signal, Date.parse(data.signal.expiresAt) + 1000);
    await act(async () => root.render(<MemoryRouter><LiveSignalDetailWorkspace data={data} temporal={temporal} remainingSec={0} reason="" command={null} commandError={null} submittingActionId={null} onReason={vi.fn()} onConfirm={vi.fn()} /></MemoryRouter>));
    const first = host.querySelector(".signal-dossier-main")!.firstElementChild!;
    expect(first.textContent).toContain("Zone d’entrée");
    expect(first.textContent).toContain("Espérance de gain");
    expect(first.textContent).not.toMatch(/Expectancy|Portfolio et Risk/);
    const progression = host.querySelector(".signal-lifecycle")!.closest("details")!;
    expect(progression.open).toBe(false);
    expect(host.querySelector(".signal-hero__validity")?.textContent).toContain("Fenêtre terminée");
  });

  it("switches the Live mobile task without losing instrument or signal", async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={["/live?instrument=ZW&timeframe=15&signalId=signal-a"]}><NavigationProbe /></MemoryRouter>));
    const activity = [...host.querySelectorAll("button")].find((button) => button.textContent === "Activité")!;
    await act(async () => activity.click());
    expect(activity.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("output")?.textContent).toContain("instrument=ZW&timeframe=15&signalId=signal-a&livePanel=activity");
    const href = host.querySelector("a")!.getAttribute("href")!;
    expect(new URLSearchParams(href.split("?")[1]).get("returnTo")).toContain("livePanel=activity");
  });
  it("returns to the preserved Focus path even from a directly shared dossier URL", async () => {
    const target = "/live?focus=1&instrument=ZC&timeframe=5&panel=tickets&ticketId=trade%3Aa";
    await act(async () => root.render(<MemoryRouter initialEntries={["/execution/orders/a?returnTo=" + encodeURIComponent(target)]}><JourneyBackLink fallback="/orders" /></MemoryRouter>));
    expect(host.querySelector("a")!.textContent).toBe("Retour à Focus");
    expect(host.querySelector("a")!.getAttribute("href")).toBe(target);
  });
  it("does not show a pointless form when no action is published", async () => {
    await act(async () => root.render(<SignalCommandPanel actions={[]} reason="" command={null} error={null} submittingActionId={null} onReason={vi.fn()} onConfirm={vi.fn()} />));
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toContain("Aucune action autorisée");
  });
  it("keeps denied permissions and all competing sends disabled", async () => {
    const actions = liveSignalDetailView.data.commandActions.map((action) => ({ ...action, permission: "DENIED" as const }));
    const onConfirm = vi.fn();
    await act(async () => root.render(<SignalCommandPanel actions={actions} reason="Vérifié" command={null} error={null} submittingActionId={null} onReason={vi.fn()} onConfirm={onConfirm} />));
    expect([...host.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("distinguishes source quality from an execution status", async () => {
    await act(async () => root.render(<JourneyFreshness meta={{ ...liveSignalDetailView.meta, availability: "PARTIAL", stale: false }} />));
    expect(host.textContent).toContain("Données partielles");
    expect(host.textContent).not.toContain("exécuté");
  });
  it.each([
    [{ availability: "AVAILABLE", stale: false }, "Vue publiée"],
    [{ availability: "AVAILABLE", stale: true }, "Données anciennes · à vérifier"],
    [{ availability: "STALE", stale: false }, "Données anciennes · à vérifier"],
    [{ availability: "UNAVAILABLE", stale: false }, "Données indisponibles"],
    [{ stale: false }, "Qualité de la vue non publiée"],
  ] as const)("preserves source availability %j", (meta, expected) => {
    expect(journeyAvailability(meta)).toBe(expected);
  });
  it("pages long histories without losing or reordering their source", async () => {
    await act(async () => root.render(<PaginationProbe filterKey="all" />));
    expect(host.querySelectorAll("li")).toHaveLength(12);
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelectorAll("li")).toHaveLength(24);
    expect(host.querySelector("li")?.textContent).toBe("Dossier 1");
    await act(async () => root.render(<PaginationProbe filterKey="open" />));
    expect(host.querySelectorAll("li")).toHaveLength(12);
    expect(receivedRows).toHaveLength(40);
  });
});
