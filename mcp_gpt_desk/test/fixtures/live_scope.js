export function liveScope(overrides = {}) {
  const tradingDate = overrides.trading_date || overrides.date || "2026-07-03";
  const cutoffParis = overrides.cutoff_paris || `${tradingDate}T00:10:00+02:00`;
  return {
    strategy_id: "asia_open",
    session: "asia_open",
    mode: "live",
    trading_date: tradingDate,
    date: tradingDate,
    run_id: `live__asia_open__${tradingDate.replaceAll("-", "")}__test`,
    as_of_utc: new Date(Date.parse(cutoffParis)).toISOString(),
    timezone: "Europe/Paris",
    cutoff_paris: cutoffParis,
    ...overrides,
  };
}

export function nyLiveScope(overrides = {}) {
  const tradingDate = overrides.trading_date || overrides.date || "2026-07-09";
  const cutoffParis = overrides.cutoff_paris || `${tradingDate}T15:30:00+02:00`;
  return liveScope({
    strategy_id: "ny_open_1530",
    session: "ny_open",
    trading_date: tradingDate,
    date: tradingDate,
    run_id: `live__ny_open__${tradingDate.replaceAll("-", "")}__test`,
    as_of_utc: new Date(Date.parse(cutoffParis)).toISOString(),
    cutoff_paris: cutoffParis,
    ...overrides,
  });
}
