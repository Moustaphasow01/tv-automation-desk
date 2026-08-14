import { createHash } from "node:crypto";
import { canonicalSha256 } from "@tv-automation/desk-domain";

export const RESEARCH_STRATEGY_ITERATION_TASK_TYPE = "RESEARCH_STRATEGY_ITERATION";
export const RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION = "research_strategy_iteration_runner_v1";
export const RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION = "research_strategy_iteration_generator_v2_10";
export const RESEARCH_STRATEGY_ITERATION_OUTPUT_SCHEMA_VERSION = "research_strategy_iteration_output_v1";

export function researchStrategyIterationGeneratorSlug() {
  return RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION
    .replace(/^research_strategy_iteration_generator_/, "g")
    .replaceAll("_", "-");
}

export function canonicalTaskId(task = {}) {
  return requiredText(task.task_id || task.agent_task_id, "task_id");
}

export function conversationFromRunnerInput(runnerInput = {}) {
  const conversation = runnerInput.conversation?.conversation;
  if (!conversation) return null;
  return {
    conversation_id: conversation.conversation_id,
    external_conversation_ref: conversation.external_conversation_ref || null,
    thread_id: conversation.external_conversation_ref || null,
  };
}

export function stableUuid(value) {
  const hash = canonicalSha256(value).replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(hash[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function percentile(values, percentileValue) {
  const clean = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.round((clean.length - 1) * percentileValue)));
  return clean[index];
}

export function sha256Text(value) {
  return `sha256:${createHash("sha256").update(String(value ?? "")).digest("hex")}`;
}

export function semverBuildHash(value, length = 12) {
  const hash = value && typeof value === "object"
    ? canonicalSha256(value)
    : sha256Text(value);
  return hash.replace(/^sha256:/, "").slice(0, Math.max(1, length));
}

export function roundPrice(value) {
  return Math.round(Number(value) * 4) / 4;
}

export function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function boundedInteger(value, fallback, min = 0, max = 1_000) {
  const parsed = Math.trunc(Number(value));
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(selected, max));
}

export function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function text(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

export function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw coded("RESEARCH_ITERATION_FIELD_REQUIRED", `${field} is required.`, false);
  return normalized;
}

export function iso(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) throw coded("RESEARCH_ITERATION_TIMESTAMP_INVALID", "Invalid timestamp.", false, { value });
  return new Date(parsed).toISOString();
}

export function timeframeValue(value) {
  const normalized = String(value || "").toUpperCase().replace(/^M/, "");
  return normalized || "5";
}

export function coded(code, message, retryable, details = {}) {
  return Object.assign(new Error(message || code), { code, retryable, details });
}
