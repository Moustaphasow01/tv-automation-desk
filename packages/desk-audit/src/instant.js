export function parseInstant(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return timestamp;
}
