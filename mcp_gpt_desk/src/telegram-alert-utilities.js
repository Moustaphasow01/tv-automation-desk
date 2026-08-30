export function telegramSourceKindsToBaseline({ candidates = [], existingSourceKinds = [], globalBaseline = false } = {}) {
  const candidateKinds = new Set(candidates.map((candidate) => String(candidate?.sourceKind || "").trim()).filter(Boolean));
  if (globalBaseline) return candidateKinds;
  const existing = new Set(existingSourceKinds.map((value) => String(value || "").trim()).filter(Boolean));
  return new Set([...candidateKinds].filter((kind) => !existing.has(kind)));
}

export function telegramRetryDelaySeconds(error, attemptCount) {
  const exponential = 15 * (2 ** Math.max(0, Number(attemptCount || 0) - 1));
  const retryAfter = Number(error?.retryAfterSeconds);
  return Math.min(300, Math.max(exponential, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter + 1 : 0));
}

export function inferScope(item = {}) {
  const text = [item.scope, item.run_scope, item.workflow, item.workflow_id, item.run_id, item.process_id]
    .filter(Boolean).join(" ").toLowerCase();
  return text.includes("replay") || text.includes("backtest") ? "replay" : "live";
}

export function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function formatCounts(counts) {
  return Object.entries(counts).sort((left, right) => right[1] - left[1]).map(([key, value]) => `${key}: ${value}`).join("\n") || "Aucun élément";
}
