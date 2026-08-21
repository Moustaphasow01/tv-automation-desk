import { afterEach, describe, expect, it, vi } from "vitest";
import { commandCenterView } from "@/mocks/canonicalDataset";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { createDeskTransport } from "@/shared/transport";
import type { DeskAppConfig } from "@/app/appConfig";

const bffConfig: DeskAppConfig = {
  dataMode: "bff",
  frontApiBaseUrl: "/front-api/v1",
  operatorAuthBaseUrl: "/api/v1/auth/operator",
  frontApiTimeoutMs: 1_000,
  features: {
    jarvisWorkspace: true
  }
};

describe("front vnext BFF transport contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads view envelopes from /front-api/v1/views/:view in BFF mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/front-api/v1/views/command-center");
      expect(init?.headers).toMatchObject({ Accept: "application/json" });

      return new Response(JSON.stringify(commandCenterView), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const envelope = await createDeskTransport(bffConfig).getView<CommandCenterView>("command-center");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(envelope.meta.correlationId).toBe(commandCenterView.meta.correlationId);
    expect(envelope.data.summary.activeStrategies).toBe(commandCenterView.data.summary.activeStrategies);
  });

  it("submits operator commands to /front-api/v1/commands with idempotency and revision headers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const body = JSON.parse(String(init?.body ?? "{}"));

      expect(String(input)).toBe("/front-api/v1/commands");
      expect(init?.method).toBe("POST");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["Idempotency-Key"]).toMatch(/^idem_risk_kill_switch_request_/);
      expect(headers["X-Correlation-ID"]).toMatch(/^corr_risk_kill_switch_request_/);
      expect(headers["X-Desk-Environment"]).toBe("PAPER");
      expect(headers["If-Match"]).toBe("risk_policy_rev_42");
      expect(body).toMatchObject({
        commandType: "risk.kill_switch.request",
        environment: "PAPER",
        expectedVersion: "risk_policy_rev_42",
        reason: "Operator E2E transport proof."
      });

      return new Response(JSON.stringify({
        commandId: "cmd_bff_transport_001",
        status: "ACCEPTED",
        correlationId: headers["X-Correlation-ID"],
        idempotencyKey: headers["Idempotency-Key"],
        acceptedAt: "2026-08-10T20:45:00.000Z"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const accepted = await createDeskTransport(bffConfig).submitCommand({
      commandType: "risk.kill_switch.request",
      environment: "PAPER",
      expectedVersion: "risk_policy_rev_42",
      reason: "Operator E2E transport proof.",
      payload: {
        mode: "PAPER",
        requestedBy: "operator"
      }
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(accepted).toMatchObject({
      commandId: "cmd_bff_transport_001",
      status: "ACCEPTED"
    });
  });

  it("keys detail reads with encoded route identifiers and reads terminal command state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("live-signal-detail")) {
        expect(url).toBe("/front-api/v1/views/live-signal-detail?signalId=signal-42");
        return new Response(JSON.stringify(commandCenterView), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      expect(url).toBe("/front-api/v1/commands/cmd-42");
      return new Response(JSON.stringify({ commandId: "cmd-42", status: "SUCCEEDED", correlationId: "corr-42", updatedAt: "2026-08-13T10:00:00.000Z" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const transport = createDeskTransport(bffConfig);
    await transport.getView("live-signal-detail", { signalId: "signal-42" });
    await expect(transport.getCommand("cmd-42")).resolves.toMatchObject({ status: "SUCCEEDED", commandId: "cmd-42" });
  });

  it("normalizes legacy MOCK page commands to PAPER before sending them to the real BFF", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const body = JSON.parse(String(init?.body ?? "{}"));

      expect(headers["X-Desk-Environment"]).toBe("PAPER");
      expect(body.environment).toBe("PAPER");

      return new Response(JSON.stringify({
        commandId: "cmd_bff_paper_001",
        status: "ACCEPTED",
        correlationId: headers["X-Correlation-ID"],
        idempotencyKey: headers["Idempotency-Key"],
        acceptedAt: "2026-08-10T20:46:00.000Z"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const accepted = await createDeskTransport(bffConfig).submitCommand({
      commandType: "live.reconciliation.request",
      environment: "MOCK",
      reason: "Legacy VNext page command before full PAPER wiring.",
      payload: { sessionId: "front_live_test" }
    });

    expect(accepted.commandId).toBe("cmd_bff_paper_001");
  });

  it("submits operator login credentials to the backend auth endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/v1/auth/operator/login");
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      expect(JSON.parse(String(init?.body))).toEqual({ login: "MSO", password: "2018" });
      return new Response(JSON.stringify({ ok: true, authenticated: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await createDeskTransport(bffConfig).loginOperator({ login: "MSO", password: "2018" });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
