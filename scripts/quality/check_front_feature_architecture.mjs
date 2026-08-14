#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_FRONT_ARCH_ROOT || defaultRoot);
const failures = [];

const requiredFiles = [
  "src/features/live-desk/dataAccess.ts",
  "src/features/live-desk/viewModel.ts",
  "src/screens/live/LiveDeskScreen.tsx",
  "src/screens/live/tabs/SessionsTab.tsx",
  "src/test/liveDeskViewModel.test.ts",
  "src/test/deskSessionMerge.test.ts",
];

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) failures.push(`missing required front feature file: ${file}`);
}

await validateLiveDeskFeature();
await validateRuntimeFrontNoMocks();

if (failures.length) {
  console.error("[front-feature-architecture] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    feature: "live-desk",
    required_files: requiredFiles.length,
    guarded_runtime_files: (await runtimeFrontFiles()).length,
    rules: [
      "live-desk-data-access-boundary",
      "live-desk-view-model-boundary",
      "no-runtime-mock-copy",
      "no-live-screen-raw-strategy-id",
    ],
  }, null, 2));
}

async function validateLiveDeskFeature() {
  const dataAccess = await readIfPresent("src/features/live-desk/dataAccess.ts");
  const viewModel = await readIfPresent("src/features/live-desk/viewModel.ts");
  const screen = await readIfPresent("src/screens/live/LiveDeskScreen.tsx");
  const sessionsTab = await readIfPresent("src/screens/live/tabs/SessionsTab.tsx");
  const useDesk = await readIfPresent("src/hooks/useDesk.ts");

  if (!dataAccess.includes("deskApi")) failures.push("live-desk dataAccess must own deskApi calls");
  if (!dataAccess.includes("mergeLiveDeskSessionResources")) failures.push("live-desk dataAccess must expose the aggregate merge function");
  if (/from\s+["']react["']/.test(viewModel)) failures.push("live-desk viewModel must remain React-free");
  if (viewModel.includes("@/api/")) failures.push("live-desk viewModel must not import API modules");
  if (!screen.includes("buildLiveDeskScreenViewModel")) failures.push("LiveDeskScreen must consume the Live Desk ViewModel");
  if (screen.includes("@/api/") || screen.includes("@/hooks/useDesk") || screen.includes("@/lib/presentation")) {
    failures.push("LiveDeskScreen must not import API, hooks or presentation formatting directly");
  }
  if (screen.includes("data.strategyId")) failures.push("LiveDeskScreen must not render raw strategyId");
  if (sessionsTab.includes("<dd>{data.strategyId}</dd>")) failures.push("SessionsTab must not render raw strategyId");
  if (!sessionsTab.includes("sessionLabel(data.strategyId)")) failures.push("SessionsTab must present strategyId through sessionLabel");
  if (!useDesk.includes("@/features/live-desk/dataAccess")) failures.push("useDesk must delegate Live Desk reads to the feature dataAccess module");
}

async function validateRuntimeFrontNoMocks() {
  const forbidden = /\b(mock|dummy|fake|fixture)\b|sample data|demo data/i;
  for (const file of await runtimeFrontFiles()) {
    const content = await readFile(path.join(root, file), "utf8");
    const suspicious = content
      .split(/\r?\n/)
      .filter(line => forbidden.test(line))
      .filter(line => !/\b(aucun|sans|no)\s+mock\b/i.test(line));
    if (suspicious.length) failures.push(`${file}: runtime front contains mock/demo wording`);
  }
}

async function runtimeFrontFiles() {
  const files = [];
  await collect(path.join(root, "src"), files);
  return files
    .map(file => path.relative(root, file).replaceAll(path.sep, "/"))
    .filter(file => /\.(ts|tsx)$/.test(file))
    .filter(file => !file.startsWith("src/test/"))
    .filter(file => !file.endsWith(".d.ts"));
}

async function collect(directory, files) {
  if (!existsSync(directory)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist"].includes(entry.name)) continue;
      await collect(full, files);
    } else {
      files.push(full);
    }
  }
}

async function readIfPresent(file) {
  const full = path.join(root, file);
  if (!existsSync(full)) return "";
  return readFile(full, "utf8");
}
