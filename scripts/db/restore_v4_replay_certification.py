#!/usr/bin/env python3
"""Restore certified Autopilot V4 history markers in PostgreSQL.

The generic Firestore bootstrap intentionally copies raw source documents. If
it runs after the dedicated V4 history importer it can therefore replace the
history/certification annotations added by that importer. This command rebuilds
those annotations from the committed V4 import reports without deleting or
replacing business payloads.
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
from psycopg.types.json import Jsonb


ROOT = Path(__file__).resolve().parents[2]
REPORT_PATHS = (
    ROOT / "docs/AUTOPILOT_V4_REPLAY_HISTORY_IMPORT_2026-07-20.json",
    ROOT / "docs/AUTOPILOT_V4_REPLAY_HISTORY_IMPORT_2026-07-22_JUNE_03_05.json",
    ROOT / "docs/AUTOPILOT_V4_REPLAY_HISTORY_IMPORT_2026-07-24_JUNE_08_09.json",
    ROOT / "docs/AUTOPILOT_V4_REPLAY_HISTORY_IMPORT_2026-07-25_JUNE_10.json",
)
RELATED_COLLECTIONS = (
    "desk_replay_runs",
    "desk_replay_steps",
    "desk_replay_bundles",
    "desk_replay_master_analyses",
    "desk_replay_monitors",
    "desk_replay_active_theses",
    "desk_replay_setups",
    "desk_replay_positions",
    "desk_replay_trade_simulations",
    "desk_replay_context_transmissions",
    "desk_replay_timeline",
    "desk_replay_audit_logs",
    "desk_agent_work_items",
    "desk_agent_work_events",
)
MASTER_CONTRACT_ID = "DeskMasterAnalysisContract_v4_0_0"
MASTER_SCHEMA_VERSION = "4.0.0"
REPLAY_SCHEMA_VERSION = "2.0.0"


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore V4 replay history certification markers.")
    parser.add_argument("--mode", choices=("dry-run", "apply"), default="dry-run")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if not args.database_url:
        raise SystemExit("DATABASE_URL or --database-url is required.")

    evidence = load_certification_evidence()
    run_ids = sorted(evidence)
    restored_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    with psycopg.connect(args.database_url, row_factory=dict_row) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("restore_v4_replay_certification",))
            documents = fetch_documents(conn, run_ids)
            validate_runs(documents, evidence)
            coverage = build_coverage(documents, evidence)
            changes = restore_markers(
                conn,
                documents,
                evidence,
                restored_at=restored_at,
                apply=args.mode == "apply",
            )
            verification = verify_markers(conn, run_ids) if args.mode == "apply" else preview_verification(documents)

    report = {
        "ok": verification["unmarked"] == 0 if args.mode == "apply" else True,
        "mode": args.mode,
        "generated_at_utc": restored_at,
        "strategy_version": "autopilot_v4",
        "autopilot_version": "4.0.0",
        "certified_run_ids": run_ids,
        "certification_reports": [str(path) for path in REPORT_PATHS],
        "coverage": coverage,
        "changes": changes,
        "verification": verification,
        "notes": [
            "No document is inserted or deleted by this command.",
            "Business payloads are preserved; only V4 history/certification annotations and terminal run controls are merged.",
            "Coverage gaps remain pending until the final Firestore tail import restores the missing related documents.",
        ],
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


def load_certification_evidence() -> dict[str, dict[str, Any]]:
    evidence: dict[str, dict[str, Any]] = {}
    for path in REPORT_PATHS:
        report = json.loads(path.read_text(encoding="utf-8"))
        if report.get("ok") is not True or report.get("mode") != "import":
            raise RuntimeError(f"invalid_v4_import_report:{path}")
        if report.get("strategy_version") != "autopilot_v4":
            raise RuntimeError(f"invalid_v4_strategy_report:{path}")
        for run_id in report.get("run_ids") or []:
            validation = (report.get("validations") or {}).get(run_id) or {}
            if validation.get("terminal") is not True or validation.get("anti_lookahead_compliant") is not True:
                raise RuntimeError(f"uncertified_v4_run:{run_id}:{path}")
            evidence[run_id] = {
                "report": path.name,
                "import_id": report.get("import_id"),
                "source_project": report.get("source_project") or "tv-automation-23d50",
                "validation": validation,
                "expected_collections": (report.get("collections") or {}).get(run_id) or {},
            }
    if not evidence:
        raise RuntimeError("no_v4_certification_evidence")
    return evidence


def fetch_documents(conn: Any, run_ids: list[str]) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              collection,
              document_id,
              CASE
                WHEN collection = 'desk_replay_runs' THEN document_id
                ELSE data->>'backtest_id'
              END AS run_id,
              jsonb_build_object(
                'backtest_id', data->'backtest_id',
                'status', data->'status',
                'replay_schema_version', data->'replay_schema_version',
                'cadence', data->'cadence',
                'monitor_cadence', data->'monitor_cadence',
                'pinned_contracts', data->'pinned_contracts',
                'strategy_version', data->'strategy_version',
                'autopilot_version', data->'autopilot_version',
                'data_origin', data->'data_origin',
                'operational_visibility', data->'operational_visibility',
                'research_visibility', data->'research_visibility',
                'read_only', data->'read_only',
                'v4_history_eligible', data->'v4_history_eligible',
                'history_source_project', data->'history_source_project',
                'history_source_collection', data->'history_source_collection',
                'history_import_id', data->'history_import_id',
                'history_certification_report', data->'history_certification_report',
                'history_original_automation_status', data->'history_original_automation_status',
                'automation_enabled', data->'automation_enabled',
                'automation_status', data->'automation_status',
                'next_action', data->'next_action',
                'lease_owner', data->'lease_owner',
                'lease_expires_at', data->'lease_expires_at'
              ) AS data
            FROM desk_documents
            WHERE (
              collection = 'desk_replay_runs'
              AND document_id = ANY(%s)
            ) OR (
              collection = ANY(%s)
              AND data->>'backtest_id' = ANY(%s)
            )
            ORDER BY collection, document_id
            """,
            (run_ids, list(RELATED_COLLECTIONS), run_ids),
        )
        return list(cur.fetchall())


def validate_runs(documents: list[dict[str, Any]], evidence: dict[str, dict[str, Any]]) -> None:
    runs = {
        row["document_id"]: row["data"]
        for row in documents
        if row["collection"] == "desk_replay_runs"
    }
    missing = sorted(set(evidence) - set(runs))
    if missing:
        raise RuntimeError(f"certified_v4_runs_missing:{','.join(missing)}")
    for run_id, run in runs.items():
        master = ((run.get("pinned_contracts") or {}).get("master_contract") or {})
        cadence = str(run.get("cadence") or run.get("monitor_cadence") or "").lower()
        if run.get("backtest_id") != run_id:
            raise RuntimeError(f"certified_v4_identity_mismatch:{run_id}")
        if str(run.get("status") or "").upper() != "COMPLETED":
            raise RuntimeError(f"certified_v4_run_not_completed:{run_id}:{run.get('status')}")
        if run.get("replay_schema_version") != REPLAY_SCHEMA_VERSION:
            raise RuntimeError(f"certified_v4_replay_schema_mismatch:{run_id}")
        if cadence != "15m":
            raise RuntimeError(f"certified_v4_cadence_mismatch:{run_id}:{cadence}")
        if (
            master.get("contract_id") != MASTER_CONTRACT_ID
            or master.get("schema_version") != MASTER_SCHEMA_VERSION
        ):
            raise RuntimeError(f"certified_v4_master_contract_mismatch:{run_id}")


def build_coverage(
    documents: list[dict[str, Any]],
    evidence: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    actual: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in documents:
        run_id = row["run_id"]
        if run_id in evidence:
            actual[run_id][row["collection"]] += 1

    per_run: dict[str, Any] = {}
    missing_total = 0
    for run_id, item in evidence.items():
        expected = {key: int(value) for key, value in item["expected_collections"].items()}
        observed = {collection: int(actual[run_id].get(collection, 0)) for collection in expected}
        missing = {
            collection: max(0, expected_count - observed.get(collection, 0))
            for collection, expected_count in expected.items()
            if expected_count > observed.get(collection, 0)
        }
        missing_total += sum(missing.values())
        per_run[run_id] = {
            "expected": expected,
            "observed": observed,
            "missing": missing,
            "complete": not missing,
        }
    return {
        "runs": per_run,
        "expected_documents": sum(
            sum(int(value) for value in item["expected_collections"].values())
            for item in evidence.values()
        ),
        "observed_documents": len(documents),
        "missing_documents": missing_total,
        "complete": missing_total == 0,
    }


def restore_markers(
    conn: Any,
    documents: list[dict[str, Any]],
    evidence: dict[str, dict[str, Any]],
    *,
    restored_at: str,
    apply: bool,
) -> dict[str, Any]:
    by_collection: dict[str, int] = defaultdict(int)
    changed_rows: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in documents:
        collection = row["collection"]
        run_id = row["run_id"]
        if run_id not in evidence:
            continue
        markers = certification_markers(
            evidence[run_id],
            collection,
            current=row["data"],
            restored_at=restored_at,
        )
        comparison_markers = {
            key: value
            for key, value in markers.items()
            if key != "history_marker_restored_at_utc"
        }
        if all(row["data"].get(key) == value for key, value in comparison_markers.items()):
            continue
        changed_rows[(run_id, collection)].append(row)
        by_collection[collection] += 1

    if apply:
        for (run_id, collection), rows in changed_rows.items():
            markers = certification_markers(
                evidence[run_id],
                collection,
                current=rows[0]["data"],
                restored_at=restored_at,
            )
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE desk_documents
                    SET data = data || %s,
                        updated_at = now()
                    WHERE collection = %s
                      AND document_id = ANY(%s)
                    """,
                    (Jsonb(markers), collection, [row["document_id"] for row in rows]),
                )
                if cur.rowcount != len(rows):
                    raise RuntimeError(
                        f"v4_marker_update_rowcount:{run_id}:{collection}:{cur.rowcount}:{len(rows)}"
                    )
    changed = sum(len(rows) for rows in changed_rows.values())
    return {
        "documents_considered": len(documents),
        "documents_changed": changed,
        "documents_already_marked": len(documents) - changed,
        "changed_by_collection": dict(sorted(by_collection.items())),
    }


def certification_markers(
    source: dict[str, Any],
    collection: str,
    *,
    current: dict[str, Any],
    restored_at: str,
) -> dict[str, Any]:
    markers = {
        "strategy_version": "autopilot_v4",
        "autopilot_version": "4.0.0",
        "data_origin": "prod_v4_import",
        "operational_visibility": "history",
        "research_visibility": "replay_lab",
        "read_only": True,
        "v4_history_eligible": True,
        "history_source_project": source["source_project"],
        "history_source_collection": collection,
        "history_import_id": source["import_id"],
        "history_certification_report": source["report"],
        "history_marker_restored_at_utc": restored_at,
    }
    if collection == "desk_replay_runs":
        markers.update(
            {
                "history_original_automation_status": current.get(
                    "history_original_automation_status",
                    current.get("automation_status"),
                ),
                "automation_enabled": False,
                "automation_status": "completed",
                "next_action": "TERMINAL",
                "lease_owner": None,
                "lease_expires_at": None,
            }
        )
    return markers


def verify_markers(conn: Any, run_ids: list[str]) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              count(*)::int AS total,
              count(*) FILTER (
                WHERE data->>'strategy_version' = 'autopilot_v4'
                  AND data->>'autopilot_version' = '4.0.0'
                  AND data->>'data_origin' = 'prod_v4_import'
                  AND data->>'operational_visibility' = 'history'
                  AND data->>'research_visibility' = 'replay_lab'
                  AND data->>'read_only' = 'true'
                  AND data->>'v4_history_eligible' = 'true'
              )::int AS marked
            FROM desk_documents
            WHERE (
              collection = 'desk_replay_runs'
              AND document_id = ANY(%s)
            ) OR (
              collection = ANY(%s)
              AND data->>'backtest_id' = ANY(%s)
            )
            """,
            (run_ids, list(RELATED_COLLECTIONS), run_ids),
        )
        result = cur.fetchone()
    total = int(result["total"])
    marked = int(result["marked"])
    return {"total": total, "marked": marked, "unmarked": total - marked}


def preview_verification(documents: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "total": len(documents),
        "marked": None,
        "unmarked": None,
        "note": "Dry-run only; verification is executed after --mode apply.",
    }


if __name__ == "__main__":
    raise SystemExit(main())
