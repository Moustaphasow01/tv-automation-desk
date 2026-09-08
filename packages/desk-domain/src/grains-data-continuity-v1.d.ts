export type GrainsDataPolicy = "M1_M5_STRICT" | "M5_FALLBACK";
export const GRAINS_DATA_POLICIES: Readonly<{ STRICT: "M1_M5_STRICT"; M5_FALLBACK: "M5_FALLBACK" }>;
export function normalizeGrainsDataPolicy(value?: GrainsDataPolicy): GrainsDataPolicy;
export function requiredGrainsTimeframes(input?: { policy?: GrainsDataPolicy; instruments?: string[] }): string[];
export function evaluateGrainsDataContinuity(input: {
  policy?: GrainsDataPolicy; instrument: string;
  timeframes?: { M1?: { status: string; issues: string[] }; M5?: { status: string; issues: string[] } };
}): {
  data_policy: GrainsDataPolicy; data_mode: "BLOCKED" | "M5_FALLBACK" | "M1_M5";
  required_timeframes: string[]; optional_timeframes: string[]; tradeable: boolean;
  status: "BLOCKED" | "DEGRADED" | "TRADEABLE"; blocking_issues: string[]; reason_codes: string[];
};
