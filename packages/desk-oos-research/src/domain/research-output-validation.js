import { requireResearch } from "./research-evidence.js";

/** Small strict validator for the bounded research-output schema subset, not trading policy. */
export function validateResearchOutput(value, schema, path = "$", depth = 0) {
  requireResearch(depth < 30, "RESEARCH_OUTPUT_DEPTH_INVALID", { path });
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  requireResearch(types.includes(actual), "RESEARCH_OUTPUT_TYPE_INVALID", { path });
  if (actual === "number") requireResearch(Number.isFinite(value), "RESEARCH_OUTPUT_NUMBER_INVALID", { path });
  if (schema.enum) requireResearch(schema.enum.includes(value), "RESEARCH_OUTPUT_ENUM_INVALID", { path });
  if (actual === "object") validateObject(value, schema, path, depth);
  if (actual === "array") {
    requireResearch(value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? 100000),
      "RESEARCH_OUTPUT_ARRAY_INVALID", { path });
    value.forEach((item, i) => validateResearchOutput(item, schema.items, `${path}[${i}]`, depth + 1));
  }
  if (actual === "string") requireResearch(value.length <= 50000, "RESEARCH_OUTPUT_TEXT_TOO_LARGE", { path });
  return value;
}

function validateObject(value, schema, path, depth) {
  const properties = schema.properties ?? {};
  requireResearch(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    "RESEARCH_OUTPUT_OBJECT_INVALID", { path });
  requireResearch((schema.required ?? []).every(key => Object.hasOwn(value, key)), "RESEARCH_OUTPUT_REQUIRED", { path });
  requireResearch(schema.additionalProperties !== false || Object.keys(value).every(key => Object.hasOwn(properties, key)),
    "RESEARCH_OUTPUT_FIELDS_INVALID", { path });
  for (const [key, field] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) validateResearchOutput(value[key], field, `${path}.${key}`, depth + 1);
  }
}
