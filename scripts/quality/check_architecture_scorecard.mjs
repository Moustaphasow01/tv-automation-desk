#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_SCORECARD_ROOT || defaultRoot);
const scorecardPath = path.join(root, "docs/engineering/architecture-scorecard.json");
const backlogPath = path.join(root, "docs/trading-desk-target-blueprint/implementation-backlog-v2.yaml");
const exceptionsPath = path.join(root, "docs/engineering/exception-register.md");
const staticBaselinePath = path.join(root, "docs/engineering/static-quality-baseline.json");
const packagePath = path.join(root, "package.json");

const scorecard = JSON.parse(await readFile(scorecardPath, "utf8"));
const backlog = await readFile(backlogPath, "utf8");
const exceptions = await readFile(exceptionsPath, "utf8");
const staticBaseline = JSON.parse(await readFile(staticBaselinePath, "utf8"));
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

const archTickets = parseArchTickets(backlog);
const activeExceptions = parseExceptionCount(exceptions);
const failures = [];
expectEqual("p_minus_1.total_tickets", scorecard.p_minus_1?.total_tickets, archTickets.length);
expectEqual("p_minus_1.done_tickets", scorecard.p_minus_1?.done_tickets, archTickets.filter((ticket) => ticket.done).length);
expectEqual("exceptions.active", scorecard.exceptions?.active, activeExceptions);
expectEqual("static_quality.aggregate_budgets", JSON.stringify(scorecard.static_quality?.aggregate_budgets), JSON.stringify(staticBaseline.aggregate_budgets));
for (const script of scorecard.required_scripts || []) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json missing script ${script}`);
}

if (failures.length) {
  console.error("[architecture-scorecard] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    p_minus_1: scorecard.p_minus_1,
    exceptions: scorecard.exceptions,
    static_quality: scorecard.static_quality,
    required_scripts: scorecard.required_scripts,
  }, null, 2));
}

function parseArchTickets(backlog) {
  return backlog
    .split(/\r?\n/)
    .filter((line) => line.includes("external_id: TD2-ARCH-"))
    .map((line) => ({
      external_id: line.match(/external_id:\s*(TD2-ARCH-\d+)/)?.[1],
      done: /status:\s*Done/.test(line),
    }))
    .filter((ticket) => ticket.external_id);
}

function parseExceptionCount(markdown) {
  return markdown.split(/\r?\n/).filter((line) => /^\|\s*EXC-TD-/.test(line)).length;
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, received ${actual}`);
}
