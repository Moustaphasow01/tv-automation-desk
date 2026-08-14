import { describe, expect, it } from "vitest";
import { groupRoutesByNavigation, vnextRoutes } from "@/app/routes";

describe("vnextRoutes", () => {
  it("declares the complete V2 information architecture without duplicates", () => {
    const paths = vnextRoutes.map((route) => route.path);

    expect(paths.length).toBeGreaterThanOrEqual(59);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(
      expect.arrayContaining([
        "auth",
        "command-center",
        "operations",
        "events",
        "research",
        "research/experiments/:experimentId",
        "research/runs/:runId",
        "research/agents",
        "research/data",
        "research/compute",
        "strategies",
        "strategies/:strategyId",
        "strategies/:strategyId/compare",
        "live",
        "demo-paper-readiness",
        "live/signals/:signalId",
        "portfolio",
        "orders",
        "risk",
        "execution/providers",
        "execution/incidents",
        "jarvis",
        "settings",
        "admin"
        ,"sessions"
        ,"live/news"
        ,"research/candidates"
        ,"replay/runs/:runId"
        ,"performance/days/:dayId"
        ,"operations/workflows/:workflowId"
        ,"execution/orders/:orderId"
        ,"execution/portfolio/positions/:positionId"
        ,"governance/prompts"
      ])
    );
  });

  it("routes BFF-backed control plane views through /views contracts", () => {
    const bffRoutes = vnextRoutes.filter((route) => route.viewEndpoint);

    expect(bffRoutes.map((route) => route.viewEndpoint)).toEqual(
      expect.arrayContaining([
        "/views/auth-session",
        "/views/operator-settings",
        "/views/admin-access",
        "/views/command-center",
        "/views/demo-paper-readiness",
        "/views/research-lab",
        "/views/strategy-center",
        "/views/strategy-detail",
        "/views/strategy-compare",
        "/views/live-trading",
        "/views/live-signal-detail",
        "/views/orders",
        "/views/risk",
        "/views/execution-providers",
        "/views/execution-incidents",
        "/views/portfolio",
        "/views/sessions",
        "/views/live-plan",
        "/views/live-news",
        "/views/live-timeline",
        "/views/execution-reconciliation",
        "/views/operations-observability",
        "/views/research-experiments",
        "/views/research-candidates",
        "/views/research-dataset-detail",
        "/views/strategy-deployments",
        "/views/replay-overview",
        "/views/replay-runs",
        "/views/replay-run-detail",
        "/views/replay-compare",
        "/views/performance-overview",
        "/views/performance-calendar",
        "/views/performance-day-detail",
        "/views/performance-strategies",
        "/views/performance-trades",
        "/views/workflow-detail",
        "/views/event-detail",
        "/views/operations-runbooks",
        "/views/governance-prompts",
        "/views/governance-policies",
        "/views/jarvis-workspace"
      ])
    );
  });

  it("has no route left in a backend-gap placeholder state", () => {
    expect(vnextRoutes.filter((route) => route.status === "backend-gap")).toEqual([]);
    expect(vnextRoutes.every((route) => Boolean(route.viewEndpoint))).toBe(true);
  });

  it("keeps every navigation group reachable", () => {
    const grouped = groupRoutesByNavigation();

    expect(Object.values(grouped).every((routes) => routes.length > 0)).toBe(true);
  });

  it("declares a backend-resolved capability for every route", () => {
    expect(vnextRoutes.every((route) => route.capability.length > 0)).toBe(true);
    expect(vnextRoutes.filter((route) => route.status === "foundation").some((route) => route.capability === "front.read")).toBe(false);
    expect(vnextRoutes.filter((route) => route.capability === "front.read").every((route) => route.status === "backend-gap")).toBe(true);
  });
});
