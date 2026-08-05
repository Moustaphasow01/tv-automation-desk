import type {
  AnalyticalResearchPhase,
  AnalyticalResearchPhaseName,
  AnalyticalResearchProgress,
  AnalyticalResearchStatus,
} from "@/operationsTypes";

export const ANALYTICAL_RESEARCH_PHASES: readonly AnalyticalResearchPhaseName[] = Object.freeze([
  "CONTINUITY",
  "CORE_MARKET",
  "INDEX_CONFIRMATION",
  "CROSS_ASSET",
  "MEGACAPS",
  "MACRO",
  "NEWS",
  "THESIS_EVOLUTION",
  "OPPORTUNITY",
  "CONCLUSION",
]);

const RESEARCH_STATUSES = new Set<AnalyticalResearchStatus>([
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETE",
  "DEGRADED",
  "UNAVAILABLE",
  "BLOCKED",
]);

const RESEARCH_PHASES = new Set<AnalyticalResearchPhaseName>(ANALYTICAL_RESEARCH_PHASES);
const RESEARCH_SCHEMA = "desk_analytical_research_progress_v1" as const;

export function normalizeResearchProgress(value: unknown): AnalyticalResearchProgress | null {
  const source = asRecord(value);
  if (!source) return null;
  const schemaVersion = text(source.schemaVersion ?? source.schema_version);
  if (schemaVersion && schemaVersion !== RESEARCH_SCHEMA) return null;

  const rawPhases = Array.isArray(source.phases) ? source.phases : [];
  const indexed = new Map<AnalyticalResearchPhaseName, Record<string, unknown>>();
  for (const value of rawPhases) {
    const phase = asRecord(value);
    const name = researchPhase(phase?.phase);
    if (phase && name && !indexed.has(name)) indexed.set(name, phase);
  }

  const phases = ANALYTICAL_RESEARCH_PHASES.map(name => normalizePhase(name, indexed.get(name)));
  const rawCoverage = asRecord(source.coverage);
  const derivedRequired = phases.filter(phase => phase.required).length;
  const derivedComplete = phases.filter(phase =>
    phase.required && ["COMPLETE", "DEGRADED", "UNAVAILABLE", "BLOCKED"].includes(phase.status),
  ).length;
  const required = boundedInteger(rawCoverage?.required, derivedRequired, 0, phases.length);
  const total = boundedInteger(rawCoverage?.total, phases.length, 0, phases.length);
  const complete = boundedInteger(rawCoverage?.complete, derivedComplete, 0, Math.max(required, total));
  const derivedPercent = required ? Math.round((complete / required) * 100) : 0;
  const percent = boundedNumber(rawCoverage?.percent, derivedPercent, 0, 100);

  return {
    schemaVersion: RESEARCH_SCHEMA,
    status: researchStatus(source.status),
    currentPhase: researchPhase(source.currentPhase ?? source.current_phase),
    startedAt: nullableText(source.startedAt ?? source.started_at_utc),
    updatedAt: nullableText(source.updatedAt ?? source.updated_at_utc),
    phases,
    coverage: { required, total, complete, percent },
    toolCallsCount: nonNegativeInteger(source.toolCallsCount ?? source.tool_calls_count),
    evidenceReceiptsCount: nonNegativeInteger(
      source.evidenceReceiptsCount ?? source.evidence_receipts_count,
    ),
  };
}

export function researchProgressFromCarrier(
  value: unknown,
  fallback: unknown = null,
): AnalyticalResearchProgress | null {
  const source = asRecord(value);
  return normalizeResearchProgress(
    source?.researchProgress
      ?? source?.research_progress
      ?? fallback,
  );
}

export function withResearchProgress<T extends object>(
  value: T,
  fallback: unknown = null,
): T & { researchProgress?: AnalyticalResearchProgress | null } {
  const progress = researchProgressFromCarrier(value, fallback);
  return progress ? { ...value, researchProgress: progress } : value;
}

function normalizePhase(
  name: AnalyticalResearchPhaseName,
  source?: Record<string, unknown>,
): AnalyticalResearchPhase {
  return {
    phase: name,
    status: researchStatus(source?.status),
    required: typeof source?.required === "boolean" ? source.required : true,
    evidenceCount: nonNegativeInteger(source?.evidenceCount ?? source?.evidence_count),
    toolCallCount: nonNegativeInteger(source?.toolCallCount ?? source?.tool_call_count),
    startedAt: nullableText(source?.startedAt ?? source?.started_at_utc),
    completedAt: nullableText(source?.completedAt ?? source?.completed_at_utc),
    degradedReasons: stringList(source?.degradedReasons ?? source?.degraded_reasons),
  };
}

function researchStatus(value: unknown): AnalyticalResearchStatus {
  const normalized = text(value).toUpperCase() as AnalyticalResearchStatus;
  return RESEARCH_STATUSES.has(normalized) ? normalized : "NOT_STARTED";
}

function researchPhase(value: unknown): AnalyticalResearchPhaseName | null {
  const normalized = text(value).toUpperCase() as AnalyticalResearchPhaseName;
  return RESEARCH_PHASES.has(normalized) ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown): number {
  return boundedInteger(value, 0, 0, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function nullableText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).slice(0, 20)
    : [];
}
