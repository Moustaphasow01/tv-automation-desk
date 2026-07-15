export function stableVNextId(prefix, left, right) {
  const clean = (value) => String(value || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "item";
  return `${prefix}_${clean(left)}_${clean(right)}`;
}
