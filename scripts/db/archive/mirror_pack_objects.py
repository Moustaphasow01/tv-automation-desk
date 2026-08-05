#!/usr/bin/env python3
"""Archived one-time mirror for immutable pack objects in PREPROD local storage.

Google Cloud is used only as a one-time, read-only migration source. Runtime
reads are resolved through PostgreSQL's desk_pack_objects catalogue and never
contact Google Cloud.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import psycopg


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_URL = "postgresql://desk:desk_local_only@localhost:5432/desk"
DEFAULT_OBJECT_ROOT = ROOT / ".local" / "desk_objects"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mirror immutable desk pack objects locally.")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--object-root", default=os.getenv("DESK_OBJECT_HOST_ROOT", str(DEFAULT_OBJECT_ROOT)))
    parser.add_argument("--pack-build-id", action="append", default=[])
    parser.add_argument("--trading-date", action="append", default=[])
    parser.add_argument("--all-ready", action="store_true")
    parser.add_argument("--execute", action="store_true", help="Copy and catalogue objects. Default is dry-run.")
    parser.add_argument("--gcloud", default=shutil.which("gcloud") or "gcloud")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.pack_build_id and not args.trading_date and not args.all_ready:
        print("Select --pack-build-id, --trading-date or --all-ready.", file=sys.stderr)
        return 2

    object_root = Path(args.object_root).resolve()
    with psycopg.connect(args.database_url) as conn:
        builds = select_builds(conn, args)
        refs = collect_refs(builds)
        print(json.dumps({
            "mode": "execute" if args.execute else "dry_run",
            "build_count": len(builds),
            "object_count": len(refs),
            "object_root": str(object_root),
        }, sort_keys=True))
        if not args.execute:
            for ref in refs:
                print(json.dumps(public_ref(ref), sort_keys=True))
            return 0

        object_root.mkdir(parents=True, exist_ok=True)
        completed = 0
        skipped = 0
        for ref in refs:
            status = mirror_one(conn, ref, object_root, args.gcloud)
            conn.commit()
            completed += status == "mirrored"
            skipped += status == "already_ready"
            print(json.dumps({**public_ref(ref), "status": status}, sort_keys=True))
        conn.commit()

    print(json.dumps({
        "status": "COMPLETED",
        "mirrored": completed,
        "already_ready": skipped,
        "total": len(refs),
    }, sort_keys=True))
    return 0


def select_builds(conn: psycopg.Connection, args: argparse.Namespace) -> list[dict]:
    clauses = ["collection = 'desk_pack_builds'"]
    values: list[object] = []
    selectors: list[str] = []
    if args.pack_build_id:
        values.append(args.pack_build_id)
        selectors.append("document_id = ANY(%s)")
    if args.trading_date:
        values.append(args.trading_date)
        selectors.append("data->>'trading_date' = ANY(%s)")
    if args.all_ready:
        selectors.append("(data->>'status' = 'ready' OR data->>'execution_allowed' = 'true')")
    clauses.append(f"({' OR '.join(selectors)})")
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT document_id, data FROM desk_documents WHERE {' AND '.join(clauses)} ORDER BY document_id",
            values,
        )
        return [{"document_id": row[0], "data": row[1]} for row in cur.fetchall()]


def collect_refs(builds: list[dict]) -> list[dict]:
    by_key: dict[tuple[str, str], dict] = {}
    for build in builds:
        for dataset_id, dataset in (build["data"].get("datasets") or {}).items():
            storage_path = dataset.get("storage_path") or dataset.get("object_path")
            if not str(storage_path or "").startswith("gs://"):
                continue
            generation = str(dataset.get("gcs_generation") or dataset.get("generation") or "")
            ref = {
                "pack_build_id": build["document_id"],
                "dataset_id": dataset.get("dataset") or dataset_id,
                "storage_path": storage_path,
                "generation": generation,
                "sha256": str(dataset.get("sha256") or dataset.get("checksum") or "").lower(),
                "size_bytes": int(dataset.get("size_bytes") or 0),
                "content_type": "application/json" if str(storage_path).endswith(".json") else "text/csv",
            }
            if len(ref["sha256"]) != 64 or ref["size_bytes"] < 0:
                raise RuntimeError(f"Invalid immutable manifest for {storage_path}")
            by_key[(storage_path, generation)] = ref
    return [by_key[key] for key in sorted(by_key)]


def mirror_one(conn: psycopg.Connection, ref: dict, object_root: Path, gcloud: str) -> str:
    existing = get_catalogue_object(conn, ref["storage_path"], ref["generation"])
    if existing and existing["status"] == "READY":
        local_path = safe_local_path(object_root, existing["local_relative_path"])
        if local_path.is_file() and file_sha256(local_path) == ref["sha256"] and local_path.stat().st_size == ref["size_bytes"]:
            return "already_ready"

    relative_path = mirror_relative_path(ref["storage_path"], ref["generation"])
    destination = safe_local_path(object_root, relative_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        actual_sha = file_sha256(destination)
        actual_size = destination.stat().st_size
        if actual_sha != ref["sha256"] or actual_size != ref["size_bytes"]:
            raise RuntimeError(f"Immutable destination has invalid bytes: {destination}")
        upsert_catalogue_object(conn, ref, relative_path)
        return "catalogued_existing"
    with tempfile.NamedTemporaryFile(prefix=".mirror-", dir=destination.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        command = [gcloud, "storage", "cp", "--quiet", ref["storage_path"], str(temporary)]
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"gcloud read failed for {ref['storage_path']}: {result.stderr.strip()}")
        actual_sha = file_sha256(temporary)
        actual_size = temporary.stat().st_size
        if actual_sha != ref["sha256"] or actual_size != ref["size_bytes"]:
            raise RuntimeError(
                f"Integrity mismatch for {ref['storage_path']}: "
                f"sha256={actual_sha}/{ref['sha256']} size={actual_size}/{ref['size_bytes']}"
            )
        if destination.exists():
            if file_sha256(destination) != actual_sha:
                raise RuntimeError(f"Immutable destination conflict: {destination}")
            temporary.unlink()
        else:
            temporary.replace(destination)
        upsert_catalogue_object(conn, ref, relative_path)
        return "mirrored"
    finally:
        if temporary.exists():
            temporary.unlink()


def get_catalogue_object(conn: psycopg.Connection, storage_path: str, generation: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT local_relative_path, content_sha256, size_bytes, status
               FROM desk_pack_objects
               WHERE source_storage_path = %s AND source_generation = %s""",
            (storage_path, generation),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "local_relative_path": row[0],
        "content_sha256": row[1],
        "size_bytes": row[2],
        "status": row[3],
    }


def upsert_catalogue_object(conn: psycopg.Connection, ref: dict, relative_path: str) -> None:
    object_id = hashlib.sha256(f"{ref['storage_path']}\n{ref['generation']}".encode()).hexdigest()
    metadata = json.dumps({
        "pack_build_id": ref["pack_build_id"],
        "dataset_id": ref["dataset_id"],
        "migration": "gcs_read_only_mirror",
    })
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO desk_pack_objects (
                 object_id, source_storage_path, source_generation, local_relative_path,
                 content_sha256, size_bytes, content_type, status, source_kind,
                 immutable, metadata, verified_at_utc, updated_at_utc
               ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'READY', 'GCS_MIRROR',
                         true, %s::jsonb, now(), now())
               ON CONFLICT (source_storage_path, source_generation) DO UPDATE
               SET local_relative_path = EXCLUDED.local_relative_path,
                   content_sha256 = EXCLUDED.content_sha256,
                   size_bytes = EXCLUDED.size_bytes,
                   content_type = EXCLUDED.content_type,
                   status = 'READY',
                   source_kind = 'GCS_MIRROR',
                   metadata = desk_pack_objects.metadata || EXCLUDED.metadata,
                   verified_at_utc = now(),
                   updated_at_utc = now()""",
            (
                object_id,
                ref["storage_path"],
                ref["generation"],
                relative_path,
                ref["sha256"],
                ref["size_bytes"],
                ref["content_type"],
                metadata,
            ),
        )


def mirror_relative_path(storage_path: str, generation: str) -> str:
    parsed = urlparse(storage_path)
    suffix = Path(parsed.path).suffix or ".bin"
    digest = hashlib.sha256(f"{storage_path}\n{generation}".encode()).hexdigest()
    bucket = sanitize_component(parsed.netloc)
    return f"mirror/{bucket}/{digest[:2]}/{digest}{suffix}"


def safe_local_path(root: Path, relative_path: str) -> Path:
    candidate = (root / relative_path).resolve()
    if root != candidate and root not in candidate.parents:
        raise RuntimeError(f"Object path escapes root: {relative_path}")
    return candidate


def sanitize_component(value: str) -> str:
    return "".join(char if char.isalnum() or char in "._-" else "_" for char in value) or "unknown"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def public_ref(ref: dict) -> dict:
    return {
        "pack_build_id": ref["pack_build_id"],
        "dataset_id": ref["dataset_id"],
        "storage_path": ref["storage_path"],
        "generation": ref["generation"],
        "sha256": ref["sha256"],
        "size_bytes": ref["size_bytes"],
    }


if __name__ == "__main__":
    raise SystemExit(main())
