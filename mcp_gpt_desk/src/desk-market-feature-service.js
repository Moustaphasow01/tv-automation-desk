import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { DATASETS } from "./schemas.js";
import { datasetRef } from "./desk-pack-service.js";
import { normalizeUtcIso } from "./desk-time-utils.js";
import { MARKET_FEATURE_ALGORITHMS } from "./desk-market-feature-algorithms.js";

const COLLECTIONS = DESK_COLLECTIONS;

export class DeskMarketFeatureService {
  constructor({ persistence, clock, host }) {
    this.persistence = persistence;
    this.clock = clock;
    this.host = host;
    this.algorithms = MARKET_FEATURE_ALGORITHMS;
  }

  async getLevelMap({ date, session = "asia_open", instrument }) {
    const docs = await this.persistence.listDocuments(COLLECTIONS.deskLevelMaps, 200).catch(() => []);
    return this.algorithms.selectLevelMap(docs, { date, session, instrument });
  }

  async getTechnicalEvents({ date, session = "asia_open", instrument, from, to, event_type }) {
    const filters = [
      ...(date ? [{ field: "date", operator: "==", value: date }] : []),
      ...(session ? [{ field: "session", operator: "==", value: session }] : []),
      ...(instrument ? [{ field: "instrument", operator: "==", value: instrument }] : []),
      ...(event_type ? [{ field: "event_type", operator: "==", value: event_type }] : []),
      ...(from ? [{ field: "timestamp_paris", operator: ">=", value: from }] : []),
      ...(to ? [{ field: "timestamp_paris", operator: "<=", value: to }] : []),
    ];
    const docs = typeof this.persistence.queryCollectionDocuments === "function"
      ? await this.persistence.queryCollectionDocuments({
          collection: COLLECTIONS.deskTechnicalEvents,
          filters,
          orderBy: [{ field: "timestamp_paris", direction: "desc" }],
          limit: 500,
        }).catch(() => [])
      : await this.persistence.listDocuments(COLLECTIONS.deskTechnicalEvents).catch(() => []);
    return this.algorithms.selectTechnicalEvents(docs, { date, session, instrument, from, to, event_type });
  }

  async getConditionStatus({ thesis_id, timestamp_paris }) {
    const docs = await this.persistence.listDocuments(COLLECTIONS.deskConditionStatus, 200).catch(() => []);
    return this.algorithms.selectConditionStatus(docs, { thesis_id, timestamp_paris });
  }

  async getRawWindow(args) {
    const query = this.algorithms.normalizeOperationalQuery(args);
    const run = query.replay
      ? await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, query.backtest_id).catch(() => null)
      : null;
    if (query.replay) this.algorithms.assertReplayRunMatchesQuery(run, query);
    this.algorithms.assertRawWindowQuery(args, query, run);
    return this.algorithms.buildScopedPackRawWindow(this.host, args, query, run);
  }

  async getSessionSnapshot({ date, session = "asia_open", instrument }) {
    const docs = await this.persistence.listDocuments(COLLECTIONS.deskSessionSnapshots, 200).catch(() => []);
    return this.algorithms.selectSessionSnapshot(docs, { date, session, instrument });
  }

  async runFeatureEngine(args = {}) {
    const tick = this.clock.now();
    const run = this.algorithms.featureRunStarted(args, tick);
    try {
      const pack = await this.algorithms.resolvePackForState(this.host, {
        date: args.date,
        session: args.session || "asia_open",
        timezone: args.timezone || "Europe/Paris",
      });
      if (!pack) throw new Error(`desk_pack_not_found_for_feature_engine:${args.date}:${args.session || "asia_open"}`);
      const result = {
        ok: true,
        run_id: run.run_id,
        date: args.date,
        session: args.session || "asia_open",
        cutoff_paris: args.cutoff_paris || pack.data_cutoff?.cutoff_paris || tick.paris,
        saved: args.save !== false,
        instruments: {},
        cross_asset_deltas: {},
        condition_status: null,
      };
      const featureComputedAt = normalizeUtcIso(result.cutoff_paris);
      const activeThesis = await this.algorithms.resolveFeatureEngineActiveThesis(this.host, args);
      const firstInstrumentRows = {};
      for (const instrument of args.instruments || ["MNQ", "MES"]) {
        const candlesByTimeframe = await this.loadFeatureCandles(pack, instrument, result.cutoff_paris);
        const features = this.algorithms.buildDeterministicFeatureSet({
          date: result.date,
          session: result.session,
          instrument,
          candlesByTimeframe,
          cutoff_paris: result.cutoff_paris,
          computed_at: featureComputedAt,
        });
        if (args.save !== false) {
          await this.persistence.setDocument(COLLECTIONS.deskSessionSnapshots, features.session_snapshot.snapshot_id, features.session_snapshot, { merge: true });
          await this.persistence.setDocument(COLLECTIONS.deskLevelMaps, features.level_map.level_map_id, features.level_map, { merge: true });
          for (const event of features.technical_events) {
            await this.persistence.setDocument(COLLECTIONS.deskTechnicalEvents, event.event_id, event, { merge: true });
          }
        }
        if (!Object.keys(firstInstrumentRows).length) Object.assign(firstInstrumentRows, candlesByTimeframe);
        result.instruments[instrument] = this.algorithms.summarizeFeatureOutput(features, candlesByTimeframe);
      }
      const rowsByAsset = await this.loadCrossAssetRows(pack, result.cutoff_paris);
      for (const delta of this.algorithms.buildCrossAssetDeltaDocs({
        timestamp_paris: result.cutoff_paris,
        rowsByAsset,
        computed_at: featureComputedAt,
      })) {
        result.cross_asset_deltas[delta.window] = this.algorithms.summarizeCrossAssetDelta(delta);
      }
      if (activeThesis) {
        const conditionStatus = this.algorithms.buildConditionStatusDoc({
          thesis: activeThesis,
          timestamp_paris: result.cutoff_paris,
          latest_price: this.algorithms.latestClose(firstInstrumentRows["5"] || firstInstrumentRows.M5 || []),
          computed_at: featureComputedAt,
        });
        result.condition_status = {
          condition_status_id: conditionStatus.condition_status_id,
          conditions_go_count: conditionStatus.conditions_go.length,
          invalidations_count: conditionStatus.invalidations.length,
        };
        if (args.save !== false) {
          await this.persistence.setDocument(COLLECTIONS.deskConditionStatus, conditionStatus.condition_status_id, conditionStatus, { merge: true });
        }
      }
      const completed = this.algorithms.featureRunCompleted(run, result, tick);
      if (args.save !== false) {
        await this.persistence.setDocument(COLLECTIONS.deskFeatureRuns, run.run_id, completed, { merge: true });
      }
      return result;
    } catch (error) {
      const failed = this.algorithms.featureRunFailed(run, error, tick);
      await this.persistence.setDocument(COLLECTIONS.deskFeatureRuns, run.run_id, failed, { merge: true });
      await this.persistence.setDocument(COLLECTIONS.deskErrors, failed.error_id, failed.error, { merge: true });
      return { ok: false, run_id: run.run_id, error: this.algorithms.publicReplayError(error) };
    }
  }

  async runAutomated(args, cutoffParis) {
    const mode = args.mode || "live";
    if (!["live", "paper"].includes(mode)) return null;
    const date = args.trading_date || args.date || String(cutoffParis || "").slice(0, 10);
    return this.runFeatureEngine({
      date,
      session: args.session || "asia_open",
      cutoff_paris: cutoffParis,
      timezone: args.timezone || "Europe/Paris",
      instruments: (args.instruments || ["MNQ", "MES"]).filter((instrument) => ["MNQ", "MES", "NQ", "ES"].includes(instrument)),
      save: args.save !== false,
      strategy_id: args.strategy_id,
      mode,
      trading_date: date,
      run_id: args.run_id,
      as_of_utc: args.as_of_utc || new Date(Date.parse(cutoffParis)).toISOString(),
      master_id: args.master_id,
      thesis_id: args.thesis_id,
    });
  }

  async replaySetup(setup, args) {
    const timeframe = this.algorithms.canonicalTimeframe(args.timeframe || "M5");
    const window = this.algorithms.replayWindowForSetup(setup, args);
    let rows = [];
    let rawRef = null;
    for (const feedId of this.algorithms.marketFeedCandidates(setup.instrument, timeframe)) {
      rawRef = `${COLLECTIONS.marketFeeds}/${feedId}/${COLLECTIONS.marketFeedCandles}`;
      rows = await this.persistence.queryDocuments({
        parentPath: `${COLLECTIONS.marketFeeds}/${feedId}`,
        collectionId: COLLECTIONS.marketFeedCandles,
        fromUtc: normalizeUtcIso(window.from),
        toUtc: normalizeUtcIso(window.to),
        orderField: "timestamp_utc",
        limit: args.max_rows || 5000,
      }).catch(() => []);
      if (rows.length) break;
    }
    return this.algorithms.replaySetupOnCandles(setup, rows, {
      source: "postgres_market_feeds_v2",
      raw_ref: rawRef,
      replay_id: args.replay_id || null,
      pricing_mode: args.pricing_mode || null,
      replay_window: window,
    });
  }

  async loadFeatureCandles(pack, instrument, cutoffParis) {
    const output = {};
    for (const timeframe of Object.keys(this.algorithms.featureDatasetCandidates(instrument))) {
      const candidates = this.algorithms.rawWindowDatasetCandidates(instrument, timeframe);
      const dataset = candidates.find((candidate) => DATASETS.includes(candidate) && datasetRef(pack, candidate));
      if (!dataset) {
        output[timeframe] = [];
        continue;
      }
      const ref = datasetRef(pack, dataset);
      const response = await this.host.getDataset({
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        dataset,
        as_of_utc: normalizeUtcIso(cutoffParis),
        mode: "live",
        max_rows: 5000,
      });
      const normalized = this.algorithms.normalizeFeatureRows(
        (response.rows || []).filter((row) => this.algorithms.rowMatchesInstrument(row, instrument, dataset)),
        {
          instrument,
          timeframe: this.algorithms.datasetTimeframe(dataset, timeframe),
          rawRef: ref.object_path || ref.storage_path || null,
        },
      );
      const direct = normalized.filter((row) => this.algorithms.canonicalTimeframe(row.timeframe) === timeframe);
      const baseRows = direct.length ? direct : normalized.filter((row) => this.algorithms.canonicalTimeframe(row.timeframe) === "5");
      output[timeframe] = direct.length || timeframe === "5" ? baseRows : this.algorithms.resampleRows(baseRows, timeframe);
    }
    return output;
  }

  async loadCrossAssetRows(pack, cutoffParis) {
    const output = {};
    for (const asset of ["DXY", "VIX", "US10Y", "US02Y", "GC", "CL"]) {
      const dataset = this.algorithms.rawWindowDatasetCandidates(asset, "5")
        .find((candidate) => DATASETS.includes(candidate) && datasetRef(pack, candidate));
      if (!dataset) {
        output[asset] = [];
        continue;
      }
      const ref = datasetRef(pack, dataset);
      const response = await this.host.getDataset({
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        dataset,
        as_of_utc: normalizeUtcIso(cutoffParis),
        mode: "live",
        max_rows: 5000,
      });
      output[asset] = this.algorithms.normalizeFeatureRows(
        (response.rows || []).filter((row) => this.algorithms.rowMatchesInstrument(row, asset, dataset)),
        {
          instrument: asset,
          timeframe: "5",
          rawRef: ref.object_path || ref.storage_path || null,
        },
      );
    }
    return output;
  }
}
