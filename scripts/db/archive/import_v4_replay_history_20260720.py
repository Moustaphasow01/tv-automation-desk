#!/usr/bin/env python3
"""Import selected, completed Autopilot V4 replay histories into PREPROD.

This is a scoped migration utility, not a runtime dependency. It reads the
authoritative PROD Firestore documents, verifies that each requested replay is
terminal and anti-lookahead compliant, then replaces only the matching replay
documents in the local PostgreSQL ``desk_documents`` table.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from firestore_to_postgres import (
    DEFAULT_DATABASE_URL,
    DEFAULT_PROJECT_ID,
    STREAM_RETRY,
    build_firestore_client,
    json_default,
    json_safe,
)


V4_MASTER_CONTRACT_ID = "DeskMasterAnalysisContract_v4_0_0"
V4_MASTER_SCHEMA_VERSION = "4.0.0"
V4_REPLAY_SCHEMA_VERSION = "2.0.0"
V4_STRATEGY_VERSION = "autopilot_v4"

RELATED_COLLECTIONS = (
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Import completed Autopilot V4 replay history into PREPROD PostgreSQL.")
    parser.add_argument("--mode", choices=("dry-run", "import"), default="dry-run")
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--auth", choices=("auto", "adc", "firebase-cli"), default="auto")
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--run-id", action="append", required=True, dest="run_ids")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    imported_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    import_id = f"v4_replay_history_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    client = build_firestore_client(project_id=args.project_id, auth=args.auth)
    selected: dict[str, dict[str, dict[str, Any]]] = {}
    validations: dict[str, Any] = {}

    for run_id in unique(args.run_ids):
        run_snapshot = client.collection("desk_replay_runs").document(run_id).get()
        if not run_snapshot.exists:
            raise RuntimeError(f"replay_run_not_found:{run_id}")
        run = json_safe(run_snapshot.to_dict() or {})
        validate_v4_run(run_id, run)

        documents: dict[str, dict[str, Any]] = {
            "desk_replay_runs": {
                run_snapshot.id: history_document(
                    run,
                    collection="desk_replay_runs",
                    project_id=args.project_id,
                    import_id=import_id,
                    imported_at=imported_at,
                    terminal_run=True,
                )
            }
        }
        for collection in RELATED_COLLECTIONS:
            documents[collection] = {}
            query = client.collection(collection).where("backtest_id", "==", run_id)
            stream_args: dict[str, Any] = {"timeout": 300}
            if STREAM_RETRY:
                stream_args["retry"] = STREAM_RETRY
            for snapshot in query.stream(**stream_args):
                documents[collection][snapshot.id] = history_document(
                    json_safe(snapshot.to_dict() or {}),
                    collection=collection,
                    project_id=args.project_id,
                    import_id=import_id,
                    imported_at=imported_at,
                )

        validations[run_id] = validate_replay_documents(run_id, documents)
        selected[run_id] = documents

    report = {
        "ok": True,
        "mode": args.mode,
        "import_id": import_id,
        "source_project": args.project_id,
        "strategy_version": V4_STRATEGY_VERSION,
        "run_ids": list(selected),
        "validations": validations,
        "collections": collection_counts(selected),
        "deleted": {},
        "upserted": {},
    }

    if args.mode == "import":
        import_documents(
            args.database_url,
            import_id=import_id,
            project_id=args.project_id,
            selected=selected,
            report=report,
        )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=json_default) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, default=json_default))
    return 0


def validate_v4_run(run_id: str, run: dict[str, Any]) -> None:
    if run.get("backtest_id") != run_id:
        raise RuntimeError(f"replay_run_identity_mismatch:{run_id}")
    if str(run.get("status") or "").upper() != "COMPLETED":
        raise RuntimeError(f"replay_run_not_completed:{run_id}:{run.get('status')}")
    if run.get("replay_schema_version") != V4_REPLAY_SCHEMA_VERSION:
        raise RuntimeError(f"replay_schema_not_v4:{run_id}:{run.get('replay_schema_version')}")
    if str(run.get("cadence") or run.get("monitor_cadence") or "").lower() != "15m":
        raise RuntimeError(f"replay_cadence_not_15m:{run_id}")
    master_contract = (run.get("pinned_contracts") or {}).get("master_contract") or {}
    if (
        master_contract.get("contract_id") != V4_MASTER_CONTRACT_ID
        or master_contract.get("schema_version") != V4_MASTER_SCHEMA_VERSION
    ):
        raise RuntimeError(f"replay_master_contract_not_v4:{run_id}")
    current = parse_iso(run.get("current_replay_time"))
    end = parse_iso(run.get("end_time"))
    if not current or not end or current < end:
        raise RuntimeError(f"replay_terminal_time_incomplete:{run_id}")


def validate_replay_documents(run_id: str, documents: dict[str, dict[str, Any]]) -> dict[str, Any]:
    simulations = list(documents.get("desk_replay_trade_simulations", {}).values())
    violations: list[str] = []
    for item in simulations:
        simulation_id = item.get("simulation_id") or "unknown"
        if item.get("anti_lookahead_compliant") is not True:
            violations.append(f"{simulation_id}:anti_lookahead_not_true")
        if item.get("future_prices_used") is True:
            violations.append(f"{simulation_id}:future_prices_used")
        max_price = parse_iso(item.get("max_price_timestamp_used"))
        cutoff = parse_iso(item.get("as_of_utc") or item.get("cutoff_paris"))
        if max_price and cutoff and max_price > cutoff:
            violations.append(f"{simulation_id}:price_after_cutoff")
    if violations:
        raise RuntimeError(f"replay_anti_lookahead_failed:{run_id}:{','.join(violations[:10])}")

    positions = list(documents.get("desk_replay_positions", {}).values())
    closed_positions = [item for item in positions if str(item.get("status") or "").upper() == "CLOSED"]
    return {
        "terminal": True,
        "anti_lookahead_compliant": True,
        "simulations_checked": len(simulations),
        "positions": len(positions),
        "closed_positions": len(closed_positions),
        "priced_closed_positions": sum(1 for item in closed_positions if number(item.get("exit_price")) is not None),
        "unpriced_closed_positions": sum(1 for item in closed_positions if number(item.get("exit_price")) is None),
        "setups": len(documents.get("desk_replay_setups", {})),
        "masters": len(documents.get("desk_replay_master_analyses", {})),
        "monitors": len(documents.get("desk_replay_monitors", {})),
        "steps": len(documents.get("desk_replay_steps", {})),
    }


def history_document(
    source: dict[str, Any],
    *,
    collection: str,
    project_id: str,
    import_id: str,
    imported_at: str,
    terminal_run: bool = False,
) -> dict[str, Any]:
    output = {
        **source,
        "strategy_version": V4_STRATEGY_VERSION,
        "autopilot_version": "4.0.0",
        "data_origin": "prod_v4_import",
        "operational_visibility": "history",
        "research_visibility": "replay_lab",
        "read_only": True,
        "v4_history_eligible": True,
        "history_source_project": project_id,
        "history_source_collection": collection,
        "history_import_id": import_id,
        "history_imported_at_utc": imported_at,
    }
    if terminal_run:
        output.update(
            {
                "history_original_automation_status": source.get("automation_status"),
                "automation_enabled": False,
                "automation_status": "completed",
                "next_action": "TERMINAL",
                "lease_owner": None,
                "lease_expires_at": None,
            }
        )
    return output


def import_documents(
    database_url: str,
    *,
    import_id: str,
    project_id: str,
    selected: dict[str, dict[str, dict[str, Any]]],
    report: dict[str, Any],
) -> None:
    collections = sorted({collection for groups in selected.values() for collection in groups})
    with psycopg.connect(database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO desk_import_runs (
                      import_id, source_project, source_kind, mode, status,
                      requested_collections, excluded_collections, options
                    ) VALUES (%s, %s, 'firestore', 'import', 'running', %s, '[]'::jsonb, %s)
                    """,
                    (
                        import_id,
                        project_id,
                        Jsonb(collections),
                        Jsonb(
                            {
                                "scope": "completed_autopilot_v4_replay_history",
                                "run_ids": list(selected),
                                "replace_scoped_documents": True,
                            }
                        ),
                    ),
                )
                for run_id, groups in selected.items():
                    for collection in groups:
                        cur.execute(
                            """
                            DELETE FROM desk_documents
                            WHERE collection = %s
                              AND (
                                document_id = %s
                                OR data->>'backtest_id' = %s
                                OR data->>'replay_run_id' = %s
                              )
                            """,
                            (collection, run_id, run_id, run_id),
                        )
                        report["deleted"][f"{run_id}:{collection}"] = cur.rowcount

                for run_id, groups in selected.items():
                    for collection, documents in groups.items():
                        for document_id, data in documents.items():
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
                        report["upserted"][f"{run_id}:{collection}"] = len(documents)

                cur.execute(
                    """
                    UPDATE desk_import_runs
                    SET status = 'completed',
                        completed_at = now(),
                        report = %s
                    WHERE import_id = %s
                    """,
                    (Jsonb(report), import_id),
                )


def collection_counts(selected: dict[str, dict[str, dict[str, Any]]]) -> dict[str, dict[str, int]]:
    return {
        run_id: {collection: len(documents) for collection, documents in sorted(groups.items())}
        for run_id, groups in selected.items()
    }


def parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


if __name__ == "__main__":
    raise SystemExit(main())
