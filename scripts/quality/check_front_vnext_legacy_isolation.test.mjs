import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkFrontVNextLegacyIsolation } from "./check_front_vnext_legacy_isolation.mjs";

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("checkFrontVNextLegacyIsolation", () => {
  it("accepts imports that stay inside the VNext app", () => {
    const repoRoot = createTempRepo();
    mkdirSync(path.join(repoRoot, "apps/desk-control-plane/src/app"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "apps/desk-control-plane/src/app/App.tsx"),
      "import { thing } from './inside';\nexport const App = thing;\n"
    );
    writeFileSync(
      path.join(repoRoot, "apps/desk-control-plane/src/app/inside.ts"),
      "export const thing = 'ok';\n"
    );

    const result = checkFrontVNextLegacyIsolation({ repoRoot });

    assert.equal(result.ok, true);
    assert.equal(result.violations.length, 0);
  });

  it("fails on an intentionally injected import from the legacy root", () => {
    const repoRoot = createTempRepo();
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "apps/desk-control-plane/src/app"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src/App.tsx"), "export const Legacy = 'legacy';\n");
    writeFileSync(
      path.join(repoRoot, "apps/desk-control-plane/src/app/App.tsx"),
      "import { Legacy } from '../../../../src/App';\nexport const App = Legacy;\n"
    );

    const result = checkFrontVNextLegacyIsolation({ repoRoot });

    assert.equal(result.ok, false);
    assert.deepEqual(result.violations.map((violation) => violation.reason), [
      "FRONT_VNEXT_IMPORT_OUTSIDE_APP"
    ]);
  });
});

function createTempRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "front-vnext-guard-"));
  tempRoots.push(repoRoot);
  return repoRoot;
}
