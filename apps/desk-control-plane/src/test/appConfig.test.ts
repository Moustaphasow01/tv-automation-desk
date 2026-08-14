import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl, readDeskAppConfig } from "@/app/appConfig";

describe("readDeskAppConfig", () => {
  it("defaults to BFF mode and canonical BFF base", () => {
    expect(readDeskAppConfig({} as ImportMetaEnv)).toMatchObject({
      dataMode: "bff",
      frontApiBaseUrl: "/front-api/v1",
      frontApiTimeoutMs: 12_000,
      features: {
        jarvisWorkspace: true
      }
    });
  });

  it("refuses to activate mock runtime mode even when requested", () => {
    expect(readDeskAppConfig({ VITE_DATA_MODE: "mock" } as ImportMetaEnv)).toMatchObject({
      dataMode: "bff",
      frontApiBaseUrl: "/front-api/v1"
    });
  });

  it("accepts BFF mode and trims trailing slashes", () => {
    expect(
      readDeskAppConfig({
        VITE_DATA_MODE: "bff",
        VITE_FRONT_API_BASE_URL: "https://desk.example/front-api/v1///",
        VITE_FRONT_API_TIMEOUT_MS: "4500",
        VITE_FEATURE_JARVIS_WORKSPACE: "false"
      } as ImportMetaEnv)
    ).toMatchObject({
      dataMode: "bff",
      frontApiBaseUrl: "https://desk.example/front-api/v1",
      frontApiTimeoutMs: 4500,
      features: {
        jarvisWorkspace: false
      }
    });
  });
});

describe("normalizeApiBaseUrl", () => {
  it("normalizes empty values", () => {
    expect(normalizeApiBaseUrl(undefined)).toBe("/front-api/v1");
    expect(normalizeApiBaseUrl("")).toBe("/front-api/v1");
  });
});
