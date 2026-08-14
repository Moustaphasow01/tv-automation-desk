#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_FRONT_VNEXT_DATA_MODE_ROOT || defaultRoot);

export function checkFrontVNextRuntimeDataMode({ repoRoot = root } = {}) {
  const failures = [];
  const appConfig = readRequired(repoRoot, "apps/desk-control-plane/src/app/appConfig.ts", failures);
  const dockerfile = readRequired(repoRoot, "infra/docker/control-plane.Dockerfile", failures);
  const compose = readRequired(repoRoot, "docker-compose.yml", failures);
  const readme = readRequired(repoRoot, "apps/desk-control-plane/README.md", failures);

  if (appConfig) {
    if (!appConfig.includes('const dataMode: DeskDataMode = "bff"')) {
      failures.push("appConfig must pin runtime data mode to the real BFF");
    }
    if (/VITE_DATA_MODE[^\n]*(?:mock|\"mock\")/i.test(appConfig)) {
      failures.push("appConfig must not expose a production mock data override");
    }
  }

  if (dockerfile && !/ARG\s+VITE_DATA_MODE=bff\b/.test(dockerfile)) {
    failures.push("control-plane Dockerfile must build with VITE_DATA_MODE=bff by default");
  }

  if (compose && !/VITE_DATA_MODE:\s*bff\b/.test(compose)) {
    failures.push("docker-compose control-plane service must pass VITE_DATA_MODE: bff");
  }

  if (readme) {
    if (!/BFF réel par défaut/i.test(readme)) {
      failures.push("README must document that VNext uses the real BFF by default");
    }
    if (!/fixtures.*tests? uniquement/i.test(readme)) {
      failures.push("README must document that fixtures are test-only and never a runtime mode");
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function readRequired(repoRoot, relativePath, failures) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!existsSync(fullPath)) {
    failures.push(`missing required file: ${relativePath}`);
    return "";
  }
  return readFileSync(fullPath, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkFrontVNextRuntimeDataMode();
  if (!result.ok) {
    console.error("[front-vnext-runtime-data-mode] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      ok: true,
      rules: [
        "vnext-defaults-to-real-bff",
        "mock-fixtures-are-test-only",
        "docker-control-plane-builds-bff",
      ],
    }, null, 2));
  }
}
