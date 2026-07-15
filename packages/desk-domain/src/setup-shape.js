export function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function priceFromValue(value) {
  const numeric = numberOrNull(value);
  if (numeric !== null) return numeric;
  if (!value || typeof value !== "object") return null;
  const direct = numberOrNull(firstPresent(value.price, value.level, value.value, value.target));
  if (direct !== null) return direct;
  const from = numberOrNull(value.from);
  const to = numberOrNull(value.to);
  if (from !== null && to !== null) return (from + to) / 2;
  return firstPresent(from, to) ?? null;
}

export function setupEntry(setup = {}) {
  return priceFromValue(firstPresent(setup.entry_price, setup.entry, setup.entry_zone, setup.entryZone));
}

export function setupStop(setup = {}) {
  return priceFromValue(firstPresent(setup.stop_loss, setup.stop, setup.sl_price, setup.sl));
}

export function setupTarget(setup = {}) {
  return priceFromValue(firstPresent(
    setup.take_profit_1,
    setup.tp1_price,
    setup.tp1,
    setup.take_profit,
    setup.target,
    setup.take_profits,
  ));
}

export function setupDirection(setup = {}) {
  const raw = String(firstPresent(setup.direction, setup.side, setup.order_type) || "").toLowerCase();
  if (raw.includes("buy") || raw === "long") return "long";
  if (raw.includes("sell") || raw === "short") return "short";
  if (raw === "neutral" || raw === "wait") return raw;
  return "unknown";
}

export function setupInstrument(setup = {}) {
  return String(firstPresent(setup.instrument, setup.symbol, setup.ticker) || "").toUpperCase();
}

export function setupKey(setup = {}) {
  return String(firstPresent(setup.setup_id, setup.setup_key, setup.setup_name, setup.setup_type) || "").toLowerCase();
}

export function firstTargetFromCollection(value) {
  if (Array.isArray(value)) {
    const first = value.find((item) => item !== undefined && item !== null);
    if (!first) return null;
    return priceFromValue(firstPresent(first.target, first.price, first.level, first));
  }
  if (value && typeof value === "object") {
    return priceFromValue(firstPresent(value.tp1, value.take_profit_1, value.target, value.price, value.level));
  }
  return priceFromValue(value);
}

export function computeRewardRisk(setup = {}) {
  const direction = setupDirection(setup);
  const entry = setupEntry(setup);
  const stop = setupStop(setup);
  const target = firstTargetFromCollection(setupTarget(setup) ?? setup.take_profits);
  if (!["long", "short"].includes(direction) || entry === null || stop === null || target === null) {
    return {
      direction,
      entry,
      stop,
      target,
      riskPoints: null,
      rewardPoints: null,
      rr: null,
    };
  }
  const riskPoints = Math.abs(entry - stop);
  const rewardPoints = Math.abs(target - entry);
  return {
    direction,
    entry,
    stop,
    target,
    riskPoints,
    rewardPoints,
    rr: riskPoints > 0 ? round(rewardPoints / riskPoints, 4) : null,
  };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
