import { createHash } from "node:crypto";
import { isGrainsRth } from "./us-grains-data-quality.js";
import { chicagoMinuteOfUtc } from "./us-grains-causal-session.js";

export function auditCausalDetection({
  source,
  detect,
  startDate,
  endDate,
  codeHashes = {},
} = {}) {
  if (!source || typeof detect !== "function")
    throw new Error("SOURCE_AND_DETECTOR_REQUIRED");
  const rowsBySymbol = candlesToRowsBySymbol(source.candles || []);
  const events = source.agriEvents || source.agri_events || [];
  const coverage = source.agriCalendarCoverage || [];
  const base = detectorInput({
    rowsBySymbol,
    events,
    coverage,
    startDate,
    endDate,
    asOfUtc: endOfDay(endDate),
  });
  const full = detect(base);
  const signals = array(full.raw_signals);
  const cutoffs = decisionCutoffs({ rowsBySymbol, startDate, endDate });
  const prefixes = cutoffs.map((cutoff) =>
    prefixCheck({
      cutoff,
      fullSignals: signals,
      rowsBySymbol,
      events,
      coverage,
      detect,
    }),
  );
  const changed = prefixes.filter((item) => !item.invariant);
  const unexpected = prefixes.reduce(
    (count, item) => count + item.unexpected_prefix_count,
    0,
  );
  const legacy = legacySignals(source, startDate, endDate);
  const comparison = compareSignals(legacy, signals);
  return causalAuditReport({ source, codeHashes, full, signals, prefixes, changed, unexpected, comparison });
}

function causalAuditReport({ source, codeHashes, full, signals, prefixes, changed, unexpected, comparison }) {
  return {
    schema_version: "grains_causal_detection_audit_v1",
    authority: "OFFLINE_DETECTOR_ONLY_NO_R_HUMANGATE_OR_PROVIDER_RESULT",
    input: {
      as_of: source.asOf || null,
      candle_count: source.candles?.length || 0,
      input_sha256: source.input_sha256 || null,
    },
    code_hashes: codeHashes,
    detector: {
      suite_version: full.suite_version || null,
      raw_signal_count: signals.length,
    },
    invariance: {
      unit: "ALL_CLOSED_RTH_M5_CUTOFFS_INCLUDING_NO_SIGNAL",
      scope: "INDEPENDENT_TRADING_DAY_WITH_PRIOR_DATA_RETAINED",
      checked: prefixes.length,
      unchanged: prefixes.length - changed.length,
      changed_count: changed.length,
      unexpected_prefix_count: unexpected,
      counterexamples: changed.slice(0, 20),
    },
    legacy_comparison: comparison,
    receipt_provenance: "UNVERIFIED_LEGACY_RECEIPT_TIMES",
  };
}

export function candlesToRowsBySymbol(candles = []) {
  const result = {};
  for (const candle of candles) {
    const parts = String(candle.feed_id || "").split("__");
    if (parts.length < 4) continue;
    const key = `${parts[2]}:${parts[3]}`.toUpperCase();
    (result[key] ||= []).push({ ...candle });
  }
  return result;
}

export function compareSignals(legacy = [], causal = []) {
  const left = groupSignals(legacy.map(comparisonSignal));
  const right = groupSignals(causal.map(comparisonSignal));
  const keys = new Set([...left.keys(), ...right.keys()]);
  const missing = [];
  const added = [];
  const matched = [];
  for (const key of keys) {
    const oldSignals = left.get(key) || [];
    const newSignals = right.get(key) || [];
    const pairCount = Math.min(oldSignals.length, newSignals.length);
    for (let index = 0; index < pairCount; index += 1) {
      matched.push(signalDiff(key, oldSignals[index], newSignals[index]));
    }
    missing.push(
      ...Array(Math.max(0, oldSignals.length - pairCount)).fill(key),
    );
    added.push(...Array(Math.max(0, newSignals.length - pairCount)).fill(key));
  }
  return {
    legacy_count: legacy.length,
    causal_count: causal.length,
    matched_count: matched.length,
    missing_legacy_count: missing.length,
    new_causal_count: added.length,
    missing_legacy_examples: missing.slice(0, 20),
    new_causal_examples: added.slice(0, 20),
    differences: matched.filter((item) => item.differences.length).slice(0, 50),
  };
}

function comparisonSignal(row) {
  const envelope = row.payload;
  if (envelope?.type !== "signal.emitted" || !envelope.payload?.signal_id)
    return row;
  const embedded = envelope.payload;
  return {
    ...embedded,
    ...row,
    setup: embedded.setup,
    signal_quality: embedded.signal_quality,
    payload: embedded.payload,
  };
}

export function inputSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function prefixCheck({
  cutoff,
  fullSignals,
  rowsBySymbol,
  events,
  coverage,
  detect,
}) {
  const date = cutoff.slice(0, 10);
  const prefixRows = Object.fromEntries(
    Object.entries(rowsBySymbol).map(([key, rows]) => [
      key,
      rows.filter((row) => closedByCutoff(key, row, cutoff)),
    ]),
  );
  const result = detect(
    detectorInput({
      rowsBySymbol: prefixRows,
      events: availableEvents(events, cutoff),
      coverage: coverage.filter(
        (item) => Date.parse(item.asOf) <= Date.parse(cutoff),
      ),
      startDate: date,
      endDate: date,
      asOfUtc: cutoff,
    }),
  );
  const prefixSignals = throughCutoff(array(result.raw_signals), cutoff);
  const expected = throughCutoff(fullSignals, cutoff);
  const mutated = detect(
    detectorInput({
      rowsBySymbol: perturbFuture(rowsBySymbol, cutoff),
      events,
      coverage,
      startDate: date,
      endDate: date,
      asOfUtc: cutoff,
    }),
  );
  const differences = compareCollections(expected, prefixSignals);
  const futureInvariant = compareCollections(
    prefixSignals,
    throughCutoff(array(mutated.raw_signals), cutoff),
  ).equal;
  return {
    cutoff_utc: cutoff,
    invariant: differences.equal && futureInvariant,
    reason: !differences.equal
      ? "SIGNAL_CHANGED_AT_PREFIX"
      : !futureInvariant
        ? "FUTURE_PRICE_PERTURBATION_CHANGED_SIGNAL"
        : null,
    unexpected_prefix_count: differences.extra,
    expected_signal_count: expected.length,
    future_price_invariant: futureInvariant,
  };
}

function decisionCutoffs({ rowsBySymbol, startDate, endDate }) {
  const cutoffs = new Set();
  for (const [key, rows] of Object.entries(rowsBySymbol)) {
    if (!key.endsWith(":5")) continue;
    for (const row of rows) {
      if (
        !isGrainsRth(row.timestamp_utc) ||
        chicagoMinuteOfUtc(row.timestamp_utc) + 5 > 800
      )
        continue;
      const cutoff = new Date(
        Date.parse(row.timestamp_utc) + 300_000,
      ).toISOString();
      if (within(cutoff, startDate, endDate)) cutoffs.add(cutoff);
    }
  }
  return [...cutoffs].sort();
}

function throughCutoff(signals, cutoff) {
  return signals.filter((signal) => {
    const at = signal.source_data_cutoff_utc || signal.generated_at_utc;
    return (
      at?.slice(0, 10) === cutoff.slice(0, 10) &&
      Date.parse(at) <= Date.parse(cutoff)
    );
  });
}

function compareCollections(expected, actual) {
  const expectedHashes = expected.map(canonicalSignalHash).sort();
  const actualHashes = actual.map(canonicalSignalHash).sort();
  const expectedKeys = new Set(expected.map(signalKey));
  return {
    equal: JSON.stringify(expectedHashes) === JSON.stringify(actualHashes),
    extra: actual.filter((item) => !expectedKeys.has(signalKey(item))).length,
  };
}

function perturbFuture(rowsBySymbol, cutoff) {
  return Object.fromEntries(
    Object.entries(rowsBySymbol).map(([key, rows]) => [
      key,
      rows.map((row) => {
        if (closedByCutoff(key, row, cutoff)) return row;
        const offset = key.startsWith("ZC") ? 1000 : 500;
        return {
          ...row,
          open: Number(row.open) + offset,
          high: Number(row.high) + offset,
          low: Number(row.low) + offset,
          close: Number(row.close) + offset,
        };
      }),
    ]),
  );
}

function detectorInput({
  rowsBySymbol,
  events,
  coverage,
  startDate,
  endDate,
  asOfUtc,
}) {
  return {
    rowsBySymbol,
    agriEvents: events,
    agriCalendarCoverage: coverage,
    instruments: ["ZW", "ZC"],
    startDate,
    endDate,
    asOfUtc,
  };
}

function endOfDay(value) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59.999Z`
    : value;
}

function availableEvents(events, cutoff) {
  return array(events).filter((event) => {
    const available = event.source_published_at_utc || event.known_at_utc;
    return Boolean(available) && Date.parse(available) <= Date.parse(cutoff);
  });
}

function closedByCutoff(key, row, cutoff) {
  const timeframe = key.endsWith(":1")
    ? 60_000
    : key.endsWith(":5")
      ? 300_000
      : 0;
  const opened = Date.parse(row.timestamp_utc || "");
  const closed = opened + timeframe;
  return Number.isFinite(opened) && closed <= Date.parse(cutoff);
}

function legacySignals(source, startDate, endDate) {
  return array(source.signals).filter((signal) =>
    within(signal.generated_at_utc, startDate, endDate),
  );
}

function signalDiff(key, oldSignal, newSignal) {
  const differences = [];
  if (family(oldSignal) !== family(newSignal)) differences.push("family");
  if (oldSignal.direction !== newSignal.direction)
    differences.push("direction");
  if (planHash(oldSignal) !== planHash(newSignal)) differences.push("plan");
  if (oldSignal.expires_at_utc !== newSignal.expires_at_utc)
    differences.push("ttl");
  if (context(oldSignal) !== context(newSignal)) differences.push("context");
  return { key, differences };
}

function signalKey(signal = {}) {
  return [
    signal.instrument,
    family(signal),
    signal.direction,
    sourceBarOpen(signal),
  ].join("|");
}

function groupSignals(signals) {
  const groups = new Map();
  for (const signal of signals) {
    const key = signalKey(signal);
    const values = groups.get(key) || [];
    values.push(signal);
    groups.set(key, values);
  }
  return groups;
}

function sourceBarOpen(signal = {}) {
  const explicit = explicitBarOpen(signal);
  if (explicit)
    return Number.isFinite(Date.parse(explicit))
      ? new Date(explicit).toISOString()
      : null;
  const close = Date.parse(
    signal.generated_at_utc || signal.source_data_cutoff_utc || "",
  );
  const version = String(
    signal.signal_quality?.strategy_suite_version ||
      signal.payload?.signal_quality?.strategy_suite_version ||
      "",
  );
  const causal = version.includes("causal") || /v2/.test(version);
  return Number.isFinite(close)
    ? new Date(close - (causal ? 5 * 60_000 : 0)).toISOString()
    : null;
}

function explicitBarOpen(signal) {
  const payload = signal.payload || {};
  return (
    signal.source_bar_open_utc ||
    signal.bar_open_utc ||
    payload.source_bar_open_utc ||
    payload.bar_open_utc ||
    payload.bar_open
  );
}

function family(signal = {}) {
  const setup = signal.setup || {};
  const payload = signal.payload || {};
  const payloadSetup = payload.setup || {};
  return (
    setup.family ||
    setup.setup_type ||
    setup.setup_kind ||
    payload.strategy_family ||
    payloadSetup.family ||
    payloadSetup.setup_type ||
    payloadSetup.setup_kind ||
    null
  );
}

function planHash(signal = {}) {
  const plan =
    signal.proposed_trade_plan || signal.payload?.proposed_trade_plan || null;
  return plan ? stableHash(plan) : null;
}

function context(signal = {}) {
  return signal.setup?.context ? stableHash(signal.setup.context) : null;
}

function within(value, startDate, endDate) {
  const time = Date.parse(value || "");
  return (
    Number.isFinite(time) &&
    (!startDate || value.slice(0, 10) >= startDate) &&
    (!endDate || value.slice(0, 10) <= endDate)
  );
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function canonicalSignalHash(signal) {
  return stableHash(stripNonSemantic(signal));
}

function stripNonSemantic(value, path = "") {
  if (Array.isArray(value))
    return value.map((item, index) =>
      stripNonSemantic(item, `${path}[${index}]`),
    );
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (
      [
        "created_at_utc",
        "published_at_utc",
        "consumed_at_utc",
        "status",
      ].includes(key) ||
      fullPath === "payload.aggregate_id" ||
      fullPath === "payload.occurred_at_utc"
    )
      continue;
    result[key] = stripNonSemantic(item, fullPath);
  }
  return result;
}

function stableHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}
