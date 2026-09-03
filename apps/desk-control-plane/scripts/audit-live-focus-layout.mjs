import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

const targetUrl = process.argv[2] || "http://127.0.0.1:4173/#/live?focus=1";
const outputRoot = resolve("output/playwright/live-focus-layout");
mkdirSync(outputRoot, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH || undefined,
});

const results = [];
try {
  const context = await browser.newContext();
  for (const viewport of viewports) {
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page);
    await page.waitForSelector(".live-focus", { timeout: 60_000 });
    await page.screenshot({
      path: resolve(outputRoot, `live-focus-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
    results.push(await page.evaluate(auditLiveFocusLayout, viewport));
    await page.close();
  }
  await context.close();
} finally {
  await browser.close();
}

writeFileSync(resolve(outputRoot, "live-focus-layout-audit.json"), JSON.stringify(results, null, 2));

const failures = results.flatMap((result) => result.failures.map((failure) => `${result.viewport.width}x${result.viewport.height} — ${failure}`));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Live Focus layout audit passed for ${results.length} viewport(s).`);
}

async function loginIfNeeded(page) {
  const loginInput = page.getByLabel(/identifiant/i);
  await Promise.race([
    loginInput.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    page.locator(".live-focus").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  ]);
  if ((await page.locator(".live-focus").isVisible().catch(() => false))) return;
  if (!(await loginInput.isVisible().catch(() => false))) return;
  await loginInput.fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
  await page.getByLabel(/mot de passe/i).fill(process.env.DESK_OPERATOR_PASSWORD || "2018");
  await page.getByRole("button", { name: /entrer dans le desk|connexion|connecter|login|entrer/i }).click();
  await page.locator(".live-focus").waitFor({ state: "visible", timeout: 30_000 }).catch(async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
  });
}

function auditLiveFocusLayout(viewport) {
  const failures = [];
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const ownText = (element) => Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim() || "")
    .join("")
    .trim();

  const styles = Array.from(document.styleSheets).flatMap((sheet) => {
    try {
      return Array.from(sheet.cssRules).map((rule) => rule.cssText);
    } catch {
      return [];
    }
  }).filter((rule) => rule.includes(".live-focus")).join("\n");

  if (/line-clamp|-webkit-box/.test(styles)) failures.push("troncature dure interdite détectée dans les styles Focus");

  document.querySelectorAll(".live-focus *, .live-focus-drawer *").forEach((element) => {
    if (!visible(element) || !ownText(element)) return;
    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    if (Number.isFinite(size) && size < 12) failures.push(`texte sous 12px: ${element.className || element.tagName} = ${size}px`);
  });

  document.querySelectorAll(".live-focus button, .live-focus a[href], .live-focus summary").forEach((element) => {
    if (!visible(element)) return;
    const rect = element.getBoundingClientRect();
    if (rect.height < 44 || rect.width < 44) failures.push(`cible interactive ${Math.round(rect.width)}×${Math.round(rect.height)} sous 44×44`);
  });

  document.querySelectorAll(".live-focus__body > section, .live-focus__ticket").forEach((element) => {
    if (element.classList.contains("live-focus__brief")) return;
    if (element.scrollHeight > element.clientHeight + 2) failures.push(`${element.className || element.tagName} masque ${element.scrollHeight - element.clientHeight}px`);
  });

  const yScrollers = Array.from(document.querySelectorAll(".live-focus *"))
    .filter((element) => visible(element))
    .filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY))
    .filter((element) => element.scrollHeight > element.clientHeight + 2)
    .map((element) => element.className || element.tagName);
  const unexpectedScrollers = yScrollers.filter((name) => !String(name).includes("live-focus__brief"));
  if (unexpectedScrollers.length) failures.push(`zones verticales défilantes inattendues: ${unexpectedScrollers.join(", ")}`);

  document.querySelectorAll(".live-focus__ticket > div").forEach((cell) => {
    const label = cell.querySelector("small");
    const value = cell.querySelector("strong");
    if (!label || !value || !visible(label) || !visible(value)) return;
    const labelRect = label.getBoundingClientRect();
    const valueRect = value.getBoundingClientRect();
    const separated = valueRect.top - labelRect.bottom >= 5.5 || valueRect.left - labelRect.right >= 5.5;
    if (!separated) failures.push(`étiquette collée à la valeur: ${label.textContent}`);
  });

  const priceSizes = Array.from(document.querySelectorAll(".live-focus__ticket .is-market-level strong"))
    .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    .filter(Number.isFinite);
  const otherActionSizes = Array.from(document.querySelectorAll(".live-focus__decision *:not(.is-market-level strong)"))
    .filter((element) => visible(element) && ownText(element))
    .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    .filter(Number.isFinite);
  if (priceSizes.length && Math.max(...otherActionSizes, 0) > Math.max(...priceSizes)) {
    failures.push("les prix ne sont pas la plus forte hiérarchie typographique du ticket");
  }

  return { viewport, failures };
}
