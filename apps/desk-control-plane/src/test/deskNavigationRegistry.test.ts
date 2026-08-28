import { describe, expect, it } from "vitest";
import { vnextRoutes } from "@/app/routes";
import { DESK_NAVIGATION_SECTIONS, deskPrimaryNavigation } from "@/shell/navigation";

describe("desk primary navigation registry", () => {
  it("derives every primary destination from a registered static route", () => {
    const paths = new Set(vnextRoutes.map((route) => route.path));
    expect(deskPrimaryNavigation.every((item) => paths.has(item.to.slice(1)))).toBe(true);
    expect(deskPrimaryNavigation.every((item) => !item.to.includes(":"))).toBe(true);
    expect(new Set(deskPrimaryNavigation.map((item) => item.to)).size).toBe(deskPrimaryNavigation.length);
    expect(deskPrimaryNavigation.every((item) => item.capability.length > 0)).toBe(true);
  });

  it("keeps all task sections and explicit mobile priorities reachable", () => {
    expect(DESK_NAVIGATION_SECTIONS.every((section) => deskPrimaryNavigation.some((item) => item.section === section))).toBe(true);
    expect(deskPrimaryNavigation.filter((item) => item.mobile).map((item) => item.to)).toEqual([
      "/command-center",
      "/live",
      "/orders",
      "/execution/incidents",
    ]);
  });
});
