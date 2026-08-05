import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";

export const CODEX_RUNTIME_SETTINGS_ID = "default";
export const CODEX_REASONING_EFFORTS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
export const DEFAULT_CODEX_REASONING_EFFORT = "xhigh";

const REASONING_EFFORT_SET = new Set(CODEX_REASONING_EFFORTS);

export async function loadCodexRuntimeSettings(persistence, {
  env = process.env,
} = {}) {
  const stored = await persistence
    .getDocument(DESK_COLLECTIONS.deskAiRuntimeSettings, CODEX_RUNTIME_SETTINGS_ID)
    .catch((error) => {
      if (isMissingDocument(error)) return null;
      throw error;
    });
  return normalizeCodexRuntimeSettings(stored, { env });
}

export function normalizeCodexRuntimeSettings(value = null, {
  env = process.env,
} = {}) {
  const storedEffort = value?.reasoning_effort ?? value?.reasoningEffort;
  const environmentEffort = env?.DESK_CODEX_REASONING_EFFORT;
  const source = storedEffort
    ? "database"
    : environmentEffort
      ? "environment"
      : "default";
  const reasoningEffort = normalizeCodexReasoningEffort(
    storedEffort ?? environmentEffort,
    DEFAULT_CODEX_REASONING_EFFORT,
  );
  return {
    id: value?.settings_id || value?.id || CODEX_RUNTIME_SETTINGS_ID,
    revision: Number(value?.revision || 0),
    reasoningEffort,
    source,
    supportedReasoningEfforts: [...CODEX_REASONING_EFFORTS],
    appliesTo: "next_analysis",
    updatedAt: value?.updated_at_utc || value?.updatedAt || null,
    updatedBy: value?.updated_by || value?.updatedBy || null,
  };
}

export function normalizeCodexReasoningEffort(value, fallback = DEFAULT_CODEX_REASONING_EFFORT) {
  const normalized = String(value || "").trim().toLowerCase();
  if (REASONING_EFFORT_SET.has(normalized)) return normalized;
  const normalizedFallback = String(fallback || "").trim().toLowerCase();
  return REASONING_EFFORT_SET.has(normalizedFallback)
    ? normalizedFallback
    : DEFAULT_CODEX_REASONING_EFFORT;
}

export function isCodexReasoningEffort(value) {
  return REASONING_EFFORT_SET.has(String(value || "").trim().toLowerCase());
}

function isMissingDocument(error) {
  return /document_not_found/i.test(String(error?.message || error || ""));
}
