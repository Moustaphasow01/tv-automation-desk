export {
  catalogs,
  commonSchemas,
  entitySchemas,
  enums,
  registry,
  toolInputSchemasByFile,
} from "./generated/runtime-data.js";

import {
  catalogs,
  entitySchemas,
  registry,
  toolInputSchemasByFile,
} from "./generated/runtime-data.js";

export {
  CDC_TARGET_COLLECTIONS,
  DESK_COLLECTIONS,
} from "./collections.js";

export const TOOL_INPUT_SCHEMAS = Object.fromEntries(
  Object.entries(toolInputSchemasByFile).map(([file, schema]) => [
    file.replace(/\.input\.schema\.json$/, ""),
    schema,
  ]),
);

export function getToolInputSchema(name) {
  const schema = TOOL_INPUT_SCHEMAS[name];
  if (!schema) {
    throw new Error(`tool_input_schema_not_found:${name}`);
  }
  return schema;
}

export function getEntitySchema(fileName) {
  const schema = entitySchemas[fileName];
  if (!schema) {
    throw new Error(`entity_schema_not_found:${fileName}`);
  }
  return schema;
}

export function getCatalog(fileName) {
  const catalog = catalogs[fileName];
  if (!catalog) {
    throw new Error(`catalog_not_found:${fileName}`);
  }
  return catalog;
}

function schemaFileName(schemaPath) {
  return schemaPath.split("/").at(-1);
}

function entityContractWithSchema(key, entry) {
  return {
    key,
    ...entry,
    schema: getEntitySchema(schemaFileName(entry.schema_path)),
  };
}

export function listActiveEntityContracts() {
  return Object.entries(registry.entity_contracts || {})
    .filter(([, entry]) => entry.status === "active")
    .map(([key, entry]) => entityContractWithSchema(key, entry));
}

export function getEntityContractDefinition(identifier) {
  const match = Object.entries(registry.entity_contracts || {}).find(([key, entry]) => {
    return (
      key === identifier ||
      entry.contract_id === identifier ||
      entry.contract_name === identifier ||
      entry.schema_path === identifier ||
      schemaFileName(entry.schema_path) === identifier
    );
  });
  if (!match) {
    throw new Error(`entity_contract_not_found:${identifier}`);
  }
  return entityContractWithSchema(match[0], match[1]);
}
