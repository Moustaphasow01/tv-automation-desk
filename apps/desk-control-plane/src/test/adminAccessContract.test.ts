import { describe, expect, it } from "vitest";
import { adminAccessView, authSessionView, executionProvidersView } from "@/mocks/canonicalDataset";
import { isAdminAccessView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildAdminAccessCommand } from "@/pages/AdminAccessPage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("admin access front contract", () => {
  it("accepts the canonical Admin Access view envelope", () => {
    const envelope = assertViewEnvelope(adminAccessView, isAdminAccessView);

    expect(envelope.data.users.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.roles.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.capabilities.length).toBeGreaterThanOrEqual(8);
    expect(envelope.data.accountGroups.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(6);
  });

  it("shows read-only admin access for the current non-owner operator", () => {
    expect(adminAccessView.data.summary.accessMode).toBe("READ_ONLY");
    expect(adminAccessView.data.currentAccess.userId).toBe(authSessionView.data.principal.userId);
    expect(adminAccessView.data.currentAccess.canMutate).toBe(false);
    expect(adminAccessView.data.commandActions.find((action) => action.commandType === "admin.audit.export")?.permission).toBe("ALLOWED");
    expect(
      adminAccessView.data.commandActions
        .filter((action) => action.commandType !== "admin.audit.export")
        .every((action) => action.permission === "STEP_UP_REQUIRED" || action.permission === "DENIED")
    ).toBe(true);
  });

  it("does not expose provider sensitive material in admin data", () => {
    const serialized = JSON.stringify(adminAccessView.data).toLowerCase();

    expect(adminAccessView.data.providerAccess.every((provider) => provider.browserMaterialExposure === "NONE")).toBe(true);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("bearer");
    expect(serialized).not.toContain("api_key");
  });

  it("references known providers and known auth account scopes", () => {
    const providerIds = new Set(executionProvidersView.data.providers.map((provider) => provider.providerId));
    const authAccountIds = new Set(authSessionView.data.principal.accountScopes);

    expect(
      adminAccessView.data.providerAccess
        .filter((provider) => provider.providerId !== "provider_future_broker_api")
        .every((provider) => providerIds.has(provider.providerId))
    ).toBe(true);

    expect(
      adminAccessView.data.accountGroups
        .flatMap((group) => group.accountIds)
        .filter((accountId) => accountId !== "acct_internal_demo")
        .every((accountId) => authAccountIds.has(accountId))
    ).toBe(true);
  });

  it("submits audit export through Command Runtime with If-Match", () => {
    const action = adminAccessView.data.commandActions.find((candidate) => candidate.commandType === "admin.audit.export");
    expect(action).toBeTruthy();

    const input = buildAdminAccessCommand(action!, "Export current RBAC audit.");
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T17:00:00.000Z"),
      randomId: (() => {
        const ids = ["admin-one", "admin-two"];
        return () => ids.shift() ?? "admin-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(action!.expectedVersion);
    expect(headers["If-Match"]).toBe(action!.expectedVersion);
    expect(input.payload).toMatchObject({
      actionId: action!.actionId,
      format: "jsonl",
      readOnly: true
    });
  });

  it("requires step-up for admin mutations and rejects denied policy enable", () => {
    const invite = adminAccessView.data.commandActions.find((candidate) => candidate.commandType === "admin.user.invite");
    const denied = adminAccessView.data.commandActions.find((candidate) => candidate.commandType === "admin.policy.enable");
    expect(invite).toBeTruthy();
    expect(denied).toBeTruthy();

    expect(() => buildAdminAccessCommand(invite!, "Invite viewer", "bad-token")).toThrow("ADMIN_STEP_UP_REQUIRED");
    expect(() => buildAdminAccessCommand(denied!, "Enable policy")).toThrow("ADMIN_PERMISSION_DENIED");
    expect(() => buildAdminAccessCommand(adminAccessView.data.commandActions[0], " ")).toThrow("ADMIN_REASON_REQUIRED");

    const input = buildAdminAccessCommand(invite!, "Invite read-only research viewer.", invite!.actionId);
    expect(input.payload).toMatchObject({
      actionId: invite!.actionId,
      roleId: "role_research_viewer",
      stepUpAccepted: true
    });
  });

  it("keeps every admin command auditable by type or target", () => {
    const auditActions = new Set(adminAccessView.data.auditEvents.map((event) => event.action));

    expect(auditActions.has("admin.view.opened")).toBe(true);
    expect(auditActions.has("admin.role.change")).toBe(true);
    expect(adminAccessView.data.policies.every((policy) => policy.enabled)).toBe(true);
    expect(adminAccessView.data.policies.some((policy) => policy.confirmationMode === "DOUBLE_VALIDATION")).toBe(true);
  });
});
