import { chicagoDate, grainRound } from "./us-grains-strategy-input.js";

export function summarizeGrainStrategyReplay({
  config,
  signals,
  trades,
  skippedDays,
}) {
  const filled = trades.filter((item) => item.filled_at_utc);
  const wins = filled.filter((item) => item.r_result > 0);
  const losses = filled.filter((item) => item.r_result < 0);
  const byDay = {};
  for (const trade of trades) recordDayResult(byDay, trade);
  return {
    schema_version: "us_grains_strategy_replay_result_v1",
    engine_version: "us_grains_strategy_engine_v1",
    strategy_id: config.strategyId,
    instrument: config.instrument,
    signal_count: signals.length,
    filled_trade_count: filled.length,
    win_count: wins.length,
    loss_count: losses.length,
    win_rate: filled.length ? grainRound(wins.length / filled.length, 4) : 0,
    total_r: grainRound(
      filled.reduce((sum, item) => sum + item.r_result, 0),
      4,
    ),
    average_r: filled.length
      ? grainRound(
          filled.reduce((sum, item) => sum + item.r_result, 0) / filled.length,
          4,
        )
      : 0,
    by_day: byDay,
    signals,
    trades,
    skipped_days: skippedDays,
  };
}

function recordDayResult(byDay, trade) {
  const day = chicagoDate(trade.generated_at_utc);
  byDay[day] ||= { signal_count: 0, filled_count: 0, total_r: 0, statuses: {} };
  byDay[day].signal_count += 1;
  if (trade.filled_at_utc) byDay[day].filled_count += 1;
  byDay[day].total_r = grainRound(byDay[day].total_r + trade.r_result, 4);
  byDay[day].statuses[trade.status] =
    (byDay[day].statuses[trade.status] || 0) + 1;
}
