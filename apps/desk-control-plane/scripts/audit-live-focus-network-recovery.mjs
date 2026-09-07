import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetUrl = process.argv[2] || "http://127.0.0.1:8096/#/live?instrument=ZW&focus=1";
const outputRoot = resolve(process.env.DESK_NETWORK_AUDIT_OUTPUT || "output/playwright/live-focus-network");
mkdirSync(outputRoot, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH || undefined,
});

const report = {
  target: targetUrl,
  generatedAt: new Date().toISOString(),
  readOnly: true,
  probes: [],
};

try {
  const context = await browser.newContext({
    timezoneId: "Europe/Paris",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await loginIfNeeded(page);
  await page.locator(".live-focus").waitFor({ state: "visible", timeout: 90_000 });
  await page.locator(".live-focus__queue").waitFor({ state: "visible", timeout: 90_000 });

  const endpoint = new URL("/front-api/v1/views/live-focus", targetUrl);
  endpoint.searchParams.set("instrument", "ZW");
  for (let index = 0; index < 10; index += 1) {
    const startedAt = Date.now();
    const response = await context.request.get(endpoint.toString(), { timeout: 90_000 });
    const body = response.ok() ? await response.json() : null;
    report.probes.push({
      index,
      status: response.status(),
      latencyMs: Date.now() - startedAt,
      availability: body?.meta?.availability ?? null,
      stale: body?.meta?.stale ?? null,
      sources: normalizeSources(body?.meta?.sources),
      warnings: sanitizeWarnings(body?.meta?.warnings),
    });
    await page.waitForTimeout(1_100);
  }

  expect(report.probes.every((probe) => probe.status === 200)).toBeTruthy();
  const watchedSources = report.probes.flatMap((probe) => probe.sources)
    .filter((source) => ["live-session", "front-macro", "front-news"].includes(source.name));
  expect(watchedSources.length).toBeGreaterThan(0);
  expect(watchedSources.every((source) => !["UNAVAILABLE", "ERROR"].includes(source.availability))).toBeTruthy();

  const focus = page.locator(".live-focus");
  const projectionBefore = await focus.innerText();
  report.beforeOffline = {
    textSha256: createHash("sha256").update(projectionBefore).digest("hex"),
    chars: projectionBefore.length,
  };

  await context.setOffline(true);
  const offline = page.locator('.live-focus-connectivity[data-kind="offline"]');
  await expect(offline).toBeVisible({ timeout: 10_000 });
  await expect(offline).toContainText("Réseau indisponible");
  await expect(offline).toContainText("Dernière projection connue");
  await expect(focus).toBeVisible();
  const activeSensitiveActions = await page.locator(
    '.live-focus button[data-intent="confirm"]:not([disabled]), .live-focus button[data-intent="reject"]:not([disabled])',
  ).count();
  expect(activeSensitiveActions).toBe(0);
  report.offline = {
    banner: await offline.innerText(),
    projectionStillVisible: await focus.isVisible(),
    sensitiveActionsEnabled: activeSensitiveActions,
  };
  await page.screenshot({ path: resolve(outputRoot, "live-focus-offline.png"), fullPage: true });

  await context.setOffline(false);
  await expect(offline).toBeHidden({ timeout: 90_000 });
  await expect(focus).toBeVisible();
  report.recovered = {
    bannerHidden: await offline.isHidden(),
    projectionVisible: await focus.isVisible(),
  };
  report.pageErrors = pageErrors;
  report.passed = pageErrors.length === 0;
  expect(report.passed).toBeTruthy();
  await page.screenshot({ path: resolve(outputRoot, "live-focus-recovered.png"), fullPage: true });
  await context.close();
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(outputRoot, "network-recovery-audit.json"), JSON.stringify(report, null, 2));
  await browser.close();
}

if (report.passed) {
  console.log(`Live Focus network recovery passed: ${report.probes.length}/10 BFF probes, offline state and recovery verified.`);
}

async function loginIfNeeded(page) {
  const login = page.getByLabel(/identifiant/i);
  await Promise.race([
    login.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    page.locator(".live-focus").waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
  ]);
  if (await page.locator(".live-focus").isVisible()) return;
  if (!(await login.isVisible())) throw new Error("Neither login nor Live Focus available.");
  await login.fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
  await page.getByLabel(/mot de passe/i).fill(process.env.DESK_OPERATOR_PASSWORD || "2018");
  await page.getByRole("button", { name: /entrer dans le desk/i }).click();
}

function normalizeSources(sources) {
  if (Array.isArray(sources)) {
    return sources.map((source) => ({
      name: String(source?.source || source?.name || "unknown"),
      availability: String(source?.availability || source?.state || source?.status || "UNKNOWN"),
      stale: source?.stale ?? null,
      latencyMs: source?.latencyMs ?? null,
    }));
  }
  if (sources && typeof sources === "object") {
    return Object.entries(sources).map(([name, source]) => ({
      name,
      availability: String(source?.availability || source?.state || source?.status || "UNKNOWN"),
      stale: source?.stale ?? null,
      latencyMs: source?.latencyMs ?? null,
    }));
  }
  return [];
}

function sanitizeWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  return warnings.map((warning) => String(warning).replace(/password|token|secret|pin/gi, "[REDACTED]").slice(0, 240));
}
