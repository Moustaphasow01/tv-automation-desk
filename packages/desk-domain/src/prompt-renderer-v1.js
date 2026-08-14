import { canonicalSha256 } from "./execution-scope.js";

export const PROMPT_RENDER_SNAPSHOT_SCHEMA_VERSION_V1 = "prompt_render_snapshot_v1";
export const PROMPT_COMPOSITION_SCHEMA_VERSION_V1 = "prompt_composition_v1";
export const PROMPT_RENDERER_VERSION_V1 = "1.0.0";

export function renderPromptCompositionV1(input = {}) {
  const composition = normalizeComposition(input.composition);
  const variables = objectOrEmpty(input.variables);
  const issues = validateComposition(composition, variables);
  if (issues.length) return { ok: false, reasons: issues, snapshot: null };
  const renderedPrompt = renderItems(composition.items, variables);
  const snapshot = {
    schema_version: PROMPT_RENDER_SNAPSHOT_SCHEMA_VERSION_V1,
    renderer_version: PROMPT_RENDERER_VERSION_V1,
    composition_key: text(composition.composition_key),
    prompt_key: text(composition.prompt_key),
    semantic_version: text(composition.semantic_version),
    binding_key: text(input.binding_key || composition.binding_key),
    rendered_prompt: renderedPrompt,
    rendered_sha256: `sha256:${canonicalSha256(renderedPrompt)}`,
    variables_sha256: `sha256:${canonicalSha256(variables)}`,
    variables_redacted: redactVariables(variables, composition.variables_schema),
    composition_hash: promptCompositionHashV1(composition),
    model_context: objectOrEmpty(input.model_context),
    created_at_utc: text(input.created_at_utc),
  };
  return { ok: true, reasons: [], snapshot };
}

export function promptCompositionHashV1(composition = {}) {
  return `sha256:${canonicalSha256(normalizeComposition(composition))}`;
}

export function normalizePromptTemplateTextV1(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
}

export function validatePromptVariablesV1(schema = {}, variables = {}) {
  const normalizedSchema = objectOrEmpty(schema);
  const missing = requiredFields(normalizedSchema).filter((field) => getPath(variables, field) === undefined);
  const typeIssues = validateVariableTypes(normalizedSchema.properties, variables);
  return {
    ok: missing.length === 0 && typeIssues.length === 0,
    reasons: [
      ...missing.map((field) => `VARIABLE_REQUIRED:${field}`),
      ...typeIssues,
    ],
  };
}

export function redactPromptVariablesV1(variables = {}, schema = {}) {
  return redactVariables(objectOrEmpty(variables), objectOrEmpty(schema));
}

function normalizeComposition(composition = {}) {
  const value = objectOrEmpty(composition);
  return {
    schema_version: PROMPT_COMPOSITION_SCHEMA_VERSION_V1,
    composition_key: text(value.composition_key),
    prompt_key: text(value.prompt_key),
    semantic_version: text(value.semantic_version),
    binding_key: text(value.binding_key),
    variables_schema: objectOrEmpty(value.variables_schema),
    items: normalizeItems(value.items),
    metadata: objectOrEmpty(value.metadata),
  };
}

function normalizeItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      ordinal: Number.isInteger(item.ordinal) ? item.ordinal : index + 1,
      item_kind: text(item.item_kind || item.kind) || "STATIC_TEXT",
      item_key: text(item.item_key || item.key),
      template: normalizePromptTemplateTextV1(item.template ?? item.text ?? ""),
      content_sha256: text(item.content_sha256),
    }))
    .sort((left, right) => left.ordinal - right.ordinal);
}

function validateComposition(composition, variables) {
  const issues = [];
  if (!composition.composition_key) issues.push("COMPOSITION_KEY_REQUIRED");
  if (!composition.prompt_key) issues.push("PROMPT_KEY_REQUIRED");
  if (!composition.items.length) issues.push("COMPOSITION_ITEMS_REQUIRED");
  issues.push(...validateItemHashes(composition.items));
  issues.push(...validatePromptVariablesV1(composition.variables_schema, variables).reasons);
  issues.push(...missingTemplateVariables(composition.items, variables));
  return [...new Set(issues)];
}

function validateItemHashes(items) {
  return items
    .filter((item) => item.content_sha256 && item.content_sha256 !== `sha256:${canonicalSha256(item.template)}`)
    .map((item) => `ITEM_HASH_DRIFT:${item.item_key || item.ordinal}`);
}

function missingTemplateVariables(items, variables) {
  return [...new Set(items.flatMap((item) => templateVariables(item.template)))]
    .filter((field) => getPath(variables, field) === undefined)
    .map((field) => `VARIABLE_REQUIRED:${field}`);
}

function renderItems(items, variables) {
  return items.map((item) => renderTemplate(item.template, variables)).join("\n\n---\n\n");
}

function renderTemplate(template, variables) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => stringifyVariable(getPath(variables, key)));
}

function templateVariables(template) {
  return [...String(template || "").matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]);
}

function validateVariableTypes(properties = {}, variables = {}) {
  return Object.entries(objectOrEmpty(properties)).flatMap(([field, definition]) => {
    const value = getPath(variables, field);
    if (value === undefined || !definition?.type) return [];
    return matchesType(value, definition.type) ? [] : [`VARIABLE_TYPE_INVALID:${field}:${definition.type}`];
  });
}

function matchesType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function requiredFields(schema = {}) {
  return Array.isArray(schema.required) ? schema.required.filter((field) => typeof field === "string") : [];
}

function redactVariables(variables, schema) {
  return Object.fromEntries(Object.entries(variables).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [
    key,
    shouldRedact(key, schema?.properties?.[key]) ? "[REDACTED]" : redactNested(value, schema?.properties?.[key]),
  ]));
}

function redactNested(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return redactVariables(value, objectOrEmpty(schema));
}

function shouldRedact(key, schema) {
  return schema?.secret === true || /secret|token|password|api[_-]?key|pin/i.test(key);
}

function getPath(source, pathValue) {
  return String(pathValue || "").split(".").reduce((cursor, part) => (cursor && Object.prototype.hasOwnProperty.call(cursor, part) ? cursor[part] : undefined), source);
}

function stringifyVariable(value) {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
