#!/usr/bin/env python3
"""Derive local higher-timeframe market candles from lower-timeframe candles.

This script is intentionally scoped to local PREPROD data repair. It fills
PostgreSQL gaps without mutating any upstream source.

Default mapping:

- MNQ/MES 15m from local 5m candles
- MNQ/MES 1H from local 5m candles

Only complete source buckets are eligible, and existing target candles are never
overwritten unless the script is extended explicitly.
"""
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_URL = "postgresql://desk:desk_local_only@localhost:5432/desk"
DEFAULT_FROM_UTC = "2026-06-30T22:00:00Z"
DEFAULT_TO_UTC = "2026-07-17T21:00:00Z"


@dataclass(frozen=True)
class DerivationTarget:
    source_feed_id: str
    target_feed_id: str
    source_timeframe: str
    target_timeframe: str
    bucket_interval: str
    expected_source_candles: int


DEFAULT_TARGETS = [
    DerivationTarget("prod__tradingview__MNQ1!__5", "prod__tradingview__MNQ1!__15", "5", "15", "15 minutes", 3),
    DerivationTarget("prod__tradingview__MNQ1!__5", "prod__tradingview__MNQ1!__1H", "5", "1H", "1 hour", 12),
    DerivationTarget("prod__tradingview__MES1!__5", "prod__tradingview__MES1!__15", "5", "15", "15 minutes", 3),
    DerivationTarget("prod__tradingview__MES1!__5", "prod__tradingview__MES1!__1H", "5", "1H", "1 hour", 12),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Derive local market candles from lower timeframes.")
    parser.add_argument("--mode", choices=("dry-run", "import"), default="dry-run")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--from-utc", default=DEFAULT_FROM_UTC)
    parser.add_argument("--to-utc", default=DEFAULT_TO_UTC)
    parser.add_argument(
        "--target-feed-ids",
        help="Comma-separated target feed IDs to derive. Defaults to MNQ/MES 15m+1H.",
    )
    parser.add_argument(
        "--json-output",
        default=str(ROOT / "docs" / "MARKET_CANDLES_DERIVATION_MNQ_MES_2026-07-20.json"),
    )
    args = parser.parse_args()

    from_utc = parse_utc(args.from_utc)
    to_utc = parse_utc(args.to_utc)
    selected_targets = select_targets(args.target_feed_ids)
    report = {
        "ok": True,
        "mode": args.mode,
        "generated_at_utc": iso_utc(datetime.now(timezone.utc)),
        "window": {
            "from_utc": iso_utc(from_utc),
            "to_utc": iso_utc(to_utc),
        },
        "targets": [],
        "summary": {},
    }

    with psycopg.connect(args.database_url, row_factory=dict_row) as conn:
        conn.execute("SET TIME ZONE 'UTC'")
        for target in selected_targets:
            target_report = process_target(conn, target, from_utc, to_utc, dry_run=args.mode == "dry-run")
            report["targets"].append(target_report)
        if args.mode == "import":
            conn.commit()

    report["summary"] = {
        "target_count": len(report["targets"]),
        "candidate_complete_buckets": sum(item["candidate_complete_buckets"] for item in report["targets"]),
        "existing_target_buckets": sum(item["existing_target_buckets"] for item in report["targets"]),
        "missing_target_buckets": sum(item["missing_target_buckets"] for item in report["targets"]),
        "inserted_buckets": sum(item["inserted_buckets"] for item in report["targets"]),
        "skipped_partial_buckets": sum(item["skipped_partial_buckets"] for item in report["targets"]),
    }

    output_path = Path(args.json_output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=json_default) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "output": str(output_path), "summary": report["summary"]}, indent=2, ensure_ascii=False))
    return 0


def select_targets(raw: str | None) -> list[DerivationTarget]:
    if not raw:
        return DEFAULT_TARGETS
    requested = {item.strip() for item in raw.split(",") if item.strip()}
    selected = [target for target in DEFAULT_TARGETS if target.target_feed_id in requested]
    missing = sorted(requested - {target.target_feed_id for target in selected})
    if missing:
        raise SystemExit(f"Unsupported target feed IDs for this scoped script: {', '.join(missing)}")
    return selected


def process_target(
    conn: psycopg.Connection,
    target: DerivationTarget,
    from_utc: datetime,
    to_utc: datetime,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    before = fetch_target_state(conn, target.target_feed_id)
    candidates = fetch_candidate_stats(conn, target, from_utc, to_utc)
    if dry_run:
        inserted = 0
        inserted_range = {"first_inserted_timestamp_utc": None, "last_inserted_timestamp_utc": None}
    else:
        inserted_range = insert_derived_candles(conn, target, from_utc, to_utc)
        inserted = inserted_range["inserted_buckets"]
        if inserted:
            update_target_feed_metadata(conn, target, before, inserted_range)
    after = fetch_target_state(conn, target.target_feed_id)
    return {
        "source_feed_id": target.source_feed_id,
        "target_feed_id": target.target_feed_id,
        "source_timeframe": target.source_timeframe,
        "target_timeframe": target.target_timeframe,
        "bucket_interval": target.bucket_interval,
        "expected_source_candles": target.expected_source_candles,
        "candidate_complete_buckets": candidates["candidate_complete_buckets"],
        "existing_target_buckets": candidates["existing_target_buckets"],
        "missing_target_buckets": candidates["missing_target_buckets"],
        "skipped_partial_buckets": candidates["skipped_partial_buckets"],
        "first_candidate_timestamp_utc": iso_utc(candidates["first_candidate_timestamp_utc"]),
        "last_candidate_timestamp_utc": iso_utc(candidates["last_candidate_timestamp_utc"]),
        "inserted_buckets": inserted,
        **inserted_range,
        "before": state_for_report(before),
        "after": state_for_report(after),
    }


def fetch_target_state(conn: psycopg.Connection, target_feed_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              mf.feed_id,
              mf.instrument_code,
              ms.symbol_code,
              mf.timeframe,
              mf.latest_timestamp_utc,
              mf.latest_candle_path,
              mf.status,
              mf.metadata,
              count(mc.timestamp_utc)::int AS candle_count,
              min(mc.timestamp_utc) AS first_timestamp_utc,
              max(mc.timestamp_utc) AS last_timestamp_utc
            FROM market_feeds mf
            JOIN market_symbols ms ON ms.symbol_id = mf.symbol_id
            LEFT JOIN market_candles mc ON mc.feed_id = mf.feed_id
            WHERE mf.feed_id = %s
            GROUP BY mf.feed_id, mf.instrument_code, ms.symbol_code
            """,
            (target_feed_id,),
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"target_feed_not_found:{target_feed_id}")
        return dict(row)


def fetch_candidate_stats(
    conn: psycopg.Connection,
    target: DerivationTarget,
    from_utc: datetime,
    to_utc: datetime,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH bucketed AS (
              SELECT
                date_bin(%s::interval, timestamp_utc, '1970-01-01 00:00:00+00'::timestamptz) AS bucket_ts,
                count(*)::int AS source_count
              FROM market_candles
              WHERE feed_id = %s
                AND timestamp_utc >= %s
                AND timestamp_utc <= %s
              GROUP BY bucket_ts
            )
            SELECT
              count(*) FILTER (WHERE source_count = %s)::int AS candidate_complete_buckets,
              count(*) FILTER (WHERE source_count <> %s)::int AS skipped_partial_buckets,
              count(*) FILTER (
                WHERE source_count = %s
                  AND existing.timestamp_utc IS NOT NULL
              )::int AS existing_target_buckets,
              count(*) FILTER (
                WHERE source_count = %s
                  AND existing.timestamp_utc IS NULL
              )::int AS missing_target_buckets,
              min(bucket_ts) FILTER (WHERE source_count = %s) AS first_candidate_timestamp_utc,
              max(bucket_ts) FILTER (WHERE source_count = %s) AS last_candidate_timestamp_utc
            FROM bucketed
            LEFT JOIN market_candles existing
              ON existing.feed_id = %s
             AND existing.timestamp_utc = bucketed.bucket_ts
            """,
            (
                target.bucket_interval,
                target.source_feed_id,
                from_utc,
                to_utc,
                target.expected_source_candles,
                target.expected_source_candles,
                target.expected_source_candles,
                target.expected_source_candles,
                target.expected_source_candles,
                target.expected_source_candles,
                target.target_feed_id,
            ),
        )
        return dict(cur.fetchone())


def insert_derived_candles(
    conn: psycopg.Connection,
    target: DerivationTarget,
    from_utc: datetime,
    to_utc: datetime,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH source AS (
              SELECT *
              FROM market_candles
              WHERE feed_id = %(source_feed_id)s
                AND timestamp_utc >= %(from_utc)s
                AND timestamp_utc <= %(to_utc)s
            ),
            bucketed AS (
              SELECT
                date_bin(%(bucket_interval)s::interval, timestamp_utc, '1970-01-01 00:00:00+00'::timestamptz) AS bucket_ts,
                count(*)::int AS source_count,
                min(timestamp_utc) AS source_first_timestamp_utc,
                max(timestamp_utc) AS source_last_timestamp_utc,
                (array_agg(open ORDER BY timestamp_utc ASC))[1] AS open,
                max(high) AS high,
                min(low) AS low,
                (array_agg(close ORDER BY timestamp_utc DESC))[1] AS close,
                sum(volume) FILTER (WHERE volume IS NOT NULL) AS volume,
                bool_and(is_closed) AS is_closed,
                (array_agg(symbol_code ORDER BY timestamp_utc ASC))[1] AS symbol_code
              FROM source
              GROUP BY bucket_ts
            ),
            eligible AS (
              SELECT *
              FROM bucketed
              WHERE source_count = %(expected_source_candles)s
                AND NOT EXISTS (
                  SELECT 1
                  FROM market_candles existing
                  WHERE existing.feed_id = %(target_feed_id)s
                    AND existing.timestamp_utc = bucketed.bucket_ts
                )
            ),
            inserted AS (
              INSERT INTO market_candles (
                feed_id,
                timestamp_utc,
                symbol_code,
                timeframe,
                trading_date,
                timestamp_paris,
                open,
                high,
                low,
                close,
                volume,
                is_closed,
                indicators,
                studies,
                raw,
                source_collection,
                source_document_id
              )
              SELECT
                %(target_feed_id)s,
                bucket_ts,
                symbol_code,
                %(target_timeframe)s,
                to_char(bucket_ts AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
                to_char(bucket_ts AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI:SS'),
                open,
                high,
                low,
                close,
                volume,
                coalesce(is_closed, true),
                '{}'::jsonb,
                '{}'::jsonb,
                jsonb_build_object(
                  'schema_version', 'local-derived-v1',
                  'source', 'postgres_local_derivation',
                  'script', 'scripts/db/derive_market_candles.py',
                  'source_feed_id', %(source_feed_id)s::text,
                  'target_feed_id', %(target_feed_id)s::text,
                  'source_timeframe', %(source_timeframe)s::text,
                  'target_timeframe', %(target_timeframe)s::text,
                  'bucket_interval', %(bucket_interval)s::text,
                  'expected_source_candles', %(expected_source_candles)s::int,
                  'source_candle_count', source_count,
                  'source_first_timestamp_utc', to_char(source_first_timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'source_last_timestamp_utc', to_char(source_last_timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'derived_at_utc', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                ),
                'derived:market_feeds/' || %(source_feed_id)s::text || '/candles',
                to_char(bucket_ts AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
              FROM eligible
              ON CONFLICT (feed_id, timestamp_utc) DO NOTHING
              RETURNING timestamp_utc
            )
            SELECT
              count(*)::int AS inserted_buckets,
              min(timestamp_utc) AS first_inserted_timestamp_utc,
              max(timestamp_utc) AS last_inserted_timestamp_utc
            FROM inserted
            """,
            {
                "source_feed_id": target.source_feed_id,
                "target_feed_id": target.target_feed_id,
                "source_timeframe": target.source_timeframe,
                "target_timeframe": target.target_timeframe,
                "bucket_interval": target.bucket_interval,
                "expected_source_candles": target.expected_source_candles,
                "from_utc": from_utc,
                "to_utc": to_utc,
            },
        )
        row = dict(cur.fetchone())
        return {
            "inserted_buckets": int(row["inserted_buckets"] or 0),
            "first_inserted_timestamp_utc": iso_utc(row["first_inserted_timestamp_utc"]),
            "last_inserted_timestamp_utc": iso_utc(row["last_inserted_timestamp_utc"]),
        }


def update_target_feed_metadata(
    conn: psycopg.Connection,
    target: DerivationTarget,
    before: dict[str, Any],
    inserted_range: dict[str, Any],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH stats AS (
              SELECT max(timestamp_utc) AS max_timestamp_utc
              FROM market_candles
              WHERE feed_id = %s
            )
            UPDATE market_feeds
            SET
              latest_timestamp_utc = stats.max_timestamp_utc,
              latest_candle_path = 'market_feeds/' || market_feeds.feed_id || '/candles/' || to_char(stats.max_timestamp_utc AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
              status = 'derived_local',
              metadata = market_feeds.metadata || %s::jsonb,
              updated_at = now()
            FROM stats
            WHERE market_feeds.feed_id = %s
              AND stats.max_timestamp_utc IS NOT NULL
            """,
            (
                target.target_feed_id,
                Jsonb({
                    "local_derivation": {
                        "enabled": True,
                        "script": "scripts/db/derive_market_candles.py",
                        "source_feed_id": target.source_feed_id,
                        "source_timeframe": target.source_timeframe,
                        "target_timeframe": target.target_timeframe,
                        "bucket_interval": target.bucket_interval,
                        "expected_source_candles": target.expected_source_candles,
                        "previous_feed_latest_timestamp_utc": iso_utc(before.get("latest_timestamp_utc")),
                        "previous_latest_candle_path": before.get("latest_candle_path"),
                        "inserted_buckets": inserted_range["inserted_buckets"],
                        "first_inserted_timestamp_utc": inserted_range["first_inserted_timestamp_utc"],
                        "last_inserted_timestamp_utc": inserted_range["last_inserted_timestamp_utc"],
                        "derived_at_utc": iso_utc(datetime.now(timezone.utc)),
                    }
                }),
                target.target_feed_id,
            ),
        )


def state_for_report(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") or {}
    return {
        "feed_id": row.get("feed_id"),
        "instrument_code": row.get("instrument_code"),
        "symbol_code": row.get("symbol_code"),
        "timeframe": row.get("timeframe"),
        "candle_count": row.get("candle_count"),
        "first_timestamp_utc": iso_utc(row.get("first_timestamp_utc")),
        "last_timestamp_utc": iso_utc(row.get("last_timestamp_utc")),
        "latest_timestamp_utc": iso_utc(row.get("latest_timestamp_utc")),
        "latest_candle_path": row.get("latest_candle_path"),
        "status": row.get("status"),
        "has_local_derivation_metadata": "local_derivation" in metadata,
    }


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


def json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return iso_utc(value) or ""
    return str(value)


if __name__ == "__main__":
    raise SystemExit(main())
