import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeskAppConfig } from "@/app/appConfig";
import {
  clearPersistedRealtimeCursor,
  loadPersistedRealtimeState,
  persistRealtimeCursor,
  realtimeCursorStorageKey,
} from "@/domains/realtime/RealtimeProvider";

const config: DeskAppConfig = {
  dataMode: "bff",
  frontApiBaseUrl: "/front-api/v1",
  operatorAuthBaseUrl: "/api/v1/auth/operator",
  frontApiTimeoutMs: 1_000,
  features: { jarvisWorkspace: true },
};

describe("realtime cursor persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("persists only the opaque event id in a deployment-scoped browser key", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      location: { origin: "https://desk.example" },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    persistRealtimeCursor(config, "domain_evt_42");

    const key = realtimeCursorStorageKey(config);
    expect(key).toContain("https://desk.example:/front-api/v1");
    expect(values.get(key)).toBe('{"eventId":"domain_evt_42"}');
    expect(loadPersistedRealtimeState(config).lastEventId).toBe("domain_evt_42");

    clearPersistedRealtimeCursor(config);
    expect(loadPersistedRealtimeState(config).lastEventId).toBeNull();
  });

  it("fails closed to an empty cursor when persisted storage is malformed", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://desk.example" },
      localStorage: {
        getItem: () => "not-json",
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });

    expect(loadPersistedRealtimeState(config).lastEventId).toBeNull();
  });
});
