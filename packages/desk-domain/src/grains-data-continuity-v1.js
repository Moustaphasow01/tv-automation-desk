export const GRAINS_DATA_POLICIES = Object.freeze({
  STRICT: "M1_M5_STRICT",
  M5_FALLBACK: "M5_FALLBACK",
});

export function normalizeGrainsDataPolicy(value = GRAINS_DATA_POLICIES.STRICT) {
  if (Object.values(GRAINS_DATA_POLICIES).includes(value)) return value;
  const error = new Error("GRAINS_DATA_POLICY_INVALID");
  error.code = "GRAINS_DATA_POLICY_INVALID";
  throw error;
}

export function requiredGrainsTimeframes({ policy, instruments = [] } = {}) {
  const resolved = normalizeGrainsDataPolicy(policy);
  const grainsOnly = instruments.length > 0
    && instruments.every((instrument) => ["ZC", "ZW"].includes(instrument));
  return resolved === GRAINS_DATA_POLICIES.M5_FALLBACK && grainsOnly
    ? ["5"] : ["1", "5"];
}

// M5 admission is stricter than a row-count waiver: its own quality must be READY.
// The original M1 evidence is retained, never relabelled READY or reconstructed.
export function evaluateGrainsDataContinuity({ policy, instrument, timeframes }) {
  const dataPolicy = normalizeGrainsDataPolicy(policy);
  const required = requiredGrainsTimeframes({ policy: dataPolicy, instruments: [instrument] });
  const m5Only = required.length === 1;
  const blocked = required.some((tf) => timeframes?.[`M${tf}`]?.status !== "READY");
  const degraded = m5Only && timeframes?.M1?.status !== "READY";
  return {
    data_policy: dataPolicy,
    data_mode: blocked ? "BLOCKED" : degraded ? "M5_FALLBACK" : "M1_M5",
    required_timeframes: required,
    optional_timeframes: m5Only ? ["1"] : [],
    tradeable: !blocked,
    status: blocked ? "BLOCKED" : degraded ? "DEGRADED" : "TRADEABLE",
    blocking_issues: required.flatMap((tf) => frameBlockingIssues(timeframes?.[`M${tf}`], tf)),
    reason_codes: !blocked && degraded ? ["US_GRAINS_M1_UNAVAILABLE_M5_FALLBACK"] : [],
  };
}

function frameBlockingIssues(frame, timeframe) {
  if (frame?.status === "READY") return [];
  const issues = frame?.issues?.length ? frame.issues : ["QUALITY_UNAVAILABLE_BLOCKING"];
  return issues.map((code) => `M${timeframe}_${code}`);
}
