import { z } from "zod";

export const GPT_TELEMETRY_SCHEMA_VERSION = "1.0.0";

export const gptTelemetrySchema = z.object({
  provider: z.string().min(1).max(80).optional(),
  model: z.string().min(1).max(160).optional(),
  request_id: z.string().min(1).max(240).optional(),
  input_tokens: z.number().int().min(0).optional(),
  output_tokens: z.number().int().min(0).optional(),
  total_tokens: z.number().int().min(0).optional(),
  cached_input_tokens: z.number().int().min(0).optional(),
  reasoning_tokens: z.number().int().min(0).optional(),
  reasoning_effort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]).optional(),
  runtime_settings_revision: z.number().int().min(0).optional(),
  cost_usd: z.number().min(0).optional(),
  api_latency_ms: z.number().int().min(0).optional(),
  started_at_utc: z.string().datetime({ offset: true }).optional(),
  completed_at_utc: z.string().datetime({ offset: true }).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "telemetry must contain at least one measured field",
});

export function normalizeGptTelemetry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inputTokens = nonNegativeInteger(value.input_tokens ?? value.prompt_tokens ?? value.inputTokens);
  const outputTokens = nonNegativeInteger(value.output_tokens ?? value.completion_tokens ?? value.outputTokens);
  const explicitTotal = nonNegativeInteger(value.total_tokens ?? value.totalTokens);
  const totalTokens = explicitTotal ?? (inputTokens !== null || outputTokens !== null
    ? Number(inputTokens || 0) + Number(outputTokens || 0)
    : null);
  const normalized = {
    schema_version: GPT_TELEMETRY_SCHEMA_VERSION,
    provider: optionalText(value.provider),
    model: optionalText(value.model ?? value.model_name ?? value.model_id),
    request_id: optionalText(value.request_id ?? value.requestId),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cached_input_tokens: nonNegativeInteger(value.cached_input_tokens ?? value.cached_tokens),
    reasoning_tokens: nonNegativeInteger(value.reasoning_tokens ?? value.reasoning_output_tokens),
    reasoning_effort: optionalText(value.reasoning_effort ?? value.reasoningEffort),
    runtime_settings_revision: nonNegativeInteger(value.runtime_settings_revision ?? value.runtimeSettingsRevision),
    cost_usd: nonNegativeNumber(value.cost_usd),
    api_latency_ms: nonNegativeInteger(value.api_latency_ms ?? value.latency_ms),
    started_at_utc: optionalText(value.started_at_utc),
    completed_at_utc: optionalText(value.completed_at_utc),
  };
  return Object.entries(normalized).some(([key, item]) => key !== "schema_version" && item !== null)
    ? normalized
    : null;
}

export function sameGptTelemetry(left, right) {
  return JSON.stringify(normalizeGptTelemetry(left)) === JSON.stringify(normalizeGptTelemetry(right));
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function nonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
