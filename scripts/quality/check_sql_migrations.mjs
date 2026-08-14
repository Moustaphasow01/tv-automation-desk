#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(process.env.DESK_SQL_MIGRATION_ROOT || defaultRoot);
const policyPath = path.join(root, "docs/engineering/sql-migration-policy.json");
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const migrationRoot = path.join(root, policy.migration_directory);
const failures = [];
const warnings = [];

const files = (await readdir(migrationRoot))
  .filter((file) => file.endsWith(".sql"))
  .sort();
validateSequence(files, failures);

const migrations = [];
for (const file of files) {
  const content = await readFile(path.join(migrationRoot, file), "utf8");
  migrations.push({ file, content });
}

const tables = [];
const indexes = new Map();
for (const migration of migrations) {
  tables.push(...parseCreateTables(migration));
  for (const indexRef of parseIndexes(migration)) {
    indexes.set(indexRef.table, (indexes.get(indexRef.table) || 0) + 1);
  }
  validateDestructiveStatements(migration, failures);
}

for (const table of tables) {
  table.owner = resolveOwner(table.name);
  if (!table.owner) failures.push(`${table.file}: table ${table.name} has no owner rule`);
  if (!/\bPRIMARY\s+KEY\b/i.test(table.body)) failures.push(`${table.file}: table ${table.name} has no primary key`);
  if (!indexes.has(table.name)) warnings.push(`${table.name}: no secondary index detected`);
}

if (failures.length) {
  console.error("[sql-migrations] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    migration_files: files.length,
    tables: tables.length,
    owners: countBy(tables, "owner"),
    indexed_tables: indexes.size,
    warnings,
  }, null, 2));
}

function validateSequence(files, failures) {
  const pattern = new RegExp(policy.filename_pattern);
  files.forEach((file, index) => {
    if (!pattern.test(file)) failures.push(`${file}: migration filename does not match policy`);
    const expected = String(index + 1).padStart(3, "0");
    if (!file.startsWith(`${expected}_`)) failures.push(`${file}: expected sequence ${expected}`);
  });
}

function parseCreateTables(migration) {
  const tables = [];
  const regex = /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z_][\w.]*)\s*\(/gi;
  let match;
  while ((match = regex.exec(migration.content))) {
    const bodyStart = regex.lastIndex;
    const bodyEnd = findStatementEnd(migration.content, bodyStart);
    tables.push({
      file: migration.file,
      name: match[1],
      body: migration.content.slice(bodyStart, bodyEnd),
    });
  }
  return tables;
}

function findStatementEnd(content, start) {
  let depth = 1;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return index;
  }
  return content.length;
}

function parseIndexes(migration) {
  const indexes = [];
  const regex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+[a-zA-Z_][\w]*\s+ON\s+([a-zA-Z_][\w.]*)/gi;
  let match;
  while ((match = regex.exec(migration.content))) indexes.push({ file: migration.file, table: match[1] });
  return indexes;
}

function validateDestructiveStatements(migration, failures) {
  const normalizedContent = normalizeSql(migration.content);
  const destructive = policy.destructive_operations || [];
  for (const operation of destructive) {
    let searchFrom = 0;
    while (searchFrom < normalizedContent.length) {
      const foundAt = normalizedContent.indexOf(operation, searchFrom);
      if (foundAt === -1) break;
      const context = normalizedContent.slice(foundAt);
      if (!isAllowedDestructive(migration.file, context)) {
        failures.push(`${migration.file}: destructive statement is not allowlisted (${context.slice(0, 80)})`);
      }
      searchFrom = foundAt + operation.length;
    }
  }
}

function normalizeSql(statement) {
  return statement
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function isAllowedDestructive(file, normalized) {
  return (policy.allowed_destructive_statements || []).some((item) => (
    item.file === file
    && normalized.startsWith(item.starts_with.toUpperCase())
    && item.reason
  ));
}

function resolveOwner(tableName) {
  for (const rule of policy.owner_rules || []) {
    if (rule.patterns.some((pattern) => new RegExp(pattern).test(tableName))) return rule.owner;
  }
  return null;
}

function countBy(items, field) {
  return Object.fromEntries([...items.reduce((acc, item) => {
    const key = item[field] || "unknown";
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
}
