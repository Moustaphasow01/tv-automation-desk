#!/usr/bin/env python3
"""Audit local PostgreSQL market candle quality for PREPROD.

The goal is not to prove market-session correctness perfectly. It is a
repeatable migration-control report that answers:

- which hot-scope feeds have candles;
- which feeds are stale because the source itself stopped early;
- whether obvious timestamp gaps or OHLC anomalies exist;
- which metadata feeds are intentionally not imported yet.
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_URL = "postgresql://desk:desk_local_only@localhost:5432/desk"
DEFAULT_FROM_UTC = "2026-06-30T22:00:00Z"
DEFAULT_TO_UTC = "2026-07-17T21:00:00Z"

HOT_SCOPE_EXPECTED: dict[str, list[str]] = {
    "MNQ": ["1", "5", "15", "1H", "4H"],
    "MES": ["1", "5", "15", "1H", "4H"],
    "NQ": ["5", "15", "1H", "4H"],
    "ES": ["5", "15", "1H", "4H"],
    "DXY": ["5", "4H"],
    "VIX": ["5", "4H"],
    "US10Y": ["5", "4H"],
    "US02Y": ["5", "4H"],
    "GC": ["5", "4H"],
    "CL": ["5", "4H"],
}

ASSUMED_MISSING_OPTIONAL_FEEDS: dict[str, str] = {
    "prod__tradingview__NQ1!__5": "Assumé temporairement : les timeframes principaux NQ restent disponibles.",
    "prod__tradingview__ES1!__5": "Assumé temporairement : les timeframes principaux ES restent disponibles.",
}

SOURCE_STALE_TOLERANCE_SECONDS = 24 * 3600


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit local market_candles quality.")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--from-utc", default=DEFAULT_FROM_UTC)
    parser.add_argument("--to-utc", default=DEFAULT_TO_UTC)
    parser.add_argument("--max-gap-samples-per-feed", type=int, default=8)
    parser.add_argument(
        "--json-output",
        default=str(ROOT / "docs" / "MARKET_CANDLES_QUALITY_AUDIT_2026-07-19.json"),
    )
    parser.add_argument(
        "--markdown-output",
        default=str(ROOT / "docs" / "MARKET_CANDLES_QUALITY_AUDIT_2026-07-19.md"),
    )
    args = parser.parse_args()

    from_utc = parse_utc(args.from_utc)
    to_utc = parse_utc(args.to_utc)
    if from_utc >= to_utc:
        raise SystemExit("--from-utc must be before --to-utc")

    with psycopg.connect(args.database_url, row_factory=dict_row) as conn:
        feeds = fetch_feeds(conn)
        summaries = fetch_candle_summaries(conn, from_utc, to_utc)
        timestamps = fetch_candle_timestamps(conn, from_utc, to_utc)
        quarantine_count = fetch_scalar(conn, "SELECT count(*)::int FROM desk_document_quarantine")

    feed_reports = build_feed_reports(feeds, summaries, timestamps, from_utc, to_utc, args.max_gap_samples_per_feed)
    completeness = build_hot_scope_completeness(feed_reports)
    report = {
        "ok": True,
        "generated_at_utc": iso_utc(datetime.now(timezone.utc)),
        "window": {
            "from_utc": iso_utc(from_utc),
            "to_utc": iso_utc(to_utc),
        },
        "hot_scope_expected": HOT_SCOPE_EXPECTED,
        "assumed_missing_optional_feeds": ASSUMED_MISSING_OPTIONAL_FEEDS,
        "summary": build_summary(feed_reports, completeness, quarantine_count),
        "hot_scope_completeness": completeness,
        "feed_reports": feed_reports,
        "notes": [
            "calendar_missing_slots is intentionally calendar-based and includes normal session/weekend breaks.",
            "review_gap_count excludes obvious long session/weekend breaks and common 45-90 minute maintenance breaks.",
            "SOURCE_STALE_VS_WINDOW means local candles match a source feed whose latest_timestamp_utc is already older than the audit window end.",
            "ASSUMED_MISSING_OPTIONAL means the missing/stale feed is accepted by current desk logic and is not counted as a blocking stale source.",
        ],
    }

    json_path = Path(args.json_output)
    md_path = Path(args.markdown_output)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=json_default) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "json_output": str(json_path),
        "markdown_output": str(md_path),
        "summary": report["summary"],
    }, indent=2, ensure_ascii=False))
    return 0


def fetch_feeds(conn: psycopg.Connection) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              mf.feed_id,
              mf.symbol_id,
              ms.symbol_code,
              mf.instrument_code,
              mf.timeframe,
              mt.seconds::int AS timeframe_seconds,
              mt.group_name::text AS timeframe_group,
              mf.enabled,
              mf.latest_timestamp_utc,
              mf.latest_candle_path,
              mf.status,
              mf.metadata,
              mf.provider::text AS provider,
              mf.source_service,
              mf.updated_at
            FROM market_feeds mf
            JOIN market_timeframes mt ON mt.timeframe = mf.timeframe
            JOIN market_symbols ms ON ms.symbol_id = mf.symbol_id
            ORDER BY mf.instrument_code, mt.seconds, mf.feed_id
            """
        )
        return list(cur.fetchall())


def fetch_candle_summaries(conn: psycopg.Connection, from_utc: datetime, to_utc: datetime) -> dict[str, dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              mf.feed_id,
              count(mc.timestamp_utc)::int AS candle_count,
              min(mc.timestamp_utc) AS first_timestamp_utc,
              max(mc.timestamp_utc) AS last_timestamp_utc,
              count(*) FILTER (
                WHERE mc.timestamp_utc IS NOT NULL
                AND (
                  mc.low > mc.high
                  OR mc.high < greatest(mc.open, mc.close)
                  OR mc.low > least(mc.open, mc.close)
                  OR mc.open <= 0
                  OR mc.high <= 0
                  OR mc.low <= 0
                  OR mc.close <= 0
                )
              )::int AS invalid_ohlc_count,
              count(*) FILTER (
                WHERE mc.timestamp_utc IS NOT NULL
                AND mc.is_closed IS NOT TRUE
              )::int AS open_candle_count
            FROM market_feeds mf
            LEFT JOIN market_candles mc
              ON mc.feed_id = mf.feed_id
             AND mc.timestamp_utc >= %s
             AND mc.timestamp_utc <= %s
            GROUP BY mf.feed_id
            """,
            (from_utc, to_utc),
        )
        return {row["feed_id"]: dict(row) for row in cur.fetchall()}


def fetch_candle_timestamps(conn: psycopg.Connection, from_utc: datetime, to_utc: datetime) -> dict[str, list[datetime]]:
    by_feed: dict[str, list[datetime]] = defaultdict(list)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT feed_id, timestamp_utc
            FROM market_candles
            WHERE timestamp_utc >= %s
              AND timestamp_utc <= %s
            ORDER BY feed_id, timestamp_utc
            """,
            (from_utc, to_utc),
        )
        for row in cur.fetchall():
            by_feed[row["feed_id"]].append(row["timestamp_utc"])
    return by_feed


def fetch_scalar(conn: psycopg.Connection, sql: str) -> Any:
    with conn.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
        return next(iter(row.values()))


def build_feed_reports(
    feeds: list[dict[str, Any]],
    summaries: dict[str, dict[str, Any]],
    timestamps: dict[str, list[datetime]],
    from_utc: datetime,
    to_utc: datetime,
    max_gap_samples_per_feed: int,
) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for feed in feeds:
        feed_id = feed["feed_id"]
        summary = summaries.get(feed_id, {})
        candle_count = int(summary.get("candle_count") or 0)
        first_ts = summary.get("first_timestamp_utc")
        last_ts = summary.get("last_timestamp_utc")
        step = int(feed["timeframe_seconds"])
        gap_stats = analyze_gaps(timestamps.get(feed_id, []), step, max_gap_samples_per_feed)
        observed_slots = calendar_slots(first_ts, last_ts, step)
        calendar_missing = max(0, observed_slots - candle_count) if observed_slots is not None else None
        coverage = (candle_count / observed_slots) if observed_slots else None
        latest_source = feed.get("latest_timestamp_utc")
        source_minus_actual = seconds_between(last_ts, latest_source) if last_ts and latest_source else None
        window_minus_actual = seconds_between(last_ts, to_utc) if last_ts else None
        window_minus_source = seconds_between(latest_source, to_utc) if latest_source else None
        flags = feed_flags(
            feed_id=feed_id,
            candle_count=candle_count,
            invalid_ohlc_count=int(summary.get("invalid_ohlc_count") or 0),
            review_gap_count=gap_stats["review_gap_count"],
            source_minus_actual=source_minus_actual,
            window_minus_actual=window_minus_actual,
            window_minus_source=window_minus_source,
            step=step,
            instrument_code=feed["instrument_code"],
            timeframe=feed["timeframe"],
            is_local_derived=is_local_derived_feed(feed),
        )
        reports.append({
            "feed_id": feed_id,
            "instrument_code": feed["instrument_code"],
            "symbol_code": feed["symbol_code"],
            "timeframe": feed["timeframe"],
            "timeframe_seconds": step,
            "timeframe_group": feed["timeframe_group"],
            "provider": feed["provider"],
            "enabled": feed["enabled"],
            "feed_status": feed.get("status"),
            "is_local_derived": is_local_derived_feed(feed),
            "in_hot_scope": feed["instrument_code"] in HOT_SCOPE_EXPECTED and feed["timeframe"] in HOT_SCOPE_EXPECTED[feed["instrument_code"]],
            "candle_count": candle_count,
            "first_timestamp_utc": iso_utc(first_ts),
            "last_timestamp_utc": iso_utc(last_ts),
            "feed_latest_timestamp_utc": iso_utc(latest_source),
            "latest_candle_path": feed.get("latest_candle_path"),
            "calendar_observed_slots": observed_slots,
            "calendar_missing_slots": calendar_missing,
            "calendar_coverage_ratio": round(coverage, 6) if coverage is not None else None,
            "invalid_ohlc_count": int(summary.get("invalid_ohlc_count") or 0),
            "open_candle_count": int(summary.get("open_candle_count") or 0),
            "source_minus_actual_seconds": source_minus_actual,
            "window_minus_actual_seconds": window_minus_actual,
            "window_minus_source_seconds": window_minus_source,
            "gap_summary": gap_stats,
            "flags": flags,
        })
    return reports


def analyze_gaps(timestamps: list[datetime], step_seconds: int, max_samples: int) -> dict[str, Any]:
    counts = {
        "total_gap_count": 0,
        "daily_maintenance_or_short_session_break_count": 0,
        "session_or_weekend_break_count": 0,
        "review_gap_count": 0,
        "calendar_missing_slots_from_gaps": 0,
        "max_gap_seconds": 0,
        "max_review_gap_seconds": 0,
    }
    samples: list[dict[str, Any]] = []
    if len(timestamps) < 2:
        return {**counts, "samples": samples}
    for previous, current in zip(timestamps, timestamps[1:]):
        delta = int((current - previous).total_seconds())
        if delta <= step_seconds * 1.5:
            continue
        missing_slots = max(1, int(round(delta / step_seconds)) - 1)
        classification = classify_gap(delta, step_seconds)
        counts["total_gap_count"] += 1
        counts["calendar_missing_slots_from_gaps"] += missing_slots
        counts["max_gap_seconds"] = max(counts["max_gap_seconds"], delta)
        if classification == "daily_maintenance_or_short_session_break":
            counts["daily_maintenance_or_short_session_break_count"] += 1
        elif classification == "session_or_weekend_break":
            counts["session_or_weekend_break_count"] += 1
        else:
            counts["review_gap_count"] += 1
            counts["max_review_gap_seconds"] = max(counts["max_review_gap_seconds"], delta)
        if len(samples) < max_samples or classification == "review_gap":
            samples.append({
                "from_utc": iso_utc(previous),
                "to_utc": iso_utc(current),
                "gap_seconds": delta,
                "missing_slots_calendar": missing_slots,
                "classification": classification,
            })
    samples.sort(key=lambda item: (item["classification"] != "review_gap", -item["gap_seconds"]))
    return {**counts, "samples": samples[:max_samples]}


def classify_gap(delta_seconds: int, step_seconds: int) -> str:
    if step_seconds <= 900 and 45 * 60 <= delta_seconds <= 4 * 3600:
        return "daily_maintenance_or_short_session_break"
    if step_seconds >= 3600 and delta_seconds <= 3 * 3600:
        return "daily_maintenance_or_short_session_break"
    if delta_seconds >= 4 * 3600:
        return "session_or_weekend_break"
    return "review_gap"


def feed_flags(
    *,
    feed_id: str,
    candle_count: int,
    invalid_ohlc_count: int,
    review_gap_count: int,
    source_minus_actual: int | None,
    window_minus_actual: int | None,
    window_minus_source: int | None,
    step: int,
    instrument_code: str,
    timeframe: str,
    is_local_derived: bool,
) -> list[str]:
    flags: list[str] = []
    if is_local_derived:
        flags.append("LOCAL_DERIVED")
    if instrument_code not in HOT_SCOPE_EXPECTED or timeframe not in HOT_SCOPE_EXPECTED[instrument_code]:
        flags.append("OUT_OF_HOT_SCOPE")
    if candle_count == 0:
        flags.append("NO_CANDLES_IMPORTED")
        return flags
    if invalid_ohlc_count:
        flags.append("INVALID_OHLC")
    if source_minus_actual is not None and source_minus_actual > max(step * 2, 60):
        flags.append("IMPORT_LAG_VS_FEED_LATEST")
    if feed_id in ASSUMED_MISSING_OPTIONAL_FEEDS and (
        (window_minus_source is not None and window_minus_source > SOURCE_STALE_TOLERANCE_SECONDS)
        or (window_minus_actual is not None and window_minus_actual > SOURCE_STALE_TOLERANCE_SECONDS)
    ):
        flags.append("ASSUMED_MISSING_OPTIONAL")
    elif window_minus_source is not None and window_minus_source > SOURCE_STALE_TOLERANCE_SECONDS:
        flags.append("SOURCE_STALE_VS_WINDOW")
    elif window_minus_actual is not None and window_minus_actual > SOURCE_STALE_TOLERANCE_SECONDS:
        flags.append("STALE_VS_WINDOW")
    if review_gap_count:
        flags.append("REVIEW_GAPS")
    if not flags or flags == ["LOCAL_DERIVED"]:
        flags.append("OK")
    return flags


def build_hot_scope_completeness(feed_reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_instrument_tf: dict[tuple[str, str], dict[str, Any]] = {}
    for feed in feed_reports:
        by_instrument_tf[(feed["instrument_code"], feed["timeframe"])] = feed

    rows: list[dict[str, Any]] = []
    for instrument, timeframes in HOT_SCOPE_EXPECTED.items():
        for timeframe in timeframes:
            feed = by_instrument_tf.get((instrument, timeframe))
            if not feed:
                rows.append({
                    "instrument_code": instrument,
                    "timeframe": timeframe,
                    "status": "MISSING_FEED_DEFINITION",
                    "feed_id": None,
                    "candle_count": 0,
                    "last_timestamp_utc": None,
                    "flags": ["MISSING_FEED_DEFINITION"],
                })
                continue
            status = "OK"
            if "NO_CANDLES_IMPORTED" in feed["flags"]:
                status = "NO_CANDLES_IMPORTED"
            elif "IMPORT_LAG_VS_FEED_LATEST" in feed["flags"]:
                status = "IMPORT_LAG"
            elif "ASSUMED_MISSING_OPTIONAL" in feed["flags"]:
                status = "ASSUMED_MISSING"
            elif "SOURCE_STALE_VS_WINDOW" in feed["flags"]:
                status = "SOURCE_STALE"
            elif "STALE_VS_WINDOW" in feed["flags"]:
                status = "STALE"
            elif "INVALID_OHLC" in feed["flags"] or "REVIEW_GAPS" in feed["flags"]:
                status = "REVIEW"
            elif "LOCAL_DERIVED" in feed["flags"]:
                status = "DERIVED_OK"
            rows.append({
                "instrument_code": instrument,
                "timeframe": timeframe,
                "status": status,
                "feed_id": feed["feed_id"],
                "candle_count": feed["candle_count"],
                "last_timestamp_utc": feed["last_timestamp_utc"],
                "feed_latest_timestamp_utc": feed["feed_latest_timestamp_utc"],
                "flags": feed["flags"],
            })
    return rows


def build_summary(feed_reports: list[dict[str, Any]], completeness: list[dict[str, Any]], quarantine_count: int) -> dict[str, Any]:
    hot_feeds = [feed for feed in feed_reports if feed["in_hot_scope"]]
    imported_feeds = [feed for feed in feed_reports if feed["candle_count"] > 0]
    hot_imported_feeds = [feed for feed in hot_feeds if feed["candle_count"] > 0]
    stale_source = [feed for feed in hot_feeds if "SOURCE_STALE_VS_WINDOW" in feed["flags"]]
    assumed_missing = [feed for feed in hot_feeds if "ASSUMED_MISSING_OPTIONAL" in feed["flags"]]
    review_gaps = [feed for feed in hot_feeds if "REVIEW_GAPS" in feed["flags"]]
    local_derived = [feed for feed in hot_feeds if "LOCAL_DERIVED" in feed["flags"]]
    invalid_ohlc = [feed for feed in feed_reports if feed["invalid_ohlc_count"] > 0]
    not_imported_out_of_scope = [
        feed for feed in feed_reports
        if "OUT_OF_HOT_SCOPE" in feed["flags"] and "NO_CANDLES_IMPORTED" in feed["flags"]
    ]
    completeness_by_status: dict[str, int] = defaultdict(int)
    for row in completeness:
        completeness_by_status[row["status"]] += 1
    return {
        "market_feeds_total": len(feed_reports),
        "feeds_with_candles": len(imported_feeds),
        "hot_scope_expected_feeds": len(completeness),
        "hot_scope_feeds_with_candles": len(hot_imported_feeds),
        "total_candles_in_window": sum(feed["candle_count"] for feed in feed_reports),
        "quarantine_count": quarantine_count,
        "hot_scope_completeness_by_status": dict(sorted(completeness_by_status.items())),
        "source_stale_hot_scope_feed_count": len(stale_source),
        "assumed_missing_optional_hot_scope_feed_count": len(assumed_missing),
        "review_gap_hot_scope_feed_count": len(review_gaps),
        "local_derived_hot_scope_feed_count": len(local_derived),
        "invalid_ohlc_feed_count": len(invalid_ohlc),
        "out_of_hot_scope_no_candles_feed_count": len(not_imported_out_of_scope),
        "source_stale_hot_scope_feeds": [feed["feed_id"] for feed in stale_source],
        "assumed_missing_optional_hot_scope_feeds": [feed["feed_id"] for feed in assumed_missing],
        "review_gap_hot_scope_feeds": [feed["feed_id"] for feed in review_gaps],
        "local_derived_hot_scope_feeds": [feed["feed_id"] for feed in local_derived],
    }


def render_markdown(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# Audit qualité candles locales Postgres — 2026-07-19",
        "",
        f"Fenêtre auditée : `{report['window']['from_utc']}` → `{report['window']['to_utc']}`.",
        "",
        "## Résumé",
        "",
        f"- Feeds marché total : `{summary['market_feeds_total']}`",
        f"- Feeds avec candles dans la fenêtre : `{summary['feeds_with_candles']}`",
        f"- Hot scope attendu : `{summary['hot_scope_expected_feeds']}` feeds",
        f"- Hot scope alimenté : `{summary['hot_scope_feeds_with_candles']}` feeds",
        f"- Candles locales dans la fenêtre : `{summary['total_candles_in_window']}`",
        f"- Quarantine : `{summary['quarantine_count']}`",
        f"- Feeds hot scope stale côté source : `{summary['source_stale_hot_scope_feed_count']}`",
        f"- Feeds hot scope manquants assumés : `{summary['assumed_missing_optional_hot_scope_feed_count']}`",
        f"- Feeds hot scope avec gaps à revoir : `{summary['review_gap_hot_scope_feed_count']}`",
        f"- Feeds hot scope dérivés localement : `{summary['local_derived_hot_scope_feed_count']}`",
        f"- Feeds avec OHLC invalide : `{summary['invalid_ohlc_feed_count']}`",
        "",
        "## Complétude hot scope",
        "",
        "| Instrument | Timeframe | Status | Candles | Dernière candle | Feed |",
        "|---|---|---|---:|---|---|",
    ]
    for row in report["hot_scope_completeness"]:
        lines.append(
            "| "
            + " | ".join([
                row["instrument_code"],
                row["timeframe"],
                row["status"],
                str(row["candle_count"]),
                row.get("last_timestamp_utc") or "",
                f"`{row['feed_id']}`" if row.get("feed_id") else "",
            ])
            + " |"
        )

    stale_rows = [
        feed for feed in report["feed_reports"]
        if "SOURCE_STALE_VS_WINDOW" in feed["flags"] or "STALE_VS_WINDOW" in feed["flags"]
    ]
    lines.extend([
        "",
        "## Feeds stale / incomplets côté source",
        "",
    ])
    if stale_rows:
        lines.extend([
            "| Feed | Candles | Dernière candle locale | Dernière candle déclarée feed | Flags |",
            "|---|---:|---|---|---|",
        ])
        for feed in stale_rows:
            lines.append(
                "| "
                + " | ".join([
                    f"`{feed['feed_id']}`",
                    str(feed["candle_count"]),
                    feed.get("last_timestamp_utc") or "",
                    feed.get("feed_latest_timestamp_utc") or "",
                    ", ".join(feed["flags"]),
                ])
                + " |"
            )
    else:
        lines.append("Aucun feed stale détecté.")

    assumed_rows = [feed for feed in report["feed_reports"] if "ASSUMED_MISSING_OPTIONAL" in feed["flags"]]
    lines.extend([
        "",
        "## Feeds manquants assumés",
        "",
    ])
    if assumed_rows:
        lines.extend([
            "| Feed | Candles disponibles | Dernière candle | Raison | Flags |",
            "|---|---:|---|---|---|",
        ])
        for feed in assumed_rows:
            lines.append(
                "| "
                + " | ".join([
                    f"`{feed['feed_id']}`",
                    str(feed["candle_count"]),
                    feed.get("last_timestamp_utc") or "",
                    ASSUMED_MISSING_OPTIONAL_FEEDS.get(feed["feed_id"], ""),
                    ", ".join(feed["flags"]),
                ])
                + " |"
            )
    else:
        lines.append("Aucun feed manquant assumé.")

    derived_rows = [feed for feed in report["feed_reports"] if "LOCAL_DERIVED" in feed["flags"]]
    lines.extend([
        "",
        "## Feeds dérivés localement",
        "",
    ])
    if derived_rows:
        lines.extend([
            "| Feed | Candles | Dernière candle | Status feed | Flags |",
            "|---|---:|---|---|---|",
        ])
        for feed in derived_rows:
            lines.append(
                "| "
                + " | ".join([
                    f"`{feed['feed_id']}`",
                    str(feed["candle_count"]),
                    feed.get("last_timestamp_utc") or "",
                    feed.get("feed_status") or "",
                    ", ".join(feed["flags"]),
                ])
                + " |"
            )
    else:
        lines.append("Aucun feed dérivé localement.")

    review_rows = [feed for feed in report["feed_reports"] if "REVIEW_GAPS" in feed["flags"]]
    lines.extend([
        "",
        "## Gaps à revoir",
        "",
    ])
    if review_rows:
        lines.extend([
            "| Feed | Review gaps | Max gap | Samples |",
            "|---|---:|---:|---|",
        ])
        for feed in review_rows:
            samples = "; ".join(
                f"{sample['from_utc']}→{sample['to_utc']} ({sample['gap_seconds']}s)"
                for sample in feed["gap_summary"]["samples"]
                if sample["classification"] == "review_gap"
            )
            lines.append(
                "| "
                + " | ".join([
                    f"`{feed['feed_id']}`",
                    str(feed["gap_summary"]["review_gap_count"]),
                    seconds_label(feed["gap_summary"]["max_review_gap_seconds"]),
                    samples,
                ])
                + " |"
            )
    else:
        lines.append("Aucun gap court/moyen suspect détecté dans le hot scope. Les trous restants sont classés comme pauses de session/week-end ou maintenance.")

    lines.extend([
        "",
        "## Feeds hors scope chaud non importés",
        "",
        "Ces feeds existent en metadata mais n’ont pas été alimentés en candles locales dans ce palier :",
        "",
    ])
    out_of_scope = [
        feed for feed in report["feed_reports"]
        if "OUT_OF_HOT_SCOPE" in feed["flags"] and "NO_CANDLES_IMPORTED" in feed["flags"]
    ]
    if out_of_scope:
        for feed in out_of_scope:
            lines.append(f"- `{feed['feed_id']}`")
    else:
        lines.append("- Aucun.")

    lines.extend([
        "",
        "## Notes de lecture",
        "",
        "- `SOURCE_STALE` signifie que la dernière candle locale colle à la dernière candle déclarée par le feed, mais que cette source est ancienne par rapport à la fin de fenêtre.",
        "- `ASSUMED_MISSING` signifie que le manque est accepté temporairement par la logique métier et ne bloque pas les replays.",
        "- `DERIVED_OK` signifie que le feed est complet dans la fenêtre grâce à une dérivation locale contrôlée depuis un timeframe plus fin.",
        "- `calendar_missing_slots` dans le JSON est volontairement calendaire : il inclut les pauses normales de session et les week-ends.",
        "- Les gaps classés `daily_maintenance_or_short_session_break` ou `session_or_weekend_break` ne sont pas considérés comme anomalies bloquantes.",
        "",
    ])
    return "\n".join(lines)


def calendar_slots(first_ts: datetime | None, last_ts: datetime | None, step_seconds: int) -> int | None:
    if not first_ts or not last_ts:
        return None
    return int((last_ts - first_ts).total_seconds() // step_seconds) + 1


def is_local_derived_feed(feed: dict[str, Any]) -> bool:
    metadata = feed.get("metadata") or {}
    return feed.get("status") == "derived_local" or "local_derivation" in metadata


def seconds_between(left: datetime | None, right: datetime | None) -> int | None:
    if not left or not right:
        return None
    return int((right - left).total_seconds())


def parse_utc(raw: str) -> datetime:
    value = raw.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def iso_utc(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def seconds_label(seconds: int | None) -> str:
    if not seconds:
        return "0s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds / 3600:.1f}h"
    return f"{seconds / 86400:.1f}d"


def json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return iso_utc(value) or ""
    return str(value)


if __name__ == "__main__":
    raise SystemExit(main())
