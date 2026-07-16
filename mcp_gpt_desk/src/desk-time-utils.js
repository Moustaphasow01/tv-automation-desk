export function normalizeUtcIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toISOString().replace(".000Z", "+00:00");
}
