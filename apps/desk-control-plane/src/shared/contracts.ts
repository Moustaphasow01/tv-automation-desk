export type SchemaVersion = `${number}.${number}.${number}`;

export type ViewMeta = {
  generatedAt: string;
  asOf: string;
  stale: boolean;
  latencyMs: number;
  correlationId: string;
  schemaVersion: SchemaVersion;
  availability?: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "STALE";
  warnings?: readonly string[];
  sources?: readonly {
    source: string;
    state: "AVAILABLE" | "UNAVAILABLE";
  }[];
};

export type DataValue<T> =
  | { state: "KNOWN"; value: T; asOf: string; source: string }
  | { state: "UNKNOWN"; reason: string }
  | { state: "UNAVAILABLE"; reason: string; errorCode?: string; source?: string }
  | { state: "STALE"; value: T; asOf: string; reason: string; source?: string }
  | { state: "PARTIAL"; value?: T; reason: string; asOf?: string; sources?: readonly string[] }
  | { state: "NOT_IMPLEMENTED"; reason: string; capability?: string }
  | { state: "DISCONNECTED"; reason: string; source?: string; lastKnownAt?: string }
  | { state: "ERROR"; reason: string; errorCode?: string; correlationId?: string }
  | { state: "FORBIDDEN"; reason: string }
  | { state: "NOT_APPLICABLE"; reason: string };

export function known<T>(value: T, metadata: { asOf: string; source: string }): DataValue<T> {
  return { state: "KNOWN", value, ...metadata };
}

export function unavailable<T = never>(reason: string, metadata: { errorCode?: string; source?: string } = {}): DataValue<T> {
  return { state: "UNAVAILABLE", reason, ...metadata };
}

export type Violation = {
  field: string;
  message: string;
  code: string;
};

export type ApiProblem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  correlationId?: string;
  violations?: readonly Violation[];
};

export type ActionPermission = {
  capability: string;
  allowed: boolean;
  reason?: string;
  requiresStepUp?: boolean;
};

export type CapabilityCatalog = {
  schemaVersion: SchemaVersion;
  capabilities: readonly ActionPermission[];
  actions: readonly {
    actionId: string;
    commandType: string;
    capability: string;
    environments: readonly ("MOCK" | "PAPER" | "LIVE")[];
    mutation: string;
    brokerExecution: boolean;
    allowed: boolean;
  }[];
};

export type ViewEnvelope<T> = {
  meta: ViewMeta;
  permissions: readonly ActionPermission[];
  data: T;
};

export type FrontViewName =
  | "auth-session"
  | "operator-settings"
  | "admin-access"
  | "command-center"
  | "demo-paper-readiness"
  | "events-audit"
  | "operations-queue"
  | "research-agent-fleet"
  | "research-compute-scheduler"
  | "research-data-catalog"
  | "research-experiment-detail"
  | "research-run-detail"
  | "research-lab"
  | "strategy-center"
  | "strategy-detail"
  | "strategy-compare"
  | "live-trading"
  | "crypto-market"
  | "live-focus"
  | "live-signal-detail"
  | "order-detail"
  | "position-detail"
  | "incident-detail"
  | "orders"
  | "risk"
  | "execution-providers"
  | "execution-incidents"
  | "portfolio"
  | "sessions"
  | "live-plan"
  | "live-news"
  | "live-timeline"
  | "execution-reconciliation"
  | "operations-observability"
  | "research-experiments"
  | "research-candidates"
  | "research-dataset-detail"
  | "strategy-deployments"
  | "replay-overview"
  | "replay-runs"
  | "replay-run-detail"
  | "replay-compare"
  | "performance-overview"
  | "performance-calendar"
  | "performance-day-detail"
  | "performance-strategies"
  | "performance-trades"
  | "workflow-detail"
  | "event-detail"
  | "operations-runbooks"
  | "governance-prompts"
  | "governance-policies"
  | "jarvis-workspace";

export function assertViewEnvelope<T>(value: unknown, isData: (candidate: unknown) => candidate is T): ViewEnvelope<T> {
  if (!isObject(value)) {
    throw contractError("VIEW_ENVELOPE_NOT_OBJECT", "La réponse BFF n’est pas un objet.");
  }

  const envelope = value as Partial<ViewEnvelope<T>>;

  if (!isViewMeta(envelope.meta)) {
    throw contractError("VIEW_META_INVALID", "La réponse BFF ne contient pas un ViewMeta valide.");
  }

  if (!Array.isArray(envelope.permissions) || !envelope.permissions.every(isActionPermission)) {
    throw contractError("VIEW_PERMISSIONS_INVALID", "La réponse BFF ne contient pas des permissions valides.");
  }

  if (!isData(envelope.data)) {
    throw contractError("VIEW_DATA_INVALID", "La réponse BFF ne respecte pas le DTO attendu.");
  }

  return envelope as ViewEnvelope<T>;
}

export function isViewMeta(value: unknown): value is ViewMeta {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<ViewMeta>;
  return (
    typeof candidate.generatedAt === "string" &&
    typeof candidate.asOf === "string" &&
    typeof candidate.stale === "boolean" &&
    typeof candidate.latencyMs === "number" &&
    typeof candidate.correlationId === "string" &&
    typeof candidate.schemaVersion === "string"
  );
}

export function isActionPermission(value: unknown): value is ActionPermission {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<ActionPermission>;
  return typeof candidate.capability === "string" && typeof candidate.allowed === "boolean";
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function contractError(code: string, message: string) {
  return Object.assign(new Error(message), {
    code,
    problem: {
      type: "https://desk.local/problems/front-contract",
      title: "Contrat BFF invalide",
      status: 502,
      detail: message,
      violations: [{ field: "body", code, message }]
    } satisfies ApiProblem
  });
}
