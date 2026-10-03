import { absentEvidence } from "../domain/forensic-evidence.js";

/** No provider dependency: published event OHLC is never promoted to a continuous series. */
export class ForensicMarket {
  constructor(queries) { this.queries = queries; }
  async bars(args) {
    const day = await this.queries.index.get(args.date), series = day.bar_series?.[args.timeframe];
    if (!series?.complete || !series.bars?.length) return { ...absentEvidence("persisted_market_bars"),
      timeframe: args.timeframe, date: args.date, sparse_event_OHLC_tool: "get_forensic_events" };
    return this.queries.page(series.bars.filter(b => b.open_time >= args.start_time && b.close_time <= args.end_time), args);
  }
  async window(args) {
    const series = {};
    for (const timeframe of args.timeframes) series[timeframe] = await this.bars({ ...args, timeframe });
    return { date: args.date, start_time: args.start_time, end_time: args.end_time, series,
      available: Object.values(series).some(s => s.available) };
  }
  async interactions(args) {
    // This extractor version found no continuous native bar series in the deployed OOS corpus.
    // Never manufacture a chronology from screenshots or sparse event snapshots.
    const day = await this.queries.index.get(args.date);
    return { ...absentEvidence("complete_persisted_market_bars"), date: day.identity.date,
      classification: "DERIVED_LOCAL", requested_levels: args.levels ?? [], requested_zones: args.zones ?? [] };
  }
}
