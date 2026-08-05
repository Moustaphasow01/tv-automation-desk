import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";

const COLLECTIONS = {
  ...DESK_COLLECTIONS,
  newsSources: DESK_COLLECTIONS.newsSources || "news_sources",
  newsArticles: DESK_COLLECTIONS.newsArticles || "news_articles",
  newsIngestionRuns: DESK_COLLECTIONS.newsIngestionRuns || "news_ingestion_runs",
};
const DEFAULT_SOURCE_ID = "gdelt_market_news";
const DEFAULT_SOURCE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_QUERY = [
  '"S&P 500"',
  '"Nasdaq futures"',
  '"Federal Reserve"',
  '"Treasury yields"',
  '"US inflation"',
  '"crude oil prices"',
  '"gold prices"',
  '"VIX index"',
  '"Nvidia stock"',
  '"Apple stock"',
  '"Microsoft stock"',
  '"Tesla stock"',
].join(" OR ");

const BLOCKED_EDITORIAL_DOMAINS = new Set([
  "dhal3.com",
]);
const BLOCKED_EDITORIAL_TITLE_PATTERNS = [
  /\bfor sale\b/i,
  /\bhead(?:\s*-\s*|\s+)to(?:\s*-\s*|\s+)head\b/i,
  /\bfinancial survey\b/i,
  /\bshares? in .+ bought by\b/i,
  /\banalyzing\b.+(?:&|\bvs\.?\b)/i,
  /\bstock position (raised|reduced|trimmed)\b/i,
  /\b(boosts|cuts|reduces|raises) (its )?holdings\b/i,
];

const TOPIC_RULES = [
  {
    topic: "FED_MONETARY_POLICY",
    pattern: /\b(FEDERAL RESERVE|FED\b|FOMC|POWELL|INTEREST RATE|RATE CUT|RATE HIKE)\b/i,
    assets: ["DXY", "VIX", "US10Y", "US02Y", "MNQ", "MES"],
    instruments: ["MNQ", "MES"],
    importance: "HIGH",
  },
  {
    topic: "US_MACRO",
    pattern: /\b(CPI|PCE|INFLATION|NONFARM|NON-FARM|PAYROLL|JOBS REPORT|JOBLESS|GDP|RETAIL SALES|ISM)\b/i,
    assets: ["DXY", "VIX", "US10Y", "US02Y", "MNQ", "MES"],
    instruments: ["MNQ", "MES"],
    importance: "HIGH",
  },
  {
    topic: "US_RATES",
    pattern: /\b(TREASURY|TREASURIES|BOND YIELD|YIELDS|US10Y|10-YEAR|2-YEAR)\b/i,
    assets: ["US10Y", "US02Y", "DXY", "MNQ", "MES"],
    instruments: ["MNQ", "MES"],
    importance: "MEDIUM",
  },
  {
    topic: "NASDAQ",
    pattern: /\b(NASDAQ (INDEX|FUTURES|COMPOSITE)|NQ FUTURES|TECH STOCKS|QQQ)\b/i,
    assets: ["MNQ", "NQ", "QQQ", "VIX"],
    instruments: ["MNQ"],
    importance: "MEDIUM",
  },
  {
    topic: "SP500",
    pattern: /\b(S&P ?500|S&P FUTURES|SP500|E-MINI S&P|ES FUTURES|SPY)\b/i,
    assets: ["MES", "ES", "SPY", "VIX"],
    instruments: ["MES"],
    importance: "MEDIUM",
  },
  {
    topic: "VOLATILITY",
    pattern: /\b(VIX|VOLATILITY INDEX|MARKET VOLATILITY)\b/i,
    assets: ["VIX", "MNQ", "MES"],
    instruments: ["MNQ", "MES"],
    importance: "MEDIUM",
  },
  {
    topic: "ENERGY",
    pattern: /\b(CRUDE OIL|WTI|OPEC|OIL PRICES?|PETROLEUM|EIA INVENTOR)\b/i,
    assets: ["MCL", "CL", "WTI"],
    instruments: ["MCL"],
    importance: "MEDIUM",
  },
  {
    topic: "GOLD",
    pattern: /\b(GOLD PRICES?|GOLD FUTURES|BULLION|XAU)\b/i,
    assets: ["GC", "GOLD"],
    instruments: [],
    importance: "MEDIUM",
  },
  {
    topic: "MEGACAPS",
    pattern: /\b(NVIDIA|NVDA|APPLE|AAPL|MICROSOFT|MSFT|TESLA|TSLA|META|AMAZON|AMZN|GOOGLE|ALPHABET|GOOGL)\b/i,
    assets: [],
    instruments: ["MNQ"],
    importance: "MEDIUM",
  },
];

const MEGACAP_SYMBOLS = [
  ["NVIDIA", "NVDA"],
  ["NVDA", "NVDA"],
  ["APPLE", "AAPL"],
  ["AAPL", "AAPL"],
  ["MICROSOFT", "MSFT"],
  ["MSFT", "MSFT"],
  ["TESLA", "TSLA"],
  ["TSLA", "TSLA"],
  ["META", "META"],
  ["AMAZON", "AMZN"],
  ["AMZN", "AMZN"],
  ["GOOGLE", "GOOGL"],
  ["ALPHABET", "GOOGL"],
  ["GOOGL", "GOOGL"],
];

export class NewsIngestionService {
  constructor({
    persistence,
    clock = new SystemClock(),
    fetchImpl = globalThis.fetch,
    sourceId = process.env.DESK_NEWS_SOURCE_ID || DEFAULT_SOURCE_ID,
    sourceUrl = process.env.DESK_NEWS_GDELT_URL || DEFAULT_SOURCE_URL,
    query = process.env.DESK_NEWS_GDELT_QUERY || DEFAULT_QUERY,
    timeoutMs = process.env.DESK_NEWS_TIMEOUT_MS,
    minimumRefreshMs = process.env.DESK_NEWS_MIN_REFRESH_MS,
    failureBackoffMs = process.env.DESK_NEWS_FAILURE_BACKOFF_MS,
    maximumFailureBackoffMs = process.env.DESK_NEWS_MAX_FAILURE_BACKOFF_MS,
    maxRecords = process.env.DESK_NEWS_MAX_RECORDS,
    retentionDays = process.env.DESK_NEWS_RETENTION_DAYS,
  } = {}) {
    if (!persistence) throw new Error("document_persistence_required");
    if (typeof fetchImpl !== "function") throw new Error("news_fetch_required");
    this.persistence = persistence;
    this.clock = clock;
    this.fetchImpl = fetchImpl;
    this.sourceId = String(sourceId || DEFAULT_SOURCE_ID);
    this.sourceUrl = String(sourceUrl || DEFAULT_SOURCE_URL);
    this.query = String(query || DEFAULT_QUERY);
    this.timeoutMs = boundedNumber(timeoutMs, 35_000, 5_000, 60_000);
    this.minimumRefreshMs = boundedNumber(minimumRefreshMs, 10 * 60_000, 60_000, 6 * 60 * 60_000);
    this.failureBackoffMs = boundedNumber(failureBackoffMs, 15 * 60_000, 60_000, 6 * 60 * 60_000);
    this.maximumFailureBackoffMs = boundedNumber(maximumFailureBackoffMs, 6 * 60 * 60_000, this.failureBackoffMs, 24 * 60 * 60_000);
    this.maxRecords = boundedNumber(maxRecords, 100, 10, 250);
    this.retentionDays = boundedNumber(retentionDays, 90, 7, 365);
  }

  async refresh({ requested_by = "live_runtime_scheduler", force = false } = {}) {
    const fetchedAtUtc = normalizeInstant(this.clock.now().utc);
    const previous = await this.#latestRun();
    const previousMs = Date.parse(previous?.started_at_utc || "");
    const nextRetryMs = Date.parse(previous?.metadata?.next_retry_at_utc || "");
    if (!force
      && previous?.status === "FETCH_FAILED"
      && Number.isFinite(nextRetryMs)
      && Date.parse(fetchedAtUtc) < nextRetryMs) {
      return {
        ok: false,
        status: "FETCH_FAILED",
        source: this.sourceId,
        fetched_at_utc: previous.completed_at_utc || previous.started_at_utc,
        reused_existing_fetch: true,
        circuit_state: "open",
        next_retry_at_utc: new Date(nextRetryMs).toISOString(),
        error: previous.error || "news_provider_circuit_open",
        received_count: 0,
        inserted_count: 0,
        updated_count: 0,
      };
    }
    if (!force
      && previous?.status === "READY"
      && Number.isFinite(previousMs)
      && Date.parse(fetchedAtUtc) - previousMs < this.minimumRefreshMs) {
      return {
        ok: true,
        status: "READY",
        source: this.sourceId,
        fetched_at_utc: previous.completed_at_utc || previous.started_at_utc,
        reused_existing_fetch: true,
        received_count: previous.received_count || 0,
        inserted_count: 0,
        updated_count: 0,
      };
    }

    await this.#saveSource(fetchedAtUtc);
    const runId = `${this.sourceId}__${fetchedAtUtc.replaceAll(/[-:.]/g, "").replace("Z", "Z")}`;
    const initialRun = {
      run_id: runId,
      source_id: this.sourceId,
      requested_by,
      status: "RUNNING",
      started_at_utc: fetchedAtUtc,
      completed_at_utc: null,
      received_count: 0,
      normalized_count: 0,
      inserted_count: 0,
      updated_count: 0,
      discarded_count: 0,
      pruned_count: 0,
      error: null,
      metadata: {
        provider: "GDELT",
        query: this.query,
        max_records: this.maxRecords,
        window_hours: 48,
      },
    };
    await this.#saveRun(initialRun);

    let response;
    try {
      response = await fetchJson(
        this.fetchImpl,
        this.#requestUrl(),
        this.timeoutMs,
        this.fetchImpl === globalThis.fetch,
      );
    } catch (error) {
      const previousFailures = previous?.status === "FETCH_FAILED"
        ? Number(previous?.metadata?.consecutive_failures || 0)
        : 0;
      const consecutiveFailures = previousFailures + 1;
      const exponentialBackoff = Math.min(
        this.maximumFailureBackoffMs,
        this.failureBackoffMs * (2 ** Math.min(consecutiveFailures - 1, 8)),
      );
      const retryAfterMs = Number(error?.retryAfterMs || 0);
      const backoffMs = Math.max(exponentialBackoff, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
      const nextRetryAtUtc = new Date(Date.parse(fetchedAtUtc) + backoffMs).toISOString();
      const failed = {
        ...initialRun,
        status: "FETCH_FAILED",
        completed_at_utc: fetchedAtUtc,
        error: error.message || String(error),
        metadata: {
          ...initialRun.metadata,
          consecutive_failures: consecutiveFailures,
          circuit_state: "open",
          next_retry_at_utc: nextRetryAtUtc,
          backoff_ms: backoffMs,
        },
      };
      await this.#saveRun(failed);
      await this.#syncAlert({ status: "FETCH_FAILED", atUtc: fetchedAtUtc, error: failed.error });
      return {
        ok: false,
        status: failed.status,
        source: this.sourceId,
        fetched_at_utc: fetchedAtUtc,
        error: failed.error,
        circuit_state: "open",
        next_retry_at_utc: nextRetryAtUtc,
        received_count: 0,
        inserted_count: 0,
        updated_count: 0,
      };
    }

    const rawArticles = Array.isArray(response?.articles) ? response.articles : [];
    const normalized = normalizeGdeltArticles(rawArticles, {
      sourceId: this.sourceId,
      firstSeenAtUtc: fetchedAtUtc,
    });
    const upsert = await this.#saveArticles(normalized);
    const pruneBeforeUtc = new Date(Date.parse(fetchedAtUtc) - this.retentionDays * 24 * 60 * 60_000).toISOString();
    const prunedCount = await this.#prune(pruneBeforeUtc);
    const completed = {
      ...initialRun,
      status: "READY",
      completed_at_utc: fetchedAtUtc,
      received_count: rawArticles.length,
      normalized_count: normalized.length,
      inserted_count: upsert.inserted_count,
      updated_count: upsert.updated_count,
      discarded_count: Math.max(0, rawArticles.length - normalized.length),
      pruned_count: prunedCount,
      metadata: {
        ...initialRun.metadata,
        consecutive_failures: 0,
        circuit_state: "closed",
        next_retry_at_utc: null,
      },
    };
    await this.#saveRun(completed);
    await this.#markSourceSuccess(fetchedAtUtc);
    await this.#syncAlert({ status: "READY", atUtc: fetchedAtUtc });
    return {
      ok: true,
      status: completed.status,
      source: this.sourceId,
      fetched_at_utc: fetchedAtUtc,
      received_count: completed.received_count,
      normalized_count: completed.normalized_count,
      inserted_count: completed.inserted_count,
      updated_count: completed.updated_count,
      discarded_count: completed.discarded_count,
      pruned_count: completed.pruned_count,
    };
  }

  async getWindow({
    as_of_utc,
    before_hours = 48,
    limit = 100,
    instruments = [],
  } = {}) {
    const cutoffUtc = normalizeInstant(as_of_utc || this.clock.now().utc);
    const beforeHours = boundedNumber(before_hours, 48, 1, 168);
    const boundedLimit = boundedNumber(limit, 100, 1, 250);
    const fromUtc = new Date(Date.parse(cutoffUtc) - beforeHours * 60 * 60_000).toISOString();
    const items = await this.#queryArticles({
      from_utc: fromUtc,
      to_utc: cutoffUtc,
      limit: boundedLimit,
      instruments,
    });
    const latestRun = await this.#latestRun();
    const sources = [...new Set(items.map((item) => item.source_domain || item.source).filter(Boolean))];
    const highImpact = items.filter((item) => ["HIGH", "CRITICAL"].includes(String(item.importance).toUpperCase())).length;
    const digest = items.length
      ? `${items.length} news éditoriale${items.length > 1 ? "s" : ""} réelle${items.length > 1 ? "s" : ""} sur les ${beforeHours} dernières heures, provenant de ${sources.length} source${sources.length > 1 ? "s" : ""}, dont ${highImpact} à impact élevé.`
      : `Aucune news éditoriale pertinente matérialisée sur les ${beforeHours} dernières heures.`;
    return {
      ok: true,
      status: items.length ? "ready" : "empty",
      source: this.sourceId,
      provider: "GDELT",
      as_of_utc: cutoffUtc,
      updated_at_utc: latestRun?.completed_at_utc || latestRun?.started_at_utc || null,
      updated_at_paris: latestRun?.completed_at_utc || latestRun?.started_at_utc
        ? toParisIso(Date.parse(latestRun.completed_at_utc || latestRun.started_at_utc))
        : null,
      window: {
        before_hours: beforeHours,
        from_utc: fromUtc,
        to_utc: cutoffUtc,
      },
      freshness: newsFreshness(latestRun, cutoffUtc),
      digest,
      items,
      empty_ok: true,
      reason: items.length ? null : "no_relevant_editorial_news_in_window",
    };
  }

  async getCoverage() {
    const nowUtc = normalizeInstant(this.clock.now().utc);
    const latestRun = await this.#latestRun();
    const window = await this.getWindow({ as_of_utc: nowUtc, before_hours: 48, limit: 1 });
    return {
      ok: latestRun?.status === "READY",
      status: latestRun?.status || "NOT_STARTED",
      source: this.sourceId,
      latest_run: latestRun,
      latest_article_at_utc: window.items[0]?.published_at_utc || null,
      freshness: window.freshness,
    };
  }

  #requestUrl() {
    const url = new URL(this.sourceUrl);
    url.searchParams.set("query", `(${this.query}) sourcelang:english`);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("maxrecords", String(this.maxRecords));
    url.searchParams.set("timespan", "48h");
    url.searchParams.set("sort", "datedesc");
    url.searchParams.set("format", "json");
    return url.href;
  }

  async #saveSource(atUtc) {
    const source = {
      source_id: this.sourceId,
      provider: "GDELT",
      display_name: "GDELT DOC 2.0 Market News",
      base_url: this.sourceUrl,
      enabled: true,
      refresh_interval_seconds: Math.round(this.minimumRefreshMs / 1000),
      configuration: {
        query: this.query,
        max_records: this.maxRecords,
        retention_days: this.retentionDays,
      },
      last_attempt_at_utc: atUtc,
    };
    if (typeof this.persistence.upsertNewsSource === "function") {
      await this.persistence.upsertNewsSource(source);
      return;
    }
    await this.persistence.setDocument(COLLECTIONS.newsSources, this.sourceId, source, { merge: true });
  }

  async #markSourceSuccess(atUtc) {
    if (typeof this.persistence.markNewsSourceSuccess === "function") {
      await this.persistence.markNewsSourceSuccess(this.sourceId, atUtc);
      return;
    }
    await this.persistence.setDocument(COLLECTIONS.newsSources, this.sourceId, {
      last_attempt_at_utc: atUtc,
      last_success_at_utc: atUtc,
    }, { merge: true });
  }

  async #saveRun(run) {
    if (typeof this.persistence.upsertNewsIngestionRun === "function") {
      await this.persistence.upsertNewsIngestionRun(run);
      return;
    }
    await this.persistence.setDocument(COLLECTIONS.newsIngestionRuns, run.run_id, run, { merge: true });
  }

  async #latestRun() {
    if (typeof this.persistence.getLatestNewsIngestionRun === "function") {
      return this.persistence.getLatestNewsIngestionRun(this.sourceId);
    }
    const rows = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.newsIngestionRuns,
      filters: [{ field: "source_id", operator: "==", value: this.sourceId }],
      orderBy: [{ field: "started_at_utc", direction: "desc" }],
      limit: 1,
    }).catch(() => []);
    return rows[0] || null;
  }

  async #saveArticles(articles) {
    if (typeof this.persistence.upsertNewsArticles === "function") {
      return this.persistence.upsertNewsArticles(articles);
    }
    let insertedCount = 0;
    let updatedCount = 0;
    const writes = [];
    for (const article of articles) {
      const existing = await this.persistence.getDocument(COLLECTIONS.newsArticles, article.article_id).catch(() => null);
      if (existing) updatedCount += 1;
      else insertedCount += 1;
      writes.push({
        collection: COLLECTIONS.newsArticles,
        documentId: article.article_id,
        data: {
          ...(existing || {}),
          ...article,
          first_seen_at_utc: existing?.first_seen_at_utc || article.first_seen_at_utc,
        },
        merge: true,
      });
    }
    if (writes.length && typeof this.persistence.writeDocuments === "function") {
      await this.persistence.writeDocuments(writes);
    } else {
      for (const write of writes) {
        await this.persistence.setDocument(write.collection, write.documentId, write.data, { merge: true });
      }
    }
    return { inserted_count: insertedCount, updated_count: updatedCount };
  }

  async #queryArticles({ from_utc, to_utc, limit, instruments }) {
    let rows;
    if (typeof this.persistence.queryNewsArticles === "function") {
      rows = await this.persistence.queryNewsArticles({ from_utc, to_utc, limit, instruments });
    } else {
      rows = await this.persistence.queryCollectionDocuments({
        collection: COLLECTIONS.newsArticles,
        filters: [
          { field: "published_at_utc", operator: ">=", value: from_utc },
          { field: "published_at_utc", operator: "<=", value: to_utc },
        ],
        orderBy: [{ field: "published_at_utc", direction: "desc" }],
        limit,
      });
    }
    const requestedInstruments = new Set((instruments || []).map((value) => String(value).toUpperCase()));
    const eligible = rows
      .filter((article) => {
        const publishedMs = Date.parse(article.published_at_utc || "");
        if (!Number.isFinite(publishedMs) || publishedMs < Date.parse(from_utc) || publishedMs > Date.parse(to_utc)) return false;
        if (!isEditorialNewsQuality(article.title, article.source_domain || article.source)) return false;
        if (!requestedInstruments.size) return true;
        return (article.instruments || []).some((instrument) => requestedInstruments.has(String(instrument).toUpperCase()));
      })
      .sort((left, right) => String(right.published_at_utc).localeCompare(String(left.published_at_utc)));
    const uniqueTitles = new Set();
    const deduplicated = [];
    for (const article of eligible) {
      const titleKey = normalizedTitleKey(article.title);
      if (!titleKey || uniqueTitles.has(titleKey)) continue;
      uniqueTitles.add(titleKey);
      deduplicated.push(article);
      if (deduplicated.length >= limit) break;
    }
    return deduplicated.map(projectNewsArticle);
  }

  async #prune(beforeUtc) {
    if (typeof this.persistence.pruneNewsArticles === "function") {
      return this.persistence.pruneNewsArticles(beforeUtc);
    }
    return 0;
  }

  async #syncAlert({ status, atUtc, error = null }) {
    const ready = status === "READY";
    const alertId = `news_ingestion__${this.sourceId}`;
    const current = await this.persistence.getDocument(COLLECTIONS.deskAlerts, alertId).catch(() => null);
    if (ready && !current) return;
    await this.persistence.setDocument(COLLECTIONS.deskAlerts, alertId, {
      ...(current || {}),
      alert_id: alertId,
      alert_type: "NEWS_INGESTION",
      status: ready ? "RESOLVED" : "OPEN",
      level: ready ? "positive" : "critical",
      severity: ready ? "INFO" : "CRITICAL",
      title: ready ? "Flux de news disponible" : "Flux de news indisponible",
      message: ready
        ? "La collecte éditoriale GDELT fonctionne normalement."
        : `La collecte éditoriale GDELT a échoué : ${error || "erreur inconnue"}.`,
      timestamp_utc: atUtc,
      timestamp_paris: toParisIso(Date.parse(atUtc)),
      updated_at_utc: atUtc,
      resolved_at_utc: ready ? atUtc : null,
    }, { merge: true });
  }
}

export function normalizeGdeltArticles(rawArticles, {
  sourceId = DEFAULT_SOURCE_ID,
  firstSeenAtUtc = new Date().toISOString(),
} = {}) {
  const byUrl = new Map();
  for (const raw of rawArticles || []) {
    const originalUrl = stringValue(raw?.url);
    const canonicalUrl = canonicalNewsUrl(originalUrl);
    const title = decodeEntities(stringValue(raw?.title));
    const publishedAtUtc = parseGdeltTimestamp(raw?.seendate);
    if (!canonicalUrl || !title || !publishedAtUtc) continue;
    const sourceDomain = (stringValue(raw?.domain) || new URL(canonicalUrl).hostname)
      .replace(/^www\./, "")
      .toLowerCase();
    if (!isEditorialNewsQuality(title, sourceDomain)) continue;
    const classification = classifyNews(`${title} ${raw?.domain || ""}`);
    if (!classification.topics.length) continue;
    const providerArticleId = sha256(canonicalUrl).slice(0, 32);
    const articleId = `${sourceId}__${providerArticleId}`;
    const article = {
      article_id: articleId,
      source_id: sourceId,
      provider: "GDELT",
      provider_article_id: providerArticleId,
      url: canonicalUrl,
      canonical_url: canonicalUrl,
      original_url: originalUrl,
      title,
      summary: classification.summary,
      source: sourceDomain,
      source_domain: sourceDomain,
      language: stringValue(raw?.language) || "English",
      source_country: stringValue(raw?.sourcecountry) || null,
      published_at_utc: publishedAtUtc,
      published_at_paris: toParisIso(Date.parse(publishedAtUtc)),
      importance: classification.importance,
      assets: classification.assets,
      instruments: classification.instruments,
      topics: classification.topics,
      sentiment: null,
      content_hash: sha256(`${title}\n${canonicalUrl}\n${publishedAtUtc}`),
      raw,
      first_seen_at_utc: firstSeenAtUtc,
      last_seen_at_utc: firstSeenAtUtc,
    };
    const existing = byUrl.get(canonicalUrl);
    if (!existing || article.published_at_utc > existing.published_at_utc) byUrl.set(canonicalUrl, article);
  }
  return [...byUrl.values()].sort((left, right) => right.published_at_utc.localeCompare(left.published_at_utc));
}

export function classifyNews(value) {
  const text = String(value || "");
  const topics = [];
  const assets = new Set();
  const instruments = new Set();
  let importance = "LOW";
  for (const rule of TOPIC_RULES) {
    if (!rule.pattern.test(text)) continue;
    topics.push(rule.topic);
    rule.assets.forEach((asset) => assets.add(asset));
    rule.instruments.forEach((instrument) => instruments.add(instrument));
    if (importanceRank(rule.importance) > importanceRank(importance)) importance = rule.importance;
  }
  const upper = text.toUpperCase();
  for (const [needle, symbol] of MEGACAP_SYMBOLS) {
    if (upper.includes(needle)) assets.add(symbol);
  }
  const topicLabel = topics.map((topic) => topic.replaceAll("_", " ").toLowerCase()).join(", ");
  return {
    topics: [...new Set(topics)],
    assets: [...assets],
    instruments: [...instruments],
    importance,
    summary: topicLabel
      ? `Actualité éditoriale classée : ${topicLabel}. Actifs suivis : ${[...assets].join(", ") || "contexte général"}.`
      : "Actualité éditoriale hors périmètre du desk.",
  };
}

export function isEditorialNewsQuality(title, sourceDomain = "") {
  const normalizedDomain = String(sourceDomain || "").trim().toLowerCase().replace(/^www\./, "");
  if (BLOCKED_EDITORIAL_DOMAINS.has(normalizedDomain)) return false;
  const normalizedTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (normalizedTitle.length < 20) return false;
  return !BLOCKED_EDITORIAL_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle));
}

function normalizedTitleKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function projectNewsArticle(article) {
  return {
    ...article,
    source: article.source_domain || article.source || "GDELT",
    provider: article.provider || "GDELT",
    url: article.canonical_url || article.url || article.original_url || "",
    published_at_utc: normalizeInstant(article.published_at_utc),
    published_at_paris: article.published_at_paris
      || toParisIso(Date.parse(article.published_at_utc)),
    impact: article.summary || "Actualité éditoriale pertinente pour le desk.",
  };
}

function newsFreshness(latestRun, nowUtc) {
  if (!latestRun) return { status: "not_started", age_minutes: null };
  const referenceMs = Date.parse(latestRun.completed_at_utc || latestRun.started_at_utc || "");
  const ageMinutes = Number.isFinite(referenceMs)
    ? Math.max(0, Math.round((Date.parse(nowUtc) - referenceMs) / 60_000))
    : null;
  return {
    status: latestRun.status !== "READY" ? "degraded" : ageMinutes != null && ageMinutes <= 30 ? "fresh" : "stale",
    age_minutes: ageMinutes,
    ingestion_status: latestRun.status,
  };
}

function canonicalNewsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|source$|campaign$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function parseGdeltTimestamp(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(fetchImpl, url, timeoutMs, nativeFallback = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        headers: {
          accept: "application/json",
          "user-agent": "DeskFuturesNews/1.0",
        },
        signal: controller.signal,
      });
      if (!response?.ok) {
        const error = new Error(`news_fetch_failed:${response?.status || "unknown"}`);
        const retryAfter = response?.headers?.get?.("retry-after");
        error.retryAfterMs = parseRetryAfterMs(retryAfter);
        throw error;
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.articles)) throw new Error("news_payload_invalid");
      return payload;
    } catch (error) {
      if (!nativeFallback || controller.signal.aborted || /^news_(fetch_failed|payload_invalid)/.test(error.message || "")) throw error;
      return await fetchJsonViaHttps(url, timeoutMs);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function fetchJsonViaHttps(url, timeoutMs, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      request.destroy(new Error("news_native_https_timeout"));
    }, timeoutMs);
    const request = httpsRequest(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "DeskFuturesNews/1.0",
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirectCount < 3) {
        clearTimeout(timeout);
        response.resume();
        fetchJsonViaHttps(new URL(response.headers.location, url).href, timeoutMs, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        clearTimeout(timeout);
        response.resume();
        reject(new Error(`news_fetch_failed:${response.statusCode || "unknown"}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) {
          request.destroy(new Error("news_payload_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        clearTimeout(timeout);
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!payload || !Array.isArray(payload.articles)) throw new Error("news_payload_invalid");
          resolve(payload);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    request.end();
  });
}

function importanceRank(value) {
  return { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[String(value || "").toUpperCase()] || 0;
}

function parseRetryAfterMs(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1_000);
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

function normalizeInstant(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_timestamp:${value}`);
  return new Date(parsed).toISOString();
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

function stringValue(value) {
  return value == null ? "" : String(value).trim();
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
