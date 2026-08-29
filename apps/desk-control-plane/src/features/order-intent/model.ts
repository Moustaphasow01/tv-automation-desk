import type { DataValue, ViewMeta } from "@/shared/contracts";
import type { SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";

export type DossierField = DataValue<string | number>;

export type ExecutionMode = "SHADOW" | "SEMI_MANUAL" | "PAPER" | "LIVE";

export type AuthorityStage = {
  label: string;
  decision: DataValue<string>;
  reasonCodes: readonly string[];
  authorityId: DataValue<string>;
  version: DataValue<string>;
};

export type HumanGateAction = {
  action: "CONFIRM" | "REJECT" | "UNDO";
  actionId: string;
  label: string;
  commandType: string;
  environment: "MOCK" | "SHADOW" | "PAPER" | "LIVE";
  permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
  requiresConfirmation: boolean;
  requiresReason: boolean;
  expectedRevision: string;
  impactPreview: string;
  payload: Readonly<Record<string, string | number | boolean>>;
};

export type HumanGate = {
  status: DataValue<string>;
  actions: readonly HumanGateAction[];
  unavailableReason?: string;
};

export type ProviderTimelineEvent = {
  eventId: string;
  occurredAt: string;
  status: string;
  title: string;
  details: string;
  source: string;
  actor: string;
  entity: string;
  correlationId: string;
  causationId?: string;
  sequence?: number;
  revision?: string;
};

export type ReconciliationComparison = {
  status: DataValue<string>;
  checkedAt: DataValue<string>;
  expected: readonly { label: string; value: DataValue<string | number> }[];
  broker: readonly { label: string; value: DataValue<string | number> }[];
  mismatches: readonly { field: string; expected: string; actual: string; reason: string }[];
};

export type OrderIntentDossier = {
  meta: ViewMeta;
  degradedReadOnly: boolean;
  brokerSummary: {
    state: string;
    orderedQuantity: number;
    filledQuantity: number;
    remainingQuantity: number;
    fillCount: number;
    protectionStatus: string;
  };
  identity: {
    orderIntentId: DataValue<string>;
    orderId: DataValue<string>;
    brokerOrderId: DataValue<string>;
    providerId: DataValue<string>;
    correlationId: DataValue<string>;
  };
  strategy: {
    strategyId: DataValue<string>;
    strategyInstanceId: DataValue<string>;
    strategyVersion: DataValue<string>;
  };
  signal: {
    signalId: DataValue<string>;
    instrument: DataValue<string>;
    side: DataValue<string>;
  };
  contextGate: AuthorityStage;
  portfolioArbitration: AuthorityStage;
  globalRisk: AuthorityStage;
  targetPosition: {
    targetPositionId: DataValue<string>;
    account: DataValue<string>;
    authorizedQuantity: DataValue<number>;
  };
  executionPlan: {
    orderType: DataValue<string>;
    timeInForce: DataValue<string>;
    entry: DataValue<number>;
    stop: DataValue<number>;
    targets: readonly DataValue<number>[];
    expectedR: DataValue<number>;
    expectedRevision: DataValue<string>;
    createdAt: DataValue<string>;
    expiresAt: DataValue<string>;
  };
  marketContext: {
    lastPrice: DataValue<number>;
    asOf: DataValue<string>;
    distanceToEntryPoints: DataValue<number>;
    distanceToEntryR: DataValue<number>;
    outsideTradeZone: boolean | null;
  };
  executionMode: DataValue<ExecutionMode>;
  humanGate: HumanGate;
  providerLifecycle: readonly ProviderTimelineEvent[];
  fills: readonly { fillId: string; quantity: number; price: number; filledAt: string }[];
  reconciliation: ReconciliationComparison;
  relations: readonly { label: string; id: string; route: string }[];
  technical: readonly { label: string; value: string }[];
};

export function buildHumanGateCommand(action: HumanGateAction, reason: string): SubmitDeskCommandInput {
  if (action.permission !== "ALLOWED") throw new Error("HUMAN_GATE_ACTION_NOT_ALLOWED");
  if (action.requiresReason && !reason.trim()) throw new Error("HUMAN_GATE_REASON_REQUIRED");
  if (!action.actionId || !action.commandType || !action.expectedRevision) throw new Error("HUMAN_GATE_ACTION_INCOMPLETE");

  return {
    commandType: action.commandType,
    environment: action.environment,
    expectedVersion: action.expectedRevision,
    reason: reason.trim() || undefined,
    payload: {
      ...action.payload,
      actionId: action.actionId,
    },
  };
}
