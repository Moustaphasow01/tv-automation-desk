import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import pg from "pg";
import { buildPostgresDataHealth } from "./postgres-data-health.js";
import { projectOperationalServices } from "./postgres-operational-health.js";

const { Pool } = pg;

const MARKET_FEEDS_COLLECTION = "market_feeds";
const MARKET_FEED_CANDLES_COLLECTION = "candles";
const LIVE_DATA_FEED_STATUS_COLLECTION = "live_data_feed_status";
const TRADINGVIEW_EVENTS_COLLECTION = "tradingview_webhook_events";
const MARKET_CANDLE_COLLECTION_RE = /^market_feeds\/([^/]+)\/candles$/;
const POSTGRES_TRANSIENT_STARTUP_CODES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "53300", "57P01", "57P02", "57P03",
  "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT",
]);

export class PostgresDeskPersistence {
  constructor(options = {}) {
    this.connectionString = options.connectionString || process.env.DATABASE_URL || null;
    if (!options.pool && !this.connectionString) {
      throw new Error("DATABASE_URL is required for the PostgreSQL desk store");
    }
    this.pool = options.pool || new Pool(postgresPoolOptions({
      ...options,
      connectionString: this.connectionString,
    }));
    this.objectRoot = resolve(options.objectRoot || process.env.DESK_OBJECT_ROOT || "./local_data/objects");
    this.schemaMode = resolveSchemaMode(options.schemaMode);
    const initializeSchema = () => this.schemaMode === "validate"
      ? this.#validateSchema()
      : this.#initialize();
    this.initialized = retryPostgresInitialization(initializeSchema, {
      maxAttempts: options.initializationAttempts,
      baseDelayMs: options.initializationRetryBaseMs,
      maxDelayMs: options.initializationRetryMaxMs,
      sleep: options.initializationSleep,
    });
  }

  async health() {
    await this.initialized;
    const result = await this.pool.query(`SELECT current_database() AS database, now() AS server_time,
      pg_database_size(current_database())::bigint AS database_size_bytes`);
    return {
      ok: true,
      mode: "postgres",
      database: result.rows[0].database,
      server_time: result.rows[0].server_time,
      database_size_bytes: Number(result.rows[0].database_size_bytes || 0),
      pool: {
        total: Number(this.pool.totalCount || 0),
        idle: Number(this.pool.idleCount || 0),
        waiting: Number(this.pool.waitingCount || 0),
      },
    };
  }

  async operationalHealth({
    staleAfterSeconds = positiveInteger(process.env.DESK_OPERATIONAL_HEALTH_STALE_SECONDS, 90),
    expectedServices = String(process.env.DESK_EXPECTED_SERVICE_IDS
      || "live_runtime_scheduler,replay_preparation_worker,broker_management,telegram_alert_worker")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  } = {}) {
    await this.initialized;
    const [heartbeats, objects, maintenance] = await Promise.all([
      this.pool.query(
        `SELECT service_id, service_kind, instance_id, release_version, status, details,
                heartbeat_at_utc, consecutive_failures, circuit_state, next_retry_at_utc,
                extract(epoch FROM (now() - heartbeat_at_utc))::integer AS age_seconds
         FROM desk_service_heartbeats
         ORDER BY service_id`,
      ),
      this.pool.query(
        `SELECT count(*)::integer AS count,
                COALESCE(sum(size_bytes), 0)::bigint AS catalog_size_bytes,
                count(*) FILTER (WHERE status <> 'READY')::integer AS not_ready
         FROM desk_pack_objects`,
      ),
      this.pool.query(
        `SELECT maintenance_run_id, status, deleted_counts, storage_snapshot,
                started_at_utc, completed_at_utc, error
         FROM desk_maintenance_runs
         ORDER BY started_at_utc DESC LIMIT 1`,
      ),
    ]);
    const operational = projectOperationalServices(heartbeats.rows, { expectedServices, staleAfterSeconds });
    const objectRow = objects.rows[0] || {};
    return {
      ok: operational.ok,
      services: operational.services,
      missing_services: operational.missingServices,
      objects: {
        count: Number(objectRow.count || 0),
        catalog_size_bytes: Number(objectRow.catalog_size_bytes || 0),
        not_ready: Number(objectRow.not_ready || 0),
      },
      maintenance: maintenance.rows[0] || null,
    };
  }

  async dataHealth({ nowUtc = new Date().toISOString() } = {}) {
    await this.initialized;
    return buildPostgresDataHealth(this.pool, { nowUtc });
  }

  async close() {
    await this.pool.end();
  }

  async getDocument(collection, documentId) {
    await this.initialized;
    const specialized = await getSpecializedDocument(this.pool, collection, documentId);
    if (specialized) return specialized;
    const document = await getDocument(this.pool, collection, documentId);
    if (!document) throw new Error(`${collection}_document_not_found:${documentId}`);
    return document;
  }

  async listDocuments(collection, limit) {
    await this.initialized;
    const bounded = limit === undefined || limit === null ? null : boundedLimit(limit);
    const specialized = await listSpecializedDocuments(this.pool, collection, bounded);
    if (specialized?.length) return specialized;
    const result = bounded
      ? await this.pool.query(
          "SELECT data FROM desk_documents WHERE collection = $1 ORDER BY document_id ASC LIMIT $2",
          [collection, bounded],
        )
      : await this.pool.query(
          "SELECT data FROM desk_documents WHERE collection = $1 ORDER BY document_id ASC",
          [collection],
        );
    return result.rows.map((row) => row.data);
  }

  async queryCollectionDocumentProjections({ collection, fields = [], filters = [], limit = 1000 }) {
    await this.initialized;
    const selectedFields = [...new Set(fields.map((field) => String(field || "").trim()).filter(Boolean))];
    if (!selectedFields.length || selectedFields.some((field) => !/^[a-zA-Z0-9_]+$/.test(field))) {
      throw persistenceError("DOCUMENT_PROJECTION_FIELDS_INVALID", "Projection fields must be non-empty top-level JSON property names.");
    }
    const values = [collection];
    const clauses = filters.filter(canPushDownFilter).map((filter) => pushDownFilterClause(filter, values));
    const pairs = selectedFields.flatMap((field) => [`'${field}'`, `data->'${field}'`]).join(", ");
    values.push(boundedLimit(limit));
    const result = await this.pool.query(
      `SELECT jsonb_strip_nulls(jsonb_build_object(${pairs})) AS data
       FROM desk_documents
       WHERE collection = $1${clauses.length ? ` AND ${clauses.join(" AND ")}` : ""}
       ORDER BY document_id ASC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows
      .map((row) => row.data)
      .filter((document) => filters.every((filter) => matchesFilter(document, filter)));
  }

  async queryDocuments({
    parentPath,
    collectionId,
    fromUtc,
    toUtc,
    orderField = "timestamp_utc",
    direction = "asc",
    limit = 500,
  }) {
    const collection = `${parentPath}/${collectionId}`;
    const orderDirection = String(direction).toLowerCase() === "desc" ? "desc" : "asc";
    const specialized = await querySpecializedCollection(this.pool, {
      collection,
      filters: [
        { field: orderField, operator: ">=", value: fromUtc },
        { field: orderField, operator: "<=", value: toUtc },
      ],
      orderBy: [{ field: orderField, direction: orderDirection }],
      limit,
    });
    if (specialized?.length) return specialized;
    return this.queryCollectionDocuments({
      collection,
      filters: [
        { field: orderField, operator: ">=", value: fromUtc },
        { field: orderField, operator: "<=", value: toUtc },
      ],
      orderBy: [{ field: orderField, direction: orderDirection }],
      limit,
    });
  }

  async queryFrontMarketCandles({
    feed_ids = [],
    from_utc,
    to_utc,
    limit_per_feed = 1500,
  } = {}) {
    await this.initialized;
    const feedIds = [...new Set((feed_ids || []).map((value) => String(value || "").trim()).filter(Boolean))];
    if (!feedIds.length) return [];
    const result = await this.pool.query(
      `WITH ranked AS (
         SELECT feed_id, timestamp_utc, symbol_code, timeframe, open, high, low, close,
                volume, is_closed, raw,
                row_number() OVER (PARTITION BY feed_id ORDER BY timestamp_utc DESC) AS row_rank
         FROM market_candles
         WHERE feed_id = ANY($1::text[])
           AND ($2::timestamptz IS NULL OR timestamp_utc >= $2::timestamptz)
           AND ($3::timestamptz IS NULL OR timestamp_utc <= $3::timestamptz)
       )
       SELECT feed_id,
              raw || jsonb_build_object(
                'feed_id', feed_id,
                'timestamp_utc', to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'symbol', symbol_code,
                'timeframe', timeframe,
                'open', open,
                'high', high,
                'low', low,
                'close', close,
                'volume', volume,
                'is_closed', is_closed
              ) AS data
       FROM ranked
       WHERE row_rank <= $4
       ORDER BY feed_id ASC, timestamp_utc DESC`,
      [
        feedIds,
        from_utc || null,
        to_utc || null,
        Math.max(1, Math.min(Number(limit_per_feed) || 1500, 5000)),
      ],
    );
    return result.rows.map((row) => ({
      feed_id: row.feed_id,
      data: row.data,
    }));
  }

  async queryCollectionDocuments({ collection, filters = [], orderBy = [], limit = 50 }) {
    await this.initialized;
    const specialized = await querySpecializedCollection(this.pool, { collection, filters, orderBy, limit });
    if (specialized?.length) return specialized;
    const sqlFilters = filters.filter(canPushDownFilter);
    let documents;
    if (sqlFilters.length) {
      const values = [collection];
      const clauses = sqlFilters.map((filter) => pushDownFilterClause(filter, values));
      const result = await this.pool.query(
        `SELECT data FROM desk_documents WHERE collection = $1 AND ${clauses.join(" AND ")}`,
        values,
      );
      documents = result.rows.map((row) => row.data);
    } else {
      documents = await this.listDocuments(collection);
    }
    const filtered = documents.filter((document) => filters.every((filter) => matchesFilter(document, filter)));
    filtered.sort((left, right) => compareDocuments(left, right, orderBy));
    return filtered.slice(0, boundedLimit(limit));
  }

  async queryMarketCandles({
    symbolCodes = [],
    feedIds = [],
    timeframe,
    fromUtc,
    toUtc,
    closedOnly = true,
    limit = 50_000,
  } = {}) {
    await this.initialized;
    const symbols = [...new Set((symbolCodes || []).map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))];
    const canonicalFeedIds = [...new Set((feedIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
    if (!symbols.length) throw persistenceError("MARKET_SYMBOLS_REQUIRED", "At least one market symbol is required.");
    if (!timeframe) throw persistenceError("MARKET_TIMEFRAME_REQUIRED", "Market timeframe is required.");
    const result = await this.pool.query(
      `SELECT raw || jsonb_build_object(
         'feed_id', feed_id,
         'timestamp_utc', to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'timestamp_paris', COALESCE(timestamp_paris, to_char(timestamp_utc AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI:SS')),
         'symbol', symbol_code,
         'symbol_code', symbol_code,
         'timeframe', timeframe,
         'open', open,
         'high', high,
         'low', low,
         'close', close,
         'volume', volume,
         'is_closed', is_closed,
         'indicators', indicators,
         'studies', studies
       ) AS data
       FROM market_candles
       WHERE upper(symbol_code) = ANY($1::text[])
         AND timeframe = $2
         AND ($3::timestamptz IS NULL OR timestamp_utc >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR timestamp_utc <= $4::timestamptz)
         AND ($5::boolean = false OR is_closed = true)
         AND ($6::text[] IS NULL OR feed_id = ANY($6::text[]))
       ORDER BY timestamp_utc ASC, symbol_code ASC, feed_id ASC
       LIMIT $7`,
      [
        symbols,
        canonicalTimeframe(timeframe),
        fromUtc || null,
        toUtc || null,
        Boolean(closedOnly),
        canonicalFeedIds.length ? canonicalFeedIds : null,
        Math.max(1, Math.min(Number(limit) || 50_000, 250_000)),
      ],
    );
    return result.rows.map((row) => row.data);
  }

  async upsertNewsSource(source = {}) {
    await this.initialized;
    await this.pool.query(
      `INSERT INTO news_sources (
         source_id, provider, display_name, base_url, enabled,
         refresh_interval_seconds, configuration, last_success_at_utc, last_attempt_at_utc
       ) VALUES (
         $1, $2::desk_news_provider, $3, $4, $5,
         $6, $7::jsonb, $8::timestamptz, $9::timestamptz
       )
       ON CONFLICT(source_id) DO UPDATE
       SET provider = EXCLUDED.provider,
           display_name = EXCLUDED.display_name,
           base_url = EXCLUDED.base_url,
           enabled = EXCLUDED.enabled,
           refresh_interval_seconds = EXCLUDED.refresh_interval_seconds,
           configuration = news_sources.configuration || EXCLUDED.configuration,
           last_success_at_utc = COALESCE(EXCLUDED.last_success_at_utc, news_sources.last_success_at_utc),
           last_attempt_at_utc = COALESCE(EXCLUDED.last_attempt_at_utc, news_sources.last_attempt_at_utc),
           updated_at_utc = now()`,
      [
        source.source_id,
        String(source.provider || "GDELT").toUpperCase(),
        source.display_name || source.source_id,
        source.base_url,
        source.enabled !== false,
        Number(source.refresh_interval_seconds || 900),
        JSON.stringify(source.configuration || {}),
        source.last_success_at_utc || null,
        source.last_attempt_at_utc || null,
      ],
    );
  }

  async markNewsSourceSuccess(sourceId, atUtc) {
    await this.initialized;
    await this.pool.query(
      `UPDATE news_sources
       SET last_attempt_at_utc = $2::timestamptz,
           last_success_at_utc = $2::timestamptz,
           updated_at_utc = now()
       WHERE source_id = $1`,
      [sourceId, atUtc],
    );
  }

  async upsertNewsIngestionRun(run = {}) {
    await this.initialized;
    await this.pool.query(
      `INSERT INTO news_ingestion_runs (
         run_id, source_id, requested_by, status, started_at_utc, completed_at_utc,
         received_count, normalized_count, inserted_count, updated_count,
         discarded_count, pruned_count, error, metadata
       ) VALUES (
         $1, $2, $3, $4::desk_news_ingestion_status, $5::timestamptz, $6::timestamptz,
         $7, $8, $9, $10,
         $11, $12, $13, $14::jsonb
       )
       ON CONFLICT(run_id) DO UPDATE
       SET status = EXCLUDED.status,
           completed_at_utc = EXCLUDED.completed_at_utc,
           received_count = EXCLUDED.received_count,
           normalized_count = EXCLUDED.normalized_count,
           inserted_count = EXCLUDED.inserted_count,
           updated_count = EXCLUDED.updated_count,
           discarded_count = EXCLUDED.discarded_count,
           pruned_count = EXCLUDED.pruned_count,
           error = EXCLUDED.error,
           metadata = news_ingestion_runs.metadata || EXCLUDED.metadata,
           updated_at_utc = now()`,
      [
        run.run_id,
        run.source_id,
        run.requested_by,
        String(run.status || "RUNNING").toUpperCase(),
        run.started_at_utc,
        run.completed_at_utc || null,
        Number(run.received_count || 0),
        Number(run.normalized_count || 0),
        Number(run.inserted_count || 0),
        Number(run.updated_count || 0),
        Number(run.discarded_count || 0),
        Number(run.pruned_count || 0),
        run.error || null,
        JSON.stringify(run.metadata || {}),
      ],
    );
  }

  async getLatestNewsIngestionRun(sourceId) {
    await this.initialized;
    const result = await this.pool.query(
      `SELECT run_id, source_id, requested_by, status::text AS status,
              started_at_utc, completed_at_utc, received_count, normalized_count,
              inserted_count, updated_count, discarded_count, pruned_count,
              error, metadata
       FROM news_ingestion_runs
       WHERE source_id = $1
       ORDER BY started_at_utc DESC
       LIMIT 1`,
      [sourceId],
    );
    return result.rows[0] ? normalizeNewsRunRow(result.rows[0]) : null;
  }

  async upsertNewsArticles(articles = []) {
    if (!articles.length) return { inserted_count: 0, updated_count: 0 };
    return this.#transaction(`news:${createHash("sha256").update(articles.map((article) => article.article_id).join("\n")).digest("hex")}`, async (client) => {
      let insertedCount = 0;
      let updatedCount = 0;
      for (const article of articles) {
        const existing = await client.query(
          "SELECT article_id FROM news_articles WHERE canonical_url = $1 LIMIT 1",
          [article.canonical_url || article.url],
        );
        if (existing.rows.length) updatedCount += 1;
        else insertedCount += 1;
        await client.query(
          `INSERT INTO news_articles (
             article_id, source_id, provider_article_id, canonical_url, original_url,
             title, summary, source_domain, language, source_country, published_at_utc,
             importance, assets, instruments, topics, sentiment, content_hash, raw,
             first_seen_at_utc, last_seen_at_utc
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10, $11::timestamptz,
             $12::desk_news_importance, $13::text[], $14::text[], $15::text[], $16, $17, $18::jsonb,
             $19::timestamptz, $20::timestamptz
           )
           ON CONFLICT(canonical_url) DO UPDATE
           SET title = EXCLUDED.title,
               summary = EXCLUDED.summary,
               source_domain = EXCLUDED.source_domain,
               language = EXCLUDED.language,
               source_country = EXCLUDED.source_country,
               published_at_utc = LEAST(news_articles.published_at_utc, EXCLUDED.published_at_utc),
               importance = EXCLUDED.importance,
               assets = EXCLUDED.assets,
               instruments = EXCLUDED.instruments,
               topics = EXCLUDED.topics,
               sentiment = EXCLUDED.sentiment,
               content_hash = EXCLUDED.content_hash,
               raw = news_articles.raw || EXCLUDED.raw,
               last_seen_at_utc = EXCLUDED.last_seen_at_utc,
               updated_at_utc = now()`,
          [
            article.article_id,
            article.source_id,
            article.provider_article_id,
            article.canonical_url || article.url,
            article.original_url || article.url,
            article.title,
            article.summary || null,
            article.source_domain || article.source,
            article.language || "English",
            article.source_country || null,
            article.published_at_utc,
            String(article.importance || "LOW").toUpperCase(),
            article.assets || [],
            article.instruments || [],
            article.topics || [],
            article.sentiment ?? null,
            article.content_hash,
            JSON.stringify(article.raw || {}),
            article.first_seen_at_utc,
            article.last_seen_at_utc,
          ],
        );
      }
      return { inserted_count: insertedCount, updated_count: updatedCount };
    });
  }

  async queryNewsArticles({
    from_utc,
    to_utc,
    limit = 100,
    instruments = [],
  } = {}) {
    await this.initialized;
    const instrumentFilter = (instruments || []).map((value) => String(value || "").trim().toUpperCase()).filter(Boolean);
    const result = await this.pool.query(
      `SELECT article_id, source_id, provider_article_id, canonical_url, original_url,
              title, summary, source_domain, language, source_country, published_at_utc,
              importance::text AS importance, assets, instruments, topics, sentiment,
              content_hash, first_seen_at_utc, last_seen_at_utc
       FROM news_articles
       WHERE ($1::timestamptz IS NULL OR published_at_utc >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR published_at_utc <= $2::timestamptz)
         AND ($3::text[] IS NULL OR instruments && $3::text[])
       ORDER BY published_at_utc DESC, article_id ASC
       LIMIT $4`,
      [from_utc || null, to_utc || null, instrumentFilter.length ? instrumentFilter : null, Math.max(1, Math.min(Number(limit) || 100, 1000))],
    );
    return result.rows.map(normalizeNewsArticleRow);
  }

  async pruneNewsArticles(beforeUtc) {
    await this.initialized;
    const result = await this.pool.query(
      "DELETE FROM news_articles WHERE published_at_utc < $1::timestamptz",
      [beforeUtc],
    );
    return result.rowCount || 0;
  }

  async setDocument(collection, documentId, data, { merge = false } = {}) {
    await this.initialized;
    await setDocument(this.pool, collection, documentId, data, merge);
  }

  async createDocument(collection, documentId, data) {
    await this.initialized;
    try {
      await this.pool.query(
        "INSERT INTO desk_documents (collection, document_id, data) VALUES ($1, $2, $3::jsonb)",
        [collection, documentId, JSON.stringify(data)],
      );
    } catch (error) {
      if (error?.code === "23505") throw persistenceError("DOCUMENT_ALREADY_EXISTS", `${collection}/${documentId} already exists.`);
      throw error;
    }
  }

  async writeDocuments(writes = []) {
    return this.#transaction(`batch:${createHash("sha256").update(JSON.stringify(writes.map((write) => [write.collection, write.documentId]))).digest("hex")}`, async (client) => {
      for (const write of writes) {
        await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      }
      return { ok: true, write_count: writes.length };
    });
  }

  async commitFrontProjectionMutation({ sourceWrite, projectionWrites = [], currentStatePrecondition = null }) {
    return this.#transaction(`front:${currentStatePrecondition?.documentId || sourceWrite.documentId}`, async (client) => {
      if (currentStatePrecondition) {
        const current = await getDocument(client, currentStatePrecondition.collection, currentStatePrecondition.documentId);
        const revisionMatches = currentStatePrecondition.expectedRevision === null
          ? current === null
          : current !== null && Number(current.revision) === Number(currentStatePrecondition.expectedRevision);
        const hashMatches = currentStatePrecondition.expectedRevision === null
          || String(current?.projection_hash || "") === String(currentStatePrecondition.expectedProjectionHash || "");
        if (!revisionMatches || !hashMatches) {
          throw persistenceError("FRONT_PROJECTION_REVISION_CONFLICT", "Front projection changed before save.");
        }
      }
      for (const write of [sourceWrite, ...projectionWrites]) {
        await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      }
      return { ok: true, projection_write_count: projectionWrites.length };
    });
  }

  async commitBrokerPositionProjection(input) {
    return this.#transaction(`broker-position:${input.positionId}`, async (client) => {
      const current = await getDocument(client, input.positionCollection, input.positionId);
      if (!current) {
        return { applied: false, replayed: false, reason: "CANONICAL_POSITION_NOT_FOUND", position: null };
      }
      const currentBrokerRevision = Number(current.broker_projection_revision ?? -1);
      const incomingBrokerRevision = Number(input.brokerRevision);
      if (!Number.isInteger(incomingBrokerRevision) || incomingBrokerRevision < 0) {
        throw persistenceError("BROKER_PROJECTION_REVISION_INVALID", "Broker projection revision must be a non-negative integer.");
      }
      if (currentBrokerRevision >= incomingBrokerRevision) {
        return { applied: false, replayed: true, reason: "BROKER_PROJECTION_ALREADY_APPLIED", position: current };
      }
      const position = {
        ...current,
        ...(input.positionPatch || {}),
        broker_projection_revision: incomingBrokerRevision,
      };
      await setDocument(client, input.positionCollection, input.positionId, position, false);
      if (input.auditWrite) {
        await setDocument(client, input.auditWrite.collection, input.auditWrite.documentId, input.auditWrite.data, false);
      }
      return { applied: true, replayed: false, reason: "BROKER_ACK_PROJECTED", position };
    });
  }

  async commitLiveMonitorMutation(input) {
    return this.#transaction(`live-monitor:${input.stateId}`, async (client) => {
      const existingMonitor = await getDocument(client, input.monitorCollection, input.monitorId);
      if (existingMonitor) {
        if (String(existingMonitor.monitor_command_hash || "") !== String(input.commandHash || "")) {
          throw persistenceError("MONITOR_IDEMPOTENCY_CONFLICT", "Monitor identity already exists with different canonical command content.");
        }
        return {
          replayed: true,
          revision: Number(existingMonitor.applied_revision ?? existingMonitor.revision ?? 0),
          monitor: existingMonitor,
        };
      }
      const state = await getDocument(client, input.stateCollection, input.stateId);
      const actualRevision = state === null ? null : Number(state.revision || 0);
      if (state === null || actualRevision !== Number(input.expectedRevision)) {
        throw persistenceError("MONITOR_REVISION_CONFLICT", "Monitor expected_revision no longer matches the canonical active thesis.", {
          expected_revision: Number(input.expectedRevision),
          actual_revision: actualRevision,
          state_id: input.stateId,
        });
      }
      if (input.frontStatePrecondition) {
        const current = await getDocument(client, input.frontStatePrecondition.collection, input.frontStatePrecondition.documentId);
        const revisionMatches = input.frontStatePrecondition.expectedRevision === null
          ? current === null
          : current !== null && Number(current.revision) === Number(input.frontStatePrecondition.expectedRevision);
        const hashMatches = input.frontStatePrecondition.expectedRevision === null
          || String(current?.projection_hash || "") === String(input.frontStatePrecondition.expectedProjectionHash || "");
        if (!revisionMatches || !hashMatches) {
          throw persistenceError("FRONT_PROJECTION_REVISION_CONFLICT", "Front projection changed before Monitor save.");
        }
      }
      const revision = actualRevision + 1;
      const monitor = { ...input.monitorDoc, expected_revision: actualRevision, applied_revision: revision };
      const nextState = { ...state, ...(input.statePatch || {}), revision };
      for (const write of input.writes || []) {
        const data = write.collection === input.monitorCollection && write.documentId === input.monitorId
          ? monitor
          : write.data;
        await setDocument(client, write.collection, write.documentId, data, Boolean(write.merge));
      }
      await setDocument(client, input.stateCollection, input.stateId, nextState, false);
      return { replayed: false, revision, monitor, state: nextState };
    });
  }

  async commitOperatorCommandMutation(input) {
    return this.#transaction(`operator:${input.stateId}`, async (client) => {
      const existingCommand = await getDocument(client, input.commandCollection, input.commandId);
      if (existingCommand) {
        if (existingCommand.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Operator command idempotency conflict.");
        return { replayed: true, command: existingCommand, result: existingCommand.result || null };
      }
      const state = await getDocument(client, input.stateCollection, input.stateId);
      if (Number(state?.revision || 0) !== Number(input.expectedRevision)) {
        throw persistenceError("REVISION_CONFLICT", "Operator state revision conflict.");
      }
      for (const condition of input.preconditions || []) {
        const current = await getDocument(client, condition.collection, condition.documentId);
        if (!current || canonicalHash(current) !== condition.expectedHash) throw persistenceError("TARGET_CONFLICT", "Operator target changed before commit.");
      }
      for (const write of input.writes || []) await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      await setDocument(client, input.stateCollection, input.stateId, input.stateDoc, false);
      await setDocument(client, input.commandCollection, input.commandId, input.commandDoc, false);
      await setDocument(client, input.eventCollection, input.eventDoc.event_id, input.eventDoc, false);
      await setDocument(client, input.auditCollection, input.auditDoc.audit_id, input.auditDoc, false);
      return { replayed: false, command: input.commandDoc, result: input.result || {} };
    });
  }

  async commitReplayMutation(input) {
    return this.#transaction(`replay:${input.backtestId}`, async (client) => {
      const idempotencyId = replayIdempotencyId(input.backtestId, input.idempotencyKey);
      const existing = await getDocument(client, input.idempotencyCollection, idempotencyId);
      const run = await getDocument(client, input.runCollection, input.backtestId);
      if (existing) {
        if (existing.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Replay idempotency conflict.");
        return { replayed: true, run: run || {}, result: existing.result || null };
      }
      if (!run) throw persistenceError("RUN_NOT_FOUND", `Replay run not found: ${input.backtestId}.`);
      if (Number(run.revision || 0) !== Number(input.expectedRevision)) throw persistenceError("REVISION_CONFLICT", "Replay revision conflict.");
      for (const condition of input.preconditions || []) {
        const current = await getDocument(client, condition.collection, condition.documentId);
        if (!current || Object.entries(condition.equals || {}).some(([key, value]) => current[key] !== value)) {
          throw persistenceError("WORK_LEASE_CONFLICT", "Desk work lease changed before replay save.");
        }
      }
      const revision = Number(run.revision || 0) + 1;
      const nextRun = { ...run, ...input.runPatch, revision };
      const result = { ...(input.result || {}), revision, idempotent_replay: false };
      await setDocument(client, input.runCollection, input.backtestId, nextRun, false);
      for (const write of input.writes || []) await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      await setDocument(client, input.idempotencyCollection, idempotencyId, {
        idempotency_id: idempotencyId,
        idempotency_key: input.idempotencyKey,
        backtest_id: input.backtestId,
        request_hash: input.requestHash,
        expected_revision: input.expectedRevision,
        applied_revision: revision,
        status: "applied",
        result,
        created_at_utc: input.tick?.utc || null,
        created_at_paris: input.tick?.paris || null,
      }, false);
      return { replayed: false, run: nextRun, result };
    });
  }

  async claimDeskWorkItem({ collection, workItemId, proposed, tick }) {
    return this.#transaction(`work:${workItemId}`, async (client) => {
      const current = await getDocument(client, collection, workItemId);
      if (!current) return null;
      if (current.operational_visibility === "history" || current.read_only === true) return null;
      const replayWork = current.automation_scope === "replay" && ["REPLAY_MASTER", "REPLAY_MONITOR"].includes(current.workflow);
      const now = Number(tick?.epochMs);
      const expiry = Date.parse(current.lease_expires_at_utc || current.lease_expires_at_paris || "");
      const retryAfter = Date.parse(current.retry_after_utc || current.retry_after_paris || "");
      const retryDue = !Number.isFinite(retryAfter) || (Number.isFinite(now) && retryAfter <= now);
      const claimable = (current.status === "READY" && retryDue)
        || (current.status === "CLAIMED" && Number.isFinite(expiry) && Number.isFinite(now) && expiry <= now);
      if (!replayWork || !claimable || Number(current.attempt_count || 0) >= Number(current.max_attempts ?? 3)) return null;
      const claimed = { ...current, ...proposed, attempt_count: Number(current.attempt_count || 0) + 1 };
      await setDocument(client, collection, workItemId, claimed, false);
      return claimed;
    });
  }

  async claimLiveCursor(input) {
    return this.transitionLiveCursor(input);
  }

  async transitionLiveCursor(input) {
    if (typeof input.transition !== "function") throw new Error("LIVE_CURSOR_TRANSITION_REQUIRED");
    return this.#transaction(`cursor:${input.cursorId}`, async (client) => {
      const current = await getDocument(client, input.cursorCollection || "desk_live_run_cursor", input.cursorId) || input.initialCursor;
      if (!current) throw new Error(`LIVE_CURSOR_NOT_FOUND:${input.cursorId}`);
      const outcome = await input.transition(current);
      if (!outcome?.cursor || outcome.cursor.cursor_id !== input.cursorId) throw new Error(`LIVE_CURSOR_TRANSITION_INVALID:${input.cursorId}`);
      await setDocument(client, input.cursorCollection || "desk_live_run_cursor", input.cursorId, outcome.cursor, false);
      for (const event of outcome.events || []) await setDocument(client, input.eventCollection || "desk_agent_work_events", event.event_id, event, false);
      for (const item of outcome.dead_letters || []) await setDocument(client, input.deadLetterCollection || "desk_agent_work_dead_letter", item.dead_letter_id, item, false);
      return outcome;
    });
  }

  async createReplayRun(input) {
    return this.#transaction(`replay-create:${input.run.backtest_id}`, async (client) => {
      const idempotencyId = replayIdempotencyId(input.run.backtest_id, input.idempotencyKey);
      const existing = await getDocument(client, input.idempotencyCollection, idempotencyId);
      const currentRun = await getDocument(client, input.runCollection, input.run.backtest_id);
      if (existing) {
        if (existing.request_hash !== input.requestHash) throw persistenceError("IDEMPOTENCY_CONFLICT", "Replay creation idempotency conflict.");
        return { replayed: true, run: currentRun || {}, result: existing.result || null };
      }
      if (currentRun) throw persistenceError("IDEMPOTENCY_CONFLICT", `Replay run already exists: ${input.run.backtest_id}.`);
      const result = { ...(input.result || {}), revision: Number(input.run.revision || 0), idempotent_replay: false };
      await setDocument(client, input.runCollection, input.run.backtest_id, input.run, false);
      for (const write of input.writes || []) await setDocument(client, write.collection, write.documentId, write.data, Boolean(write.merge));
      await setDocument(client, input.idempotencyCollection, idempotencyId, {
        idempotency_id: idempotencyId,
        idempotency_key: input.idempotencyKey,
        backtest_id: input.run.backtest_id,
        request_hash: input.requestHash,
        applied_revision: Number(input.run.revision || 0),
        status: "applied",
        operation: "create_orchestrated_replay",
        result,
        created_at_utc: input.tick?.utc || null,
        created_at_paris: input.tick?.paris || null,
      }, false);
      return { replayed: false, run: input.run, result };
    });
  }

  async readStorageText(storagePath) {
    return (await this.readStorageObject(storagePath)).text;
  }

  async getPackObject(storagePath, generation = null) {
    await this.initialized;
    const normalizedGeneration = generation === null || generation === undefined ? null : String(generation);
    const result = await this.pool.query(
      `SELECT object_id, source_storage_path, source_generation, local_relative_path,
              content_sha256, size_bytes, content_type, status, source_kind,
              immutable, metadata, created_at_utc, verified_at_utc, updated_at_utc
       FROM desk_pack_objects
       WHERE source_storage_path = $1
         AND ($2::text IS NULL OR source_generation = $2)
       ORDER BY verified_at_utc DESC NULLS LAST, updated_at_utc DESC
       LIMIT 1`,
      [String(storagePath || ""), normalizedGeneration],
    );
    return result.rows[0] || null;
  }

  async registerPackObject(input) {
    await this.initialized;
    const sourceStoragePath = String(input.sourceStoragePath || input.storagePath || "").trim();
    const sourceGeneration = String(input.sourceGeneration ?? input.generation ?? "");
    const localRelativePath = normalizedRelativeObjectPath(input.localRelativePath || input.relativePath);
    const contentSha256 = String(input.contentSha256 || input.sha256 || "").toLowerCase();
    const sizeBytes = Number(input.sizeBytes);
    if (!sourceStoragePath) throw persistenceError("PACK_OBJECT_SOURCE_REQUIRED", "Pack object source path is required.");
    if (!/^[a-f0-9]{64}$/.test(contentSha256)) throw persistenceError("PACK_OBJECT_SHA256_INVALID", "Pack object SHA-256 is required.");
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw persistenceError("PACK_OBJECT_SIZE_INVALID", "Pack object size is invalid.");
    const objectId = input.objectId || createHash("sha256").update(`${sourceStoragePath}\n${sourceGeneration}`).digest("hex");
    const result = await this.pool.query(
      `INSERT INTO desk_pack_objects (
         object_id, source_storage_path, source_generation, local_relative_path,
         content_sha256, size_bytes, content_type, status, source_kind,
         immutable, metadata, verified_at_utc, updated_at_utc
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10::jsonb, $11::timestamptz, now()
       )
       ON CONFLICT (source_storage_path, source_generation) DO UPDATE
       SET local_relative_path = CASE
             WHEN desk_pack_objects.content_sha256 = EXCLUDED.content_sha256
             THEN EXCLUDED.local_relative_path
             ELSE desk_pack_objects.local_relative_path
           END,
           size_bytes = CASE
             WHEN desk_pack_objects.content_sha256 = EXCLUDED.content_sha256
             THEN EXCLUDED.size_bytes
             ELSE desk_pack_objects.size_bytes
           END,
           content_type = CASE
             WHEN desk_pack_objects.content_sha256 = EXCLUDED.content_sha256
             THEN EXCLUDED.content_type
             ELSE desk_pack_objects.content_type
           END,
           status = CASE
             WHEN desk_pack_objects.content_sha256 = EXCLUDED.content_sha256
             THEN EXCLUDED.status
             ELSE 'QUARANTINED'
           END,
           source_kind = CASE
             WHEN desk_pack_objects.content_sha256 = EXCLUDED.content_sha256
             THEN EXCLUDED.source_kind
             ELSE desk_pack_objects.source_kind
           END,
           metadata = desk_pack_objects.metadata || EXCLUDED.metadata,
           verified_at_utc = CASE
             WHEN desk_pack_objects.content_sha256 = EXCLUDED.content_sha256
             THEN EXCLUDED.verified_at_utc
             ELSE desk_pack_objects.verified_at_utc
           END,
           updated_at_utc = now()
       RETURNING *`,
      [
        objectId,
        sourceStoragePath,
        sourceGeneration,
        localRelativePath,
        contentSha256,
        sizeBytes,
        input.contentType || null,
        input.status || "READY",
        input.sourceKind || "LOCAL",
        JSON.stringify(input.metadata || {}),
        input.verifiedAtUtc || new Date().toISOString(),
      ],
    );
    const registered = result.rows[0];
    if (registered.content_sha256 !== contentSha256 || registered.status === "QUARANTINED") {
      throw persistenceError("PACK_OBJECT_IMMUTABILITY_CONFLICT", `Immutable object conflict for ${sourceStoragePath}.`);
    }
    return registered;
  }

  async writeStorageObject(storagePath, content, options = {}) {
    await this.initialized;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), options.encoding || "utf8");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const generation = String(options.generation || sha256);
    const relativePath = normalizedRelativeObjectPath(
      options.localRelativePath || immutableObjectRelativePath(storagePath, generation),
    );
    const filePath = localObjectPath(`local://${relativePath}`, this.objectRoot);
    await mkdir(dirname(filePath), { recursive: true });
    let existing = null;
    try {
      existing = await readFile(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (existing && createHash("sha256").update(existing).digest("hex") !== sha256) {
      throw persistenceError("PACK_OBJECT_IMMUTABILITY_CONFLICT", `Immutable local path already contains different bytes: ${relativePath}.`);
    }
    if (!existing) {
      const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      try {
        await writeFile(temporaryPath, buffer, { flag: "wx" });
        await rename(temporaryPath, filePath);
      } catch (error) {
        try {
          await unlink(temporaryPath);
        } catch {
          // Best effort cleanup only.
        }
        throw error;
      }
    }
    const registered = await this.registerPackObject({
      sourceStoragePath: storagePath,
      sourceGeneration: generation,
      localRelativePath: relativePath,
      contentSha256: sha256,
      sizeBytes: buffer.length,
      contentType: options.contentType || contentType(filePath),
      sourceKind: options.sourceKind || "POSTGRES_BUILD",
      metadata: options.metadata || {},
    });
    return {
      storage_path: storagePath,
      generation,
      sha256,
      size_bytes: buffer.length,
      local_relative_path: relativePath,
      object: registered,
    };
  }

  async readStorageObject(storagePath, { generation = null } = {}) {
    await this.initialized;
    const catalogObject = await this.getPackObject(storagePath, generation);
    if (catalogObject && catalogObject.status !== "READY") {
      throw persistenceError("PACK_OBJECT_NOT_READY", `Pack object is ${catalogObject.status}: ${storagePath}.`, {
        storage_path: storagePath,
        generation,
        status: catalogObject.status,
      });
    }
    if (!catalogObject && String(storagePath || "").startsWith("gs://")) {
      throw persistenceError("PACK_OBJECT_NOT_MIRRORED", `Cloud object is not mirrored locally: ${storagePath}.`, {
        storage_path: storagePath,
        generation,
      });
    }
    const filePath = catalogObject
      ? localObjectPath(`local://${catalogObject.local_relative_path}`, this.objectRoot)
      : localObjectPath(storagePath, this.objectRoot);
    const [buffer, metadata] = await Promise.all([readFile(filePath), stat(filePath)]);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (catalogObject && (sha256 !== catalogObject.content_sha256 || buffer.length !== Number(catalogObject.size_bytes))) {
      await this.pool.query(
        "UPDATE desk_pack_objects SET status = 'CORRUPT', updated_at_utc = now() WHERE object_id = $1",
        [catalogObject.object_id],
      );
      throw persistenceError("PACK_OBJECT_INTEGRITY_MISMATCH", `Local immutable object failed integrity validation: ${storagePath}.`, {
        storage_path: storagePath,
        expected_sha256: catalogObject.content_sha256,
        actual_sha256: sha256,
        expected_size_bytes: Number(catalogObject.size_bytes),
        actual_size_bytes: buffer.length,
      });
    }
    return {
      buffer,
      text: buffer.toString("utf8"),
      metadata: {
        generation: catalogObject?.source_generation || String(Math.trunc(metadata.mtimeMs)),
        metageneration: "1",
        crc32c: null,
        md5_hash: createHash("md5").update(buffer).digest("base64"),
        size_bytes: buffer.length,
        content_type: catalogObject?.content_type || contentType(filePath),
        custom: {
          local_relative_path: catalogObject?.local_relative_path || relative(this.objectRoot, filePath),
          source_kind: catalogObject?.source_kind || "LOCAL_UNCATALOGUED",
          sha256,
        },
      },
    };
  }

  async auditPackObjects(datasetRefs = []) {
    const results = [];
    for (const ref of datasetRefs || []) {
      const storagePath = ref?.storage_path || ref?.object_path;
      const generation = ref?.gcs_generation ?? ref?.generation ?? null;
      if (!storagePath) {
        results.push({ dataset_id: ref?.dataset_id || null, status: "MISSING_REFERENCE" });
        continue;
      }
      const object = await this.getPackObject(storagePath, generation);
      results.push({
        dataset_id: ref?.dataset_id || null,
        storage_path: storagePath,
        generation: generation === null ? null : String(generation),
        status: object?.status || (String(storagePath).startsWith("gs://") ? "NOT_MIRRORED" : "UNCATALOGUED"),
        object,
      });
    }
    return {
      ok: results.every((result) => ["READY", "UNCATALOGUED"].includes(result.status)),
      results,
      missing: results.filter((result) => !["READY", "UNCATALOGUED"].includes(result.status)),
    };
  }

  async #initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS desk_documents (
        collection text NOT NULL,
        document_id text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (collection, document_id)
      );
      CREATE INDEX IF NOT EXISTS desk_documents_collection_updated_idx
        ON desk_documents (collection, updated_at DESC);
      CREATE INDEX IF NOT EXISTS desk_documents_data_gin_idx
        ON desk_documents USING gin (data);
      CREATE INDEX IF NOT EXISTS desk_documents_collection_backtest_idx
        ON desk_documents (collection, ((data ->> 'backtest_id')));
      CREATE INDEX IF NOT EXISTS desk_documents_collection_status_idx
        ON desk_documents (collection, ((data ->> 'status')));
      CREATE INDEX IF NOT EXISTS desk_documents_collection_trading_date_idx
        ON desk_documents (collection, ((data ->> 'trading_date')));
      CREATE INDEX IF NOT EXISTS desk_documents_collection_work_item_idx
        ON desk_documents (collection, ((data ->> 'work_item_id')));
      CREATE TABLE IF NOT EXISTS desk_pack_objects (
        object_id text PRIMARY KEY,
        source_storage_path text NOT NULL,
        source_generation text NOT NULL DEFAULT '',
        local_relative_path text NOT NULL UNIQUE,
        content_sha256 text NOT NULL,
        size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
        content_type text,
        status text NOT NULL DEFAULT 'READY'
          CHECK (status IN ('READY', 'MISSING', 'CORRUPT', 'QUARANTINED')),
        source_kind text NOT NULL DEFAULT 'LOCAL'
          CHECK (source_kind IN ('LOCAL', 'GCS_MIRROR', 'POSTGRES_BUILD')),
        immutable boolean NOT NULL DEFAULT true,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at_utc timestamptz NOT NULL DEFAULT now(),
        verified_at_utc timestamptz,
        updated_at_utc timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source_storage_path, source_generation)
      );
      CREATE INDEX IF NOT EXISTS idx_desk_pack_objects_source_path
        ON desk_pack_objects (source_storage_path);
      CREATE INDEX IF NOT EXISTS idx_desk_pack_objects_status
        ON desk_pack_objects (status, source_kind);
    `);
  }

  async #validateSchema() {
    const result = await this.pool.query(`
      SELECT
        to_regclass('public.desk_documents') AS desk_documents,
        to_regclass('public.desk_pack_objects') AS desk_pack_objects,
        to_regclass('public.news_sources') AS news_sources,
        to_regclass('public.news_articles') AS news_articles,
        to_regclass('public.news_ingestion_runs') AS news_ingestion_runs,
        to_regclass('public.trade_outcomes') AS trade_outcomes,
        to_regclass('public.desk_maintenance_runs') AS desk_maintenance_runs,
        to_regclass('public.desk_deployment_runs') AS desk_deployment_runs
      `);
    const missing = ["desk_documents", "desk_pack_objects", "news_sources", "news_articles", "news_ingestion_runs", "trade_outcomes", "desk_maintenance_runs", "desk_deployment_runs"]
      .filter((table) => !result.rows[0]?.[table]);
    if (missing.length) {
      throw persistenceError(
        "POSTGRES_SCHEMA_NOT_READY",
        `Required PostgreSQL tables are missing: ${missing.join(", ")}. Apply owner-level migrations before starting the runtime.`,
      );
    }
  }

  async #transaction(lockKey, operation) {
    await this.initialized;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}


function resolveSchemaMode(explicitMode) {
  const configured = String(explicitMode || process.env.DESK_POSTGRES_SCHEMA_MODE || "").trim().toLowerCase();
  if (configured) {
    if (!["ensure", "validate"].includes(configured)) {
      throw new Error(`DESK_POSTGRES_SCHEMA_MODE must be ensure or validate, received: ${configured}`);
    }
    return configured;
  }
  const environment = String(process.env.DESK_ENVIRONMENT || process.env.NODE_ENV || "development").trim().toLowerCase();
  return ["preprod", "production"].includes(environment) ? "validate" : "ensure";
}

function normalizeNewsRunRow(row = {}) {
  return {
    ...row,
    status: String(row.status || "").toUpperCase(),
    started_at_utc: timestampIso(row.started_at_utc),
    completed_at_utc: timestampIso(row.completed_at_utc),
  };
}

function normalizeNewsArticleRow(row = {}) {
  return {
    article_id: row.article_id,
    source_id: row.source_id,
    provider: "GDELT",
    provider_article_id: row.provider_article_id,
    url: row.canonical_url,
    canonical_url: row.canonical_url,
    original_url: row.original_url,
    title: row.title,
    summary: row.summary,
    source: row.source_domain,
    source_domain: row.source_domain,
    language: row.language,
    source_country: row.source_country,
    published_at_utc: timestampIso(row.published_at_utc),
    importance: String(row.importance || "LOW").toUpperCase(),
    assets: row.assets || [],
    instruments: row.instruments || [],
    topics: row.topics || [],
    sentiment: row.sentiment == null ? null : Number(row.sentiment),
    content_hash: row.content_hash,
    raw: row.raw || {},
    first_seen_at_utc: timestampIso(row.first_seen_at_utc),
    last_seen_at_utc: timestampIso(row.last_seen_at_utc),
  };
}

function timestampIso(value) {
  if (value == null || value === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function canPushDownFilter(filter = {}) {
  return ["==", "!=", "in"].includes(filter.operator || "==")
    && String(filter.field || "").split(".").every((part) => /^[A-Za-z0-9_]+$/.test(part))
    && (filter.operator !== "in" || Array.isArray(filter.value));
}

function pushDownFilterClause(filter, values) {
  values.push(String(filter.field).split("."));
  const pathIndex = values.length;
  if ((filter.operator || "==") === "in") {
    const candidates = filter.value || [];
    if (!candidates.length) return "FALSE";
    const placeholders = candidates.map((value) => {
      values.push(JSON.stringify(value));
      return `$${values.length}::jsonb`;
    });
    return `(data #> $${pathIndex}::text[]) IN (${placeholders.join(", ")})`;
  }
  values.push(JSON.stringify(filter.value));
  if (filter.operator === "!=") {
    return `(data #> $${pathIndex}::text[]) IS DISTINCT FROM $${values.length}::jsonb`;
  }
  return `(data #> $${pathIndex}::text[]) = $${values.length}::jsonb`;
}

async function getDocument(client, collection, documentId) {
  const result = await client.query(
    "SELECT data FROM desk_documents WHERE collection = $1 AND document_id = $2",
    [collection, documentId],
  );
  return result.rows[0]?.data || null;
}

async function setDocument(client, collection, documentId, data, merge) {
  const specialized = await setSpecializedDocument(client, collection, documentId, data, merge);
  if (specialized) return;
  await setDeskDocument(client, collection, documentId, data, merge);
  const notification = aiWorkNotification(collection, documentId, data);
  if (notification) {
    await client.query("SELECT pg_notify('desk_ai_work_ready', $1)", [JSON.stringify(notification)]);
  }
}

function aiWorkNotification(collection, documentId, data = {}) {
  if (collection === "desk_live_run_cursor" && ["DUE", "RETRY"].includes(String(data.cursor_status || ""))) {
    return {
      scope: "live",
      id: documentId,
      status: data.cursor_status,
      workflow: data.next_workflow || data.attempt?.workflow || null,
    };
  }
  if (collection === "desk_agent_work_items" && String(data.status || "") === "READY") {
    return {
      scope: "replay",
      id: documentId,
      status: data.status,
      workflow: data.workflow || null,
      backtest_id: data.backtest_id || null,
    };
  }
  return null;
}

async function setDeskDocument(client, collection, documentId, data, merge) {
  await assertImmutableSetupIdentity(client, collection, documentId, data, merge);
  await client.query(
    `INSERT INTO desk_documents (collection, document_id, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (collection, document_id) DO UPDATE
     SET data = CASE WHEN $4::boolean THEN desk_documents.data || EXCLUDED.data ELSE EXCLUDED.data END,
         updated_at = now()`,
    [collection, documentId, JSON.stringify(data), merge],
  );
}

async function assertImmutableSetupIdentity(client, collection, documentId, data, merge) {
  if (!["desk_setups", "desk_replay_setups"].includes(collection)) return;
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [data?.setup_id
      ? `${collection}:setup:${String(data.setup_id)}`
      : `${collection}:document:${documentId}`],
  );
  const currentResult = await client.query(
    `SELECT data
     FROM desk_documents
     WHERE collection = $1 AND document_id = $2
     FOR UPDATE`,
    [collection, documentId],
  );
  const current = currentResult.rows[0]?.data || null;
  const next = merge && current ? { ...current, ...data } : data;
  const setupRecordId = String(next?.setup_record_id || "");
  const setupId = String(next?.setup_id || "");
  if (setupRecordId && setupRecordId !== String(documentId)) {
    throw persistenceError(
      "SETUP_RECORD_ID_IMMUTABLE",
      "A canonical setup_record_id must equal its document identity.",
      {
        collection,
        document_id: documentId,
        setup_record_id: setupRecordId,
      },
    );
  }
  if (current?.setup_record_id && String(current.setup_record_id) !== setupRecordId) {
    throw persistenceError(
      "SETUP_RECORD_ID_IMMUTABLE",
      "The canonical setup_record_id cannot change after creation.",
      {
        collection,
        document_id: documentId,
        existing_setup_record_id: current.setup_record_id,
        attempted_setup_record_id: setupRecordId || null,
      },
    );
  }
  if (current?.setup_id && String(current.setup_id) !== setupId) {
    throw persistenceError(
      "SETUP_ID_IMMUTABLE",
      "The logical setup_id cannot change on an existing canonical setup record.",
      {
        collection,
        document_id: documentId,
        existing_setup_id: current.setup_id,
        attempted_setup_id: setupId || null,
      },
    );
  }
  if (!setupId) return;
  const conflict = await client.query(
    `SELECT document_id, data->>'setup_record_id' AS setup_record_id
     FROM desk_documents
     WHERE collection = $1
       AND document_id <> $2
       AND data->>'setup_id' = $3
     LIMIT 1`,
    [collection, documentId, setupId],
  );
  if (conflict.rows.length) {
    throw persistenceError(
      "SETUP_LOGICAL_ID_CONFLICT",
      "A logical setup_id can belong to only one canonical setup record.",
      {
        collection,
        setup_id: setupId,
        document_id: documentId,
        conflicting_document_id: conflict.rows[0].document_id,
        conflicting_setup_record_id: conflict.rows[0].setup_record_id || null,
      },
    );
  }
}

async function getSpecializedDocument(client, collection, documentId) {
  return withSpecializedSchemaFallback(async () => {
    if (collection === MARKET_FEEDS_COLLECTION) {
      const result = await client.query(
        `SELECT raw || jsonb_build_object(
           'feed_id', feed_id,
           'symbol', ms.symbol_code,
           'symbol_code', ms.symbol_code,
           'instrument', market_feeds.instrument_code,
           'timeframe', timeframe,
           'environment', environment,
           'provider', provider,
           'source_service', source_service,
           'timezone', timezone,
           'enabled', enabled,
           'latest_timestamp_utc', to_char(latest_timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'latest_candle_path', latest_candle_path,
           'status', status
         ) AS data
         FROM market_feeds
         JOIN market_symbols ms ON ms.symbol_id = market_feeds.symbol_id
         WHERE feed_id = $1`,
        [documentId],
      );
      return result.rows[0]?.data || null;
    }
    if (collection === LIVE_DATA_FEED_STATUS_COLLECTION) {
      const result = await client.query(
        `SELECT raw || jsonb_build_object(
           'status_id', status_id,
           'feed_id', feed_id,
           'symbol', symbol_code,
           'timeframe', timeframe,
           'timestamp_utc', to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'status', status,
           'latest_bar_age_seconds', latest_bar_age_seconds
         ) AS data
         FROM market_feed_status
         WHERE status_id = $1`,
        [documentId],
      );
      return result.rows[0]?.data || null;
    }
    if (collection === TRADINGVIEW_EVENTS_COLLECTION) {
      const result = await client.query(
        `SELECT raw || jsonb_build_object(
           'event_id', event_id,
           'feed_id', feed_id,
           'symbol', symbol_code,
           'timeframe', timeframe,
           'timestamp_utc', to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'received_at_utc', to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'alert_id', alert_id,
           'status', status,
           'payload', payload
         ) AS data
         FROM tradingview_events
         WHERE event_id = $1`,
        [documentId],
      );
      return result.rows[0]?.data || null;
    }
    const feedId = marketCandleFeedId(collection);
    if (feedId) {
      const result = await client.query(
        `SELECT raw || jsonb_build_object(
           'feed_id', feed_id,
           'timestamp_utc', to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'symbol', symbol_code,
           'timeframe', timeframe,
           'open', open,
           'high', high,
           'low', low,
           'close', close,
           'volume', volume,
           'is_closed', is_closed
         ) AS data
         FROM market_candles
         WHERE feed_id = $1
           AND (source_document_id = $2 OR replace(replace(to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'), '-', ''), ':', '') = $2)
         LIMIT 1`,
        [feedId, documentId],
      );
      return result.rows[0]?.data || null;
    }
    return null;
  });
}

async function listSpecializedDocuments(client, collection, limit) {
  return withSpecializedSchemaFallback(async () => {
    const bounded = limit == null ? 5000 : boundedLimit(limit);
    if (collection === MARKET_FEEDS_COLLECTION) {
      const result = await client.query(
        `SELECT raw || jsonb_build_object(
           'feed_id', feed_id,
           'symbol', ms.symbol_code,
           'symbol_code', ms.symbol_code,
           'instrument', market_feeds.instrument_code,
           'timeframe', timeframe,
           'environment', environment,
           'provider', provider,
           'source_service', source_service,
           'timezone', timezone,
           'enabled', enabled,
           'latest_timestamp_utc', to_char(latest_timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'latest_candle_path', latest_candle_path,
           'status', status
         ) AS data
         FROM market_feeds
         JOIN market_symbols ms ON ms.symbol_id = market_feeds.symbol_id
         ORDER BY feed_id ASC
         LIMIT $1`,
        [bounded],
      );
      return result.rows.map((row) => row.data);
    }
    if (collection === LIVE_DATA_FEED_STATUS_COLLECTION) {
      const result = await client.query(
        `SELECT raw || jsonb_build_object(
           'status_id', status_id,
           'feed_id', feed_id,
           'symbol', symbol_code,
           'timeframe', timeframe,
           'timestamp_utc', to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'status', status,
           'latest_bar_age_seconds', latest_bar_age_seconds
         ) AS data
         FROM market_feed_status
         ORDER BY updated_at DESC
         LIMIT $1`,
        [bounded],
      );
      return result.rows.map((row) => row.data);
    }
    if (collection === TRADINGVIEW_EVENTS_COLLECTION) {
      const result = await client.query(
        `SELECT raw || jsonb_build_object(
           'event_id', event_id,
           'feed_id', feed_id,
           'symbol', symbol_code,
           'timeframe', timeframe,
           'timestamp_utc', to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'received_at_utc', to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'alert_id', alert_id,
           'status', status,
           'payload', payload
         ) AS data
         FROM tradingview_events
         ORDER BY received_at DESC NULLS LAST
         LIMIT $1`,
        [bounded],
      );
      return result.rows.map((row) => row.data);
    }
    return null;
  });
}

async function querySpecializedCollection(client, { collection, filters = [], orderBy = [], limit = 50 }) {
  const feedId = marketCandleFeedId(collection);
  if (!feedId) return null;
  return withSpecializedSchemaFallback(async () => {
    const values = [feedId];
    const clauses = ["feed_id = $1"];
    for (const filter of filters || []) {
      if (!["timestamp_utc", "time_utc", "timestamp"].includes(String(filter.field || ""))) continue;
      const operator = sqlComparisonOperator(filter.operator || "==");
      if (!operator) continue;
      values.push(filter.value);
      clauses.push(`timestamp_utc ${operator} $${values.length}::timestamptz`);
    }
    const firstOrder = (orderBy || []).find((order) => ["timestamp_utc", "time_utc", "timestamp"].includes(String(order.field || "")));
    const direction = String(firstOrder?.direction || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
    values.push(boundedLimit(limit));
    const result = await client.query(
      `SELECT raw || jsonb_build_object(
         'feed_id', feed_id,
         'timestamp_utc', to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'symbol', symbol_code,
         'timeframe', timeframe,
         'open', open,
         'high', high,
         'low', low,
         'close', close,
         'volume', volume,
         'is_closed', is_closed
       ) AS data
       FROM market_candles
       WHERE ${clauses.join(" AND ")}
       ORDER BY timestamp_utc ${direction}
       LIMIT $${values.length}`,
      values,
    );
    const documents = result.rows.map((row) => row.data);
    const filtered = documents.filter((document) => filters.every((filter) => matchesFilter(document, filter)));
    filtered.sort((left, right) => compareDocuments(left, right, orderBy));
    return filtered.slice(0, boundedLimit(limit));
  });
}

async function setSpecializedDocument(client, collection, documentId, data, merge) {
  return withSpecializedSchemaFallback(async () => {
    if (collection === MARKET_FEEDS_COLLECTION) {
      await upsertMarketFeedDocument(client, documentId, data, merge);
      return true;
    }
    if (collection === LIVE_DATA_FEED_STATUS_COLLECTION) {
      await upsertMarketFeedStatusDocument(client, documentId, data, merge);
      return true;
    }
    if (collection === TRADINGVIEW_EVENTS_COLLECTION) {
      await upsertTradingViewEventDocument(client, documentId, data, merge);
      return true;
    }
    const feedId = marketCandleFeedId(collection);
    if (feedId) {
      const candle = marketCandleRow(feedId, documentId, data);
      if (!candle) return false;
      await ensureMarketFeed(client, feedId, data);
      await client.query(
        `INSERT INTO market_candles (
           feed_id, timestamp_utc, symbol_code, timeframe, trading_date, timestamp_paris,
           open, high, low, close, volume, is_closed, indicators, studies, raw,
           source_collection, source_document_id
         ) VALUES (
           $1, $2::timestamptz, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb,
           $16, $17
         )
         ON CONFLICT(feed_id, timestamp_utc) DO UPDATE
         SET symbol_code = EXCLUDED.symbol_code,
             timeframe = EXCLUDED.timeframe,
             trading_date = EXCLUDED.trading_date,
             timestamp_paris = EXCLUDED.timestamp_paris,
             open = EXCLUDED.open,
             high = EXCLUDED.high,
             low = EXCLUDED.low,
             close = EXCLUDED.close,
             volume = EXCLUDED.volume,
             is_closed = EXCLUDED.is_closed,
             indicators = EXCLUDED.indicators,
             studies = EXCLUDED.studies,
             raw = CASE WHEN $18::boolean THEN market_candles.raw || EXCLUDED.raw ELSE EXCLUDED.raw END,
             source_collection = EXCLUDED.source_collection,
             source_document_id = EXCLUDED.source_document_id,
             updated_at = now()`,
        [
          candle.feed_id,
          candle.timestamp_utc,
          candle.symbol_code,
          candle.timeframe,
          candle.trading_date,
          candle.timestamp_paris,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          candle.is_closed,
          JSON.stringify(candle.indicators),
          JSON.stringify(candle.studies),
          JSON.stringify(candle.raw),
          collection,
          documentId,
          merge,
        ],
      );
      return true;
    }
    return false;
  });
}

async function upsertMarketFeedDocument(client, feedId, data, merge) {
  const row = marketFeedRow(feedId, data);
  await ensureMarketSymbol(client, row.instrument_code, row.provider, row.symbol_code);
  await ensureTimeframe(client, row.timeframe);
  await client.query(
    `INSERT INTO market_feeds (
       feed_id, symbol_id, instrument_code, timeframe, environment, provider,
       source_service, timezone, enabled, latest_timestamp_utc, latest_candle_path,
       status, metadata, raw
     ) VALUES (
       $1, $2, $3, $4, $5::desk_data_environment, $6::desk_source_provider,
       $7, $8, $9, $10::timestamptz, $11,
       $12, $13::jsonb, $14::jsonb
     )
     ON CONFLICT(feed_id) DO UPDATE
     SET symbol_id = EXCLUDED.symbol_id,
         instrument_code = EXCLUDED.instrument_code,
         timeframe = EXCLUDED.timeframe,
         environment = EXCLUDED.environment,
         provider = EXCLUDED.provider,
         source_service = EXCLUDED.source_service,
         timezone = EXCLUDED.timezone,
         enabled = EXCLUDED.enabled,
         latest_timestamp_utc = GREATEST(market_feeds.latest_timestamp_utc, EXCLUDED.latest_timestamp_utc),
         latest_candle_path = CASE
           WHEN market_feeds.latest_timestamp_utc IS NULL
             OR EXCLUDED.latest_timestamp_utc >= market_feeds.latest_timestamp_utc
           THEN EXCLUDED.latest_candle_path
           ELSE market_feeds.latest_candle_path
         END,
         status = EXCLUDED.status,
         metadata = CASE
           WHEN EXCLUDED.latest_timestamp_utc < market_feeds.latest_timestamp_utc THEN market_feeds.metadata
           WHEN $15::boolean THEN market_feeds.metadata || EXCLUDED.metadata
           ELSE EXCLUDED.metadata
         END,
         raw = CASE
           WHEN EXCLUDED.latest_timestamp_utc < market_feeds.latest_timestamp_utc THEN market_feeds.raw
           WHEN $15::boolean THEN market_feeds.raw || EXCLUDED.raw
           ELSE EXCLUDED.raw
         END,
         updated_at = now()`,
    [
      row.feed_id,
      row.symbol_id,
      row.instrument_code,
      row.timeframe,
      row.environment,
      row.provider,
      row.source_service,
      row.timezone,
      row.enabled,
      row.latest_timestamp_utc,
      row.latest_candle_path,
      row.status,
      JSON.stringify(row.metadata),
      JSON.stringify(row.raw),
      merge,
    ],
  );
}

async function upsertMarketFeedStatusDocument(client, statusId, data, merge) {
  const row = marketFeedStatusRow(statusId, data);
  if (row.feed_id) await ensureMarketFeed(client, row.feed_id, data);
  await client.query(
    `INSERT INTO market_feed_status (
       status_id, feed_id, symbol_code, timeframe, timestamp_utc, status,
       latest_bar_age_seconds, payload, raw
     ) VALUES (
       $1, $2, $3, $4, $5::timestamptz, $6,
       $7, $8::jsonb, $9::jsonb
     )
     ON CONFLICT(status_id) DO UPDATE
     SET feed_id = EXCLUDED.feed_id,
         symbol_code = EXCLUDED.symbol_code,
         timeframe = EXCLUDED.timeframe,
         timestamp_utc = GREATEST(market_feed_status.timestamp_utc, EXCLUDED.timestamp_utc),
         status = CASE
           WHEN EXCLUDED.timestamp_utc >= market_feed_status.timestamp_utc THEN EXCLUDED.status
           ELSE market_feed_status.status
         END,
         latest_bar_age_seconds = CASE
           WHEN EXCLUDED.timestamp_utc >= market_feed_status.timestamp_utc THEN EXCLUDED.latest_bar_age_seconds
           ELSE market_feed_status.latest_bar_age_seconds
         END,
         payload = CASE
           WHEN EXCLUDED.timestamp_utc < market_feed_status.timestamp_utc THEN market_feed_status.payload
           WHEN $10::boolean THEN market_feed_status.payload || EXCLUDED.payload
           ELSE EXCLUDED.payload
         END,
         raw = CASE
           WHEN EXCLUDED.timestamp_utc < market_feed_status.timestamp_utc THEN market_feed_status.raw
           WHEN $10::boolean THEN market_feed_status.raw || EXCLUDED.raw
           ELSE EXCLUDED.raw
         END,
         updated_at = now()`,
    [
      row.status_id,
      row.feed_id,
      row.symbol_code,
      row.timeframe,
      row.timestamp_utc,
      row.status,
      row.latest_bar_age_seconds,
      JSON.stringify(row.payload),
      JSON.stringify(row.raw),
      merge,
    ],
  );
}

async function upsertTradingViewEventDocument(client, eventId, data, merge) {
  const row = tradingViewEventRow(eventId, data);
  if (row.feed_id) await ensureMarketFeed(client, row.feed_id, data);
  await client.query(
    `INSERT INTO tradingview_events (
       event_id, feed_id, symbol_code, timeframe, timestamp_utc, received_at,
       alert_id, status, payload, raw
     ) VALUES (
       $1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
       $7, $8, $9::jsonb, $10::jsonb
     )
     ON CONFLICT(event_id) DO UPDATE
     SET feed_id = EXCLUDED.feed_id,
         symbol_code = EXCLUDED.symbol_code,
         timeframe = EXCLUDED.timeframe,
         timestamp_utc = EXCLUDED.timestamp_utc,
         received_at = EXCLUDED.received_at,
         alert_id = EXCLUDED.alert_id,
         status = EXCLUDED.status,
         payload = CASE WHEN $11::boolean THEN tradingview_events.payload || EXCLUDED.payload ELSE EXCLUDED.payload END,
         raw = CASE WHEN $11::boolean THEN tradingview_events.raw || EXCLUDED.raw ELSE EXCLUDED.raw END,
         updated_at = now()`,
    [
      row.event_id,
      row.feed_id,
      row.symbol_code,
      row.timeframe,
      row.timestamp_utc,
      row.received_at,
      row.alert_id,
      row.status,
      JSON.stringify(row.payload),
      JSON.stringify(row.raw),
      merge,
    ],
  );
}

async function ensureMarketFeed(client, feedId, data) {
  const existing = await client.query("SELECT 1 FROM market_feeds WHERE feed_id = $1", [feedId]);
  if (existing.rows.length) return;
  await upsertMarketFeedDocument(client, feedId, data || {}, false);
}

async function ensureMarketSymbol(client, instrumentCode, provider, symbolCode) {
  await client.query(
    `INSERT INTO market_instruments (instrument_code, display_name, asset_class, active, metadata)
     VALUES ($1, $1, $2::market_asset_class, true, $3::jsonb)
     ON CONFLICT(instrument_code) DO NOTHING`,
    [instrumentCode, assetClassForInstrument(instrumentCode), JSON.stringify({ source: "postgres_persistence_auto_seed" })],
  );
  await client.query(
    `INSERT INTO market_symbols (
       symbol_id, instrument_code, provider, symbol_code, provider_type, primary_for_instrument, active, metadata
     ) VALUES ($1, $2, $3::desk_source_provider, $4, $5, false, true, $6::jsonb)
     ON CONFLICT(provider, symbol_code) DO UPDATE
     SET instrument_code = EXCLUDED.instrument_code,
         active = true,
         updated_at = now()`,
    [symbolIdFor(provider, symbolCode), instrumentCode, provider, symbolCode, providerType(symbolCode), JSON.stringify({ source: "postgres_persistence_auto_seed" })],
  );
}

async function ensureTimeframe(client, timeframe) {
  await client.query(
    `INSERT INTO market_timeframes (timeframe, seconds, group_name, intraday, active, metadata)
     VALUES ($1, $2, $3::market_timeframe_group, $4, true, $5::jsonb)
     ON CONFLICT(timeframe) DO NOTHING`,
    [timeframe, timeframeSeconds(timeframe), timeframeGroup(timeframe), ["intraday", "higher_timeframe"].includes(timeframeGroup(timeframe)), JSON.stringify({ source: "postgres_persistence_auto_seed" })],
  );
}

function marketFeedRow(feedId, data = {}) {
  const parts = feedIdParts(feedId);
  const provider = normalizeProvider(data.provider || parts.provider || "tradingview");
  const environment = normalizeEnvironment(data.environment || parts.environment || "preprod");
  const symbolCode = canonicalSymbol(data.symbol || data.symbol_code || parts.symbol || feedId);
  const timeframe = canonicalTimeframe(data.timeframe || parts.timeframe || "5");
  const instrumentCode = instrumentFromSymbol(data.instrument || symbolCode);
  return {
    feed_id: feedId,
    symbol_id: symbolIdFor(provider, symbolCode),
    instrument_code: instrumentCode,
    symbol_code: symbolCode,
    timeframe,
    environment,
    provider,
    source_service: data.source_service || null,
    timezone: data.timezone || "Europe/Paris",
    enabled: data.enabled !== false,
    latest_timestamp_utc: timestampValue(data.latest_timestamp_utc || data.timestamp_utc),
    latest_candle_path: data.latest_candle_path || null,
    status: data.status || null,
    metadata: compactMetadata(data),
    raw: data,
  };
}

function marketCandleRow(feedId, documentId, data = {}) {
  const feed = marketFeedRow(feedId, data);
  const timestampUtc = timestampValue(data.timestamp_utc || data.time_utc || data.timestamp || data.time || timestampFromDocumentId(documentId));
  const open = numericValue(data.open ?? data.price?.open ?? data.price?.o);
  const high = numericValue(data.high ?? data.price?.high ?? data.price?.h);
  const low = numericValue(data.low ?? data.price?.low ?? data.price?.l);
  const close = numericValue(data.close ?? data.price?.close ?? data.price?.c);
  if (!timestampUtc || [open, high, low, close].some((value) => value === null)) return null;
  return {
    feed_id: feedId,
    timestamp_utc: timestampUtc,
    symbol_code: feed.symbol_code,
    timeframe: feed.timeframe,
    trading_date: data.trading_date || data.trading_date_paris || String(data.timestamp_paris || "").slice(0, 10) || null,
    timestamp_paris: data.timestamp_paris || null,
    open,
    high,
    low,
    close,
    volume: numericValue(data.volume ?? data.price?.volume ?? data.price?.v),
    is_closed: data.is_closed !== false && !["open", "live"].includes(String(data.bar_status || "").toLowerCase()),
    indicators: objectValue(data.indicators),
    studies: objectValue(data.studies || data.values),
    raw: data,
  };
}

function marketFeedStatusRow(statusId, data = {}) {
  const feedId = data.feed_id || statusId;
  const feed = marketFeedRow(feedId, data);
  return {
    status_id: statusId,
    feed_id: feedId || null,
    symbol_code: feed.symbol_code,
    timeframe: feed.timeframe,
    timestamp_utc: timestampValue(data.timestamp_utc || data.latest_timestamp_utc),
    status: data.status || null,
    latest_bar_age_seconds: integerValue(data.latest_bar_age_seconds),
    payload: objectValue(data.payload),
    raw: data,
  };
}

function tradingViewEventRow(eventId, data = {}) {
  const symbol = canonicalSymbol(data.symbol || data.symbol_code || "");
  const timeframe = canonicalTimeframe(data.timeframe || "");
  const feedId = data.feed_id || (symbol ? `prod__tradingview__${symbol}__${timeframe || "5"}` : null);
  return {
    event_id: data.event_id || eventId,
    feed_id: feedId,
    symbol_code: symbol,
    timeframe,
    timestamp_utc: timestampValue(data.timestamp_utc),
    received_at: timestampValue(data.received_at_utc || data.received_at),
    alert_id: data.alert_id || null,
    status: data.status || null,
    payload: objectValue(data.payload),
    raw: data,
  };
}

function marketCandleFeedId(collection) {
  const match = String(collection || "").match(MARKET_CANDLE_COLLECTION_RE);
  return match ? match[1] : null;
}

function sqlComparisonOperator(operator) {
  return ({ "==": "=", ">=": ">=", "<=": "<=", ">": ">", "<": "<" })[operator] || null;
}

async function withSpecializedSchemaFallback(operation) {
  try {
    return await operation();
  } catch (error) {
    if (["42P01", "42704"].includes(error?.code)) return null;
    throw error;
  }
}

function feedIdParts(feedId) {
  const parts = String(feedId || "").split("__");
  if (parts.length >= 4) {
    return { environment: parts[0], provider: parts[1], symbol: parts[2], timeframe: parts[3] };
  }
  if (parts.length >= 3) {
    return { provider: parts[0], symbol: parts[1], timeframe: parts[2] };
  }
  return {};
}

function normalizeProvider(value) {
  const text = String(value || "unknown").trim().toLowerCase();
  return ["tradingview", "ninjatrader", "csv", "manual", "synthetic", "unknown"].includes(text) ? text : "unknown";
}

function normalizeEnvironment(value) {
  const text = String(value || "preprod").trim().toLowerCase();
  return ["prod", "preprod", "local", "replay", "backtest", "test"].includes(text) ? text : "preprod";
}

function canonicalSymbol(value) {
  const text = String(value || "").trim().toUpperCase();
  return text.includes(":") ? text.split(":").at(-1) : text;
}

function canonicalTimeframe(value) {
  const text = String(value || "").trim().toUpperCase();
  return ({
    M1: "1",
    "1M": "1",
    "1": "1",
    M5: "5",
    "5M": "5",
    "5": "5",
    M15: "15",
    "15M": "15",
    "15": "15",
    M30: "30",
    "30M": "30",
    "30": "30",
    H1: "1H",
    "1H": "1H",
    "60": "1H",
    H4: "4H",
    "4H": "4H",
    "240": "4H",
    D: "1D",
    D1: "1D",
    "1D": "1D",
  })[text] || text || "5";
}

function timeframeSeconds(timeframe) {
  return ({ "1": 60, "5": 300, "15": 900, "30": 1800, "1H": 3600, "4H": 14400, "1D": 86400 })[timeframe] || 300;
}

function timeframeGroup(timeframe) {
  if (["1", "5", "15", "30"].includes(timeframe)) return "intraday";
  if (["1H", "4H"].includes(timeframe)) return "higher_timeframe";
  if (timeframe === "1D") return "daily";
  return "unknown";
}

function instrumentFromSymbol(value) {
  const symbol = canonicalSymbol(value).replace("1!", "").replace(/!$/, "").replace(/\s+/g, "");
  return symbol === "MCL" ? "CL" : symbol || "UNKNOWN";
}

function symbolIdFor(provider, symbolCode) {
  return `${provider}:${symbolCode}`;
}

function providerType(symbolCode) {
  if (String(symbolCode || "").endsWith("1!")) return "continuous_future";
  if (["DXY", "VIX", "US10Y", "US02Y", "DAX"].includes(symbolCode)) return "index";
  if (["QQQ", "SMH", "SOXX"].includes(symbolCode)) return "etf";
  return symbolCode ? "equity" : "unknown";
}

function assetClassForInstrument(instrument) {
  return {
    MNQ: "futures_index",
    MES: "futures_index",
    NQ: "futures_index",
    ES: "futures_index",
    DAX: "futures_index",
    DXY: "macro_fx",
    VIX: "volatility",
    US10Y: "rates",
    US02Y: "rates",
    GC: "commodity",
    CL: "commodity",
    AAPL: "equity",
    MSFT: "equity",
    NVDA: "equity",
    TSLA: "equity",
    QQQ: "etf",
    SMH: "etf",
    SOXX: "etf",
  }[instrument] || "unknown";
}

function timestampValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}

function timestampFromDocumentId(documentId) {
  const match = String(documentId || "").match(/^(\d{8})T?(\d{6})Z?$/);
  if (!match) return null;
  const [, day, time] = match;
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.000Z`;
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value) {
  const parsed = numericValue(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactMetadata(data = {}) {
  const metadata = { ...objectValue(data.metadata) };
  for (const key of ["schema_version", "timeframe_group", "source", "source_service"]) {
    if (data[key] !== undefined) metadata[key] = data[key];
  }
  return metadata;
}

function matchesFilter(document, { field, operator = "==", value }) {
  const actual = fieldValue(document, field);
  if (operator === "==") return actual === value;
  if (operator === "!=") return actual !== value;
  if (operator === "in") return Array.isArray(value) && value.includes(actual);
  if (operator === "not-in") return Array.isArray(value) && !value.includes(actual);
  if (operator === "array-contains") return Array.isArray(actual) && actual.includes(value);
  if (operator === ">=") return actual >= value;
  if (operator === "<=") return actual <= value;
  if (operator === ">") return actual > value;
  if (operator === "<") return actual < value;
  throw new Error(`postgres_filter_operator_unsupported:${operator}`);
}

export function postgresPoolOptions(options = {}, env = process.env) {
  return {
    connectionString: options.connectionString,
    max: boundedInteger(options.poolSize ?? env.DESK_DATABASE_POOL_SIZE, 10, 1, 100),
    connectionTimeoutMillis: boundedInteger(
      options.connectionTimeoutMillis ?? env.DESK_DATABASE_CONNECTION_TIMEOUT_MS,
      5_000,
      250,
      120_000,
    ),
    idleTimeoutMillis: boundedInteger(
      options.idleTimeoutMillis ?? env.DESK_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      600_000,
    ),
    query_timeout: boundedInteger(
      options.queryTimeoutMillis ?? env.DESK_DATABASE_QUERY_TIMEOUT_MS,
      30_000,
      500,
      600_000,
    ),
    statement_timeout: boundedInteger(
      options.statementTimeoutMillis ?? env.DESK_DATABASE_STATEMENT_TIMEOUT_MS,
      30_000,
      500,
      600_000,
    ),
    lock_timeout: boundedInteger(
      options.lockTimeoutMillis ?? env.DESK_DATABASE_LOCK_TIMEOUT_MS,
      5_000,
      100,
      120_000,
    ),
    idle_in_transaction_session_timeout: boundedInteger(
      options.idleTransactionTimeoutMillis ?? env.DESK_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
      30_000,
      1_000,
      600_000,
    ),
    application_name: String(options.applicationName || env.DESK_DATABASE_APPLICATION_NAME || "desk-api").slice(0, 63),
  };
}

export async function retryPostgresInitialization(operation, options = {}, env = process.env) {
  const maxAttempts = boundedInteger(options.maxAttempts ?? env.DESK_DATABASE_INITIALIZATION_ATTEMPTS, 30, 1, 120);
  const baseDelayMs = boundedInteger(options.baseDelayMs ?? env.DESK_DATABASE_INITIALIZATION_RETRY_BASE_MS, 250, 0, 30_000);
  const maxDelayMs = boundedInteger(options.maxDelayMs ?? env.DESK_DATABASE_INITIALIZATION_RETRY_MAX_MS, 2_000, baseDelayMs, 60_000);
  const sleep = options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientPostgresStartupError(error) || attempt === maxAttempts) throw error;
      await sleep(Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1))));
    }
  }
  throw new Error("POSTGRES_INITIALIZATION_RETRY_EXHAUSTED");
}

function isTransientPostgresStartupError(error) {
  const code = String(error?.code || "").toUpperCase();
  if (POSTGRES_TRANSIENT_STARTUP_CODES.has(code) || code.startsWith("08")) return true;
  return /(database system is starting up|connection terminated unexpectedly|connection refused|timeout expired)/i.test(String(error?.message || ""));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

function compareDocuments(left, right, orderBy) {
  for (const order of orderBy || []) {
    const a = fieldValue(left, order.field);
    const b = fieldValue(right, order.field);
    if (a === b) continue;
    const comparison = a == null ? -1 : b == null ? 1 : a < b ? -1 : 1;
    return order.direction === "desc" ? -comparison : comparison;
  }
  return 0;
}

function fieldValue(document, field) {
  return String(field || "").split(".").reduce((value, key) => value?.[key], document);
}

function boundedLimit(value) {
  return Math.max(1, Math.min(Number(value) || 50, 5000));
}

function replayIdempotencyId(backtestId, idempotencyKey) {
  const safe = String(backtestId || "").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 180);
  return `${safe}__${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
}

function persistenceError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details;
  return error;
}

function canonicalHash(value) {
  return createHash("sha256").update(JSON.stringify(sortCanonical(value))).digest("hex");
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortCanonical(entry)]));
}

function localObjectPath(storagePath, objectRoot) {
  const text = String(storagePath || "").trim();
  if (!text) throw new Error("local_storage_path_missing");
  if (text.startsWith("gs://")) throw new Error("cloud_storage_reference_not_allowed_in_preprod");
  const candidate = text.startsWith("local://")
    ? resolve(objectRoot, text.slice("local://".length))
    : text.startsWith("file://")
      ? resolve(text.slice("file://".length))
      : isAbsolute(text) ? resolve(text) : resolve(objectRoot, text);
  const pathFromRoot = relative(objectRoot, candidate);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("local_storage_path_outside_object_root");
  return candidate;
}

function normalizedRelativeObjectPath(value) {
  const text = String(value || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!text) throw persistenceError("PACK_OBJECT_LOCAL_PATH_REQUIRED", "Pack object local path is required.");
  const candidate = resolve("/", text);
  const normalized = relative("/", candidate).replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("..") || isAbsolute(normalized)) {
    throw persistenceError("PACK_OBJECT_LOCAL_PATH_INVALID", "Pack object local path escapes the object root.");
  }
  return normalized;
}

function immutableObjectRelativePath(storagePath, generation) {
  const extension = String(storagePath || "").toLowerCase().endsWith(".json") ? ".json"
    : String(storagePath || "").toLowerCase().endsWith(".csv") ? ".csv"
      : ".bin";
  const digest = createHash("sha256").update(`${storagePath}\n${generation}`).digest("hex");
  return `immutable/${digest.slice(0, 2)}/${digest}${extension}`;
}

function contentType(filePath) {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}
