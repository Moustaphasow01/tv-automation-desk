import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../src");
const targets = [
  "pages/CommandCenterPage.tsx",
  "pages/EventsAuditPage.tsx",
  "pages/ExecutionIncidentsPage.tsx",
  "pages/ExecutionProvidersPage.tsx",
  "pages/JarvisWorkspacePage.tsx",
  "pages/LiveSignalsPage.tsx",
  "pages/LiveTradingPage.tsx",
  "pages/OperationsQueuePage.tsx",
  "pages/OperatorSettingsPage.tsx",
  "pages/OrdersPage.tsx",
  "pages/PortfolioPage.tsx",
  "pages/ReplayPage.tsx",
  "pages/RiskCenterPage.tsx",
  "pages/StrategyCenterPage.tsx",
  "features/command-center",
  "features/live-trading",
  "features/order-intent",
];

const forbiddenPlatformTerms = /\b(?:Human Gate|OrderIntents?|BFF|DLQ|Runbooks?|Timeline|Post-Risk|Providers?|Workers?|Payloads?|Step-up|asOf|unavailable|undefined)\b/i;
const rawEnum = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const userFacingProp = /\b(?:aria-label|description|eyebrow|fallbackLabel|label|placeholder)=(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const jsxText = />([A-Za-zÀ-ÿ0-9…·&;:'’ /+.,?!–—%()-]+)</g;

const files = targets.flatMap((target) => collect(resolve(root, target))).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));
const findings = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const { text, line, kind } of visibleLiterals(source)) {
    const platform = text.match(forbiddenPlatformTerms)?.[0];
    const enumCode = text.match(rawEnum)?.[0];
    if (!platform && !enumCode) continue;
    findings.push({ file: file.slice(root.length + 1), line, kind, value: platform ?? enumCode, text: text.trim() });
  }
}

if (findings.length) {
  console.error(`Operator vocabulary guard: ${findings.length} visible technical literal(s).`);
  for (const finding of findings) console.error(`${finding.file}:${finding.line} [${finding.kind}] ${finding.value} — ${finding.text}`);
  process.exitCode = 1;
} else {
  console.log(`Operator vocabulary guard: ${files.length} presentation files checked, no visible platform jargon or raw enum literal.`);
}

function collect(path) {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => collect(resolve(path, entry.name)));
}

function visibleLiterals(source) {
  const values = [];
  for (const [kind, pattern] of [["prop", userFacingProp], ["text", jsxText]]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) {
      const text = kind === "prop" ? match[1] ?? match[2] ?? match[3] ?? "" : match[1] ?? "";
      if (!text.trim()) continue;
      if (kind === "text" && /(?:;\s*(?:if|return)\b|\bmodel\.|===|&&|\|\||=>)/.test(text)) continue;
      values.push({ text, kind, line: source.slice(0, match.index).split("\n").length });
    }
  }
  return values;
}
