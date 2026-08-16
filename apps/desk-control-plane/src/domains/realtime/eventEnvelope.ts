import { isObject, type SchemaVersion } from "@/shared/contracts";
import type { FrontViewName } from "@/shared/contracts";

export const FRONT_EVENT_TYPES = [
  "desk.snapshot.updated",
  "agent.status.changed",
  "experiment.progress.updated",
  "backtest.completed",
  "strategy.lifecycle.changed",
  "signal.created",
  "arbitration.completed",
  "risk.warning.created",
  "order.status.changed",
  "fill.created",
  "position.updated",
  "provider.health.changed",
  "incident.created",
  "reconciliation.completed",
  "command.status.changed",
  "jarvis.message.created"
  ,"strategy.evaluation.completed"
  ,"strategy.signal.created"
  ,"ai_context.decision.created"
  ,"portfolio.arbitration.completed"
  ,"risk.decision.created"
  ,"target_position.created"
  ,"order_intent.created"
  ,"human_gate.created"
  ,"human_gate.state_changed"
  ,"provider.command.created"
  ,"provider.event.received"
  ,"reconciliation.updated"
  ,"research.run.updated"
  ,"assistant.answer.created"
  ,"desk.resync_required"
] as const;

export type FrontEventType = (typeof FRONT_EVENT_TYPES)[number] | (string & {});

export type EventEnvelope<Payload = unknown> = {
  eventId: string;
  aggregateId?: string;
  aggregateType?: string;
  eventType: FrontEventType;
  occurredAt: string;
  receivedAt?: string;
  source?: string;
  correlationId: string;
  causationId?: string;
  schemaVersion: SchemaVersion;
  sequence?: number;
  revision?: number;
  payload: Payload;
};

export type RealtimeEventState = {
  acceptedCount: number;
  duplicateCount: number;
  invalidCount: number;
  outOfOrderCount: number;
  sequenceGapCount: number;
  lastEventId: string | null;
  lastOccurredAt: string | null;
  lastSequence: number | null;
  lastSequenceByAggregate: Readonly<Record<string, number>>;
  seenEventIds: readonly string[];
  eventTypeCounts: Readonly<Record<string, number>>;
  recentEvents: readonly EventEnvelope[];
};

const MAX_SEEN_EVENT_IDS = 500;
const DEFAULT_RECENT_EVENTS = 30;

export function createRealtimeEventState(): RealtimeEventState {
  return {
    acceptedCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
    outOfOrderCount: 0,
    sequenceGapCount: 0,
    lastEventId: null,
    lastOccurredAt: null,
    lastSequence: null,
    lastSequenceByAggregate: {},
    seenEventIds: [],
    eventTypeCounts: {},
    recentEvents: []
  };
}

export function assertEventEnvelope(value: unknown): EventEnvelope {
  if (!isEventEnvelope(value)) {
    throw Object.assign(new Error("FRONT_EVENT_ENVELOPE_INVALID"), {
      code: "FRONT_EVENT_ENVELOPE_INVALID"
    });
  }

  return value;
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<EventEnvelope>;
  return (
    typeof candidate.eventId === "string" &&
    candidate.eventId.length > 0 &&
    typeof candidate.eventType === "string" &&
    candidate.eventType.length > 0 &&
    typeof candidate.occurredAt === "string" &&
    candidate.occurredAt.length > 0 &&
    typeof candidate.correlationId === "string" &&
    candidate.correlationId.length > 0 &&
    typeof candidate.schemaVersion === "string" &&
    isSchemaVersion(candidate.schemaVersion) &&
    "payload" in candidate &&
    (candidate.aggregateId === undefined || typeof candidate.aggregateId === "string") &&
    (candidate.aggregateType === undefined || typeof candidate.aggregateType === "string") &&
    (candidate.receivedAt === undefined || typeof candidate.receivedAt === "string") &&
    (candidate.source === undefined || typeof candidate.source === "string") &&
    (candidate.causationId === undefined || typeof candidate.causationId === "string") &&
    (candidate.sequence === undefined || isFiniteNonNegativeNumber(candidate.sequence)) &&
    (candidate.revision === undefined || isFiniteNonNegativeNumber(candidate.revision))
  );
}

export function reduceRealtimeMessage(state: RealtimeEventState, value: unknown): RealtimeEventState {
  if (!isEventEnvelope(value)) {
    return {
      ...state,
      invalidCount: state.invalidCount + 1
    };
  }

  return reduceRealtimeEvent(state, value);
}

export function reduceRealtimeEvent(
  state: RealtimeEventState,
  event: EventEnvelope,
  maxRecentEvents = DEFAULT_RECENT_EVENTS
): RealtimeEventState {
  if (state.seenEventIds.includes(event.eventId)) {
    return {
      ...state,
      duplicateCount: state.duplicateCount + 1
    };
  }

  const sequenceScope = event.aggregateId
    ? `${event.aggregateType || "unknown"}:${event.aggregateId}`
    : "__stream__";
  const previousSequence = state.lastSequenceByAggregate[sequenceScope];
  const isOutOfOrder = typeof event.sequence === "number" && typeof previousSequence === "number" && event.sequence <= previousSequence;
  const hasSequenceGap = typeof event.sequence === "number" && typeof previousSequence === "number" && event.sequence > previousSequence + 1;
  const nextSeen = [...state.seenEventIds, event.eventId].slice(-MAX_SEEN_EVENT_IDS);
  const nextTypeCount = (state.eventTypeCounts[event.eventType] ?? 0) + 1;

  return {
    ...state,
    acceptedCount: state.acceptedCount + 1,
    outOfOrderCount: state.outOfOrderCount + (isOutOfOrder ? 1 : 0),
    sequenceGapCount: state.sequenceGapCount + (hasSequenceGap ? 1 : 0),
    lastEventId: event.eventId,
    lastOccurredAt: event.occurredAt,
    lastSequence: typeof event.sequence === "number" ? Math.max(state.lastSequence ?? event.sequence, event.sequence) : state.lastSequence,
    lastSequenceByAggregate: typeof event.sequence === "number"
      ? { ...state.lastSequenceByAggregate, [sequenceScope]: Math.max(previousSequence ?? event.sequence, event.sequence) }
      : state.lastSequenceByAggregate,
    seenEventIds: nextSeen,
    eventTypeCounts: {
      ...state.eventTypeCounts,
      [event.eventType]: nextTypeCount
    },
    recentEvents: [event, ...state.recentEvents].slice(0, maxRecentEvents)
  };
}

export function frontViewNamesForRealtimeEvent(event: EventEnvelope): readonly FrontViewName[] {
  switch (event.eventType) {
    case "desk.snapshot.updated":
      return ["command-center", "sessions", "live-plan", "live-news", "live-timeline", "execution-reconciliation", "operations-observability"];
    case "agent.status.changed":
      return ["command-center", "research-lab", "operations-observability"];
    case "experiment.progress.updated":
      return ["command-center", "research-lab", "research-experiments", "research-candidates"];
    case "backtest.completed":
      return ["command-center", "research-lab", "research-experiments", "research-candidates", "replay-overview", "replay-runs", "replay-compare", "performance-overview", "performance-calendar", "performance-strategies", "performance-trades"];
    case "strategy.lifecycle.changed":
      return ["command-center", "strategy-center", "strategy-deployments", "performance-strategies"];
    case "signal.created":
    case "strategy.evaluation.completed":
    case "strategy.signal.created":
    case "ai_context.decision.created":
    case "arbitration.completed":
    case "portfolio.arbitration.completed":
    case "risk.warning.created":
    case "risk.decision.created":
    case "target_position.created":
      return ["command-center", "live-trading", "live-plan", "live-timeline", "sessions", "portfolio"];
    case "order.status.changed":
    case "order_intent.created":
    case "human_gate.created":
    case "human_gate.state_changed":
    case "provider.command.created":
    case "provider.event.received":
    case "fill.created":
    case "position.updated":
    case "reconciliation.completed":
    case "reconciliation.updated":
      return ["command-center", "live-trading", "live-plan", "live-timeline", "execution-reconciliation", "portfolio", "performance-overview", "performance-calendar", "performance-trades"];
    case "provider.health.changed":
    case "incident.created":
      return ["command-center", "execution-reconciliation", "operations-observability", "operations-runbooks", "portfolio"];
    case "command.status.changed":
      return ["command-center"];
    case "jarvis.message.created":
    case "assistant.answer.created":
      return ["command-center", "jarvis-workspace"];
    case "research.run.updated":
      return ["command-center", "research-lab", "research-experiments", "research-candidates"];
    case "desk.resync_required":
      return ["command-center", "live-trading", "live-plan", "live-timeline", "sessions", "execution-reconciliation", "portfolio", "operations-observability"];
    default:
      return ["command-center"];
  }
}

function isSchemaVersion(value: string): value is SchemaVersion {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function isFiniteNonNegativeNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
