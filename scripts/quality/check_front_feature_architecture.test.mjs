import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_front_feature_architecture.mjs");

describe("front feature architecture guard", () => {
  it("passes on the current repository front architecture", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"feature": "live-desk"/);
  });

  it("rejects runtime mocks and raw strategy IDs in live screens", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-front-arch-"));
    try {
      await writeFixture(fixtureRoot, {
        liveScreen: "import { buildLiveDeskScreenViewModel } from '@/features/live-desk/viewModel';\nexport const x = 'ok';\n",
        sessionsTab: "export function x(data) { return <dd>{data.strategyId}</dd>; }\n",
        extraRuntime: "export const fake = 'mock';\n",
      });
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /SessionsTab must not render raw strategyId/);
      assert.match(result.stderr, /runtime front contains mock\/demo wording/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    env: { ...process.env, DESK_FRONT_ARCH_ROOT: root },
    encoding: "utf8",
  });
}

async function writeFixture(root, values) {
  await mkdir(path.join(root, "src/features/live-desk"), { recursive: true });
  await mkdir(path.join(root, "src/screens/live/tabs"), { recursive: true });
  await mkdir(path.join(root, "src/hooks"), { recursive: true });
  await mkdir(path.join(root, "src/test"), { recursive: true });
  await writeFile(path.join(root, "src/features/live-desk/dataAccess.ts"), "import { deskApi } from '@/api/deskApi';\nexport function mergeLiveDeskSessionResources() { return deskApi; }\n");
  await writeFile(path.join(root, "src/features/live-desk/viewModel.ts"), "export function buildLiveDeskScreenViewModel() { return {}; }\n");
  await writeFile(path.join(root, "src/screens/live/LiveDeskScreen.tsx"), values.liveScreen);
  await writeFile(path.join(root, "src/screens/live/tabs/SessionsTab.tsx"), values.sessionsTab);
  await writeFile(path.join(root, "src/hooks/useDesk.ts"), "import '@/features/live-desk/dataAccess';\n");
  await writeFile(path.join(root, "src/test/liveDeskViewModel.test.ts"), "export {};\n");
  await writeFile(path.join(root, "src/test/deskSessionMerge.test.ts"), "export {};\n");
  await writeFile(path.join(root, "src/RuntimeThing.ts"), values.extraRuntime);
}
