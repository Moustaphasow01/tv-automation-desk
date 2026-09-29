export const ENGINE_VERSION = "V3.9.8";
export const BOOK_MODE = "PORTEFEUILLE_REALISTE";
export const VIEWS = Object.freeze(["5m", "15m", "1h", "4h"].flatMap(timeframe =>
  ["global", "zoom"].map(view => Object.freeze({ timeframe, view, name: `${timeframe}_${view}.png` }))));
export const STAGES = Object.freeze(["NEW", "CAPTURING", "PREMARKET_READY", "WAITING_SCENARIO",
  "PLAN_RECEIVED", "VALIDATING_PLAN", "FROZEN", "REPLAYING", "CAPTURING_RESULTS", "COMPLETED"]);

export function requireFact(condition, code, details = {}) {
  if (!condition) throw Object.assign(new Error(code), { code, details });
}

export function validateDay(input) {
  requireFact(/^[A-Za-z0-9_-]{1,80}$/.test(input.batch_id || ""), "BATCH_ID_INVALID");
  requireFact(/^2026-(07|08)-\d{2}$/.test(input.date || ""), "V1_DATE_OUT_OF_RANGE");
  const date = new Date(`${input.date}T00:00:00Z`);
  requireFact(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === input.date, "DATE_INVALID");
  requireFact(typeof input.symbol === "string" && /^[A-Za-z0-9_!:.-]{1,80}$/.test(input.symbol), "SYMBOL_INVALID");
  requireFact(input.timezone === "Europe/Paris", "TIMEZONE_INVALID");
  requireFact(input.engine_version === ENGINE_VERSION && input.schema === "SMC3", "VERSION_UNSUPPORTED");
  requireFact(input.book_mode === BOOK_MODE, "BOOK_MODE_UNSUPPORTED");
  requireFact(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+02:00$/.test(input.cutoff || ""), "CUTOFF_REQUIRED");
  requireFact(input.cutoff.slice(0, 10) === input.date && Number.isFinite(Date.parse(input.cutoff)), "CUTOFF_INVALID");
  requireFact(Date.parse(input.cutoff) < Date.parse(`${input.date}T20:00:00+02:00`), "CUTOFF_AFTER_REPLAY_END");
  return Object.freeze({ batch_id: input.batch_id, date: input.date, symbol: input.symbol,
    timezone: input.timezone, cutoff: input.cutoff, engine_version: input.engine_version,
    schema: input.schema, book_mode: input.book_mode });
}

export function batchDays(input) {
  validateBatchRequest(input);
  const start = input.date || input.from || `${input.month}-01`;
  const end = input.date || input.to || new Date(Date.UTC(2026, Number(input.month?.slice(5)), 0)).toISOString().slice(0, 10);
  requireFact(/^\d{2}:\d{2}$/.test(input.cutoff_time || ""), "CUTOFF_TIME_REQUIRED");
  requireFact(start <= end && /^2026-(07|08)-\d{2}$/.test(start) && /^2026-(07|08)-\d{2}$/.test(end), "RANGE_INVALID");
  const days = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    days.push(validateDay({ ...input, date, cutoff: `${date}T${input.cutoff_time}:00+02:00`,
      timezone: "Europe/Paris", schema: "SMC3", engine_version: ENGINE_VERSION, book_mode: BOOK_MODE }));
  }
  requireFact(days.length > 0 && days[0].date === start && days.at(-1).date === end, "RANGE_INVALID");
  return days;
}

function validateBatchRequest(input) {
  const allowed = new Set(["batch_id", "symbol", "cutoff_time", "action", "date", "month", "from", "to", "command_id"]);
  requireFact(input && typeof input === "object" && Object.keys(input).every(key => allowed.has(key)), "BATCH_FIELDS_INVALID");
  const selectors = [!!input.date, !!input.month, !!(input.from || input.to)];
  requireFact(selectors.filter(Boolean).length === 1 && !!input.from === !!input.to, "PERIOD_SELECTOR_INVALID");
}
