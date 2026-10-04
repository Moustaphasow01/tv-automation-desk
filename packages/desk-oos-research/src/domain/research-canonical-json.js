/** Key order is not an analytical difference; array order and all original values are preserved. */
export function researchCanonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, sortKeys(value[key])]));
  return value;
}
