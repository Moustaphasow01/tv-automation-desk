import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.DESK_VNEXT_BASE_URL || "http://127.0.0.1:8190";
const outputRoot = resolve(process.cwd(), "../../reports/ui-ux/live-trading");
const scenarioCatalog = [
  { name: "golden-1672x941", viewport: { width: 1672, height: 941 }, golden: true },
  { name: "laptop-1440x900", viewport: { width: 1440, height: 900 } },
  { name: "compact-1280x800", viewport: { width: 1280, height: 800 } },
  { name: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { name: "mobile-430x932", viewport: { width: 430, height: 932 } },
];
const requestedScenario = process.env.DESK_VNEXT_VISUAL_SCENARIO;
const scenarios = requestedScenario ? scenarioCatalog.filter((scenario) => scenario.name === requestedScenario) : scenarioCatalog;
if (!scenarios.length) throw new Error(`UNKNOWN_VISUAL_SCENARIO:${requestedScenario}`);
const flightDirectorGolden = {
  sidebar: { x: 0, y: 0, width: 200, height: 941 },
  header: { x: 200, y: 0, width: 1472, height: 64 },
  policy: { x: 200, y: 64, width: 1472, height: 38 },
  flightBar: { x: 200, y: 102, width: 1472, height: 76 },
  workspace: { x: 200, y: 212, width: 1472, height: 729 },
};

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch(browserLaunchOptions());
const context = await browser.newContext({ viewport: scenarios[0].viewport, deviceScaleFactor: 1, serviceWorkers: "block" });
const page = await context.newPage();
let activeConsoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") activeConsoleErrors.push(message.text()); });
page.on("pageerror", (error) => activeConsoleErrors.push(error.message));
const results = [];
try {
  for (const scenario of scenarios) {
    await page.setViewportSize(scenario.viewport);
    const consoleErrors = [];
    activeConsoleErrors = consoleErrors;
    await page.goto(`${baseUrl}/#/live`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await establishOperatorSession(page);
    await page.locator(".lt-page").waitFor({ state: "visible", timeout: 45_000 });
    try {
      await page.locator(".lt-panel").first().waitFor({ state: "visible", timeout: 45_000 });
    } catch (error) {
      const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 2_000);
      throw new Error(`LIVE_TRADING_PANEL_NOT_VISIBLE\n${bodyText}\n${consoleErrors.join("\n")}`, { cause: error });
    }
    await page.screenshot({ path: resolve(outputRoot, `${scenario.name}.png`), fullPage: false });
    // Shell geometry is certified before the audit deliberately scrolls every
    // dock and decision panel into view. Chromium can retain a visual offset
    // after those nested scroll operations even when the document itself has
    // no horizontal overflow; that offset is an audit side effect, not the
    // initial operator viewport.
    const initialLayout = await page.evaluate(measureCockpit, { mobile: scenario.viewport.width <= 900 });
    const dockTabMeasurements = [];
    const dockTabs = page.locator(".lt-activity-dock__tabs [role='tab']");
    for (let index = 0; index < await dockTabs.count(); index += 1) {
      const tab = dockTabs.nth(index);
      const consoleErrorOffset = consoleErrors.length;
      await tab.click();
      await page.locator(".lt-activity-dock__content[role='tabpanel']").waitFor({ state: "visible" });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const tabMeasurement = await page.evaluate(measureCockpit, { mobile: scenario.viewport.width <= 900, scopeSelector: ".lt-activity-dock" });
      dockTabMeasurements.push({
        id: await tab.getAttribute("id"),
        label: (await tab.textContent())?.trim() ?? "",
        ...tabMeasurement,
        consoleErrors: consoleErrors.slice(consoleErrorOffset),
      });
    }
    const activityFullscreen = {
      exercised: false,
      visible: false,
      closedWithEscape: false,
      focusRestored: false,
      bounds: null,
    };
    const activityFullscreenButton = page.locator(".lt-activity-dock__focus");
    if (await activityFullscreenButton.count()) {
      await activityFullscreenButton.click();
      activityFullscreen.exercised = true;
      const activityDialog = page.locator(".lt-activity-dock--fullscreen[role='dialog']");
      activityFullscreen.visible = await activityDialog.isVisible().catch(() => false);
      if (activityFullscreen.visible) {
        activityFullscreen.bounds = await activityDialog.evaluate((node) => node.getBoundingClientRect().toJSON());
        if (scenario.golden) await page.screenshot({ path: resolve(outputRoot, "golden-activity-fullscreen.png"), fullPage: false });
        await page.keyboard.press("Escape");
        activityFullscreen.closedWithEscape = !await activityDialog.isVisible().catch(() => false);
        activityFullscreen.focusRestored = await activityFullscreenButton.evaluate((node) => document.activeElement === node);
      }
    }
    const decisionStageMeasurements = [];
    const decisionStages = page.locator(".lt-decision-stack__flow details > summary");
    for (let index = 0; index < await decisionStages.count(); index += 1) {
      const stage = decisionStages.nth(index);
      const consoleErrorOffset = consoleErrors.length;
      await stage.scrollIntoViewIfNeeded();
      await stage.click();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      decisionStageMeasurements.push({
        label: (await stage.textContent())?.trim() ?? `stage-${index + 1}`,
        ...(await page.evaluate(measureCockpit, { mobile: scenario.viewport.width <= 900, scopeSelector: ".lt-cockpit__decision" })),
        consoleErrors: consoleErrors.slice(consoleErrorOffset),
      });
    }
    const humanGateSummary = decisionStages.last();
    if (await humanGateSummary.count()) {
      await humanGateSummary.scrollIntoViewIfNeeded();
      const details = humanGateSummary.locator("..");
      if (!(await details.getAttribute("open"))) await humanGateSummary.click();
    }
    const enabledGateCandidate = page.locator(".lt-gate-actions button:not([disabled])").first();
    if (await enabledGateCandidate.count()) await enabledGateCandidate.scrollIntoViewIfNeeded();
    const enabledGateButton = page.locator(".lt-gate-actions button:not([disabled]):visible").first();
    const gateDialog = { exercised: false, visible: false, measurement: null };
    if (await enabledGateButton.count()) {
      await enabledGateButton.click();
      gateDialog.exercised = true;
      gateDialog.visible = await page.locator(".lt-gate-dialog[role='alertdialog']").isVisible().catch(() => false);
      if (gateDialog.visible) {
        gateDialog.measurement = await page.evaluate(measureCockpit, { mobile: scenario.viewport.width <= 900, scopeSelector: ".lt-gate-dialog" });
        await page.keyboard.press("Escape");
      }
    }
    const defaultDockTab = page.locator("#lt-dock-tab-position");
    if (await defaultDockTab.count()) await defaultDockTab.click();
    await page.evaluate(() => {
      scrollTo(0, 0);
      document.querySelectorAll(".lt-activity-dock__tabs,.lt-activity-dock__content,.lt-cockpit__decision,.lt-chart-canvas,.lt-chart-toolbar,.lt-chart-controls").forEach((node) => {
        node.scrollTop = 0;
        node.scrollLeft = 0;
      });
    });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const measurement = await page.evaluate(measureCockpit, { mobile: scenario.viewport.width <= 900 });
    measurement.dockTabs = dockTabMeasurements;
    measurement.activityFullscreen = activityFullscreen;
    measurement.decisionStages = decisionStageMeasurements;
    measurement.gateDialog = gateDialog;
    measurement.minimumReadableTextPx = Math.min(
      measurement.minimumReadableTextPx,
      ...dockTabMeasurements.map((tab) => tab.minimumReadableTextPx),
      ...decisionStageMeasurements.map((stage) => stage.minimumReadableTextPx),
    );
    const geometryFailures = [];
    for (const issue of measurement.verticalShellIssues) geometryFailures.push(`shell: ${issue}`);
    for (const tab of dockTabMeasurements) {
      if (tab.clippedInteractiveCount > 0) geometryFailures.push(`${tab.id || tab.label}: ${tab.clippedInteractiveCount} clipped interactive(s)`);
      if (tab.horizontalOverflow) geometryFailures.push(`${tab.id || tab.label}: horizontal page overflow`);
      if (tab.minimumReadableTextPx < 10.9) geometryFailures.push(`${tab.id || tab.label}: minimum text ${tab.minimumReadableTextPx}px`);
    }
    for (const stage of decisionStageMeasurements) {
      if (stage.clippedInteractiveCount > 0) geometryFailures.push(`${stage.label}: ${stage.clippedInteractiveCount} horizontally clipped interactive(s)`);
      if (stage.verticallyClippedInteractiveCount > 0) geometryFailures.push(`${stage.label}: ${stage.verticallyClippedInteractiveCount} vertically clipped interactive(s)`);
      if (stage.obscuredInteractiveCount > 0) geometryFailures.push(`${stage.label}: ${stage.obscuredInteractiveCount} obscured interactive(s)`);
      if (stage.consoleErrors.length) geometryFailures.push(`${stage.label}: ${stage.consoleErrors.length} console error(s)`);
    }
    if (gateDialog.exercised && !gateDialog.visible) geometryFailures.push("Human Gate action did not open its confirmation dialog");
    if (!activityFullscreen.exercised || !activityFullscreen.visible) geometryFailures.push("Activity dock fullscreen mode is unavailable");
    if (activityFullscreen.visible && !activityFullscreen.closedWithEscape) geometryFailures.push("Activity dock fullscreen mode does not close with Escape");
    if (activityFullscreen.visible && !activityFullscreen.focusRestored) geometryFailures.push("Activity dock fullscreen mode does not restore trigger focus");
    if (activityFullscreen.bounds && (activityFullscreen.bounds.width < scenario.viewport.width * .8 || activityFullscreen.bounds.height < scenario.viewport.height * .8)) geometryFailures.push("Activity dock fullscreen mode does not occupy the investigation viewport");
    if (scenario.viewport.width <= 900) {
      if (!initialLayout.mobileInstrumentSelector.visible) geometryFailures.push("mobile instrument selector must be visible in the initial viewport");
      if (!initialLayout.mobileInstrumentSelector.uncovered) geometryFailures.push("mobile instrument selector is covered in the initial viewport");
    }
    if (scenario.golden) for (const [key, expected] of Object.entries(flightDirectorGolden)) {
      const actual = initialLayout[key];
      if (!actual) geometryFailures.push(`${key}: missing`);
      else for (const metric of ["x", "y", "width", "height"]) if (Math.abs(actual[metric] - expected[metric]) > 1) geometryFailures.push(`${key}.${metric}: expected ${expected[metric]}, got ${actual[metric]}`);
    }
    if (!measurement.marketLens) geometryFailures.push("marketLens: missing");
    if (!measurement.chart) geometryFailures.push("chart: missing");
    if (!measurement.decisionStack) geometryFailures.push("decisionStack: missing");
    if (!measurement.activityDock) geometryFailures.push("activityDock: missing");
    if (measurement.truncatedDecisionLabelCount > 0) geometryFailures.push(`${measurement.truncatedDecisionLabelCount} truncated decision label(s)`);
    if (measurement.dockOverflowWithoutScrollCount > 0) geometryFailures.push(`${measurement.dockOverflowWithoutScrollCount} dock overflow region(s) without scroll`);
    if (measurement.dockSiblingOverlapCount > 0) geometryFailures.push(`${measurement.dockSiblingOverlapCount} overlapping dock row(s)`);
    if (scenario.viewport.width > 1240 && measurement.chart && measurement.marketLens && measurement.chart.width <= measurement.marketLens.width) geometryFailures.push("chart must remain wider than market lens on desktop");
    if (!measurement.chartBeforeDecisionOnMobile) geometryFailures.push("chart must precede the decision stack on mobile");
    results.push({ scenario, initialLayout, measurement, geometryFailures, consoleErrors });
  }
} finally { await page.close(); await context.close(); await browser.close(); }

const failures = results.filter(({ measurement, geometryFailures, consoleErrors }) => measurement.horizontalOverflow || measurement.clippedInteractiveCount > 0 || measurement.verticallyClippedInteractiveCount > 0 || measurement.obscuredInteractiveCount > 0 || measurement.cockpitCount !== 1 || measurement.visibleBackdropCount > 0 || measurement.editablePostRiskCount > 0 || measurement.minimumReadableTextPx < 10.9 || geometryFailures.length || consoleErrors.length);
const reportPath = resolve(outputRoot, "live-trading-visual-qa.json");
await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, results }, null, 2)}\n`);
console.log(`Live Trading visual QA: ${results.length - failures.length}/${results.length} scenarios passed · ${reportPath}`);
for (const item of results) console.log(`${item.scenario.name}: overflow=${item.measurement.horizontalOverflow} clipped=${item.measurement.clippedInteractiveCount}/${item.measurement.verticallyClippedInteractiveCount} obscured=${item.measurement.obscuredInteractiveCount} cockpit=${item.measurement.cockpitCount} panels=${item.measurement.panelCount} backdrop=${item.measurement.visibleBackdropCount} minText=${item.measurement.minimumReadableTextPx}px immutable=${item.measurement.editablePostRiskCount === 0} gateEnabled=${item.measurement.enabledGateActions} geometry=${item.geometryFailures.length} console=${item.consoleErrors.length}`);
if (failures.length) process.exitCode = 1;

function measureCockpit({ mobile, scopeSelector = null }) {
  const read = (selector) => {
    const node = document.querySelector(selector);
    return node ? node.getBoundingClientRect().toJSON() : null;
  };
  const isRendered = (node) => {
    const bounds = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    if (node.closest("details:not([open])")) return false;
    if (node.classList.contains("skip-link") && document.activeElement !== node) return false;
    const centerY = bounds.top + bounds.height / 2;
    const centerX = bounds.left + bounds.width / 2;
    let ancestor = node.parentElement;
    while (ancestor && ancestor !== document.body) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (["auto", "scroll"].includes(ancestorStyle.overflowY)) {
        const ancestorBounds = ancestor.getBoundingClientRect();
        if (centerY <= ancestorBounds.top || centerY >= ancestorBounds.bottom) return false;
      }
      if (["auto", "scroll"].includes(ancestorStyle.overflowX)) {
        const ancestorBounds = ancestor.getBoundingClientRect();
        if (centerX <= ancestorBounds.left || centerX >= ancestorBounds.right) return false;
      }
      ancestor = ancestor.parentElement;
    }
    return bounds.width > 0
      && bounds.height > 0
      && centerX >= 0
      && centerX <= innerWidth
      && centerY >= 0
      && centerY <= innerHeight
      && style.visibility !== "hidden"
      && style.display !== "none";
  };
  const isInsideHorizontalScroller = (node) => {
    let ancestor = node.parentElement;
    while (ancestor && ancestor !== document.body) {
      const style = getComputedStyle(ancestor);
      if (["auto", "scroll"].includes(style.overflowX) && ancestor.scrollWidth > ancestor.clientWidth) return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const isVerticallyClippedByAncestor = (node) => {
    const bounds = node.getBoundingClientRect();
    let ancestor = node.parentElement;
    while (ancestor && ancestor !== document.body) {
      const style = getComputedStyle(ancestor);
      if (["auto", "scroll"].includes(style.overflowY)) return false;
      if (["hidden", "clip"].includes(style.overflowY)) {
        const ancestorBounds = ancestor.getBoundingClientRect();
        if (bounds.top < ancestorBounds.top - 1 || bounds.bottom > ancestorBounds.bottom + 1) return true;
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const isObscuredInViewport = (node) => {
    const bounds = node.getBoundingClientRect();
    const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    if (center.x < 0 || center.x > innerWidth || center.y < 0 || center.y > innerHeight) return false;
    const hit = document.elementFromPoint(center.x, center.y);
    return Boolean(hit && hit !== node && !node.contains(hit));
  };
  const interactionRoot = scopeSelector ? document.querySelector(scopeSelector) : document.querySelector(".lt-cockpit");
  const interactives = [...(interactionRoot ?? document).querySelectorAll("a,button,input,select,textarea,[tabindex]:not([tabindex='-1'])")]
    .filter((node) => !node.classList.contains("lt-chart-canvas"))
    .filter(isRendered);
  const describeInteractive = (node) => ({
    tag: node.tagName,
    id: node.id || null,
    className: typeof node.className === "string" ? node.className : "",
    text: (node.textContent || "").trim().slice(0, 100),
  });
  const verticallyClippedInteractives = interactives.filter(isVerticallyClippedByAncestor);
  const obscuredInteractives = interactives.filter(isObscuredInViewport);
  const header = read(".lt-header");
  const policy = read(".lt-policy");
  const flightBar = read(".lt-flight-bar");
  const workspace = read(".lt-cockpit__workspace");
  const verticalShellIssues = [];
  for (const [upperName, upper, lowerName, lower] of [
    ["header", header, "policy", policy],
    ["policy", policy, "flightBar", flightBar],
    ["flightBar", flightBar, "workspace", workspace],
  ]) {
    if (upper && lower && upper.bottom > lower.top + 1) {
      verticalShellIssues.push(`${upperName} overlaps ${lowerName} by ${(upper.bottom - lower.top).toFixed(1)}px`);
    }
  }
  const instrumentSelector = document.querySelector(".lt-flight-bar__scope select");
  const instrumentBounds = instrumentSelector?.getBoundingClientRect() ?? null;
  const instrumentStyle = instrumentSelector ? getComputedStyle(instrumentSelector) : null;
  const instrumentVisible = Boolean(
    !mobile
    || (instrumentSelector
      && instrumentBounds
      && instrumentStyle
      && instrumentBounds.width > 0
      && instrumentBounds.height > 0
      && instrumentStyle.display !== "none"
      && instrumentStyle.visibility !== "hidden"
      && instrumentBounds.top >= -1
      && instrumentBounds.left >= -1
      && instrumentBounds.right <= innerWidth + 1
      && instrumentBounds.bottom <= innerHeight + 1),
  );
  const instrumentCenter = instrumentBounds
    ? { x: instrumentBounds.left + instrumentBounds.width / 2, y: instrumentBounds.top + instrumentBounds.height / 2 }
    : null;
  const instrumentHit = instrumentCenter
    && instrumentCenter.x >= 0
    && instrumentCenter.x <= innerWidth
    && instrumentCenter.y >= 0
    && instrumentCenter.y <= innerHeight
    ? document.elementFromPoint(instrumentCenter.x, instrumentCenter.y)
    : null;
  const instrumentUncovered = Boolean(
    !mobile
    || (instrumentSelector
      && instrumentHit
      && (instrumentHit === instrumentSelector || instrumentSelector.contains(instrumentHit))),
  );
  const truncatedDecisionLabels = [...document.querySelectorAll(".lt-decision-stack__stage-title,.lt-decision-stack__stage-status .status-badge")]
    .filter((node) => node.scrollWidth > node.clientWidth + 1);
  const dockOverflowWithoutScroll = [...document.querySelectorAll(".lt-activity-dock__content .lt-panel__body,.lt-quality-table-scroll")]
    .filter((node) => {
      if (node.scrollHeight <= node.clientHeight + 1) return false;
      return !["auto", "scroll"].includes(getComputedStyle(node).overflowY);
    });
  const qualityDockRows = [...(document.querySelector(".lt-activity-dock__content .lt-panel--quality .lt-panel__body")?.children ?? [])]
    .filter((node) => getComputedStyle(node).display !== "none" && node.getBoundingClientRect().height > 0);
  const dockSiblingOverlaps = qualityDockRows.slice(1).filter((node, index) => (
    qualityDockRows[index].getBoundingClientRect().bottom > node.getBoundingClientRect().top + 1
  ));

  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
    sidebar: read(".desk-sidebar"),
    header,
    policy,
    flightBar,
    workspace,
    marketLens: read(".lt-cockpit__market"),
    chart: read(".lt-cockpit__canvas"),
    decisionStack: read(".lt-cockpit__decision"),
    activityDock: read(".lt-activity-dock"),
    panelCount: document.querySelectorAll(".lt-panel").length,
    cockpitCount: document.querySelectorAll(".lt-cockpit").length,
    visibleBackdropCount: [...document.querySelectorAll(".lt-panel-backdrop")].filter(isRendered).length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    clippedInteractiveCount: interactives.filter((node) => {
      const bounds = node.getBoundingClientRect();
      return (bounds.right > innerWidth + 1 || bounds.left < -1) && !isInsideHorizontalScroller(node);
    }).length,
    verticallyClippedInteractiveCount: verticallyClippedInteractives.length,
    verticallyClippedInteractives: verticallyClippedInteractives.slice(0, 20).map(describeInteractive),
    obscuredInteractiveCount: obscuredInteractives.length,
    obscuredInteractives: obscuredInteractives.slice(0, 20).map(describeInteractive),
    truncatedDecisionLabelCount: truncatedDecisionLabels.length,
    truncatedDecisionLabels: truncatedDecisionLabels.slice(0, 20).map((node) => ({
      className: typeof node.className === "string" ? node.className : "",
      text: (node.textContent || "").trim().slice(0, 120),
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    })),
    dockOverflowWithoutScrollCount: dockOverflowWithoutScroll.length,
    dockSiblingOverlapCount: dockSiblingOverlaps.length,
    editablePostRiskCount: document.querySelectorAll(".lt-panel--intent input,.lt-panel--intent select,.lt-panel--intent textarea,.lt-decision-stack__readonly input,.lt-decision-stack__readonly select,.lt-decision-stack__readonly textarea,[contenteditable='true']").length,
    enabledGateActions: [...document.querySelectorAll(".lt-gate-actions button")].filter((node) => !node.disabled).length,
    minimumReadableTextPx: [...(interactionRoot ?? document).querySelectorAll("*")].reduce((minimum, node) => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      const text = (node.textContent || "").trim();
      if (!text || bounds.width === 0 || bounds.height === 0 || style.display === "none" || style.visibility === "hidden") return minimum;
      const size = Number.parseFloat(style.fontSize);
      return Number.isFinite(size) && size > 0 ? Math.min(minimum, size) : minimum;
    }, Number.POSITIVE_INFINITY),
    undersizedTextNodes: [...(interactionRoot ?? document).querySelectorAll("*")].flatMap((node) => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      const text = (node.textContent || "").trim();
      const size = Number.parseFloat(style.fontSize);
      if (!text || bounds.width === 0 || bounds.height === 0 || style.display === "none" || style.visibility === "hidden" || !Number.isFinite(size) || size >= 10.9) return [];
      return [{
        tag: node.tagName,
        className: typeof node.className === "string" ? node.className : "",
        fontSizePx: size,
        text: text.slice(0, 120),
      }];
    }).slice(0, 20),
    chartBeforeDecisionOnMobile: !mobile || (() => {
      const decision = document.querySelector(".lt-cockpit__decision")?.getBoundingClientRect();
      const chart = document.querySelector(".lt-cockpit__canvas")?.getBoundingClientRect();
      return Boolean(decision && chart && chart.top <= decision.top);
    })(),
    verticalShellIssues,
    mobileInstrumentSelector: {
      bounds: instrumentBounds?.toJSON() ?? null,
      visible: instrumentVisible,
      uncovered: instrumentUncovered,
      topElement: instrumentHit?.tagName ?? null,
    },
  };
}

function browserLaunchOptions() {
  return {
    headless: true,
    ...(process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  };
}

async function establishOperatorSession(page) {
  const gate = page.locator(".operator-login-gate");
  if (!await gate.isVisible({ timeout: 5_000 }).catch(() => false)) return;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const form = gate.locator(".operator-login-gate__form");
    if (await form.isVisible().catch(() => false)) {
      await form.locator("input[autocomplete='username']").fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
      await form.locator("input[autocomplete='current-password']").fill(process.env.DESK_OPERATOR_PASSWORD || "2018");
      await form.locator("button[type='submit']").click();
      await gate.waitFor({ state: "hidden", timeout: 45_000 }).catch(() => undefined);
      if (!await gate.isVisible().catch(() => false)) return;
    }

    const retry = gate.locator("button.operator-login-gate__secondary");
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await page.waitForTimeout(1_000);
  }

  throw new Error(`OPERATOR_SESSION_NOT_ESTABLISHED: ${(await gate.innerText().catch(() => "")).slice(0, 500)}`);
}
