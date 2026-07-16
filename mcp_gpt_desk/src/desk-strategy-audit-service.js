import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  NY_OPEN_STRATEGY_ID,
  NY_OPEN_SESSION,
  STRATEGY_AUDIT_ALGORITHMS,
} from "./desk-strategy-audit-algorithms.js";

const COLLECTIONS = DESK_COLLECTIONS;
const LIVE_CURSOR_COLLECTION = "desk_live_run_cursor";


export class DeskStrategyAuditService {
  constructor({ persistence, clock, host, market }) {
    this.persistence = persistence;
    this.clock = clock;
    this.host = host;
    this.market = market;
    this.algorithms = STRATEGY_AUDIT_ALGORITHMS;
  }

  async getAuditState(args = {}) {
    const [featureRuns, errors] = await Promise.all([
      this.persistence.listDocuments(COLLECTIONS.deskFeatureRuns, 100).catch(() => []),
      this.persistence.listDocuments(COLLECTIONS.deskErrors, 100).catch(() => []),
    ]);
    return this.algorithms.buildAuditState(this.host, args, {
      feature_runs: featureRuns,
      errors,
    }, this.clock);
  }

  async getNyOpenStrategyState(args = {}) {
    return this.algorithms.buildNyOpenStrategyState(this.host, {
      ...(args || {}),
      strategy_id: NY_OPEN_STRATEGY_ID,
      session: NY_OPEN_SESSION,
    }, this.clock);
  }

  async prepareNyOpenMasterBundle(args = {}) {
    const date = args.date || String(this.clock.now().paris).slice(0, 10);
    const cutoff_paris = args.cutoff_paris || this.algorithms.nyOpenCutoffParis(date);
    const result = await this.host.prepareMasterCutoffBundleJob({
      ...args,
      ...this.algorithms.nyOpenOperationalScope(date, cutoff_paris),
      cutoff_paris,
      instruments: ["MNQ", "MES", "NQ", "ES"],
      save: args.save !== false,
    });
    return this.algorithms.normalizeNyOpenBundlePrep(result, { date, cutoff_paris });
  }

  async getStrategyPerformance(args = {}) {
    const strategy_id = this.algorithms.resolveStrategySelection(args);
    const filterId = strategy_id === "all" ? null : strategy_id;
    const [tradeDocs, setupDocs] = await Promise.all([
      this.persistence.listDocuments(COLLECTIONS.deskStrategyTrades, 500).catch(() => []),
      this.persistence.listDocuments(COLLECTIONS.deskSetups, 500).catch(() => []),
    ]);
    const trades = this.algorithms.filterStrategyTrades(tradeDocs, args, filterId);
    const setups = this.algorithms.filterStrategySetups(setupDocs, args, filterId);
    return this.algorithms.buildStrategyPerformance({ strategy_id, trades, setups, args });
  }

  async getStrategyCalendar(args = {}) {
    const strategy_id = this.algorithms.requireStrategyId(args);
    const docs = await this.loadStrategyDocuments(strategy_id);
    return this.algorithms.buildStrategyCalendar(docs, args, this.clock);
  }

  async getStrategyDayDetail(args = {}) {
    const strategy_id = this.algorithms.requireStrategyId(args);
    const docs = await this.loadStrategyDocuments(strategy_id);
    return this.algorithms.buildStrategyDayDetail(docs, {
      ...args,
      strategy_id,
      as_of_paris: this.clock.now().paris,
    });
  }

  async getLiveTimelineEventDetail(args = {}) {
    const strategy_id = this.algorithms.requireStrategyId(args);
    const docs = await this.loadStrategyDocuments(strategy_id);
    return this.algorithms.buildLiveTimelineEventDetail(docs, {
      ...args,
      strategy_id,
      as_of_paris: this.clock.now().paris,
    });
  }

  async recomputeStrategyPerformance(args = {}) {
    const tick = this.clock.now();
    const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
    const strict_replay = await this.applyNyOpenStrictReplay({ ...args, strategy_id })
      .catch((error) => ({ ok: false, skipped: true, error: this.algorithms.publicReplayError(error) }));
    const docs = await this.loadStrategyDocuments(strategy_id);
    const recomputed = this.algorithms.recomputeStrategyPerformanceDocs(docs, { ...args, strategy_id }, tick);
    await this.persistPerformance(strategy_id, recomputed, { includeAudit: true });
    return { ok: true, strategy_id, strict_replay, ...recomputed.summary };
  }

  async markNyOpenStrategyEvent(args = {}) {
    const tick = this.clock.now();
    const action = this.algorithms.normalizeNyOpenAction(args);
    if (action === "replay_strict_setup") {
      const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
      const strict_replay = await this.applyNyOpenStrictReplay({ ...args, strategy_id });
      const docs = await this.loadStrategyDocuments(strategy_id);
      const recomputed = this.algorithms.recomputeStrategyPerformanceDocs(docs, { ...args, strategy_id }, tick);
      await this.persistPerformance(strategy_id, recomputed);
      return { ok: true, action, status: "done", strict_replay, ...recomputed.summary };
    }
    const target = await this.resolveStrategyActionTarget(args, action);
    if (!target) {
      return { ok: false, status: "missing", action: args.action, error: "strategy_target_not_found" };
    }
    const patch = this.algorithms.strategyActionPatch(action, tick);
    const collection = target.type === "trade" ? COLLECTIONS.deskStrategyTrades : COLLECTIONS.deskSetups;
    await this.persistence.setDocument(collection, target.id, patch, { merge: true });
    const audit = this.algorithms.strategyAuditLog({
      strategy_id: args.strategy_id || NY_OPEN_STRATEGY_ID,
      action,
      document_type: target.type,
      document_id: target.id,
      previous_value: target.doc.status || null,
      new_value: patch.status,
      performed_by: args.performed_by || "dashboard_operator",
      reason: args.reason,
      tick,
    });
    await this.persistence.setDocument(COLLECTIONS.deskAuditLogs, audit.audit_id, audit, { merge: true });
    return { ok: true, action, document_type: target.type, document_id: target.id, status: patch.status, audit_id: audit.audit_id };
  }

  async applyNyOpenStrictReplay(args = {}) {
    const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
    if (strategy_id !== NY_OPEN_STRATEGY_ID || args.strict_mode === false) {
      return { ok: true, skipped: true, reason: "strict_mode_disabled_or_strategy_not_supported" };
    }
    const tick = this.clock.now();
    const sourceSetups = Array.isArray(args.setups) && args.setups.length
      ? args.setups
      : this.algorithms.filterStrategySetups(
        await this.persistence.listDocuments(COLLECTIONS.deskSetups, 500).catch(() => []),
        this.algorithms.strictReplaySetupFilters(args),
        strategy_id,
      );
    const setup = this.algorithms.selectNyOpenStrictSetup(sourceSetups, args);
    if (!setup) {
      return { ok: true, skipped: true, reason: "ny_open_strict_setup_not_found", strategy_id };
    }
    const replayWindow = this.algorithms.nyOpenStrictReplayWindow(setup, args);
    const modeResults = [];
    for (const pricing_mode of this.algorithms.nyOpenStrictPricingModes()) {
      const replay = await this.market.replaySetup(this.algorithms.strictSetupForReplay(setup, pricing_mode), {
        ...args,
        pricing_mode,
        replay_id: this.algorithms.nyOpenStrictReplayId(setup, pricing_mode, tick),
        replay_from: replayWindow.from,
        replay_to: replayWindow.to,
        timeframe: args.timeframe || "M5",
        max_rows: args.max_rows || 5000,
      });
      await this.persistence.setDocument(
        COLLECTIONS.deskSetupReplays,
        replay.replay_id || `${this.algorithms.setupDocumentId(setup)}_${pricing_mode}_strict_latest`,
        replay,
        { merge: true },
      );
      const trade = this.algorithms.nyOpenStrictTradeFromReplay({ setup, replay, replayWindow, strategy_id, tick, pricing_mode });
      if (trade) {
        await this.persistence.setDocument(COLLECTIONS.deskStrategyTrades, trade.trade_id, trade, { merge: true });
      }
      modeResults.push({ pricing_mode, replay, trade });
    }
    const setupPatch = this.algorithms.nyOpenStrictSetupPatch({ setup, modeResults, replayWindow, strategy_id, tick, pricing_mode: args.pricing_mode });
    await this.persistence.setDocument(COLLECTIONS.deskSetups, this.algorithms.setupDocumentId(setup), setupPatch, { merge: true });
    const selected = this.algorithms.selectedStrictModeResult(modeResults, args.pricing_mode);
    const audit = this.algorithms.strategyAuditLog({
      strategy_id,
      action: "nyopen_strict_replay",
      document_type: selected.trade ? "trade" : "setup",
      document_id: selected.trade?.trade_id || this.algorithms.setupDocumentId(setup),
      previous_value: setup.status || setup.lifecycle_status || null,
      new_value: selected.trade?.status || setupPatch.status,
      performed_by: args.performed_by || "backend_strict_mode",
      reason: args.reason || "strict_limit_order_from_1535",
      tick,
    });
    await this.persistence.setDocument(COLLECTIONS.deskAuditLogs, audit.audit_id, audit, { merge: true });
    return this.algorithms.summarizeNyOpenStrictReplay({ setup, modeResults, audit, replayWindow, strategy_id, pricing_mode: args.pricing_mode });
  }

  async loadStrategyDocuments(strategy_id) {
    const byStrategy = (collection, limit = 500) => this.persistence.queryCollectionDocuments({
      collection,
      filters: [{ field: "strategy_id", operator: "==", value: strategy_id }],
      limit,
    }).catch(() => []);
    const [masters, theses, setups, manualMonitors, hourlyMonitors, trades, tradeExits, daily, equity, stats, reviews, packs, bundles, liveCursors, workEvents] = await Promise.all([
      byStrategy(COLLECTIONS.deskMasterAnalyses),
      byStrategy(COLLECTIONS.deskActiveTheses),
      byStrategy(COLLECTIONS.deskSetups),
      byStrategy(COLLECTIONS.deskManualMonitors),
      byStrategy(COLLECTIONS.deskHourlyMonitors),
      byStrategy(COLLECTIONS.deskStrategyTrades),
      byStrategy(COLLECTIONS.deskStrategyTradeExits),
      byStrategy(COLLECTIONS.deskStrategyDailyPerformance),
      byStrategy(COLLECTIONS.deskStrategyEquityCurve),
      byStrategy(COLLECTIONS.deskStrategyStats, 50),
      byStrategy(COLLECTIONS.deskStrategyDailyReviews),
      byStrategy(COLLECTIONS.deskPacks),
      byStrategy(COLLECTIONS.deskMasterCutoffBundles),
      this.persistence.listDocuments(LIVE_CURSOR_COLLECTION, 500).catch(() => []),
      this.persistence.listDocuments(COLLECTIONS.deskAgentWorkEvents, 1000).catch(() => []),
    ]);
    return this.algorithms.selectStrategyDocuments({
      strategy_id,
      masters,
      theses,
      setups,
      monitors: [...manualMonitors, ...hourlyMonitors],
      trades,
      tradeExits,
      daily,
      equity,
      stats,
      reviews,
      packs,
      bundles,
      liveCursors,
      workEvents,
    });
  }

  async resolveStrategyActionTarget(args, action) {
    const strategy_id = args.strategy_id || NY_OPEN_STRATEGY_ID;
    if (args.trade_id) {
      const trades = await this.persistence.listDocuments(COLLECTIONS.deskStrategyTrades, 500).catch(() => []);
      const trade = trades.find((item) => item.trade_id === args.trade_id && this.algorithms.strategyDocMatches(item, strategy_id));
      return trade ? { type: "trade", id: trade.trade_id, doc: trade } : null;
    }
    const setupId = args.setup_id;
    if (!setupId) return null;
    const setups = await this.persistence.listDocuments(COLLECTIONS.deskSetups, 500).catch(() => []);
    const setup = setups.find((item) => this.algorithms.setupDocumentId(item) === setupId || item.setup_id === setupId || item.setup_record_id === setupId);
    if (!setup) return null;
    if (action === "mark_setup_triggered") return { type: "setup", id: this.algorithms.setupDocumentId(setup), doc: setup };
    return { type: "setup", id: this.algorithms.setupDocumentId(setup), doc: setup };
  }

  async persistPerformance(strategy_id, recomputed, { includeAudit = false } = {}) {
    for (const day of recomputed.daily_performance) {
      await this.persistence.setDocument(COLLECTIONS.deskStrategyDailyPerformance, day.perf_day_id, day, { merge: true });
    }
    for (const point of recomputed.equity_curve) {
      await this.persistence.setDocument(COLLECTIONS.deskStrategyEquityCurve, point.point_id, point, { merge: true });
    }
    await this.persistence.setDocument(COLLECTIONS.deskStrategyStats, strategy_id, recomputed.stats, { merge: true });
    if (includeAudit) {
      await this.persistence.setDocument(COLLECTIONS.deskAuditLogs, recomputed.audit.audit_id, recomputed.audit, { merge: true });
    }
  }
}
