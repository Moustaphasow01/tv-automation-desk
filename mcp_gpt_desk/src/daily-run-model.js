export const DAILY_RUN_SCOPE = "full_day";
export const DAILY_SCOPE_SESSION = "asia_open";
export const DAILY_SCOPE_STRATEGY_ID = "asia_open";
export const DAILY_START_TIME = "00:15:00";
export const DAILY_END_TIME = "22:00:00";
export const DAILY_NY_MASTER_TIME = "15:30:00";

export const DAILY_PHASES = Object.freeze([
  Object.freeze({
    phase_id: "asia_open",
    strategy_id: "asia_open",
    master_time: DAILY_START_TIME,
    monitor_from: "00:30:00",
    monitor_to: "15:15:00",
  }),
  Object.freeze({
    phase_id: "ny_open",
    strategy_id: "ny_open_1530",
    master_time: DAILY_NY_MASTER_TIME,
    monitor_from: "15:45:00",
    monitor_to: DAILY_END_TIME,
  }),
]);

export function dailyRunPhaseAt(value) {
  const time = wallTime(value);
  return time >= DAILY_NY_MASTER_TIME ? "ny_open" : "asia_open";
}

export function dailyRunStrategyAt(value) {
  return dailyRunPhaseAt(value) === "ny_open" ? "ny_open_1530" : "asia_open";
}

export function isDailyPhaseMasterCheckpoint(value) {
  const time = wallTime(value);
  return time === DAILY_START_TIME || time === DAILY_NY_MASTER_TIME;
}

export function isDailyNyMasterCheckpoint(value) {
  return wallTime(value) === DAILY_NY_MASTER_TIME;
}

export function dailyRunId(tradingDate) {
  return `front_live_${tradingDate}`;
}

export function dailyCursorId(tradingDate) {
  return `livecur__${tradingDate}`;
}

function wallTime(value) {
  const text = String(value || "");
  const match = text.match(/T(\d{2}:\d{2}(?::\d{2})?)/);
  if (match) return match[1].length === 5 ? `${match[1]}:00` : match[1];
  const time = text.slice(0, 8);
  return time.length === 5 ? `${time}:00` : time;
}
