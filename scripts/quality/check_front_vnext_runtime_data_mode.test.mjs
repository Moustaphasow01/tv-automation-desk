import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { checkFrontVNextRuntimeDataMode } from "./check_front_vnext_runtime_data_mode.mjs";

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("checkFrontVNextRuntimeDataMode", () => {
  it("accepts the current repository BFF-first VNext policy", () => {
    const result = checkFrontVNextRuntimeDataMode();

    assert.equal(result.ok, true, result.failures.join("\n"));
  });

  it("rejects a VNext app that silently defaults to mock data", () => {
    const repoRoot = makeFixture({
      appConfig: 'const dataMode = env.VITE_DATA_MODE === "bff" ? "bff" : "mock";\n',
      dockerfile: "ARG VITE_DATA_MODE=mock\n",
      compose: "services:\n  control-plane:\n    build:\n      args:\n        VITE_DATA_MODE: mock\n",
      readme: "mode de données sélectionnable avec VITE_DATA_MODE=mock|bff\n",
    });

    const result = checkFrontVNextRuntimeDataMode({ repoRoot });

    assert.equal(result.ok, false);
    assert.match(result.failures.join("\n"), /must pin runtime data mode|must not expose a production mock/);
    assert.match(result.failures.join("\n"), /Dockerfile must build with VITE_DATA_MODE=bff/);
  });

  it("rejects a runtime mock opt-in even when BFF is the default", () => {
    const repoRoot = makeFixture({
      appConfig: 'type DeskDataMode = "mock" | "bff"; const dataMode = env.VITE_DATA_MODE === "mock" ? "mock" : "bff";\n',
      dockerfile: "ARG VITE_DATA_MODE=bff\n",
      compose: "services:\n  control-plane:\n    build:\n      args:\n        VITE_DATA_MODE: bff\n",
      readme: "BFF réel par défaut. Fixtures dans les tests uniquement.\n",
    });
    const result = checkFrontVNextRuntimeDataMode({ repoRoot });
    assert.equal(result.ok, false);
    assert.match(result.failures.join("\n"), /must pin runtime data mode|must not expose a production mock/);
  });
});

function makeFixture({ appConfig, dockerfile, compose, readme }) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "front-vnext-data-mode-"));
  tempRoots.push(repoRoot);
  mkdirSync(path.join(repoRoot, "apps/desk-control-plane/src/app"), { recursive: true });
  mkdirSync(path.join(repoRoot, "apps/desk-control-plane"), { recursive: true });
  mkdirSync(path.join(repoRoot, "infra/docker"), { recursive: true });
  writeFileSync(path.join(repoRoot, "apps/desk-control-plane/src/app/appConfig.ts"), appConfig);
  writeFileSync(path.join(repoRoot, "infra/docker/control-plane.Dockerfile"), dockerfile);
  writeFileSync(path.join(repoRoot, "docker-compose.yml"), compose);
  writeFileSync(path.join(repoRoot, "apps/desk-control-plane/README.md"), readme);
  return repoRoot;
}
