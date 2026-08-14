import { describe, expect, it } from "vitest";
import { authSessionView, operatorSettingsView } from "@/mocks/canonicalDataset";
import { isOperatorSettingsView } from "@/domains/front-api/viewModels";
import { buildCommandHeaders, prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { buildOperatorSettingsCommand } from "@/pages/OperatorSettingsPage";
import { assertViewEnvelope } from "@/shared/contracts";

describe("operator settings front contract", () => {
  it("accepts the canonical Operator Settings view envelope", () => {
    const envelope = assertViewEnvelope(operatorSettingsView, isOperatorSettingsView);

    expect(envelope.data.cockpitPreferences.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.widgets.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.notificationRules.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.devices.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps optimistic UI limited to non-critical cockpit preferences", () => {
    expect(operatorSettingsView.data.cockpitPreferences.every((preference) => preference.critical === false)).toBe(true);
    expect(operatorSettingsView.data.cockpitPreferences.every((preference) => preference.optimisticAllowed)).toBe(true);

    const nonOptimisticCommands = operatorSettingsView.data.commandActions.filter((action) => !action.optimisticAllowed);
    expect(nonOptimisticCommands.some((action) => action.commandType === "settings.device.revoke")).toBe(true);
    expect(nonOptimisticCommands.some((action) => action.commandType === "settings.voice.test")).toBe(true);
  });

  it("does not expose sensitive browser material in settings data", () => {
    const serialized = JSON.stringify(operatorSettingsView.data).toLowerCase();

    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("bearer");
    expect(serialized).not.toContain("api_key");
  });

  it("keeps business and risk controls outside Settings", () => {
    expect(operatorSettingsView.data.commandActions.every((action) => action.commandType.startsWith("settings."))).toBe(true);
    expect(operatorSettingsView.data.guardrails.find((guardrail) => guardrail.guardrailId === "guard_no_risk_mutation")?.status).toBe("PASS");
    expect(operatorSettingsView.data.guardrails.find((guardrail) => guardrail.guardrailId === "guard_no_execution_mutation")?.status).toBe("PASS");
  });

  it("keeps device/session references coherent with Auth Session", () => {
    const authSessionId = authSessionView.data.session.sessionId;
    const authAccountScopes = new Set(authSessionView.data.principal.accountScopes);

    expect(operatorSettingsView.data.devices.some((device) => device.sessionId === authSessionId)).toBe(true);
    expect(operatorSettingsView.data.summary.activeDevices).toBe(
      operatorSettingsView.data.devices.filter((device) => device.state === "ACTIVE").length
    );
    expect([...authAccountScopes]).toEqual(expect.arrayContaining(["acct_sim101_main", "acct_pickmytrade_demo"]));
  });

  it("submits preference save through Command Runtime with If-Match", () => {
    const action = operatorSettingsView.data.commandActions.find((candidate) => candidate.commandType === "settings.preferences.save");
    expect(action).toBeTruthy();

    const input = buildOperatorSettingsCommand(action!, "Save non-critical cockpit preferences.");
    const prepared = prepareDeskCommand(input, {
      now: () => new Date("2026-08-10T16:50:00.000Z"),
      randomId: (() => {
        const ids = ["settings-one", "settings-two"];
        return () => ids.shift() ?? "settings-fallback";
      })()
    });
    const headers = buildCommandHeaders(prepared) as Record<string, string>;

    expect(input.environment).toBe("MOCK");
    expect(input.expectedVersion).toBe(action!.expectedVersion);
    expect(headers["If-Match"]).toBe(action!.expectedVersion);
    expect(input.payload).toMatchObject({
      actionId: action!.actionId,
      preferenceScope: "cockpit",
      optimisticAllowed: true,
      optimistic: true
    });
  });

  it("requires step-up for device revoke and rejects empty reasons", () => {
    const revoke = operatorSettingsView.data.commandActions.find((candidate) => candidate.commandType === "settings.device.revoke");
    expect(revoke).toBeTruthy();

    expect(() => buildOperatorSettingsCommand(revoke!, "Revoke device", "bad-token")).toThrow("SETTINGS_STEP_UP_REQUIRED");
    expect(() => buildOperatorSettingsCommand(operatorSettingsView.data.commandActions[0], " ")).toThrow("SETTINGS_REASON_REQUIRED");

    const input = buildOperatorSettingsCommand(revoke!, "Revoke stale mobile observer.", revoke!.actionId);
    expect(input.payload).toMatchObject({
      actionId: revoke!.actionId,
      deviceId: "dev_mobile_watch",
      revokeSessions: true,
      optimisticAllowed: false,
      stepUpAccepted: true
    });
  });
});
