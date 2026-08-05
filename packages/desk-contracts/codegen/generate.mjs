import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entitiesDir = join(root, "schemas", "entities");
const commonDir = join(root, "schemas", "common");
const toolsDir = join(root, "schemas", "tools");
const catalogsDir = join(root, "catalogs");
const enumsPath = join(root, "enums", "enums.json");
const registryPath = join(root, "registry.json");

function pascalCase(value) {
  return value
    .replace(/\.schema\.json$/, "")
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[a-z]/, (char) => char.toUpperCase());
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonDirectory(path) {
  const files = (await readdir(path)).filter((file) => file.endsWith(".json")).sort();
  const entries = [];
  for (const file of files) {
    entries.push([file, await readJson(join(path, file))]);
  }
  return Object.fromEntries(entries);
}

function jsExport(name, value) {
  return `export const ${name} = ${JSON.stringify(value, null, 2)};`;
}

function tsType(schema) {
  if (!schema) return "unknown";
  if (schema.$ref) return "unknown";
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.oneOf || schema.anyOf) return (schema.oneOf || schema.anyOf).map(tsType).join(" | ");
  if (schema.type === "array") {
    const itemType = tsType(schema.items || {});
    return `${itemType.includes(" | ") ? `(${itemType})` : itemType}[]`;
  }
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "string") return "string";
  if (schema.type === "null") return "null";
  if (schema.type === "object" || schema.properties || schema.additionalProperties) {
    const properties = schema.properties || {};
    const required = new Set(schema.required || []);
    const lines = Object.entries(properties).map(([key, value]) => {
      const optional = required.has(key) ? "" : "?";
      return `  ${JSON.stringify(key)}${optional}: ${tsType(value)};`;
    });
    if (schema.additionalProperties === true || Object.keys(properties).length === 0) {
      lines.push("  [key: string]: unknown;");
    }
    return `{\n${lines.join("\n")}\n}`;
  }
  return "unknown";
}

async function main() {
  const enums = await readJson(enumsPath);
  const registry = await readJson(registryPath);
  const files = (await readdir(entitiesDir)).filter((file) => file.endsWith(".json")).sort();
  const schemas = [];
  for (const file of files) {
    schemas.push({ file, name: pascalCase(file), schema: await readJson(join(entitiesDir, file)) });
  }
  const entitySchemas = Object.fromEntries(schemas.map(({ file, schema }) => [file, schema]));
  const commonSchemas = await readJsonDirectory(commonDir);
  const toolInputSchemasByFile = await readJsonDirectory(toolsDir);
  const catalogs = await readJsonDirectory(catalogsDir);

  const ts = [
    "/* Generated from packages/desk-contracts/schemas. Do not edit manually. */",
    "",
    ...Object.entries(enums).map(([name, values]) =>
      `export const ${name} = ${JSON.stringify(values)} as const;\nexport type ${name}Value = typeof ${name}[number];`,
    ),
    `export const catalogs = ${JSON.stringify(catalogs, null, 2)} as const;`,
    "",
    ...schemas.map(({ name, schema }) => `export type ${name} = ${tsType(schema)};`),
    "",
  ].join("\n\n");

  await writeFile(join(root, "generated", "ts", "index.ts"), ts, "utf8");
  await writeFile(
    join(root, "generated", "runtime-data.js"),
    [
      "/* Generated from packages/desk-contracts JSON sources. Do not edit manually. */",
      jsExport("enums", enums),
      jsExport("catalogs", catalogs),
      jsExport("registry", registry),
      jsExport("entitySchemas", entitySchemas),
      jsExport("commonSchemas", commonSchemas),
      jsExport("toolInputSchemasByFile", toolInputSchemasByFile),
    ].join("\n\n") + "\n",
    "utf8",
  );
  console.log(JSON.stringify({ ok: true, generated: schemas.map((item) => basename(item.file)) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
