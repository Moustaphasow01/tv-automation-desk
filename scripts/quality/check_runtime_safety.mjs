#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSearchResult } from "./ripgrep-result.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_RUNTIME_SAFETY_ROOT || defaultRoot);
const policy = JSON.parse(await readFile(path.join(root, "docs/engineering/runtime-safety-policy.json"), "utf8"));
const failures = [];

const clockExports = await readFile(path.join(root, policy.clock.package, "index.js"), "utf8");
for (const requiredExport of policy.clock.required_exports) {
  if (!clockExports.includes(requiredExport)) failures.push(`desk-time missing export ${requiredExport}`);
}

const sql = await readSql();
for (const guard of policy.sql.idempotency_guards) {
  if (!tableHasField(sql, guard.table, guard.field)) failures.push(`${guard.table}: missing ${guard.field}`);
  if (!fieldIsUnique(sql, guard.table, guard.field)) failures.push(`${guard.table}: ${guard.field} is not unique`);
}
for (const guard of policy.sql.lease_guards) {
  for (const field of [guard.lease_field, guard.expires_field, guard.attempt_field]) {
    if (!tableHasField(sql, guard.table, field)) failures.push(`${guard.table}: missing lease guard field ${field}`);
  }
}
for (const guard of policy.sql.optimistic_lock_guards) {
  for (const field of guard.fields) {
    if (!tableHasField(sql, guard.table, field)) failures.push(`${guard.table}: missing optimistic lock field ${field}`);
  }
}

const directClockUsages = countDirectClockUsages();
if (directClockUsages > policy.clock.direct_clock_usage_budget) {
  failures.push(`direct clock usages increased: ${directClockUsages} > ${policy.clock.direct_clock_usage_budget}`);
}

if (failures.length) {
  console.error("[runtime-safety] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    clock_exports: policy.clock.required_exports.length,
    direct_clock_usages: directClockUsages,
    direct_clock_budget: policy.clock.direct_clock_usage_budget,
    idempotency_guards: policy.sql.idempotency_guards.length,
    lease_guards: policy.sql.lease_guards.length,
    optimistic_lock_guards: policy.sql.optimistic_lock_guards.length,
  }, null, 2));
}

async function readSql() {
  const directory = path.join(root, policy.sql.migration_directory);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const chunks = [];
  for (const file of files) chunks.push(await readFile(path.join(directory, file), "utf8"));
  return chunks.join("\n");
}

function tableHasField(sql, table, field) {
  const normalized = normalize(sql);
  const tableBody = extractTableBody(normalized, table);
  if (tableBody.includes(`${field.toUpperCase()} `)) return true;
  const alterPattern = new RegExp(`ALTER TABLE ${table.toUpperCase()} .*ADD COLUMN IF NOT EXISTS ${field.toUpperCase()}\\b`, "s");
  return alterPattern.test(normalized);
}

function fieldIsUnique(sql, table, field) {
  const normalized = normalize(sql);
  const body = extractTableBody(normalized, table);
  const upperField = field.toUpperCase();
  return body.includes(`${upperField} `) && body.includes(`${upperField} `) && /\bUNIQUE\b/.test(lineForField(body, upperField))
    || body.includes(`UNIQUE(${upperField})`)
    || body.includes(`UNIQUE (${upperField})`)
    || new RegExp(`CREATE UNIQUE INDEX .* ON ${table.toUpperCase()}\\s*\\(${upperField}\\)`, "s").test(normalized)
    || new RegExp(`CREATE UNIQUE INDEX .* ON ${table.toUpperCase()}\\s*\\([^)]*${upperField}[^)]*\\)`, "s").test(normalized);
}

function extractTableBody(normalizedSql, table) {
  const marker = `CREATE TABLE IF NOT EXISTS ${table.toUpperCase()} (`;
  const start = normalizedSql.indexOf(marker);
  if (start === -1) return "";
  const bodyStart = start + marker.length;
  let depth = 1;
  for (let index = bodyStart; index < normalizedSql.length; index += 1) {
    if (normalizedSql[index] === "(") depth += 1;
    if (normalizedSql[index] === ")") depth -= 1;
    if (depth === 0) return normalizedSql.slice(bodyStart, index);
  }
  return normalizedSql.slice(bodyStart);
}

function lineForField(body, field) {
  return body.split(",").find((line) => line.trim().startsWith(`${field} `)) || "";
}

function normalize(value) {
  return value.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function countDirectClockUsages() {
  const paths = ["mcp_gpt_desk/src", "packages", "src", "scripts"].filter((candidate) => existsSync(path.join(root, candidate)));
  if (!paths.length) return 0;
  const result = spawnSync("rg", ["new\\s+Date\\s*\\(|Date\\.now\\s*\\(", ...paths, "-n", "-g", "!**/node_modules/**"], {
    cwd: root,
    encoding: "utf8",
  });
  validateSearchResult(result);
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.includes("/test/"))
    .filter((line) => !line.includes("src/test"))
    .filter((line) => !line.includes("scripts/quality/"))
    .filter((line) => !line.includes("packages/desk-time/"))
    .filter((line) => /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/.test(line))
    .length;
}
