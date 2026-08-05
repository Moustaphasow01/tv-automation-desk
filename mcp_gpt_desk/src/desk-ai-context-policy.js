import { DESK_AI_CONTEXT_TOOL_NAMES } from "./desk-ai-context-capability.js";

const REPLAY_ONLY_TOOLS = new Set(["get_replay_section_page"]);
const VALID_NEWS_SESSIONS = new Set(["asia_open", "asia_to_london", "ny_open"]);
const MARKET_COVERAGE_STATUSES = new Set(["COMPLETE", "DEGRADED", "UNAVAILABLE"]);

export const DESK_CONTEXT_DEEP_ROW_ORDER = "latest_first";

export function deskContextToolNamesForScope(scope) {
  return DESK_AI_CONTEXT_TOOL_NAMES.filter((tool) => (
    scope === "replay" || !REPLAY_ONLY_TOOLS.has(tool)
  ));
}

export function requireDeskContextNewsSession(value) {
  const session = String(value || "").trim();
  if (!VALID_NEWS_SESSIONS.has(session)) {
    throw contextPolicyError(
      "AI_CONTEXT_NEWS_SESSION_INVALID",
      `The claim session cannot be used for cutoff-safe news: ${session || "missing"}.`,
    );
  }
  return session;
}

export function evaluateDeskMarketContextCoverage({
  domainName,
  domain,
  snapshots = {},
  datasets = [],
} = {}) {
  if (!domain || typeof domain !== "object") {
    throw contextPolicyError(
      "AI_CONTEXT_DOMAIN_INVALID",
      `Cannot evaluate an unknown market domain: ${domainName || "missing"}.`,
    );
  }

  const materialDatasets = (datasets || []).filter((entry) => (
    entry?.ok !== false && hasMaterialData(entry?.rows ?? entry?.csv)
  ));
  const presentInstruments = new Set();
  collectInstrumentEvidence(snapshots, presentInstruments);
  for (const entry of materialDatasets) {
    collectInstrumentEvidence(entry.rows ?? entry.csv, presentInstruments);
    collectInstrumentFromDatasetName(entry.dataset, presentInstruments);
  }

  const requirements = domainName === "megacaps"
    ? [
      {
        unit: "INDICES",
        present: materialDatasets.some((entry) => (
          ["indices_asie_europe", "indices_asie_europe_H4"].includes(entry.dataset)
        )),
      },
      {
        unit: "MEGACAPS",
        present: materialDatasets.some((entry) => (
          ["ny_close_mega_caps", "mega_caps_premarket", "mega_caps_premarket_H4"].includes(entry.dataset)
        )),
      },
    ]
    : [...(domain.instruments || [])].map((instrument) => ({
      unit: instrument,
      present: presentInstruments.has(instrument),
    }));

  const presentUnits = requirements.filter((entry) => entry.present).map((entry) => entry.unit);
  const missingUnits = requirements.filter((entry) => !entry.present).map((entry) => entry.unit);
  const status = presentUnits.length === 0
    ? "UNAVAILABLE"
    : missingUnits.length === 0
      ? "COMPLETE"
      : "DEGRADED";

  return {
    status: MARKET_COVERAGE_STATUSES.has(status) ? status : "UNAVAILABLE",
    required_units: requirements.map((entry) => entry.unit),
    present_units: presentUnits,
    missing_units: missingUnits,
    present_instruments: [...presentInstruments].sort(),
    material_dataset_ids: materialDatasets.map((entry) => entry.dataset),
    dataset_error_ids: (datasets || [])
      .filter((entry) => entry?.ok === false)
      .map((entry) => entry.dataset),
  };
}

function collectInstrumentEvidence(value, target, seen = new Set()) {
  if (value === null || value === undefined) return;
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectInstrumentEvidence(item, target, seen);
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const keyInstrument = normalizeInstrumentToken(key);
    if (keyInstrument && hasMaterialData(item)) target.add(keyInstrument);
    if (isInstrumentField(key)) {
      const fieldInstrument = normalizeInstrumentToken(item);
      if (fieldInstrument) target.add(fieldInstrument);
    }
    collectInstrumentEvidence(item, target, seen);
  }
}

function collectInstrumentFromDatasetName(dataset, target) {
  const name = String(dataset || "").toUpperCase();
  const singleInstrument = /^(MNQ|MES|NQ|ES)(?:_|$)/.exec(name)?.[1] || null;
  if (singleInstrument) target.add(singleInstrument);
}

function normalizeInstrumentToken(value) {
  let token = String(value || "").trim().toUpperCase();
  if (!token) return null;
  if (token.includes(":")) token = token.split(":").at(-1);
  token = token.replace(/\s+/g, "");
  token = token.replace(/1!$/, "");
  const prefix = /^(MNQ|MES|NQ|ES|DXY|VIX|US10Y|US02Y|GC|CL)(?:_|$)/.exec(token)?.[1];
  return prefix || null;
}

function isInstrumentField(key) {
  return [
    "asset",
    "asset_id",
    "instrument",
    "instrument_id",
    "symbol",
    "ticker",
    "feed_symbol",
  ].includes(String(key || "").toLowerCase());
}

function hasMaterialData(value) {
  if (Array.isArray(value)) return value.some(hasMaterialData);
  if (!value || typeof value !== "object") {
    return value !== null && value !== undefined && value !== "";
  }
  return Object.entries(value).some(([key, item]) => (
    !["ok", "complete", "status", "error", "error_code"].includes(key)
    && hasMaterialData(item)
  ));
}

function contextPolicyError(code, message) {
  return Object.assign(new Error(message), { code });
}
