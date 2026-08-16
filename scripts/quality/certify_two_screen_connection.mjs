import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.DESK_VNEXT_BASE_URL || "http://127.0.0.1:8090";
const outputRoot = resolve("output/playwright/two-screen-closure");
const executablePath = process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH;
const screens = [
  { name: "command-center", route: "command-center", selector: ".cc-page", view: "command-center" },
  { name: "live-trading", route: "live", selector: ".lt-page", view: "live-trading" },
];

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const results = [];
try {
  for (const screen of screens) results.push(await auditScreen(browser, screen));
} finally {
  await browser.close();
}

const sse = await auditSse();
const networkSummary = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  screens: results.map(({ screenshotPath: _screenshotPath, ...result }) => result),
  sse,
};
await writeFile(resolve(outputRoot, "network-summary.json"), `${JSON.stringify(networkSummary, null, 2)}\n`);

const failures = results.flatMap((result) => result.failures.map((failure) => `${result.name}: ${failure}`));
if (sse.resyncEventType !== "desk.resync_required") failures.push("SSE: expired cursor did not require resync");
if (sse.nominalEventCount < 1) failures.push("SSE: nominal stream emitted no domain event");
console.log(`Two-screen connection certification: ${failures.length ? "FAILED" : "PASSED"}`);
for (const result of results) console.log(`${result.name}: HTTP ${result.viewStatus} · BFF=${result.bffRequestCount} · console=${result.consoleErrors.length} · genericUnavailable=${result.genericUnavailable.length} · deepLinks=${result.deepLinks.length}`);
console.log(`SSE: nominal=${sse.nominalEventCount} · resync=${sse.resyncEventType || "missing"}`);
if (failures.length) {
  failures.forEach((failure) => console.error(failure));
  process.exitCode = 1;
}

async function auditScreen(browserInstance, screen) {
  const context = await browserInstance.newContext({ viewport: { width: 1672, height: 941 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const requests = [];
  const responses = [];
  const consoleErrors = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url(), resourceType: request.resourceType() }));
  page.on("response", async (response) => responses.push({ status: response.status(), url: response.url(), contentType: response.headers()["content-type"] || null }));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const viewResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/front-api/v1/views/${screen.view}`),
    { timeout: 45_000 },
  );
  await page.goto(`${baseUrl}/#/${screen.route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator(screen.selector).waitFor({ state: "visible", timeout: 45_000 });
  const awaitedViewResponse = await viewResponsePromise;
  await page.waitForTimeout(250);
  const screenshotPath = resolve(outputRoot, `${screen.name}-full.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const dom = await page.evaluate(() => {
    const text = document.body.innerText;
    const visible = (node) => {
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return {
      text,
      genericUnavailable: [...new Set(text.match(/\b(?:UNAVAILABLE|UNKNOWN|NOT_IMPLEMENTED)\b/g) || [])],
      absenceLines: text.split("\n").map((line) => line.trim()).filter((line) => /\b(?:UNAVAILABLE|UNKNOWN|NOT_IMPLEMENTED)\b/.test(line)),
      truthStates: [...new Set(text.match(/\b(?:CONNECTED|EMPTY|STALE|DEGRADED|DISABLED|MARKET CLOSED|SEMI_MANUAL|SHADOW|PAPER|LIVE|OFF)\b/g) || [])],
      deepLinks: [...document.querySelectorAll("a[href]")].filter(visible).map((node) => node.getAttribute("href")).filter(Boolean),
      editablePostRiskCount: document.querySelectorAll(".lt-panel--intent input,.lt-panel--intent select,.lt-panel--intent textarea,[contenteditable='true']").length,
      enabledHumanGateActions: [...document.querySelectorAll(".lt-gate-actions button")].filter((node) => !node.disabled).length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  const viewResponse = responses.find((response) => response.url.includes(`/front-api/v1/views/${screen.view}`)) || {
    status: awaitedViewResponse.status(),
    url: awaitedViewResponse.url(),
  };
  const forbiddenRequests = requests.filter((request) => /provider|broker|postgres|worker/i.test(new URL(request.url).pathname) && !request.url.includes("/front-api/"));
  const failedResponses = responses.filter((response) => response.status >= 400);
  const failures = [];
  if (!viewResponse) failures.push(`missing BFF view request ${screen.view}`);
  if (viewResponse && viewResponse.status !== 200) failures.push(`BFF view HTTP ${viewResponse.status}`);
  if (consoleErrors.length) failures.push(`${consoleErrors.length} console error(s)`);
  if (forbiddenRequests.length) failures.push(`${forbiddenRequests.length} forbidden direct request(s)`);
  if (failedResponses.length) failures.push(`${failedResponses.length} HTTP failure(s)`);
  if (dom.horizontalOverflow) failures.push("horizontal overflow");
  if (screen.name === "live-trading" && dom.editablePostRiskCount) failures.push("post-Risk field is editable");

  await context.close();
  return {
    name: screen.name,
    screenshotPath,
    viewStatus: viewResponse?.status || null,
    bffRequestCount: requests.filter((request) => request.url.includes("/front-api/")).length,
    requests,
    responses,
    consoleErrors,
    forbiddenRequests,
    failedResponses,
    genericUnavailable: dom.genericUnavailable,
    absenceLines: dom.absenceLines,
    truthStates: dom.truthStates,
    deepLinks: dom.deepLinks,
    editablePostRiskCount: dom.editablePostRiskCount,
    enabledHumanGateActions: dom.enabledHumanGateActions,
    horizontalOverflow: dom.horizontalOverflow,
    failures,
  };
}

async function auditSse() {
  const nominal = await readSse(`${baseUrl}/front-api/v1/events`, 3_000);
  const expired = await readSse(`${baseUrl}/front-api/v1/events?cursor=two-screen-expired-cursor`, 3_000);
  return {
    nominalEventCount: nominal.length,
    nominalEventTypes: nominal.map((event) => event.eventType),
    firstNominalEventId: nominal[0]?.eventId || null,
    resyncEventType: expired[0]?.eventType || null,
    resyncReason: expired[0]?.payload?.reason || null,
  };
}

async function readSse(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
    const reader = response.body.getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value, { stream: true });
      const parsed = parseFrames(buffer);
      if (parsed.length) {
        await reader.cancel();
        controller.abort();
        return parsed;
      }
    }
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
  } finally {
    clearTimeout(timer);
  }
  return [];
}

function parseFrames(source) {
  const boundary = source.lastIndexOf("\n\n");
  if (boundary < 0) return [];
  return source.slice(0, boundary).split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6))
    .filter(Boolean)
    .map((value) => JSON.parse(value));
}
