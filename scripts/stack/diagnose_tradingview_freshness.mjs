#!/usr/bin/env node
import { fetchStatus } from "./check_demo_paper_gate.mjs";
import { isCliEntrypoint } from "../runtime/cli-entrypoint.mjs";
import { SystemClock } from "../../packages/desk-time/index.js";

const DEFAULT_STATUS_URL = "http://127.0.0.1:8787/status";
const DEFAULT_MAX_AGE_SECONDS = 900;
const CORE_FEEDS = Object.freeze([
  { instrument: "MNQ", timeframe: "1", label: "MNQ M1" },
  { instrument: "MNQ", timeframe: "5", label: "MNQ M5" },
  { instrument: "MES", timeframe: "1", label: "MES M1" },
  { instrument: "MES", timeframe: "5", label: "MES M5" },
]);

export function parseTradingViewFreshnessArgs(argv = process.argv.slice(2)) {
  const options = { statusUrl: DEFAULT_STATUS_URL, output: "pretty", exitZero: false };
  for (const arg of argv) {
    if (arg === "--json") options.output = "json";
    else if (arg === "--exit-zero") options.exitZero = true;
    else if (arg.startsWith("--status-url=")) options.statusUrl = arg.slice("--status-url=".length);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function buildTradingViewFreshnessDiagnosis(dataReadiness = {}, { checkedAtUtc } = {}) {
  const checkedAt = resolveCheckedAt(dataReadiness, checkedAtUtc);
  const maxAgeSeconds = freshnessMaxAgeSeconds(dataReadiness);
  const feedStatuses = CORE_FEEDS.map((expected) => statusForCoreFeed({
    expected,
    feeds: dataReadiness.core_feeds,
    checkedAt,
    maxAgeSeconds,
    effectiveMarketDate: dataReadiness.effective_market_date,
  }));
  const blockers = blockersForFeeds(feedStatuses, dataReadiness);
  const status = diagnosisStatus({ dataReadiness, blockers });
  const actions = actionsForDiagnosis({ status, blockers, dataReadiness, maxAgeSeconds });
  return {
    ok: dataReadiness.ok === true && blockers.length === 0,
    status,
    checked_at_utc: checkedAt.toISOString(),
    state: dataReadiness.state || null,
    market_closed: dataReadiness.market_closed === true,
    market_session: dataReadiness.market_session || null,
    max_age_seconds: maxAgeSeconds,
    core_age_seconds: numberOrNull(dataReadiness.core_age_seconds),
    requested_trading_date: dataReadiness.requested_trading_date || null,
    effective_market_date: dataReadiness.effective_market_date || null,
    feed_statuses: feedStatuses,
    source_health: dataReadiness.source_health || null,
    blockers,
    actions,
    durable_source_note: "Les alertes TradingView doivent rester la source durable ; le backfill MCP local est un secours opérateur scellé.",
  };
}

export function formatTradingViewFreshnessDiagnosis(diagnosis) {
  const lines = [
    `TradingView freshness doctor: ${diagnosis.status}`,
    `checked_at_utc=${diagnosis.checked_at_utc}`,
    `state=${diagnosis.state || "unknown"} · max_age=${diagnosis.max_age_seconds}s · core_age=${diagnosis.core_age_seconds ?? "—"}s`,
    "",
    "Core feeds:",
  ];
  for (const feed of diagnosis.feed_statuses) {
    lines.push(`- ${feed.label}: ${feed.status} · latest=${feed.latest_timestamp_utc || "—"} · age=${feed.age_seconds ?? "—"}s · source=${feed.provenance?.classification || "unknown"}`);
  }
  if (diagnosis.blockers.length) {
    lines.push("");
    lines.push("Blockers:");
    for (const blocker of diagnosis.blockers) lines.push(`- ${blocker.code}: ${blocker.label} (${blocker.detail})`);
  }
  if (diagnosis.actions.length) {
    lines.push("");
    lines.push("Actions opérateur:");
    for (const [index, action] of diagnosis.actions.entries()) {
      lines.push(`${index + 1}. ${action.title}`);
      lines.push(`   ${action.detail}`);
      if (action.command) lines.push(`   diagnostic: ${action.command}`);
    }
  }
  lines.push("");
  lines.push(diagnosis.durable_source_note);
  return lines.join("\n");
}

function statusForCoreFeed({ expected, feeds, checkedAt, maxAgeSeconds, effectiveMarketDate }) {
  const feed = findFeed(feeds, expected);
  if (!feed) return baseFeedStatus(expected, "missing");
  const latestAt = parseDate(feed.latest_timestamp_utc);
  if (!latestAt) return { ...baseFeedStatus(expected, "invalid_timestamp"), latest_timestamp_utc: feed.latest_timestamp_utc || null };
  const ageSeconds = Math.max(0, Math.floor((checkedAt.getTime() - latestAt.getTime()) / 1000));
  const stale = ageSeconds > maxAgeSeconds;
  const marketDateMismatch = Boolean(effectiveMarketDate && feed.latest_market_date && feed.latest_market_date !== effectiveMarketDate);
  return {
    ...baseFeedStatus(expected, stale ? "stale" : "fresh"),
    latest_timestamp_utc: latestAt.toISOString(),
    latest_market_date: feed.latest_market_date || null,
    feed_id: feed.feed_id || null,
    provider: feed.provider || null,
    source_service: feed.source_service || null,
    latest_received_at_utc: feed.latest_received_at_utc || null,
    latest_source: feed.latest_source || null,
    latest_alert_id: feed.latest_alert_id || null,
    provenance: feed.provenance || null,
    age_seconds: ageSeconds,
    stale_by_seconds: stale ? ageSeconds - maxAgeSeconds : 0,
    seconds_until_stale: stale ? 0 : maxAgeSeconds - ageSeconds,
    market_date_mismatch: marketDateMismatch,
  };
}

function baseFeedStatus(expected, status) {
  return {
    instrument: expected.instrument,
    timeframe: expected.timeframe,
    label: expected.label,
    status,
    latest_timestamp_utc: null,
    latest_market_date: null,
    feed_id: null,
    provider: null,
    source_service: null,
    latest_received_at_utc: null,
    latest_source: null,
    latest_alert_id: null,
    provenance: null,
    age_seconds: null,
    stale_by_seconds: null,
    seconds_until_stale: null,
    market_date_mismatch: false,
  };
}

function blockersForFeeds(feedStatuses, dataReadiness) {
  const blockers = [];
  for (const feed of feedStatuses) {
    if (["missing", "invalid_timestamp", "stale"].includes(feed.status)) {
      blockers.push({
        code: `feed.${feed.instrument}.${feed.timeframe}.${feed.status}`,
        label: feed.label,
        detail: feedDetail(feed),
      });
    }
    if (feed.market_date_mismatch) {
      blockers.push({
        code: `feed.${feed.instrument}.${feed.timeframe}.market_date_mismatch`,
        label: feed.label,
        detail: `latest_market_date=${feed.latest_market_date}`,
      });
    }
    if (feed.status === "fresh" && feed.provenance?.durable !== true) {
      blockers.push({
        code: `feed.${feed.instrument}.${feed.timeframe}.source_not_durable`,
        label: feed.label,
        detail: sourceDetail(feed),
      });
    }
  }
  if (dataReadiness.ok !== true && blockers.length === 0) {
    blockers.push({ code: "backend.data_readiness.not_ready", label: "Backend readiness", detail: dataReadiness.state || "unknown" });
  }
  return blockers;
}

function actionsForDiagnosis({ status, blockers, dataReadiness, maxAgeSeconds }) {
  if (status === "READY") return [];
  const missingOrStale = blockers
    .filter((blocker) => blocker.code.startsWith("feed."))
    .map((blocker) => blocker.label);
  return [
    {
      id: "tradingview_alerts_durable",
      title: "Vérifier les alertes TradingView durables MNQ/MES",
      detail: `Feeds concernés: ${missingOrStale.join(", ") || "backend readiness"}. Les alertes doivent poster MNQ/MES M1/M5 vers /api/v1/webhooks/tradingview avec une fraîcheur < ${maxAgeSeconds}s.`,
      command: "python3 scripts/tradingview/migrate_local_alert_webhooks.py",
    },
    {
      id: "tradingview_mcp_rescue",
      title: "Utiliser le backfill MCP local seulement comme secours diagnostic",
      detail: `État backend=${dataReadiness.state || "unknown"} ; ce secours écrit uniquement des bougies TradingView réelles via le webhook, jamais directement en base.`,
      command: "python3 scripts/tradingview/import_recent_ohlcv_to_webhook.py --execute --env-file .env.example",
    },
  ];
}

function diagnosisStatus({ dataReadiness, blockers }) {
  if (dataReadiness.ok === true && blockers.length === 0) return "READY";
  if (blockers.some((blocker) => blocker.code.includes(".missing"))) return "MISSING_FEEDS";
  if (blockers.some((blocker) => blocker.code.includes(".stale"))) return "STALE_FEEDS";
  if (blockers.some((blocker) => blocker.code.includes(".source_not_durable"))) return "SOURCE_NOT_DURABLE";
  if (dataReadiness.market_closed === true) return "MARKET_CLOSED_NOT_READY";
  return "NOT_READY";
}

function findFeed(feeds, expected) {
  if (!Array.isArray(feeds)) return null;
  return feeds.find((feed) => {
    const instrument = String(feed?.instrument || "").toUpperCase();
    const timeframe = String(feed?.timeframe || "");
    return instrument === expected.instrument && timeframe === expected.timeframe;
  }) || null;
}

function resolveCheckedAt(dataReadiness, checkedAtUtc) {
  const explicit = parseDate(checkedAtUtc);
  if (explicit) return explicit;
  const sessionTime = parseDate(dataReadiness?.market_session?.timestamp_paris);
  if (sessionTime) return sessionTime;
  return parseDate(new SystemClock().now().utc);
}

function freshnessMaxAgeSeconds(dataReadiness) {
  const value = Number(dataReadiness?.freshness_policy?.max_age_seconds);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_AGE_SECONDS;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function feedDetail(feed) {
  if (feed.status === "missing") return "feed absent du /status";
  if (feed.status === "invalid_timestamp") return `timestamp invalide: ${feed.latest_timestamp_utc || "—"}`;
  if (feed.status === "stale") return `age=${feed.age_seconds}s · stale_by=${feed.stale_by_seconds}s`;
  return feed.status;
}

function sourceDetail(feed) {
  const provenance = feed.provenance || {};
  return [
    `classification=${provenance.classification || "unknown"}`,
    `source=${provenance.source || feed.latest_source || "—"}`,
    `source_service=${provenance.source_service || feed.source_service || "—"}`,
    `received_at=${provenance.received_at_utc || feed.latest_received_at_utc || "—"}`,
    `alert_id=${provenance.alert_id || feed.latest_alert_id || "—"}`,
  ].join(" · ");
}

function printUsage() {
  console.log([
    "Usage: node scripts/stack/diagnose_tradingview_freshness.mjs [--json] [--exit-zero]",
    "",
    "Options:",
    "  --status-url=http://127.0.0.1:8787/status",
    "  --json",
    "  --exit-zero",
  ].join("\n"));
}

async function main() {
  const options = parseTradingViewFreshnessArgs();
  if (options.help) {
    printUsage();
    return;
  }
  const status = await fetchStatus(options.statusUrl);
  const diagnosis = buildTradingViewFreshnessDiagnosis(status.data_readiness || {});
  if (options.output === "json") console.log(JSON.stringify(diagnosis, null, 2));
  else console.log(formatTradingViewFreshnessDiagnosis(diagnosis));
  if (!diagnosis.ok && !options.exitZero) process.exitCode = 1;
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
