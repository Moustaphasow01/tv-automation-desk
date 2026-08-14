import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerDeskServiceWorker } from "@/pwa/registerServiceWorker";

const appRoot = resolve(__dirname, "../..");

describe("front vnext PWA shell contract", () => {
  const env = (prod: boolean): ImportMetaEnv => ({
    BASE_URL: "/",
    MODE: prod ? "production" : "test",
    DEV: !prod,
    PROD: prod,
    SSR: false
  });

  it("declares an installable operator shell without using a second mobile business model", () => {
    const manifest = JSON.parse(readFileSync(resolve(appRoot, "public/manifest.webmanifest"), "utf8"));

    expect(manifest.name).toBe("Desk Control Plane");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/?density=workstation#/command-center");
    expect(manifest.icons[0]).toMatchObject({
      src: "/icons/desk-control-plane.svg",
      sizes: "any",
      purpose: "any maskable"
    });
  });

  it("keeps market/BFF/API data outside the service-worker cache", () => {
    const serviceWorker = readFileSync(resolve(appRoot, "public/service-worker.js"), "utf8");

    expect(serviceWorker).toContain('url.pathname.startsWith("/front-api/")');
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain("les données live/BFF/API ne sont jamais mises en cache");
  });

  it("registers only in production-capable browsers", () => {
    const loadHandlers: Array<() => void> = [];
    const register = vi.fn().mockResolvedValue(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.stubGlobal("window", {
      addEventListener: (eventName: string, handler: () => void) => {
        if (eventName === "load") loadHandlers.push(handler);
      }
    });

    registerDeskServiceWorker(env(false));
    expect(loadHandlers).toHaveLength(0);

    registerDeskServiceWorker(env(true));
    expect(loadHandlers).toHaveLength(1);

    loadHandlers[0]();
    expect(register).toHaveBeenCalledWith("/service-worker.js", { scope: "/" });

    vi.unstubAllGlobals();
    warn.mockRestore();
  });
});
