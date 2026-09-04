const DIRECT_PRICE_KEYS = [
  "price",
  "value",
  "mid",
  "limitPrice",
  "limit_price",
  "entryPrice",
  "entry_price",
  "stopPrice",
  "stop_price",
  "targetPrice",
  "target_price",
] as const;

const LOWER_PRICE_KEYS = [
  "minPrice",
  "min_price",
  "lowerPrice",
  "lower_price",
  "low",
  "lower",
  "min",
  "from",
] as const;

const UPPER_PRICE_KEYS = [
  "maxPrice",
  "max_price",
  "upperPrice",
  "upper_price",
  "high",
  "upper",
  "max",
  "to",
] as const;

export function formatTradePlanPrice(value: unknown, fallback = "—"): string {
  if (isDisplayableScalar(value)) return displayScalar(value, fallback);
  const record = recordValue(value);
  if (!record) return fallback;

  const direct = firstPresent(record, DIRECT_PRICE_KEYS);
  if (direct !== undefined) return formatTradePlanPrice(direct, fallback);

  const lower = firstPresent(record, LOWER_PRICE_KEYS);
  const upper = firstPresent(record, UPPER_PRICE_KEYS);
  if (lower !== undefined && upper !== undefined) {
    return `${formatTradePlanPrice(lower, fallback)}–${formatTradePlanPrice(upper, fallback)}`;
  }
  if (lower !== undefined) return formatTradePlanPrice(lower, fallback);
  if (upper !== undefined) return formatTradePlanPrice(upper, fallback);

  return fallback;
}

function firstPresent(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function isDisplayableScalar(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

function displayScalar(value: number | string, fallback: string): string {
  if (value === "" || String(value).toLowerCase() === "unavailable") return fallback;
  if (typeof value === "number") return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(value);
  return String(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
