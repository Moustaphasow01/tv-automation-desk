import { describe, expect, it } from "vitest";
import { authSessionView } from "@/mocks/canonicalDataset";
import { isAuthSessionView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildAuthSessionCommand } from "@/pages/AuthSessionPage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("auth session front contract", () => {
  it("accepts the canonical Auth Session view envelope", () => {
    const envelope = assertViewEnvelope(authSessionView, isAuthSessionView);

    expect(envelope.data.summary.authenticated).toBe(true);
    expect(envelope.data.environments.length).toBe(3);
    expect(envelope.data.permissions.length).toBeGreaterThanOrEqual(7);
    expect(envelope.data.routeGuards.length).toBeGreaterThanOrEqual(6);
    expect(envelope.data.commandActions.length).toBe(3);
  });

  it("models PAPER/STAGING/LIVE without enabling LIVE prematurely", () => {
    const paper = authSessionView.data.environments.find((environment) => environment.environment === "PAPER");
    const staging = authSessionView.data.environments.find((environment) => environment.environment === "STAGING");
    const live = authSessionView.data.environments.find((environment) => environment.environment === "LIVE");

    expect(paper).toMatchObject({ current: true, tradingEnabled: true, writeEnabled: true, status: "AVAILABLE" });
    expect(staging).toMatchObject({ current: false, tradingEnabled: false, writeEnabled: false, status: "READ_ONLY" });
    expect(live).toMatchObject({ current: false, tradingEnabled: false, writeEnabled: false, status: "LOCKED" });
  });

  it("does not expose sensitive browser material or import legacy auth store", () => {
    const serialized = JSON.stringify(authSessionView.data).toLowerCase();

    expect(authSessionView.data.session.httpOnlySession).toBe(true);
    expect(authSessionView.data.session.browserMaterialExposure).toBe("NONE");
    expect(authSessionView.data.session.legacyStoreImported).toBe(false);
    expect(authSessionView.data.session.csrfBinding).toBe("BOUND");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("bearer");
    expect(serialized).not.toContain("api_key");
  });

  it("keeps route guards and trading permissions capability-driven", () => {
    const decisions = new Map(authSessionView.data.permissions.map((permission) => [permission.capability, permission.decision]));
    const routeDecisions = new Map(authSessionView.data.routeGuards.map((guard) => [guard.route, guard.decision]));

    expect(decisions.get("orders.command")).toBe("ALLOW");
    expect(decisions.get("risk.emergency")).toBe("STEP_UP_REQUIRED");
    expect(decisions.get("execution.providers.switch")).toBe("STEP_UP_REQUIRED");
    expect(decisions.get("orders.create")).toBe("DENY");
    expect(routeDecisions.get("/live")).toBe("ALLOW");
    expect(routeDecisions.get("/execution/providers:switch")).toBe("STEP_UP_REQUIRED");
    expect(routeDecisions.get("/admin")).toBe("DENY");
  });

  it("submits session refresh through Command Runtime with If-Match", () => {
    const action = authSessionView.data.commandActions.find((candidate) => candidate.commandType === "auth.session.refresh");
    expect(action).toBeTruthy();

    const input = buildAuthSessionCommand(action!, "Operator is active; refresh the httpOnly session.");
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T16:40:00.000Z"),
      randomId: (() => {
        const ids = ["auth-one", "auth-two"];
        return () => ids.shift() ?? "auth-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(action!.expectedVersion);
    expect(headers["If-Match"]).toBe(action!.expectedVersion);
    expect(input.payload).toMatchObject({
      actionId: action!.actionId,
      sessionId: "sess_vnext_operator_20260810_085811",
      reasonCode: "OPERATOR_ACTIVE"
    });
  });

  it("requires step-up before logout and rejects empty reasons", () => {
    const logout = authSessionView.data.commandActions.find((candidate) => candidate.commandType === "auth.session.logout");
    expect(logout).toBeTruthy();

    expect(() => buildAuthSessionCommand(logout!, "Logout", "bad-token")).toThrow("AUTH_SESSION_STEP_UP_REQUIRED");
    expect(() => buildAuthSessionCommand(authSessionView.data.commandActions[0], " ")).toThrow("AUTH_SESSION_REASON_REQUIRED");

    const input = buildAuthSessionCommand(logout!, "Close operator session.", logout!.actionId);
    expect(input.payload).toMatchObject({
      actionId: logout!.actionId,
      sessionId: "sess_vnext_operator_20260810_085811",
      revokeRealtime: true,
      stepUpAccepted: true
    });
  });
});
