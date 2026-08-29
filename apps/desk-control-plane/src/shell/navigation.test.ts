import { describe, expect, it } from "vitest";
import { commandShortcutLabel, directResourceDestination, rankCommandDestinations, type CommandDestination } from "@/shell/DeskCommandPalette";
import { deskPrimaryNavigation } from "@/shell/navigation";

const destinations: readonly CommandDestination[] = deskPrimaryNavigation.map((item) => ({
  label: item.label,
  route: item.to,
  group: item.section,
  keywords: item.routeLabel,
}));

describe("navigation canonique", () => {
  it("uses one label for navigation, headings and document titles", () => {
    for (const item of deskPrimaryNavigation) {
      expect(item.routeLabel).toBe(item.label);
      expect(item.title).toBe(item.label);
    }
  });

  it("adapts the command shortcut to the operator platform", () => {
    expect(commandShortcutLabel("Win32")).toBe("Ctrl K");
    expect(commandShortcutLabel("MacIntel")).toBe("⌘ K");
  });

  it("ranks an exact or close label before keyword-only matches", () => {
    expect(rankCommandDestinations(destinations, "Risque")[0]?.label).toBe("Risque");
    expect(rankCommandDestinations(destinations, "risq")[0]?.label).toBe("Risque");
  });

  it("opens canonical resources by explicit typed identifier without guessing their type", () => {
    expect(directResourceDestination("signal:sig_20260829_01")?.route).toBe("/live/signals/sig_20260829_01");
    expect(directResourceDestination("ordre:poi_42")?.route).toBe("/execution/orders/poi_42");
    expect(directResourceDestination("incident#inc/42")?.route).toBe("/operations/incidents/inc%2F42");
    expect(directResourceDestination("sig_20260829_01")).toBeNull();
  });
});
