export const DESK_DATA_AVAILABILITY_POLICY_VERSION = "2.0.0";

export const CANONICAL_TRADING_INSTRUMENTS = Object.freeze(["MNQ", "MES"]);
export const CONTEXT_INSTRUMENTS = Object.freeze([
  "NQ",
  "ES",
  "DXY",
  "VIX",
  "US10Y",
  "US02Y",
  "CL",
  "GC",
]);

export const DEFAULT_CONTEXT_MARKET_INSTRUMENTS = Object.freeze(["NQ", "ES"]);

const EXPECTED_NON_FRESH_STATES = new Set(["stale_market_closed", "not_yet_open"]);
const CONTEXT_FAILURE_CODES = new Set([
  "REPLAY_STORAGE_TEMPORARILY_UNAVAILABLE",
  "LIVE_STORAGE_TEMPORARILY_UNAVAILABLE",
  "DATA_NOT_READY",
]);

export function isCanonicalTradingInstrument(value) {
  return CANONICAL_TRADING_INSTRUMENTS.includes(String(value || "").toUpperCase());
}

export function normalizeDeskInstrumentScopes(input = {}) {
  const legacy = normalizeInstrumentList(input.instruments);
  const explicitTrading = normalizeInstrumentList(input.trading_instruments);
  const explicitContext = normalizeInstrumentList(input.context_instruments);
  const tradingCandidates = explicitTrading.length
    ? explicitTrading
    : legacy.filter(isCanonicalTradingInstrument);
  const contextCandidates = explicitContext.length
    ? explicitContext
    : legacy.filter((instrument) => DEFAULT_CONTEXT_MARKET_INSTRUMENTS.includes(instrument));
  const tradingInstruments = tradingCandidates.filter(isCanonicalTradingInstrument);
  const contextInstruments = contextCandidates
    .filter((instrument) => DEFAULT_CONTEXT_MARKET_INSTRUMENTS.includes(instrument));
  const resolvedTrading = tradingInstruments.length
    ? tradingInstruments
    : [...CANONICAL_TRADING_INSTRUMENTS];
  const resolvedContext = contextInstruments.length
    ? contextInstruments
    : [...DEFAULT_CONTEXT_MARKET_INSTRUMENTS];
  return {
    trading_instruments: resolvedTrading,
    context_instruments: resolvedContext,
    instruments: legacy.length ? legacy : unique([...resolvedTrading, ...resolvedContext]),
  };
}


export function isExpectedNonFreshAvailability(value) {
  return EXPECTED_NON_FRESH_STATES.has(String(value || "").toLowerCase());
}

export function finalizeDeskDataQuality({
  blockers = [],
  missing = [],
  warnings = [],
  stale = [],
  informational = [],
  antiLookaheadCompliant = true,
  sourceCoverage = null,
  rawRefsAvailable,
} = {}) {
  const normalized = {
    blockers: unique(blockers),
    missing: unique(missing),
    warnings: unique(warnings),
    stale: unique(stale),
    informational: unique(informational),
  };
  const blocked = normalized.blockers.length > 0 || antiLookaheadCompliant === false;
  const degraded = normalized.missing.length > 0 || normalized.warnings.length > 0;
  const status = blocked ? "missing" : degraded ? "degraded" : normalized.stale.length ? "stale" : "ready";
  const result = {
    status,
    execution_allowed: !blocked,
    analysis_mode: blocked ? "blocked" : status === "ready" ? "normal" : "degraded",
    new_entries_allowed: !blocked,
    position_management_allowed: true,
    severity_policy_version: DESK_DATA_AVAILABILITY_POLICY_VERSION,
    ...normalized,
    explicit_missing_data: unique([
      ...normalized.blockers,
      ...normalized.missing,
      ...normalized.warnings,
      ...normalized.stale,
    ]),
    anti_lookahead_compliant: antiLookaheadCompliant !== false,
  };
  if (sourceCoverage !== undefined) result.source_coverage = sourceCoverage;
  if (rawRefsAvailable !== undefined) result.raw_refs_available = rawRefsAvailable === true;
  return result;
}

export function deskDataAvailabilityWorkerRules() {
  return [
    `- Applique exclusivement data_quality selon severity_policy_version=${DESK_DATA_AVAILABILITY_POLICY_VERSION}; le backend decide de la severite, jamais le worker.`,
    "- Bloque l'analyse uniquement si data_quality.execution_allowed=false, analysis_mode=blocked, anti-lookahead non conforme, scope/contrat incoherent ou donnees canoniques MNQ/MES requises indisponibles.",
    "- missing_unexpected decrit un trou de source; il n'est pas automatiquement bloquant.",
    "- GC, CL, DXY, VIX, US10Y, US02Y, NQ/ES de confirmation, calendrier, news, indices et mega caps sont contextuels: leur absence isolee produit DEGRADED, jamais fail.",
    "- En DEGRADED, signale les donnees absentes, reduis la confiance, n'invente rien, puis sauvegarde et complete normalement le travail.",
    "- Une divergence mini/micro ne bloque pas si les flux canoniques MNQ/MES sont valides: utilise MNQ/MES, declare la divergence et poursuis en DEGRADED.",
    "- stale_market_closed et not_yet_open sont des etats normaux de session.",
    "- last_known/H4 sert au contexte, jamais a un trigger frais.",
    "- N'utilise jamais un code STORAGE_TEMPORARILY_UNAVAILABLE, DATA_NOT_READY ou fail pour la seule absence d'une donnee contextuelle.",
    "- La gestion deterministe d'une position ouverte reste autorisee meme si le contexte analytique est degrade.",
  ];
}

export function isContextOnlyWorkerFailure({ code, message } = {}) {
  const normalizedCode = String(code || "").toUpperCase();
  const normalizedMessage = String(message || "").toUpperCase();
  if (!normalizedMessage) return false;

  const explicitlyCanonicalMissing = /\b(MNQ|MES)\b/.test(normalizedMessage)
    && /(MISSING|ABSENT|EMPTY|INDISPONIBLE|UNAVAILABLE|ROW_COUNT=0)/.test(normalizedMessage)
    && !/(VERSUS|VS\.?|DIVERGEN|EQUIVALENT|CONTRATS? ÉQUIVALENTS?)/.test(normalizedMessage);
  if (explicitlyCanonicalMissing) return false;

  const contextGap = /\b(GC|DXY|CL|VIX|US10Y|US02Y|NEWS|CALENDAR|CALENDRIER|MEGA.?CAPS?|INDICES_ASIE_EUROPE)\b/.test(normalizedMessage);
  if (CONTEXT_FAILURE_CODES.has(normalizedCode) && contextGap) return true;

  if (normalizedCode === "STRUCTURAL_DATA_INCONSISTENCY") {
    return /(NQ.{0,80}MNQ|MNQ.{0,80}NQ|ES.{0,80}MES|MES.{0,80}ES|EQUIVALENT.CONTRACT|CONTRATS? ÉQUIVALENTS?)/.test(normalizedMessage);
  }
  return false;
}


function normalizeInstrumentList(items) {
  if (!Array.isArray(items)) return [];
  return unique(items.map((item) => String(item || "").trim().toUpperCase()));
}

function unique(items) {
  return [...new Set((items || []).filter((item) => item !== null && item !== undefined && item !== ""))];
}
