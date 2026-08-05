#!/usr/bin/env python3
"""Archived Firestore -> PostgreSQL bootstrap used before the V4 local cutover.

It is retained only for migration traceability and is not a runtime command.
It routes each known source
to the target table chosen during the PREPROD database audit:

- business/runtime Desk documents -> desk_documents
- market_feeds docs -> market_feeds
- market_feeds/{feed_id}/candles -> market_candles
- live_data_feed_status -> market_feed_status
- tradingview_webhook_events -> tradingview_events

Use --mode dry-run first. Use --mode import only after the report looks right.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

import psycopg
from psycopg.types.json import Jsonb

try:
    from google.api_core import exceptions
    from google.api_core.retry import Retry, if_exception_type
    from google.auth.transport.requests import AuthorizedSession
    from google.cloud import firestore
    from google.cloud.firestore_v1 import _helpers as firestore_helpers
    from google.cloud.firestore_v1.field_path import FieldPath
    from google.cloud.firestore_v1.types import Document as FirestoreDocument
    from google.cloud.firestore_v1.types import RunQueryResponse as FirestoreRunQueryResponse
    from google.oauth2.credentials import Credentials
    from google.protobuf.json_format import ParseDict
except Exception as exc:  # pragma: no cover - reported by main before work starts
    exceptions = None
    Retry = None
    if_exception_type = None
    AuthorizedSession = None
    firestore = None
    firestore_helpers = None
    FieldPath = None
    FirestoreDocument = None
    FirestoreRunQueryResponse = None
    Credentials = None
    ParseDict = None
    GOOGLE_IMPORT_ERROR = exc
else:
    GOOGLE_IMPORT_ERROR = None


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_URL = "postgresql://desk:desk_local_only@localhost:5432/desk"
DEFAULT_PROJECT_ID = "tv-automation-23d50"
STREAM_TIMEOUT_SECONDS = 300

if Retry and exceptions and if_exception_type:
    STREAM_RETRY = Retry(
        predicate=if_exception_type(
            exceptions.Aborted,
            exceptions.DeadlineExceeded,
            exceptions.InternalServerError,
            exceptions.ServiceUnavailable,
            exceptions.Unknown,
        ),
        initial=1.0,
        maximum=10.0,
        multiplier=2.0,
        deadline=120.0,
    )
else:  # pragma: no cover
    STREAM_RETRY = None


CORE_DOCUMENT_COLLECTIONS = [
    "desk_contracts",
    "desk_contract_registry",
    "desk_runtime_control",
    "desk_active_theses",
    "desk_master_analyses",
    "desk_hourly_monitors",
    "desk_live_run_cursor",
    "desk_positions",
    "desk_position_states",
    "desk_alerts",
    "desk_decisions",
    "macro_calendar_events",
    "desk_replay_runs",
    "desk_replay_steps",
    "desk_replay_bundles",
    "desk_replay_master_analyses",
    "desk_replay_monitors",
    "desk_replay_setups",
    "desk_replay_positions",
    "desk_replay_trade_simulations",
    "desk_replay_timeline",
    "desk_replay_idempotency",
    "desk_replay_autopilot_configs",
    "desk_replay_active_theses",
    "desk_agent_work_items",
    "desk_agent_work_events",
    "desk_agent_work_dead_letter",
    "desk_packs",
    "desk_pack_builds",
    "desk_master_cutoff_bundles",
    "desk_manual_monitor_bundles",
    "desk_manual_monitors",
    "desk_master_prep_jobs",
    "desk_monitor_prep_jobs",
    "desk_context_transmissions",
    "desk_monitor_context_transmissions",
    "desk_replay_context_transmissions",
    "desk_session_snapshots",
    "desk_level_maps",
    "desk_technical_events",
    "desk_rolling_snapshots",
    "desk_condition_status",
    "dashboard_commands",
    "dashboard_command_events",
    "desk_strategy_trades",
    "desk_strategy_trade_exits",
    "desk_strategy_daily_performance",
    "desk_strategy_equity_curve",
    "desk_strategy_stats",
]

SPECIALIZED_TOP_LEVEL_COLLECTIONS = [
    "market_feeds",
    "live_data_feed_status",
    "tradingview_webhook_events",
]

DEFAULT_COLLECTIONS = SPECIALIZED_TOP_LEVEL_COLLECTIONS + CORE_DOCUMENT_COLLECTIONS

SKIP_COLLECTIONS = {
    "desk_cross_asset_deltas": "excluded: cross-asset deltas are noisy and recalculable",
    "market_candles": "excluded: legacy residual replaced by market_feeds/*/candles",
    "study_candles": "excluded: high-volume derived study candles",
    "live_study_values": "excluded by default: high-volume derived study values",
    "desk_cloud_run_slots": "excluded: Cloud Run runtime-specific state",
    "broker_order_intents": "excluded by default: old broker test state, migrate later into trade_order_intents after validation",
    "broker_order_intent_events": "excluded by default: old broker test events",
    "broker_runtime_control": "excluded by default: broker automation not enabled in PREPROD",
    "broker_runtime_events": "excluded by default: broker automation not enabled in PREPROD",
    "ninjatrader_bridge_mirrors": "excluded by default: bridge mirror/test state",
}

KNOWN_PROVIDER_VALUES = {"tradingview", "ninjatrader", "csv", "manual", "synthetic", "unknown"}
KNOWN_ENV_VALUES = {"prod", "preprod", "local", "replay", "backtest", "test"}
KNOWN_ASSET_CLASSES = {
    "MNQ": "futures_index",
    "MES": "futures_index",
    "NQ": "futures_index",
    "ES": "futures_index",
    "DAX": "futures_index",
    "DXY": "macro_fx",
    "VIX": "volatility",
    "US10Y": "rates",
    "US02Y": "rates",
    "GC": "commodity",
    "CL": "commodity",
    "AAPL": "equity",
    "MSFT": "equity",
    "NVDA": "equity",
    "TSLA": "equity",
    "QQQ": "etf",
    "SMH": "etf",
    "SOXX": "etf",
}


@dataclass
class Counters:
    seen: int = 0
    written: int = 0
    skipped: int = 0
    quarantined: int = 0
    errors: int = 0


@dataclass
class RestDocumentSnapshot:
    reference: Any
    data: dict[str, Any]

    @property
    def id(self) -> str:
        return self.reference.id

    def to_dict(self) -> dict[str, Any]:
        return dict(self.data)


@dataclass
class MigrationContext:
    mode: str
    import_id: str
    conn: Any | None
    project_id: str
    requested_collections: list[str]
    excluded_collections: dict[str, str]
    options: dict[str, Any]
    counters: dict[str, Counters] = field(default_factory=lambda: defaultdict(Counters))
    checkpoint_counters: dict[tuple[str, str], Counters] = field(default_factory=lambda: defaultdict(Counters))
    samples: dict[str, list[dict[str, Any]]] = field(default_factory=lambda: defaultdict(list))
    quarantine_samples: list[dict[str, Any]] = field(default_factory=list)
    latest_document_ids: dict[tuple[str, str], str] = field(default_factory=dict)
    pipeline: Any | None = None
    pipeline_documents_since_sync: int = 0

    @property
    def dry_run(self) -> bool:
        return self.mode == "dry-run"

    def record_seen(self, target: str) -> None:
        self.counters[target].seen += 1

    def record_write(self, target: str, source_path: str, document_id: str, data: dict[str, Any]) -> None:
        self.counters[target].written += 1
        self.latest_document_ids[(source_path.rsplit("/", 1)[0], target)] = document_id
        if len(self.samples[target]) < int(self.options.get("sample_limit", 3)):
            self.samples[target].append({
                "source_path": source_path,
                "document_id": document_id,
                "keys": sorted(data.keys())[:30],
            })

    def record_skip(self, target: str) -> None:
        self.counters[target].skipped += 1

    def record_error(self, target: str) -> None:
        self.counters[target].errors += 1

    def report(self) -> dict[str, Any]:
        return {
            "ok": all(counter.errors == 0 for counter in self.counters.values()),
            "mode": self.mode,
            "import_id": self.import_id,
            "project_id": self.project_id,
            "requested_collections": self.requested_collections,
            "excluded_collections": self.excluded_collections,
            "options": self.options,
            "targets": {
                target: {
                    "seen": counter.seen,
                    "written" if not self.dry_run else "would_write": counter.written,
                    "skipped": counter.skipped,
                    "quarantined": counter.quarantined,
                    "errors": counter.errors,
                }
                for target, counter in sorted(self.counters.items())
            },
            "samples": self.samples,
            "quarantine_samples": self.quarantine_samples,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Structured Firestore to local PostgreSQL importer.")
    parser.add_argument("--mode", choices=("dry-run", "import"), default="dry-run")
    parser.add_argument("--project-id", default=os.getenv("FIREBASE_PROJECT_ID", DEFAULT_PROJECT_ID))
    parser.add_argument("--auth", choices=("auto", "adc", "firebase-cli", "firebase-cli-rest"), default="auto")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--profile", choices=("default", "core", "market"), default="default")
    parser.add_argument("--collections", help="Comma-separated explicit top-level collections. Defaults to PREPROD core profile.")
    parser.add_argument("--include-candles", action="store_true", help="Also scan market_feeds/{feed_id}/candles.")
    parser.add_argument("--feed-ids", help="Comma-separated market feed IDs to process when importing market_feeds/candles.")
    parser.add_argument("--recent-candles", action="store_true", help="For candle subcollections, read latest document IDs first.")
    parser.add_argument("--candle-from-doc-id", help="Inclusive candle document ID lower bound, e.g. 20260701T000000Z.")
    parser.add_argument("--candle-to-doc-id", help="Inclusive candle document ID upper bound, e.g. 20260717T210000Z.")
    parser.add_argument("--candle-from-utc", help="Inclusive UTC lower bound converted to candle doc ID.")
    parser.add_argument("--candle-to-utc", help="Inclusive UTC upper bound converted to candle doc ID.")
    parser.add_argument("--candle-page-size", type=int, default=1000, help="Page size for candle imports to avoid long Firestore streams.")
    parser.add_argument(
        "--top-level-page-size",
        type=int,
        default=500,
        help="Page size for top-level collections so REST streams remain short and resumable.",
    )
    parser.add_argument("--max-docs-per-collection", type=int, default=200, help="Safety cap per top-level collection. Use 0 for no cap.")
    parser.add_argument("--max-candles-per-feed", type=int, default=200, help="Safety cap per feed candle subcollection. Use 0 for no cap.")
    parser.add_argument("--batch-size", type=int, default=250, help="Reserved for future bulk mode; current writes are idempotent row upserts.")
    parser.add_argument(
        "--read-delay-ms",
        type=float,
        default=0,
        help="Optional delay after every Firestore document to stay below source read quotas.",
    )
    parser.add_argument(
        "--pipeline-sync-every",
        type=int,
        default=250,
        help="Flush PostgreSQL pipeline commands after this many imported documents.",
    )
    parser.add_argument("--sample-limit", type=int, default=3)
    parser.add_argument("--output", default=str(ROOT / "docs" / "FIRESTORE_TO_POSTGRES_DRY_RUN_LATEST.json"))
    parser.add_argument("--skip-schema-check", action="store_true")
    args = parser.parse_args()

    if GOOGLE_IMPORT_ERROR:
        print(json.dumps({"ok": False, "error": "google_firestore_dependency_missing", "detail": str(GOOGLE_IMPORT_ERROR)}, indent=2))
        return 2

    collections = parse_collections(args.collections, profile=args.profile)
    include_candles = bool(args.include_candles)
    options = {
        "include_candles": include_candles,
        "feed_ids": [item.strip() for item in str(args.feed_ids or "").split(",") if item.strip()],
        "recent_candles": bool(args.recent_candles),
        "candle_from_doc_id": args.candle_from_doc_id or doc_id_from_utc(args.candle_from_utc),
        "candle_to_doc_id": args.candle_to_doc_id or doc_id_from_utc(args.candle_to_utc),
        "candle_page_size": max(1, args.candle_page_size),
        "top_level_page_size": max(1, args.top_level_page_size),
        "max_docs_per_collection": args.max_docs_per_collection,
        "max_candles_per_feed": args.max_candles_per_feed,
        "batch_size": args.batch_size,
        "read_delay_ms": max(0.0, args.read_delay_ms),
        "pipeline_sync_every": max(1, args.pipeline_sync_every),
        "sample_limit": args.sample_limit,
    }
    import_id = f"firestore_{args.mode.replace('-', '_')}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    client = build_firestore_client(project_id=args.project_id, auth=args.auth)
    conn = None if args.mode == "dry-run" else psycopg.connect(args.database_url, autocommit=True)
    try:
        ctx = MigrationContext(
            mode=args.mode,
            import_id=import_id,
            conn=conn,
            project_id=args.project_id,
            requested_collections=collections,
            excluded_collections={name: SKIP_COLLECTIONS[name] for name in sorted(SKIP_COLLECTIONS)},
            options=options,
        )
        if conn and not args.skip_schema_check:
            assert_schema_ready(conn)
        if conn:
            start_import_run(ctx)
        if conn:
            # The importer performs an idempotent document upsert followed by a
            # checkpoint upsert for every Firestore document. Over an SSH
            # tunnel, waiting for each statement separately multiplies network
            # latency by tens of thousands of round trips. Psycopg pipeline mode
            # keeps the same SQL ordering and error semantics while batching
            # those exchanges.
            with conn.pipeline() as pipeline:
                ctx.pipeline = pipeline
                run_migration(ctx, client, collections)
                pipeline.sync()
                ctx.pipeline_documents_since_sync = 0
                ctx.pipeline = None
        else:
            run_migration(ctx, client, collections)
        report = ctx.report()
        if conn:
            finish_import_run(ctx, "completed", report=report)
    except Exception as exc:
        if conn:
            finish_import_run(ctx, "failed", report=ctx.report() if "ctx" in locals() else {}, error=str(exc))
        raise
    finally:
        if conn:
            conn.close()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=json_default) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, default=json_default))
    return 0 if report["ok"] else 1


def parse_collections(raw: str | None, *, profile: str = "default") -> list[str]:
    if not raw:
        if profile == "core":
            return ["market_feeds"] + list(CORE_DOCUMENT_COLLECTIONS)
        if profile == "market":
            return list(SPECIALIZED_TOP_LEVEL_COLLECTIONS)
        return list(DEFAULT_COLLECTIONS)
    return [item.strip() for item in raw.split(",") if item.strip()]


def run_migration(ctx: MigrationContext, client: Any, collections: list[str]) -> None:
    read_delay_seconds = float(ctx.options.get("read_delay_ms") or 0.0) / 1000.0
    for collection in collections:
        if collection in SKIP_COLLECTIONS:
            ctx.record_seen("skipped")
            ctx.record_skip("skipped")
            continue
        ref = client.collection(collection)
        limit = int(ctx.options.get("max_docs_per_collection") or 0)
        for snapshot in stream_documents(
            ref,
            limit=limit,
            page_size=int(ctx.options.get("top_level_page_size") or 500),
        ):
            feed_ids = set(ctx.options.get("feed_ids") or [])
            if collection == "market_feeds" and feed_ids and snapshot.id not in feed_ids:
                ctx.record_seen("skipped")
                ctx.record_skip("skipped")
                continue
            data = json_safe(snapshot.to_dict() or {})
            process_top_level_document(ctx, collection, snapshot.id, snapshot.reference.path, data)
            if collection == "market_feeds" and ctx.options.get("include_candles"):
                candle_limit = int(ctx.options.get("max_candles_per_feed") or 0)
                candle_ref = snapshot.reference.collection("candles")
                for candle_snapshot in stream_documents(
                    candle_ref,
                    limit=candle_limit,
                    document_id_desc=bool(ctx.options.get("recent_candles")),
                    document_id_gte=ctx.options.get("candle_from_doc_id"),
                    document_id_lte=ctx.options.get("candle_to_doc_id"),
                    page_size=int(ctx.options.get("candle_page_size") or 1000),
                ):
                    candle_data = json_safe(candle_snapshot.to_dict() or {})
                    process_market_candle(
                        ctx,
                        feed_id=snapshot.id,
                        document_id=candle_snapshot.id,
                        source_path=candle_snapshot.reference.path,
                        data=candle_data,
                    )
                    if read_delay_seconds > 0:
                        time.sleep(read_delay_seconds)
            if read_delay_seconds > 0:
                time.sleep(read_delay_seconds)


def stream_documents(
    collection_ref: Any,
    *,
    limit: int = 0,
    document_id_desc: bool = False,
    document_id_gte: str | None = None,
    document_id_lte: str | None = None,
    page_size: int | None = None,
) -> Iterable[Any]:
    if page_size and page_size > 0 and not document_id_desc:
        client = getattr(collection_ref, "_client", None)
        if client is not None and getattr(client, "_desk_rest_session", None) is not None:
            if not document_id_gte and not document_id_lte:
                yield from stream_documents_by_rest_list_pages(
                    collection_ref,
                    limit=limit,
                    page_size=page_size,
                )
            else:
                yield from stream_documents_by_rest_pages(
                    collection_ref,
                    limit=limit,
                    document_id_gte=document_id_gte,
                    document_id_lte=document_id_lte,
                    page_size=page_size,
                )
            return
        yield from stream_documents_by_id_pages(
            collection_ref,
            limit=limit,
            document_id_gte=document_id_gte,
            document_id_lte=document_id_lte,
            page_size=page_size,
        )
        return
    query = collection_ref
    if document_id_gte:
        query = query.where(FieldPath.document_id(), ">=", collection_ref.document(document_id_gte))
    if document_id_lte:
        query = query.where(FieldPath.document_id(), "<=", collection_ref.document(document_id_lte))
    if document_id_desc:
        query = query.order_by("__name__", direction=firestore.Query.DESCENDING)
    if limit and limit > 0:
        query = query.limit(limit)
    kwargs = {"timeout": STREAM_TIMEOUT_SECONDS}
    if STREAM_RETRY:
        kwargs["retry"] = STREAM_RETRY
    try:
        yield from query.stream(**kwargs)
    except Exception as exc:
        if document_id_desc and exceptions and isinstance(exc, exceptions.FailedPrecondition):
            raise RuntimeError(
                "recent_candles_requires_firestore_index: rerun without --recent-candles or create the Firestore candles __name__ DESC index"
            ) from exc
        raise


def stream_documents_by_rest_list_pages(
    collection_ref: Any,
    *,
    limit: int = 0,
    page_size: int = 500,
) -> Iterable[Any]:
    client = collection_ref._client
    session = client._desk_rest_session
    database_string = client._database_string
    parent = collection_ref.parent
    parent_path = parent.path if parent is not None else ""
    collection_path = (
        f"{parent_path}/{collection_ref.id}"
        if parent_path
        else collection_ref.id
    )
    endpoint = (
        f"https://firestore.googleapis.com/v1/{database_string}/documents/{collection_path}"
    )
    remaining = limit if limit and limit > 0 else None
    page_token: str | None = None

    while True:
        current_limit = page_size if remaining is None else min(page_size, remaining)
        params: dict[str, Any] = {
            "pageSize": current_limit,
            "orderBy": "__name__",
            "showMissing": "false",
        }
        if page_token:
            params["pageToken"] = page_token
        response = session.get(endpoint, params=params, timeout=STREAM_TIMEOUT_SECONDS)
        if not response.ok:
            try:
                error = (response.json().get("error") or {}).get("message")
            except Exception:
                error = None
            raise RuntimeError(
                f"firestore_rest_list_failed:{response.status_code}:{error or 'unknown'}"
            )
        payload = response.json()
        documents = payload.get("documents") or []
        page: list[RestDocumentSnapshot] = []
        for document in documents:
            name = str(document.get("name") or "")
            marker = "/documents/"
            if marker not in name:
                continue
            relative_path = name.split(marker, 1)[1]
            reference = client.document(relative_path)
            document_message = FirestoreDocument()
            ParseDict(document, document_message._pb)
            decoded = firestore_helpers.decode_dict(document_message.fields, client)
            page.append(RestDocumentSnapshot(reference=reference, data=decoded))
        yield from page
        if remaining is not None:
            remaining -= len(page)
            if remaining <= 0:
                break
        page_token = payload.get("nextPageToken")
        if not page_token:
            break


def stream_documents_by_rest_pages(
    collection_ref: Any,
    *,
    limit: int = 0,
    document_id_gte: str | None = None,
    document_id_lte: str | None = None,
    page_size: int = 500,
) -> Iterable[Any]:
    client = collection_ref._client
    session = client._desk_rest_session
    database_string = client._database_string
    parent = collection_ref.parent
    parent_path = parent.path if parent is not None else ""
    endpoint = (
        f"https://firestore.googleapis.com/v1/{database_string}/documents"
        f"/{parent_path}:runQuery"
        if parent_path
        else f"https://firestore.googleapis.com/v1/{database_string}/documents:runQuery"
    )
    remaining = limit if limit and limit > 0 else None
    lower = document_id_gte
    lower_operator = "GREATER_THAN_OR_EQUAL" if lower else None

    while True:
        current_limit = page_size if remaining is None else min(page_size, remaining)
        filters: list[dict[str, Any]] = []
        if lower:
            filters.append(
                firestore_document_name_filter(
                    collection_ref,
                    lower_operator or "GREATER_THAN_OR_EQUAL",
                    lower,
                )
            )
        if document_id_lte:
            filters.append(
                firestore_document_name_filter(
                    collection_ref,
                    "LESS_THAN_OR_EQUAL",
                    document_id_lte,
                )
            )
        structured_query: dict[str, Any] = {
            "from": [{"collectionId": collection_ref.id}],
            "orderBy": [{"field": {"fieldPath": "__name__"}, "direction": "ASCENDING"}],
            "limit": current_limit,
        }
        if len(filters) == 1:
            structured_query["where"] = filters[0]
        elif filters:
            structured_query["where"] = {
                "compositeFilter": {
                    "op": "AND",
                    "filters": filters,
                }
            }
        response = session.post(
            endpoint,
            json={"structuredQuery": structured_query},
            timeout=STREAM_TIMEOUT_SECONDS,
        )
        if not response.ok:
            try:
                error = (response.json().get("error") or {}).get("message")
            except Exception:
                error = None
            raise RuntimeError(
                f"firestore_rest_query_failed:{response.status_code}:{error or 'unknown'}"
            )
        payload = response.json()
        page: list[RestDocumentSnapshot] = []
        for result in payload if isinstance(payload, list) else []:
            document = result.get("document") if isinstance(result, dict) else None
            if not document:
                continue
            name = str(document.get("name") or "")
            marker = "/documents/"
            if marker not in name:
                continue
            relative_path = name.split(marker, 1)[1]
            reference = client.document(relative_path)
            response_message = FirestoreRunQueryResponse()
            ParseDict(result, response_message._pb)
            decoded = firestore_helpers.decode_dict(response_message.document.fields, client)
            page.append(RestDocumentSnapshot(reference=reference, data=decoded))
        if not page:
            break
        yield from page
        if remaining is not None:
            remaining -= len(page)
            if remaining <= 0:
                break
        if len(page) < current_limit:
            break
        last_id = page[-1].id
        if last_id == lower and lower_operator == "GREATER_THAN":
            raise RuntimeError(f"firestore_rest_pagination_stalled:{collection_ref.path}:{last_id}")
        lower = last_id
        lower_operator = "GREATER_THAN"


def firestore_document_name_filter(collection_ref: Any, operator: str, document_id: str) -> dict[str, Any]:
    return {
        "fieldFilter": {
            "field": {"fieldPath": "__name__"},
            "op": operator,
            "value": {"referenceValue": collection_ref.document(document_id)._document_path},
        }
    }


def stream_documents_by_id_pages(
    collection_ref: Any,
    *,
    limit: int = 0,
    document_id_gte: str | None = None,
    document_id_lte: str | None = None,
    page_size: int = 1000,
) -> Iterable[Any]:
    remaining = limit if limit and limit > 0 else None
    lower = document_id_gte
    lower_operator = ">=" if lower else None
    while True:
        query = collection_ref
        if lower:
            query = query.where(FieldPath.document_id(), lower_operator, collection_ref.document(lower))
        if document_id_lte:
            query = query.where(FieldPath.document_id(), "<=", collection_ref.document(document_id_lte))
        current_limit = page_size if remaining is None else min(page_size, remaining)
        query = query.limit(current_limit)
        kwargs = {"timeout": STREAM_TIMEOUT_SECONDS}
        if STREAM_RETRY:
            kwargs["retry"] = STREAM_RETRY
        page = list(query.stream(**kwargs))
        if not page:
            break
        for snapshot in page:
            yield snapshot
        if remaining is not None:
            remaining -= len(page)
            if remaining <= 0:
                break
        if len(page) < current_limit:
            break
        last_id = page[-1].id
        if last_id == lower and lower_operator == ">":
            raise RuntimeError(f"firestore_pagination_stalled:{collection_ref.path}:{last_id}")
        lower = last_id
        lower_operator = ">"


def process_top_level_document(ctx: MigrationContext, collection: str, document_id: str, source_path: str, data: dict[str, Any]) -> None:
    if collection == "market_feeds":
        ctx.record_seen("market_feeds")
        upsert_market_feed(ctx, feed_id=document_id, source_path=source_path, data=data)
        return
    if collection == "live_data_feed_status":
        ctx.record_seen("market_feed_status")
        upsert_market_feed_status(ctx, status_id=document_id, source_path=source_path, data=data)
        return
    if collection == "tradingview_webhook_events":
        ctx.record_seen("tradingview_events")
        upsert_tradingview_event(ctx, event_id=document_id, source_path=source_path, data=data)
        return
    ctx.record_seen("desk_documents")
    upsert_desk_document(ctx, collection=collection, document_id=document_id, source_path=source_path, data=data)


def process_market_candle(ctx: MigrationContext, *, feed_id: str, document_id: str, source_path: str, data: dict[str, Any]) -> None:
    ctx.record_seen("market_candles")
    try:
        row = market_candle_row(feed_id, document_id, data)
    except ValueError as exc:
        quarantine(ctx, "market_feeds/*/candles", document_id, "market_candles", str(exc), data)
        return
    if ctx.dry_run:
        ctx.record_write("market_candles", source_path, document_id, data)
        return
    ensure_market_feed(ctx, row["feed_id"], data)
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO market_candles (
              feed_id, timestamp_utc, symbol_code, timeframe, trading_date, timestamp_paris,
              open, high, low, close, volume, is_closed, indicators, studies, raw,
              source_collection, source_document_id
            ) VALUES (
              %(feed_id)s, %(timestamp_utc)s, %(symbol_code)s, %(timeframe)s, %(trading_date)s, %(timestamp_paris)s,
              %(open)s, %(high)s, %(low)s, %(close)s, %(volume)s, %(is_closed)s,
              %(indicators)s, %(studies)s, %(raw)s, %(source_collection)s, %(source_document_id)s
            )
            ON CONFLICT(feed_id, timestamp_utc) DO UPDATE
            SET
              symbol_code = EXCLUDED.symbol_code,
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
              raw = EXCLUDED.raw,
              source_collection = EXCLUDED.source_collection,
              source_document_id = EXCLUDED.source_document_id,
              updated_at = now()
            """,
            {
                **row,
                "indicators": Jsonb(row["indicators"]),
                "studies": Jsonb(row["studies"]),
                "raw": Jsonb(row["raw"]),
            },
        )
    ctx.record_write("market_candles", source_path, document_id, data)
    update_checkpoint(ctx, "market_feeds/*/candles", "market_candles", document_id)


def upsert_desk_document(ctx: MigrationContext, *, collection: str, document_id: str, source_path: str, data: dict[str, Any]) -> None:
    if ctx.dry_run:
        ctx.record_write("desk_documents", source_path, document_id, data)
        return
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO desk_documents (collection, document_id, data)
            VALUES (%s, %s, %s)
            ON CONFLICT(collection, document_id) DO UPDATE
            SET data = EXCLUDED.data,
                updated_at = now()
            """,
            (collection, document_id, Jsonb(data)),
        )
    ctx.record_write("desk_documents", source_path, document_id, data)
    update_checkpoint(ctx, collection, "desk_documents", document_id)


def upsert_market_feed(ctx: MigrationContext, *, feed_id: str, source_path: str, data: dict[str, Any]) -> None:
    row = market_feed_row(feed_id, data)
    if ctx.dry_run:
        ctx.record_write("market_feeds", source_path, feed_id, data)
        return
    ensure_market_symbol(ctx, row["instrument_code"], row["provider"], row["symbol_code"])
    ensure_timeframe(ctx, row["timeframe"])
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO market_feeds (
              feed_id, symbol_id, instrument_code, timeframe, environment, provider,
              source_service, timezone, enabled, latest_timestamp_utc, latest_candle_path,
              status, metadata, raw
            ) VALUES (
              %(feed_id)s, %(symbol_id)s, %(instrument_code)s, %(timeframe)s, %(environment)s, %(provider)s,
              %(source_service)s, %(timezone)s, %(enabled)s, %(latest_timestamp_utc)s, %(latest_candle_path)s,
              %(status)s, %(metadata)s, %(raw)s
            )
            ON CONFLICT(feed_id) DO UPDATE
            SET
              symbol_id = EXCLUDED.symbol_id,
              instrument_code = EXCLUDED.instrument_code,
              timeframe = EXCLUDED.timeframe,
              environment = EXCLUDED.environment,
              provider = EXCLUDED.provider,
              source_service = EXCLUDED.source_service,
              timezone = EXCLUDED.timezone,
              enabled = EXCLUDED.enabled,
              latest_timestamp_utc = EXCLUDED.latest_timestamp_utc,
              latest_candle_path = EXCLUDED.latest_candle_path,
              status = EXCLUDED.status,
              metadata = market_feeds.metadata || EXCLUDED.metadata,
              raw = EXCLUDED.raw,
              updated_at = now()
            """,
            {**row, "metadata": Jsonb(row["metadata"]), "raw": Jsonb(row["raw"])},
        )
    ctx.record_write("market_feeds", source_path, feed_id, data)
    update_checkpoint(ctx, "market_feeds", "market_feeds", feed_id)


def ensure_market_feed(ctx: MigrationContext, feed_id: str, data: dict[str, Any]) -> None:
    if ctx.dry_run:
        return
    row = market_feed_row(feed_id, data)
    ensure_market_symbol(ctx, row["instrument_code"], row["provider"], row["symbol_code"])
    ensure_timeframe(ctx, row["timeframe"])
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT 1 FROM market_feeds WHERE feed_id = %s", (feed_id,))
        if cur.fetchone():
            return
    upsert_market_feed(ctx, feed_id=feed_id, source_path=f"market_feeds/{feed_id}", data=data)


def market_feed_exists(ctx: MigrationContext, feed_id: str | None) -> bool:
    if not feed_id:
        return False
    if ctx.dry_run:
        return True
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT 1 FROM market_feeds WHERE feed_id = %s", (feed_id,))
        return cur.fetchone() is not None


def upsert_market_feed_status(ctx: MigrationContext, *, status_id: str, source_path: str, data: dict[str, Any]) -> None:
    row = market_feed_status_row(status_id, data)
    if ctx.dry_run:
        ctx.record_write("market_feed_status", source_path, status_id, data)
        return
    if row["feed_id"] and not market_feed_exists(ctx, row["feed_id"]):
        row["feed_id"] = None
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO market_feed_status (
              status_id, feed_id, symbol_code, timeframe, timestamp_utc, status,
              latest_bar_age_seconds, payload, raw
            ) VALUES (
              %(status_id)s, %(feed_id)s, %(symbol_code)s, %(timeframe)s, %(timestamp_utc)s, %(status)s,
              %(latest_bar_age_seconds)s, %(payload)s, %(raw)s
            )
            ON CONFLICT(status_id) DO UPDATE
            SET
              feed_id = EXCLUDED.feed_id,
              symbol_code = EXCLUDED.symbol_code,
              timeframe = EXCLUDED.timeframe,
              timestamp_utc = EXCLUDED.timestamp_utc,
              status = EXCLUDED.status,
              latest_bar_age_seconds = EXCLUDED.latest_bar_age_seconds,
              payload = EXCLUDED.payload,
              raw = EXCLUDED.raw,
              updated_at = now()
            """,
            {**row, "payload": Jsonb(row["payload"]), "raw": Jsonb(row["raw"])},
        )
    ctx.record_write("market_feed_status", source_path, status_id, data)
    update_checkpoint(ctx, "live_data_feed_status", "market_feed_status", status_id)


def upsert_tradingview_event(ctx: MigrationContext, *, event_id: str, source_path: str, data: dict[str, Any]) -> None:
    row = tradingview_event_row(event_id, data)
    if ctx.dry_run:
        ctx.record_write("tradingview_events", source_path, event_id, data)
        return
    if row["feed_id"] and not market_feed_exists(ctx, row["feed_id"]):
        row["feed_id"] = None
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO tradingview_events (
              event_id, feed_id, symbol_code, timeframe, timestamp_utc, received_at,
              alert_id, status, payload, raw
            ) VALUES (
              %(event_id)s, %(feed_id)s, %(symbol_code)s, %(timeframe)s, %(timestamp_utc)s, %(received_at)s,
              %(alert_id)s, %(status)s, %(payload)s, %(raw)s
            )
            ON CONFLICT(event_id) DO UPDATE
            SET
              feed_id = EXCLUDED.feed_id,
              symbol_code = EXCLUDED.symbol_code,
              timeframe = EXCLUDED.timeframe,
              timestamp_utc = EXCLUDED.timestamp_utc,
              received_at = EXCLUDED.received_at,
              alert_id = EXCLUDED.alert_id,
              status = EXCLUDED.status,
              payload = EXCLUDED.payload,
              raw = EXCLUDED.raw,
              updated_at = now()
            """,
            {**row, "payload": Jsonb(row["payload"]), "raw": Jsonb(row["raw"])},
        )
    ctx.record_write("tradingview_events", source_path, event_id, data)
    update_checkpoint(ctx, "tradingview_webhook_events", "tradingview_events", event_id)


def market_feed_row(feed_id: str, data: dict[str, Any]) -> dict[str, Any]:
    parts = feed_id_parts(feed_id)
    provider = normalize_provider(data.get("provider") or parts.get("provider") or "tradingview")
    environment = normalize_environment(data.get("environment") or parts.get("environment") or "prod")
    symbol_code = canonical_symbol(data.get("symbol") or data.get("symbol_code") or parts.get("symbol") or feed_id)
    timeframe = canonical_timeframe(data.get("timeframe") or parts.get("timeframe") or "5")
    instrument_code = instrument_from_symbol(data.get("instrument") or symbol_code)
    symbol_id = symbol_id_for(provider, symbol_code)
    return {
        "feed_id": feed_id,
        "symbol_id": symbol_id,
        "instrument_code": instrument_code,
        "timeframe": timeframe,
        "environment": environment,
        "provider": provider,
        "source_service": data.get("source_service"),
        "timezone": data.get("timezone") or "Europe/Paris",
        "enabled": bool(data.get("enabled", True)),
        "latest_timestamp_utc": timestamp_value(data.get("latest_timestamp_utc") or data.get("timestamp_utc")),
        "latest_candle_path": data.get("latest_candle_path"),
        "status": data.get("status"),
        "metadata": compact_metadata(data, exclude={"latest_candle_path"}),
        "raw": data,
        "symbol_code": symbol_code,
    }


def market_candle_row(feed_id: str, document_id: str, data: dict[str, Any]) -> dict[str, Any]:
    feed = market_feed_row(feed_id, data)
    timestamp = timestamp_value(
        data.get("timestamp_utc")
        or data.get("time_utc")
        or data.get("timestamp")
        or data.get("time")
        or timestamp_from_document_id(document_id)
    )
    if not timestamp:
        raise ValueError("missing_or_invalid_timestamp_utc")
    open_ = number_value(data.get("open") or nested_value(data, "price", "open") or nested_value(data, "price", "o"))
    high = number_value(data.get("high") or nested_value(data, "price", "high") or nested_value(data, "price", "h"))
    low = number_value(data.get("low") or nested_value(data, "price", "low") or nested_value(data, "price", "l"))
    close = number_value(data.get("close") or nested_value(data, "price", "close") or nested_value(data, "price", "c"))
    if any(value is None for value in (open_, high, low, close)):
        raise ValueError("missing_ohlc")
    return {
        "feed_id": feed_id,
        "timestamp_utc": timestamp,
        "symbol_code": feed["symbol_code"],
        "timeframe": feed["timeframe"],
        "trading_date": data.get("trading_date") or data.get("trading_date_paris") or str(data.get("timestamp_paris") or "")[:10] or None,
        "timestamp_paris": data.get("timestamp_paris"),
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": number_value(data.get("volume") or nested_value(data, "price", "volume") or nested_value(data, "price", "v")),
        "is_closed": bool(data.get("is_closed", str(data.get("bar_status", "closed")).lower() in {"closed", "confirmed"})),
        "indicators": object_value(data.get("indicators")),
        "studies": object_value(data.get("studies") or data.get("values")),
        "raw": data,
        "source_collection": f"market_feeds/{feed_id}/candles",
        "source_document_id": document_id,
    }


def market_feed_status_row(status_id: str, data: dict[str, Any]) -> dict[str, Any]:
    feed_id = data.get("feed_id") or status_id
    feed = market_feed_row(feed_id, data)
    return {
        "status_id": status_id,
        "feed_id": feed_id,
        "symbol_code": feed["symbol_code"],
        "timeframe": feed["timeframe"],
        "timestamp_utc": timestamp_value(data.get("timestamp_utc") or data.get("latest_timestamp_utc")),
        "status": data.get("status"),
        "latest_bar_age_seconds": integer_value(data.get("latest_bar_age_seconds")),
        "payload": object_value(data.get("payload")),
        "raw": data,
    }


def tradingview_event_row(event_id: str, data: dict[str, Any]) -> dict[str, Any]:
    feed_id = data.get("feed_id")
    if not feed_id:
        symbol = canonical_symbol(data.get("symbol") or data.get("symbol_code") or "")
        timeframe = canonical_timeframe(data.get("timeframe") or "5")
        feed_id = f"prod__tradingview__{symbol}__{timeframe}" if symbol else None
    return {
        "event_id": data.get("event_id") or event_id,
        "feed_id": feed_id,
        "symbol_code": canonical_symbol(data.get("symbol") or data.get("symbol_code") or ""),
        "timeframe": canonical_timeframe(data.get("timeframe") or ""),
        "timestamp_utc": timestamp_value(data.get("timestamp_utc")),
        "received_at": timestamp_value(data.get("received_at_utc") or data.get("received_at")),
        "alert_id": data.get("alert_id"),
        "status": data.get("status"),
        "payload": object_value(data.get("payload")),
        "raw": data,
    }


def ensure_market_symbol(ctx: MigrationContext, instrument_code: str, provider: str, symbol_code: str) -> None:
    ensure_instrument(ctx, instrument_code)
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO market_symbols (
              symbol_id, instrument_code, provider, symbol_code, provider_type, primary_for_instrument, active, metadata
            ) VALUES (%s, %s, %s, %s, %s, false, true, %s)
            ON CONFLICT(provider, symbol_code) DO UPDATE
            SET instrument_code = EXCLUDED.instrument_code,
                active = true,
                updated_at = now()
            """,
            (symbol_id_for(provider, symbol_code), instrument_code, provider, symbol_code, provider_type(symbol_code), Jsonb({"source": "firestore_import"})),
        )


def ensure_instrument(ctx: MigrationContext, instrument_code: str) -> None:
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO market_instruments (instrument_code, display_name, asset_class, active, metadata)
            VALUES (%s, %s, %s, true, %s)
            ON CONFLICT(instrument_code) DO NOTHING
            """,
            (
                instrument_code,
                instrument_code,
                KNOWN_ASSET_CLASSES.get(instrument_code, "unknown"),
                Jsonb({"source": "firestore_import_auto_seed"}),
            ),
        )


def ensure_timeframe(ctx: MigrationContext, timeframe: str) -> None:
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO market_timeframes (timeframe, seconds, group_name, intraday, active, metadata)
            VALUES (%s, %s, %s, %s, true, %s)
            ON CONFLICT(timeframe) DO NOTHING
            """,
            (
                timeframe,
                timeframe_seconds(timeframe),
                timeframe_group(timeframe),
                timeframe_group(timeframe) in {"intraday", "higher_timeframe"},
                Jsonb({"source": "firestore_import_auto_seed"}),
            ),
        )


def quarantine(ctx: MigrationContext, source_collection: str, document_id: str, target_table: str, reason: str, data: dict[str, Any]) -> None:
    ctx.counters[target_table].quarantined += 1
    if len(ctx.quarantine_samples) < int(ctx.options.get("sample_limit", 3)):
        ctx.quarantine_samples.append({
            "source_collection": source_collection,
            "document_id": document_id,
            "target_table": target_table,
            "reason": reason,
            "keys": sorted(data.keys())[:30],
        })
    if ctx.dry_run:
        return
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO desk_document_quarantine (
              source_collection, source_document_id, target_table, severity, reason, data, import_id
            ) VALUES (%s, %s, %s, 'warning', %s, %s, %s)
            ON CONFLICT(source_collection, source_document_id, reason) DO UPDATE
            SET data = EXCLUDED.data,
                import_id = EXCLUDED.import_id,
                quarantined_at = now()
            """,
            (source_collection, document_id, target_table, reason, Jsonb(data), ctx.import_id),
        )


def start_import_run(ctx: MigrationContext) -> None:
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO desk_import_runs (
              import_id, source_project, source_kind, mode, status,
              requested_collections, excluded_collections, options
            ) VALUES (%s, %s, 'firestore', %s, 'running', %s, %s, %s)
            ON CONFLICT(import_id) DO UPDATE
            SET status = 'running',
                options = EXCLUDED.options
            """,
            (
                ctx.import_id,
                ctx.project_id,
                "import",
                Jsonb(ctx.requested_collections),
                Jsonb(ctx.excluded_collections),
                Jsonb(ctx.options),
            ),
        )


def finish_import_run(ctx: MigrationContext, status: str, *, report: dict[str, Any], error: str | None = None) -> None:
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            UPDATE desk_import_runs
            SET status = %s,
                completed_at = now(),
                report = %s,
                error = %s
            WHERE import_id = %s
            """,
            (status, Jsonb(report), error, ctx.import_id),
        )


def update_checkpoint(ctx: MigrationContext, source_collection: str, target_table: str, document_id: str) -> None:
    if ctx.dry_run:
        return
    counter = ctx.checkpoint_counters[(source_collection, target_table)]
    counter.written += 1
    with ctx.conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO desk_import_checkpoints (
              import_id, source_collection, target_table, last_document_id,
              imported_count, skipped_count, error_count, metadata
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(import_id, source_collection, target_table) DO UPDATE
            SET last_document_id = EXCLUDED.last_document_id,
                imported_count = EXCLUDED.imported_count,
                skipped_count = EXCLUDED.skipped_count,
                error_count = EXCLUDED.error_count,
                updated_at = now(),
                metadata = EXCLUDED.metadata
            """,
            (
                ctx.import_id,
                source_collection,
                target_table,
                document_id,
                counter.written,
                counter.skipped,
                counter.errors,
                Jsonb({"latest_document_id": document_id}),
            ),
        )
    if ctx.pipeline is not None:
        ctx.pipeline_documents_since_sync += 1
        sync_every = int(ctx.options.get("pipeline_sync_every") or 250)
        if ctx.pipeline_documents_since_sync >= sync_every:
            ctx.pipeline.sync()
            ctx.pipeline_documents_since_sync = 0


def assert_schema_ready(conn: Any) -> None:
    required = [
        "desk_documents",
        "market_instruments",
        "market_symbols",
        "market_timeframes",
        "market_feeds",
        "market_candles",
        "market_feed_status",
        "tradingview_events",
        "desk_import_runs",
        "desk_document_quarantine",
        "trade_decisions",
        "trades",
    ]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY(%s)
            """,
            (required,),
        )
        found = {row[0] for row in cur.fetchall()}
    missing = sorted(set(required) - found)
    if missing:
        raise RuntimeError(f"postgres_schema_missing:{','.join(missing)}")


def build_firestore_client(*, project_id: str | None, auth: str) -> Any:
    if auth not in {"auto", "adc", "firebase-cli", "firebase-cli-rest"}:
        raise ValueError(f"unsupported_firestore_auth:{auth}")
    if auth == "firebase-cli-rest":
        credentials = firebase_cli_credentials()
        if project_id and hasattr(credentials, "with_quota_project"):
            credentials = credentials.with_quota_project(project_id)
        client = (
            firestore.Client(project=project_id, credentials=credentials)
            if project_id
            else firestore.Client(credentials=credentials)
        )
        client._desk_rest_session = AuthorizedSession(credentials)
        return client
    if auth in {"auto", "adc"}:
        try:
            return firestore.Client(project=project_id) if project_id else firestore.Client()
        except Exception:
            if auth == "adc":
                raise
    credentials = firebase_cli_credentials()
    return firestore.Client(project=project_id, credentials=credentials) if project_id or credentials else firestore.Client()


def firebase_cli_credentials() -> Any:
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        raise RuntimeError("npx_not_found_for_firebase_cli_auth")
    completed = subprocess.run(
        [npx, "firebase-tools", "login:list", "--json"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    data = json.loads(completed.stdout)
    result = data.get("result") if isinstance(data, dict) else None
    if not result:
        raise RuntimeError("firebase_cli_login_not_found")
    token_info = (result[0] or {}).get("tokens") or {}
    token = token_info.get("access_token")
    if not token:
        raise RuntimeError("firebase_cli_access_token_not_found")
    refresh_token = token_info.get("refresh_token")
    client_id, client_secret = firebase_cli_oauth_client()
    scopes = str(token_info.get("scope") or "").split() or None
    expiry = firebase_cli_expiry(token_info.get("expires_at"))
    if refresh_token and client_id and client_secret:
        return Credentials(
            token=token,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=scopes,
            expiry=expiry,
        )
    return Credentials(token=token, scopes=scopes)


def firebase_cli_expiry(raw: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(float(raw) / 1000, tz=timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError, OSError):
        return None


def firebase_cli_oauth_client() -> tuple[str | None, str | None]:
    env_client_id = os.getenv("FIREBASE_CLIENT_ID")
    env_client_secret = os.getenv("FIREBASE_CLIENT_SECRET")
    if env_client_id and env_client_secret:
        return env_client_id, env_client_secret
    for api_js in firebase_tools_api_js_candidates():
        try:
            text = api_js.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        client_id = regex_default(text, "FIREBASE_CLIENT_ID")
        client_secret = regex_default(text, "FIREBASE_CLIENT_SECRET")
        if client_id and client_secret:
            return client_id, client_secret
    return None, None


def firebase_tools_api_js_candidates() -> list[Path]:
    roots = [
        Path(os.getenv("APPDATA", "")) / "npm" / "node_modules" / "firebase-tools" / "lib" / "api.js",
        Path(os.getenv("LOCALAPPDATA", "")) / "npm-cache" / "_npx",
    ]
    candidates: list[Path] = []
    for root in roots:
        if root.is_file():
            candidates.append(root)
            continue
        if not root.is_dir():
            continue
        try:
            candidates.extend(root.glob("*/node_modules/firebase-tools/lib/api.js"))
        except OSError:
            continue
    return candidates


def regex_default(text: str, env_name: str) -> str | None:
    match = re.search(rf'envOverride\("{re.escape(env_name)}",\s*"([^"]+)"\)', text)
    return match.group(1) if match else None


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value.tzinfo else value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return {"_bytes_base64": base64.b64encode(value).decode("ascii")}
    if hasattr(value, "path"):
        return {"_firestore_ref": value.path}
    return value


def json_default(value: Any) -> Any:
    return json_safe(value)


def feed_id_parts(feed_id: str) -> dict[str, str]:
    parts = str(feed_id or "").split("__")
    if len(parts) >= 4:
        return {
            "environment": parts[0],
            "provider": parts[1],
            "symbol": parts[2],
            "timeframe": parts[3],
        }
    if len(parts) >= 3:
        return {
            "provider": parts[0],
            "symbol": parts[1],
            "timeframe": parts[2],
        }
    return {}


def normalize_provider(value: Any) -> str:
    text = str(value or "unknown").strip().lower()
    return text if text in KNOWN_PROVIDER_VALUES else "unknown"


def normalize_environment(value: Any) -> str:
    text = str(value or "preprod").strip().lower()
    return text if text in KNOWN_ENV_VALUES else "preprod"


def canonical_symbol(value: Any) -> str:
    text = str(value or "").strip().upper()
    return text.split(":")[-1] if ":" in text else text


def canonical_timeframe(value: Any) -> str:
    text = str(value or "").strip().upper()
    mapping = {
        "M1": "1",
        "1M": "1",
        "1": "1",
        "M5": "5",
        "5M": "5",
        "5": "5",
        "M15": "15",
        "15M": "15",
        "15": "15",
        "M30": "30",
        "30M": "30",
        "30": "30",
        "H1": "1H",
        "1H": "1H",
        "60": "1H",
        "H4": "4H",
        "4H": "4H",
        "240": "4H",
        "D": "1D",
        "D1": "1D",
        "1D": "1D",
    }
    return mapping.get(text, text or "5")


def timeframe_seconds(timeframe: str) -> int:
    mapping = {"1": 60, "5": 300, "15": 900, "30": 1800, "1H": 3600, "4H": 14400, "1D": 86400}
    return mapping.get(timeframe, 300)


def timeframe_group(timeframe: str) -> str:
    if timeframe in {"1", "5", "15", "30"}:
        return "intraday"
    if timeframe in {"1H", "4H"}:
        return "higher_timeframe"
    if timeframe == "1D":
        return "daily"
    return "unknown"


def instrument_from_symbol(value: Any) -> str:
    symbol = canonical_symbol(value).replace(" ", "")
    symbol = symbol.replace("1!", "")
    symbol = symbol.rstrip("!")
    if symbol == "MCL":
        return "CL"
    return symbol or "UNKNOWN"


def symbol_id_for(provider: str, symbol_code: str) -> str:
    return f"{provider}:{symbol_code}"


def provider_type(symbol_code: str) -> str:
    if symbol_code.endswith("1!"):
        return "continuous_future"
    if symbol_code in {"DXY", "VIX", "US10Y", "US02Y", "DAX"}:
        return "index"
    if symbol_code in {"QQQ", "SMH", "SOXX"}:
        return "etf"
    return "equity" if symbol_code else "unknown"


def timestamp_value(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        parsed = datetime_from_string(value)
        return parsed
    if isinstance(value, (int, float)):
        try:
            numeric = float(value)
            seconds = numeric / 1000 if numeric > 10_000_000_000 else numeric
            return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        except Exception:
            return None
    return str(value)


def datetime_from_string(value: str) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if re.fullmatch(r"\d+", text):
        return timestamp_value(int(text))
    try:
        normalized = text.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return text if "T" in text else None


def timestamp_from_document_id(document_id: str) -> str | None:
    text = str(document_id or "")
    match = re.match(r"^(\d{8})T?(\d{6})Z?$", text)
    if match:
        day, clock = match.groups()
        return f"{day[0:4]}-{day[4:6]}-{day[6:8]}T{clock[0:2]}:{clock[2:4]}:{clock[4:6]}Z"
    return None


def doc_id_from_utc(value: str | None) -> str | None:
    if not value:
        return None
    timestamp = timestamp_value(value)
    if not timestamp:
        return None
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    return parsed.strftime("%Y%m%dT%H%M%SZ")


def number_value(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result else None


def integer_value(value: Any) -> int | None:
    parsed = number_value(value)
    return int(parsed) if parsed is not None else None


def object_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def nested_value(data: dict[str, Any], *path: str) -> Any:
    value: Any = data
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def compact_metadata(data: dict[str, Any], *, exclude: set[str] | None = None) -> dict[str, Any]:
    exclude = exclude or set()
    metadata = object_value(data.get("metadata")).copy()
    for key in ["schema_version", "timeframe_group", "source", "source_service"]:
        if key in data and key not in exclude:
            metadata[key] = data[key]
    return metadata


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        raise SystemExit(130)
