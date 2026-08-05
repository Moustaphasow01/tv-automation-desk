export const DETERMINISTIC_ENGINE_CADENCE_MINUTES = 1;
export const DETERMINISTIC_ENGINE_CADENCE_SECONDS = 60;
export const DETERMINISTIC_ENGINE_CADENCE = "M1";

export const GPT_MONITOR_CADENCE_MINUTES = 15;
export const GPT_MONITOR_CADENCE_SECONDS = 15 * 60;
export const GPT_MONITOR_CADENCE = "M15";
export const GPT_MONITOR_CADENCE_VALUE = "15m";
export const GPT_MONITOR_CATCHUP_POLICY = "LATEST_SETTLED_CLOSED_M15";

export const GPT_EVENT_MONITOR_POLICY = "CRITICAL_EVENT_OR_SCHEDULED_M15";

export const CRITICAL_ENGINE_EVENT_TYPES = Object.freeze([
  "PAPER_SETUP_TRIGGERED",
  "PAPER_SETUP_INVALIDATED",
  "PAPER_SETUP_EXPIRED",
  "PAPER_POSITION_CLOSED",
  "PAPER_SETUP_RETROACTIVE_TRIGGER_REJECTED",
]);

const CRITICAL_ENGINE_EVENT_TYPE_SET = new Set(CRITICAL_ENGINE_EVENT_TYPES);

export function isCriticalEngineEvent(event = {}) {
  return CRITICAL_ENGINE_EVENT_TYPE_SET.has(String(event.event_type || ""));
}

export function criticalEngineEvents(events = []) {
  return (Array.isArray(events) ? events : []).filter(isCriticalEngineEvent);
}
