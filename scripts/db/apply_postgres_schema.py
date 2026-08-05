#!/usr/bin/env python3
"""Apply local PostgreSQL schema files to an existing PREPROD database.

Docker runs infra/postgres/init/*.sql only when the volume is first created.
This helper applies the same idempotent SQL files to an already-running local DB.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCHEMA_DIR = ROOT / "infra" / "postgres" / "init"
DEFAULT_DATABASE_URL = "postgresql://desk:desk_local_only@localhost:5432/desk"


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply PREPROD PostgreSQL schema files.")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--schema-dir", default=str(DEFAULT_SCHEMA_DIR))
    parser.add_argument("--file", action="append", dest="files", help="Specific SQL file to apply. Can be repeated.")
    parser.add_argument("--dry-run", action="store_true", help="Print files that would be applied without executing them.")
    args = parser.parse_args()

    schema_dir = Path(args.schema_dir).resolve()
    files = [Path(item).resolve() for item in args.files] if args.files else sorted(schema_dir.glob("*.sql"))
    if not files:
      print(f"No SQL files found in {schema_dir}", file=sys.stderr)
      return 2

    for path in files:
      if not path.exists():
        print(f"Missing SQL file: {path}", file=sys.stderr)
        return 2

    if args.dry_run:
      print("Schema files:")
      for path in files:
        print(f"- {path}")
      return 0

    with psycopg.connect(args.database_url, autocommit=True) as conn:
      with conn.cursor() as cur:
        for path in files:
          sql = path.read_text(encoding="utf-8")
          print(f"Applying {path.relative_to(ROOT)}")
          cur.execute(sql)

    print("Schema applied successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
