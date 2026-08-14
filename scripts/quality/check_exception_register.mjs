#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_EXCEPTION_GUARD_ROOT || defaultRoot);
const today = parseDateOnly(process.env.DESK_EXCEPTION_GUARD_TODAY || new Date().toISOString().slice(0, 10));
const registerPath = path.join(root, "docs/engineering/exception-register.md");
const backlogPath = path.join(root, "docs/trading-desk-target-blueprint/implementation-backlog-v2.yaml");
const baselinePath = path.join(root, "docs/engineering/static-quality-baseline.json");

const register = await readFile(registerPath, "utf8");
const backlog = await readFile(backlogPath, "utf8");
const staticBaseline = JSON.parse(await readFile(baselinePath, "utf8"));
const exceptions = parseExceptionRows(register);
const failures = validateExceptions(exceptions);
validateFinalGate(backlog, failures);

if (failures.length) {
  console.error("[exception-register-guard] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    today: toDateOnly(today),
    active_exceptions: exceptions.length,
    by_owner: countBy(exceptions, "owner"),
    next_expiration: exceptions.map((item) => item.expiration).sort()[0] || null,
    static_quality_budgets: staticBaseline.aggregate_budgets,
  }, null, 2));
}

function validateExceptions(exceptions) {
  const failures = [];
  if (!exceptions.length) failures.push("exception register has no machine-readable EXC-* rows");
  const ids = new Set();
  for (const item of exceptions) {
    if (ids.has(item.id)) failures.push(`${item.id}: duplicate exception id`);
    ids.add(item.id);
    if (!/^EXC-TD-\d{3}$/.test(item.id)) failures.push(`${item.id}: invalid exception id`);
    if (!item.owner) failures.push(`${item.id}: owner is required`);
    if (!item.expiration) failures.push(`${item.id}: expiration is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.expiration)) failures.push(`${item.id}: expiration must be YYYY-MM-DD`);
    if (item.expiration && parseDateOnly(item.expiration) < today) failures.push(`${item.id}: expired on ${item.expiration}`);
    if (!/(TD2-|ADR-|adr\/)/i.test(item.ticket)) failures.push(`${item.id}: ADR/Ticket must reference TD2 or ADR`);
    if (!item.mitigation.includes("guard") && !item.mitigation.includes("touch-and-improve")) {
      failures.push(`${item.id}: mitigation must mention a guard or touch-and-improve`);
    }
  }
  return failures;
}

function validateFinalGate(backlog, failures) {
  if (!backlog.includes("zero_active_exceptions")) {
    failures.push("implementation backlog final gate must include zero_active_exceptions");
  }
  if (!backlog.includes("TD2-1105")) {
    failures.push("implementation backlog must keep TD2-1105 as final compliance ticket");
  }
}

function parseExceptionRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*EXC-TD-/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .map((cells) => ({
      id: stripMarkdown(cells[0]),
      rule: stripMarkdown(cells[1]),
      scope: stripMarkdown(cells[2]),
      justification: stripMarkdown(cells[3]),
      risk: stripMarkdown(cells[4]),
      mitigation: stripMarkdown(cells[5]),
      owner: stripMarkdown(cells[6]),
      expiration: stripMarkdown(cells[7]),
      ticket: stripMarkdown(cells[8]),
    }));
}

function countBy(items, field) {
  return Object.fromEntries([...items.reduce((acc, item) => {
    acc.set(item[field], (acc.get(item[field]) || 0) + 1);
    return acc;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}

function stripMarkdown(value = "") {
  return value.replaceAll("`", "").trim();
}

function parseDateOnly(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function toDateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}
