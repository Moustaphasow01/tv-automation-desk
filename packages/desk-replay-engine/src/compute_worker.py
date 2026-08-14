#!/usr/bin/env python3
"""Contractual Python compute worker for canonical simulation jobs.

Python owns orchestration concerns only: validation, idempotency, subprocess
execution, timings, and error envelopes. Strategy semantics stay in Node.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JOB_SCHEMA = "simulation_compute_job_v1"
RESULT_SCHEMA = "simulation_compute_result_v1"
WORKER_VERSION = "1.0.0"


def main() -> int:
    args = parse_args()
    started = now()
    try:
        job = read_json(args.input)
        validate_job(job)
        job_hash = sha256(job)
        resumed = previous_result(args.output, job_hash)
        if resumed is not None:
            emit({**resumed, "resumed": True}, args.output)
            return 0
        cli = call_node_worker(job, args.node)
        result = success_envelope(job, job_hash, cli, started)
        emit(result, args.output)
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI boundary converts every failure to contract JSON.
        emit(failure_envelope(exc, started), args.output)
        return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a contractual Simulation Compute job.")
    parser.add_argument("--input", help="JSON job file. Defaults to stdin.")
    parser.add_argument("--output", help="Optional JSON result file for idempotent resume.")
    parser.add_argument("--node", default="node", help="Node.js executable.")
    return parser.parse_args()


def read_json(path: str | None) -> dict[str, Any]:
    content = Path(path).read_text(encoding="utf8") if path else sys.stdin.read()
    value = json.loads(content)
    if not isinstance(value, dict):
        raise ValueError("JOB_OBJECT_REQUIRED")
    return value


def validate_job(job: dict[str, Any]) -> None:
    required = ["schema_version", "job_id", "idempotency_key", "task_type", "payload"]
    missing = [field for field in required if not job.get(field)]
    if missing:
        raise ValueError(f"JOB_REQUIRED_FIELDS_MISSING:{','.join(missing)}")
    if job["schema_version"] != JOB_SCHEMA:
        raise ValueError("JOB_SCHEMA_UNSUPPORTED")
    if job["task_type"] != "CANONICAL_SIMULATION":
        raise ValueError("JOB_TASK_UNSUPPORTED")
    if not isinstance(job["payload"], dict):
        raise ValueError("JOB_PAYLOAD_OBJECT_REQUIRED")


def previous_result(output: str | None, job_hash: str) -> dict[str, Any] | None:
    if not output:
        return None
    path = Path(output)
    if not path.exists():
        return None
    previous = json.loads(path.read_text(encoding="utf8"))
    if previous.get("job_hash") != job_hash:
        raise ValueError("IDEMPOTENCY_CONFLICT")
    return previous


def call_node_worker(job: dict[str, Any], node: str) -> dict[str, Any]:
    script = Path(__file__).resolve().parents[1] / "bin" / "run-canonical-simulation-cli.mjs"
    process = subprocess.run(
        [node, str(script)],
        input=json.dumps({"payload": job["payload"], "metadata": job.get("metadata", {})}),
        text=True,
        capture_output=True,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(f"NODE_WORKER_FAILED:{process.stderr.strip() or process.stdout.strip()}")
    return json.loads(process.stdout)


def success_envelope(job: dict[str, Any], job_hash: str, cli: dict[str, Any], started: str) -> dict[str, Any]:
    completed = now()
    registration = cli.get("registration") or {}
    run = registration.get("run") or {}
    return {
        "schema_version": RESULT_SCHEMA,
        "worker_version": WORKER_VERSION,
        "job_id": job["job_id"],
        "idempotency_key": job["idempotency_key"],
        "job_hash": job_hash,
        "status": "COMPLETED" if registration.get("ok") else "FAILED",
        "started_at_utc": started,
        "completed_at_utc": completed,
        "duration_ms": elapsed_ms(started, completed),
        "task_type": job["task_type"],
        "simulation_run_id": run.get("simulation_run_id"),
        "result_hash": run.get("result_hash"),
        "metrics_hash": run.get("metrics_hash"),
        "result": cli.get("result"),
        "simulation_run": run,
        "artifacts": registration.get("artifacts", []),
        "reasons": registration.get("reasons", []),
        "observability": {"input_bytes": len(json.dumps(job)), "artifact_count": len(registration.get("artifacts", []))},
        "resumed": False,
    }


def failure_envelope(exc: Exception, started: str) -> dict[str, Any]:
    completed = now()
    return {
        "schema_version": RESULT_SCHEMA,
        "worker_version": WORKER_VERSION,
        "job_id": None,
        "idempotency_key": None,
        "job_hash": None,
        "status": "FAILED",
        "started_at_utc": started,
        "completed_at_utc": completed,
        "duration_ms": elapsed_ms(started, completed),
        "error": {"code": error_code(exc), "message": str(exc)},
        "resumed": False,
    }


def emit(result: dict[str, Any], output: str | None) -> None:
    payload = json.dumps(result, sort_keys=True)
    if output:
        Path(output).write_text(f"{payload}\n", encoding="utf8")
    sys.stdout.write(f"{payload}\n")


def sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def elapsed_ms(started: str, completed: str) -> int:
    start = datetime.fromisoformat(started.replace("Z", "+00:00"))
    end = datetime.fromisoformat(completed.replace("Z", "+00:00"))
    return max(0, round((end - start).total_seconds() * 1000))


def error_code(exc: Exception) -> str:
    text = str(exc)
    return text.split(":", 1)[0] if text else exc.__class__.__name__


if __name__ == "__main__":
    raise SystemExit(main())
