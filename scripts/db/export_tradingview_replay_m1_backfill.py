#!/usr/bin/env python3
"""Export one Paris trading day of authentic MNQ/MES M1 bars via Bar Replay.

This path is used when TradingView's normal rolling chart history no longer
reaches the requested day. It never places a replay trade. Bars are captured
incrementally while the replay cursor advances, validated, and written with a
SHA-256 manifest for the transactional PostgreSQL importer.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import math
import sys
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


UTC = timezone.utc


class _EuropeParisFallback(tzinfo):
    """IANA-compatible CET/CEST fallback for Windows without the tzdata wheel.

    The replay exporter only opens full-day windows away from the DST switch
    hour. Keeping this fallback in-process makes the acquisition verifier
    reproducible on a clean Windows VPS while retaining `ZoneInfo` whenever
    the operating system or Python package provides it.
    """

    def utcoffset(self, value: datetime | None) -> timedelta:
        return timedelta(hours=1) + self.dst(value)

    def dst(self, value: datetime | None) -> timedelta:
        if value is None:
            return timedelta(0)
        local = value.replace(tzinfo=None)
        start = datetime.combine(
            _last_sunday(value.year, 3),
            time(hour=2),
        )
        end = datetime.combine(
            _last_sunday(value.year, 10),
            time(hour=3),
        )
        return timedelta(hours=1) if start <= local < end else timedelta(0)

    def tzname(self, value: datetime | None) -> str:
        return "CEST" if self.dst(value) else "CET"


def _last_sunday(year: int, month: int) -> date:
    following_month = date(year + (month == 12), (month % 12) + 1, 1)
    last_day = following_month - timedelta(days=1)
    return last_day - timedelta(days=(last_day.weekday() + 1) % 7)


try:
    PARIS = ZoneInfo("Europe/Paris")
except ZoneInfoNotFoundError:
    PARIS = _EuropeParisFallback()
SYMBOLS = {
    "MNQ1!": "CME_MINI:MNQ1!",
    "MES1!": "CME_MINI:MES1!",
}
CSV_FIELDS = (
    "timestamp_utc",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "is_closed",
)
CANONICAL_SCHEMA_VERSION = "tradingview-m1-backfill-manifest-v2"
CAPTURE_POLICY_VERSION = "settled_closed_bar_v2"
BAR_SECONDS = 60
SETTLEMENT_GRACE_SECONDS = 60
CAPTURE_PROOF_FILENAME = "tradingview_m1_capture_proof.jsonl"
EXPECTED_ROWS_PER_SYMBOL = 1_320
CANONICAL_FILENAMES = {
    "MNQ1!": "mnq1_m1.csv",
    "MES1!": "mes1_m1.csv",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trading-date", required=True, help="Paris trading date (YYYY-MM-DD).")
    parser.add_argument(
        "--tradingview-project",
        default="/mnt/c/Users/CES/Desktop/TV_Automation",
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--symbols",
        default="MNQ1!,MES1!",
        help="Comma-separated subset of MNQ1!,MES1!.",
    )
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    parser.add_argument("--timeout-seconds", type=int, default=1_800)
    parser.add_argument(
        "--convert-combined-csv",
        help="Convert an existing sealed legacy combined CSV without connecting to TradingView.",
    )
    parser.add_argument(
        "--acquisition-manifest",
        help="Optional legacy acquisition manifest copied into the separate acquisition report.",
    )
    return parser.parse_args()


def mcp_payload(response: dict[str, Any]) -> Any:
    result = response.get("result")
    if isinstance(result, dict) and result.get("success") is True and "result" in result:
        return result["result"]
    return result


def settled_capture_end_epoch(current_epoch: int, end_epoch: int) -> int:
    """Return the exclusive minute boundary whose preceding bars are settled."""
    if current_epoch < BAR_SECONDS + SETTLEMENT_GRACE_SECONDS:
        return 0
    settled_epoch = current_epoch - SETTLEMENT_GRACE_SECONDS
    return min(end_epoch, (settled_epoch // BAR_SECONDS) * BAR_SECONDS)


def merge_settled_bars(
    captured: dict[int, dict[str, Any]],
    rows: list[dict[str, Any]],
    *,
    captured_at_cursor_epoch: int,
    start_epoch: int,
    settled_end_epoch: int,
) -> None:
    for source in rows:
        timestamp = int(source["time"])
        if timestamp < start_epoch or timestamp >= settled_end_epoch:
            continue
        bar_close_epoch = timestamp + BAR_SECONDS
        settlement_lag_seconds = captured_at_cursor_epoch - bar_close_epoch
        if settlement_lag_seconds < SETTLEMENT_GRACE_SECONDS:
            raise RuntimeError(
                "premature_bar_capture:"
                f"{timestamp}:{captured_at_cursor_epoch}:{settlement_lag_seconds}"
            )
        captured[timestamp] = {
            **source,
            "_bar_close_epoch": bar_close_epoch,
            "_captured_at_cursor_epoch": captured_at_cursor_epoch,
            "_settlement_lag_seconds": settlement_lag_seconds,
        }


def contiguous_capture_cursor(
    captured: dict[int, dict[str, Any]],
    *,
    capture_from: int,
    settled_end_epoch: int,
) -> int:
    cursor = capture_from
    while cursor < settled_end_epoch and cursor in captured:
        cursor += BAR_SECONDS
    return cursor


async def capture_visible_bars(
    adapter: Any,
    *,
    start_epoch: int,
    end_epoch: int,
) -> list[dict[str, Any]]:
    expression = f"""
    (function() {{
      var model = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().model();
      var bars = model.mainSeries().bars();
      var result = [];
      var firstIndex = bars.firstIndex();
      var lastIndex = bars.lastIndex();
      for (var i = firstIndex; i <= lastIndex; i++) {{
        var value = bars.valueAt(i);
        if (!value || value[0] < {start_epoch} || value[0] >= {end_epoch}) continue;
        result.push({{
          time: value[0],
          open: value[1],
          high: value[2],
          low: value[3],
          close: value[4],
          volume: value[5] || 0
        }});
      }}
      return result;
    }})()
    """
    response = await adapter.call_tool("ui_evaluate", {"expression": expression})
    if not response.get("ok"):
        raise RuntimeError(f"ohlcv_replay_extract_failed:{response.get('error')}")
    payload = mcp_payload(response)
    if not isinstance(payload, list):
        raise RuntimeError("ohlcv_replay_extract_invalid_payload")
    return [row for row in payload if isinstance(row, dict)]


async def replay_symbol(
    adapter: Any,
    *,
    symbol: str,
    provider_symbol: str,
    start: datetime,
    end: datetime,
    poll_seconds: float,
    timeout_seconds: int,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    await require_ok(adapter, "chart_set_symbol", {"symbol": provider_symbol})
    await asyncio.sleep(1)
    await require_ok(adapter, "chart_set_timeframe", {"timeframe": "1"})
    await asyncio.sleep(1)
    await require_ok(adapter, "replay_start", {"date": start.isoformat().replace("+00:00", "Z")})
    await require_ok(adapter, "replay_autoplay", {"speed": 0})

    start_epoch = int(start.timestamp())
    end_epoch = int(end.timestamp())
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    captured: dict[int, dict[str, Any]] = {}
    capture_from = start_epoch
    final_status: dict[str, Any] = {}

    try:
        while True:
            if asyncio.get_running_loop().time() >= deadline:
                raise RuntimeError(f"bar_replay_timeout:{symbol}")
            await asyncio.sleep(max(0.25, poll_seconds))
            status_response = await adapter.call_tool("replay_status", {})
            if not status_response.get("ok"):
                raise RuntimeError(f"replay_status_failed:{symbol}:{status_response.get('error')}")
            final_status = mcp_payload(status_response) or {}
            current_epoch = int(final_status.get("current_date") or 0)
            settled_to = max(
                capture_from,
                settled_capture_end_epoch(current_epoch, end_epoch),
            )
            if settled_to > capture_from:
                rows = await capture_visible_bars(
                    adapter,
                    start_epoch=capture_from,
                    end_epoch=settled_to,
                )
                merge_settled_bars(
                    captured,
                    rows,
                    captured_at_cursor_epoch=current_epoch,
                    start_epoch=capture_from,
                    settled_end_epoch=settled_to,
                )
                capture_from = contiguous_capture_cursor(
                    captured,
                    capture_from=capture_from,
                    settled_end_epoch=settled_to,
                )
            if capture_from >= end_epoch and settled_to >= end_epoch:
                break
        if final_status.get("is_autoplay_started"):
            await require_ok(adapter, "replay_autoplay", {"speed": 0})
        await asyncio.sleep(max(0.25, poll_seconds))
        terminal_status_response = await adapter.call_tool("replay_status", {})
        if not terminal_status_response.get("ok"):
            raise RuntimeError(
                f"replay_terminal_status_failed:{symbol}:"
                f"{terminal_status_response.get('error')}"
            )
        final_status = mcp_payload(terminal_status_response) or final_status
        terminal_cursor_epoch = int(final_status.get("current_date") or 0)
        if settled_capture_end_epoch(terminal_cursor_epoch, end_epoch) < end_epoch:
            raise RuntimeError(f"replay_terminal_window_unsettled:{symbol}")
        rows = await capture_visible_bars(
            adapter,
            start_epoch=max(start_epoch, end_epoch - 10 * BAR_SECONDS),
            end_epoch=end_epoch,
        )
        merge_settled_bars(
            captured,
            rows,
            captured_at_cursor_epoch=terminal_cursor_epoch,
            start_epoch=max(start_epoch, end_epoch - 10 * BAR_SECONDS),
            settled_end_epoch=end_epoch,
        )
    finally:
        await adapter.call_tool("replay_stop", {})

    normalized, validation, capture_proofs = normalize_and_validate(
        symbol=symbol,
        provider_symbol=provider_symbol,
        bars=list(captured.values()),
        start=start,
        end=end,
    )
    validation["replay_cursor_end_utc"] = datetime.fromtimestamp(
        int(final_status.get("current_date") or 0),
        tz=UTC,
    ).isoformat().replace("+00:00", "Z")
    return normalized, validation, capture_proofs


async def require_ok(adapter: Any, name: str, arguments: dict[str, Any]) -> Any:
    response = await adapter.call_tool(name, arguments)
    if not response.get("ok"):
        raise RuntimeError(f"{name}_failed:{response.get('error')}")
    return mcp_payload(response)


def normalize_and_validate(
    *,
    symbol: str,
    provider_symbol: str,
    bars: list[dict[str, Any]],
    start: datetime,
    end: datetime,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    normalized: list[dict[str, Any]] = []
    capture_proofs: list[dict[str, Any]] = []
    errors: list[str] = []
    timestamps: set[int] = set()
    premature_capture_count = 0

    for raw in bars:
        try:
            timestamp = int(raw["time"])
            values = {name: float(raw[name]) for name in ("open", "high", "low", "close")}
            volume = float(raw.get("volume") or 0)
            bar_close_epoch = int(raw["_bar_close_epoch"])
            captured_at_cursor_epoch = int(raw["_captured_at_cursor_epoch"])
            settlement_lag_seconds = int(raw["_settlement_lag_seconds"])
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"invalid_row:{exc}")
            continue
        instant = datetime.fromtimestamp(timestamp, tz=UTC)
        if not start <= instant < end:
            errors.append(f"timestamp_outside_window:{timestamp}")
            continue
        if timestamp in timestamps:
            errors.append(f"duplicate_timestamp:{timestamp}")
            continue
        timestamps.add(timestamp)
        if timestamp % 60 != 0:
            errors.append(f"timestamp_not_minute_aligned:{timestamp}")
        if any(not math.isfinite(value) or value <= 0 for value in values.values()):
            errors.append(f"invalid_price:{timestamp}")
        if values["high"] < max(values["open"], values["close"], values["low"]):
            errors.append(f"invalid_high:{timestamp}")
        if values["low"] > min(values["open"], values["close"], values["high"]):
            errors.append(f"invalid_low:{timestamp}")
        if not math.isfinite(volume) or volume < 0:
            errors.append(f"invalid_volume:{timestamp}")
        expected_bar_close_epoch = timestamp + BAR_SECONDS
        expected_settlement_lag_seconds = captured_at_cursor_epoch - expected_bar_close_epoch
        if bar_close_epoch != expected_bar_close_epoch:
            errors.append(f"invalid_bar_close_proof:{timestamp}:{bar_close_epoch}")
        if settlement_lag_seconds != expected_settlement_lag_seconds:
            errors.append(
                f"invalid_settlement_lag_proof:{timestamp}:{settlement_lag_seconds}:"
                f"{expected_settlement_lag_seconds}"
            )
        if expected_settlement_lag_seconds < SETTLEMENT_GRACE_SECONDS:
            premature_capture_count += 1
            errors.append(
                f"premature_bar_capture:{timestamp}:{captured_at_cursor_epoch}:"
                f"{expected_settlement_lag_seconds}"
            )

        paris = instant.astimezone(PARIS)
        normalized.append({
            "timestamp_utc": instant.isoformat().replace("+00:00", "Z"),
            "open": format(values["open"], ".12g"),
            "high": format(values["high"], ".12g"),
            "low": format(values["low"], ".12g"),
            "close": format(values["close"], ".12g"),
            "volume": format(volume, ".12g"),
            "is_closed": "true",
        })

        capture_proofs.append({
            "symbol": symbol,
            "timestamp_utc": instant.isoformat().replace("+00:00", "Z"),
            "bar_close_utc": datetime.fromtimestamp(bar_close_epoch, tz=UTC).isoformat().replace("+00:00", "Z"),
            "captured_at_cursor_utc": datetime.fromtimestamp(captured_at_cursor_epoch, tz=UTC).isoformat().replace("+00:00", "Z"),
            "settlement_lag_seconds": settlement_lag_seconds,
        })

    normalized.sort(key=lambda row: row["timestamp_utc"])
    capture_proofs.sort(key=lambda row: (row["symbol"], row["timestamp_utc"]))
    ordered_timestamps = sorted(timestamps)
    gaps = [
        right - left
        for left, right in zip(ordered_timestamps, ordered_timestamps[1:])
        if right - left != 60
    ]
    expected_count = int((end - start).total_seconds() // 60)
    if expected_count != EXPECTED_ROWS_PER_SYMBOL or len(normalized) != expected_count:
        errors.append(f"exact_bar_count_required:{len(normalized)}:{expected_count}")
    expected_timestamps = {int(start.timestamp()) + index * 60 for index in range(expected_count)}
    missing_timestamps = sorted(expected_timestamps - timestamps)
    extra_timestamps = sorted(timestamps - expected_timestamps)
    if missing_timestamps:
        errors.append(f"missing_minute_grid:{len(missing_timestamps)}:{missing_timestamps[0]}")
    if extra_timestamps:
        errors.append(f"extra_minute_grid:{len(extra_timestamps)}:{extra_timestamps[0]}")
    if gaps:
        errors.append(f"non_contiguous_grid:{gaps[0]}")
    if len(capture_proofs) != expected_count:
        errors.append(f"capture_proof_count_invalid:{len(capture_proofs)}:{expected_count}")
    if errors:
        raise RuntimeError(f"validation_failed:{symbol}:{'|'.join(errors[:30])}")

    minimum_settlement_lag_seconds = min(
        (item["settlement_lag_seconds"] for item in capture_proofs),
        default=0,
    )
    return normalized, {
        "bar_count": len(normalized),
        "first_timestamp_utc": normalized[0]["timestamp_utc"],
        "last_timestamp_utc": normalized[-1]["timestamp_utc"],
        "gap_count": len(gaps),
        "max_gap_seconds": max(gaps, default=60),
        "exact_expected_count": expected_count,
        "exact_minute_grid": True,
        "duplicate_timestamps": 0,
        "ohlcv_valid": True,
        "volume_valid": True,
        "capture_policy_version": CAPTURE_POLICY_VERSION,
        "all_bars_closed_proven": True,
        "premature_capture_count": premature_capture_count,
        "proofed_bar_count": len(capture_proofs),
        "minimum_settlement_lag_seconds": minimum_settlement_lag_seconds,
    }, capture_proofs


def write_canonical_envelope(
    *,
    output_dir: Path,
    trading_date: date,
    rows_by_symbol: dict[str, list[dict[str, Any]]],
    acquisition_report: dict[str, Any],
    capture_proofs: list[dict[str, Any]],
) -> dict[str, Any]:
    expected_symbols = set(SYMBOLS)
    if set(rows_by_symbol) != expected_symbols:
        raise RuntimeError(f"canonical_symbol_set_invalid:{sorted(rows_by_symbol)}")
    expected_proof_keys = {
        (symbol, row["timestamp_utc"])
        for symbol, rows in rows_by_symbol.items()
        for row in rows
    }
    proof_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for proof in capture_proofs:
        key = (str(proof.get("symbol") or ""), str(proof.get("timestamp_utc") or ""))
        if key in proof_by_key:
            raise RuntimeError(f"capture_proof_duplicate:{key[0]}:{key[1]}")
        timestamp = datetime.fromisoformat(key[1].replace("Z", "+00:00"))
        bar_close = datetime.fromisoformat(
            str(proof.get("bar_close_utc") or "").replace("Z", "+00:00")
        )
        captured_at = datetime.fromisoformat(
            str(proof.get("captured_at_cursor_utc") or "").replace("Z", "+00:00")
        )
        expected_close = timestamp + timedelta(seconds=BAR_SECONDS)
        settlement_lag_seconds = int((captured_at - expected_close).total_seconds())
        if bar_close != expected_close:
            raise RuntimeError(f"capture_proof_bar_close_invalid:{key[0]}:{key[1]}")
        proof_lag = proof.get("settlement_lag_seconds")
        if proof_lag is None or int(proof_lag) != settlement_lag_seconds:
            raise RuntimeError(f"capture_proof_lag_invalid:{key[0]}:{key[1]}")
        if settlement_lag_seconds < SETTLEMENT_GRACE_SECONDS:
            raise RuntimeError(f"capture_proof_premature:{key[0]}:{key[1]}")
        proof_by_key[key] = proof
    if set(proof_by_key) != expected_proof_keys:
        raise RuntimeError(
            f"capture_proof_coverage_invalid:{len(proof_by_key)}:{len(expected_proof_keys)}"
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    ordered_proofs = [proof_by_key[key] for key in sorted(proof_by_key)]
    proof_bytes = "".join(
        json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for item in ordered_proofs
    ).encode("utf-8")
    capture_proof_path = output_dir / CAPTURE_PROOF_FILENAME
    capture_proof_path.write_bytes(proof_bytes)
    minimum_settlement_lag_seconds = min(
        item["settlement_lag_seconds"] for item in ordered_proofs
    )
    capture_proof_descriptor = {
        "path": CAPTURE_PROOF_FILENAME,
        "sha256": hashlib.sha256(proof_bytes).hexdigest(),
        "row_count": len(ordered_proofs),
        "policy_version": CAPTURE_POLICY_VERSION,
        "minimum_settlement_lag_seconds": minimum_settlement_lag_seconds,
        "premature_capture_count": 0,
    }

    files: list[dict[str, Any]] = []
    for symbol in SYMBOLS:
        rows = rows_by_symbol[symbol]
        if len(rows) != EXPECTED_ROWS_PER_SYMBOL:
            raise RuntimeError(f"canonical_row_count_invalid:{symbol}:{len(rows)}")
        csv_path = output_dir / CANONICAL_FILENAMES[symbol]
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=CSV_FIELDS,
                extrasaction="raise",
                lineterminator="\n",
            )
            writer.writeheader()
            writer.writerows(rows)
        files.append({
            "path": csv_path.name,
            "symbol": symbol,
            "timeframe": "1",
            "sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
            "row_count": len(rows),
        })

    start_paris = datetime.combine(trading_date, time.min, tzinfo=PARIS)
    end_paris = datetime.combine(trading_date, time(hour=22), tzinfo=PARIS)
    manifest = {
        "schema_version": CANONICAL_SCHEMA_VERSION,
        "source": "tradingview",
        "environment": "prod",
        "timezone": "Europe/Paris",
        "window": {
            "start_paris": start_paris.isoformat(),
            "end_paris": end_paris.isoformat(),
            "semantics": "[start,end)",
        },
        "files": files,
        "capture_proof": capture_proof_descriptor,
    }
    manifest_path = output_dir / "tradingview_m1_backfill_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    acquisition_report["capture_proof"] = capture_proof_descriptor
    acquisition_path = output_dir / "tradingview_replay_m1_acquisition_report.json"
    acquisition_path.write_text(
        json.dumps(acquisition_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "status": "ok",
        "feed_count": len(files),
        "row_count": sum(item["row_count"] for item in files),
        "manifest": str(manifest_path),
        "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "files": files,
        "acquisition_report": str(acquisition_path),
    }


def load_proven_legacy_acquisition(
    args: argparse.Namespace,
    source_path: Path,
) -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    if not args.acquisition_manifest:
        raise RuntimeError("legacy_acquisition_settlement_proof_required")
    manifest_path = Path(args.acquisition_manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        manifest.get("schema_version") != "tradingview-bar-replay-m1-backfill-v2"
        or manifest.get("capture_policy_version") != CAPTURE_POLICY_VERSION
    ):
        raise RuntimeError("legacy_acquisition_settlement_policy_unproven")
    actual_csv_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if manifest.get("csv_sha256") != actual_csv_hash:
        raise RuntimeError("legacy_combined_csv_sha256_mismatch")
    if int(manifest.get("row_count") or 0) != len(SYMBOLS) * EXPECTED_ROWS_PER_SYMBOL:
        raise RuntimeError("legacy_acquisition_row_count_invalid")
    validation = manifest.get("validation") or {}
    if (
        validation.get("all_bars_closed_proven") is not True
        or int(validation.get("premature_capture_count", -1)) != 0
        or int(validation.get("proofed_bar_count") or 0)
        != len(SYMBOLS) * EXPECTED_ROWS_PER_SYMBOL
        or int(validation.get("minimum_settlement_lag_seconds") or 0)
        < SETTLEMENT_GRACE_SECONDS
    ):
        raise RuntimeError("legacy_acquisition_settlement_proof_invalid")
    descriptor = manifest.get("capture_proof") or {}
    proof_name = str(descriptor.get("path") or "")
    proof_path = (manifest_path.parent / proof_name).resolve()
    if proof_name != Path(proof_name).name or proof_path.parent != manifest_path.parent:
        raise RuntimeError("legacy_capture_proof_path_unsafe")
    proof_bytes = proof_path.read_bytes()
    if hashlib.sha256(proof_bytes).hexdigest() != descriptor.get("sha256"):
        raise RuntimeError("legacy_capture_proof_sha256_mismatch")
    if (
        descriptor.get("policy_version") != CAPTURE_POLICY_VERSION
        or int(descriptor.get("row_count") or 0)
        != len(SYMBOLS) * EXPECTED_ROWS_PER_SYMBOL
        or int(descriptor.get("premature_capture_count", -1)) != 0
        or int(descriptor.get("minimum_settlement_lag_seconds") or 0)
        < SETTLEMENT_GRACE_SECONDS
    ):
        raise RuntimeError("legacy_capture_proof_descriptor_invalid")
    proofs: dict[tuple[str, str], dict[str, Any]] = {}
    proof_keys = {
        "symbol",
        "timestamp_utc",
        "bar_close_utc",
        "captured_at_cursor_utc",
        "settlement_lag_seconds",
    }
    for line_number, line in enumerate(proof_bytes.decode("utf-8").splitlines(), start=1):
        proof = json.loads(line)
        if set(proof) != proof_keys:
            raise RuntimeError(f"legacy_capture_proof_schema_invalid:{line_number}")
        proof_instant = datetime.fromisoformat(
            str(proof["timestamp_utc"]).replace("Z", "+00:00")
        ).astimezone(UTC)
        canonical_timestamp = proof_instant.isoformat().replace("+00:00", "Z")
        key = (str(proof["symbol"]), canonical_timestamp)
        if key in proofs:
            raise RuntimeError(f"legacy_capture_proof_duplicate:{key[0]}:{key[1]}")
        proofs[key] = proof
    if len(proofs) != len(SYMBOLS) * EXPECTED_ROWS_PER_SYMBOL:
        raise RuntimeError(f"legacy_capture_proof_count_invalid:{len(proofs)}")
    minimum_lag = min(int(item["settlement_lag_seconds"]) for item in proofs.values())
    if minimum_lag != int(descriptor["minimum_settlement_lag_seconds"]):
        raise RuntimeError("legacy_capture_proof_minimum_lag_mismatch")
    return manifest, proofs


def convert_combined_csv(args: argparse.Namespace) -> dict[str, Any]:
    trading_date = date.fromisoformat(args.trading_date)
    start = datetime.combine(trading_date, time.min, tzinfo=PARIS).astimezone(UTC)
    end = datetime.combine(trading_date, time(hour=22), tzinfo=PARIS).astimezone(UTC)
    source_path = Path(args.convert_combined_csv).resolve()
    legacy_manifest, proof_by_key = load_proven_legacy_acquisition(
        args,
        source_path,
    )
    rows_by_symbol: dict[str, list[dict[str, Any]]] = {symbol: [] for symbol in SYMBOLS}
    with source_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            "symbol_code", "timeframe", "timestamp_utc", "open", "high", "low", "close", "volume", "is_closed",
        }
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise RuntimeError("legacy_combined_csv_schema_invalid")
        for raw in reader:
            symbol = str(raw.get("symbol_code") or "")
            if symbol not in SYMBOLS:
                raise RuntimeError(f"legacy_combined_csv_symbol_invalid:{symbol}")
            if raw.get("timeframe") != "1" or str(raw.get("is_closed") or "").lower() != "true":
                raise RuntimeError(f"legacy_combined_csv_scope_invalid:{symbol}")
            instant = datetime.fromisoformat(str(raw["timestamp_utc"]).replace("Z", "+00:00"))
            bars = {
                "time": int(instant.timestamp()),
                "open": raw["open"],
                "high": raw["high"],
                "low": raw["low"],
                "close": raw["close"],
                "volume": raw.get("volume") or 0,
            }
            proof_key = (symbol, instant.isoformat().replace("+00:00", "Z"))
            proof = proof_by_key.get(proof_key)
            if not proof:
                raise RuntimeError(
                    f"legacy_capture_proof_missing:{symbol}:{raw['timestamp_utc']}"
                )
            bars["_bar_close_epoch"] = int(datetime.fromisoformat(
                proof["bar_close_utc"].replace("Z", "+00:00")
            ).timestamp())
            bars["_captured_at_cursor_epoch"] = int(datetime.fromisoformat(
                proof["captured_at_cursor_utc"].replace("Z", "+00:00")
            ).timestamp())
            bars["_settlement_lag_seconds"] = int(proof["settlement_lag_seconds"])
            rows_by_symbol[symbol].append(bars)

    validations: list[dict[str, Any]] = []
    canonical_rows: dict[str, list[dict[str, Any]]] = {}
    capture_proofs: list[dict[str, Any]] = []
    for symbol in SYMBOLS:
        rows, validation, proofs = normalize_and_validate(
            symbol=symbol,
            provider_symbol=SYMBOLS[symbol],
            bars=rows_by_symbol[symbol],
            start=start,
            end=end,
        )
        canonical_rows[symbol] = rows
        capture_proofs.extend(proofs)
        validations.append({
            "feed_id": f"prod__tradingview__{symbol}__1",
            "symbol_code": symbol,
            "provider_symbol": SYMBOLS[symbol],
            "timeframe": "1",
            "validation": validation,
        })

    acquisition_report = {
        "schema_version": "tradingview-m1-backfill-acquisition-report-v2",
        "source_mode": "legacy_combined_csv_conversion",
        "capture_policy_version": CAPTURE_POLICY_VERSION,
        "source_csv_file": source_path.name,
        "source_csv_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "source_manifest_file": Path(args.acquisition_manifest).name,
        "trading_date_paris": trading_date.isoformat(),
        "feed_count": len(validations),
        "row_count": sum(item["validation"]["bar_count"] for item in validations),
        "feeds": validations,
        "legacy_acquisition": legacy_manifest,
        "validation": {
            "status": "passed",
            "exact_1320_rows_per_feed": True,
            "exact_minute_grid": True,
            "all_bars_closed_proven": True,
            "premature_capture_count": 0,
            "proofed_bar_count": len(capture_proofs),
            "minimum_settlement_lag_seconds": min(
                item["settlement_lag_seconds"] for item in capture_proofs
            ),
            "no_replay_trades": True,
        },
    }
    return write_canonical_envelope(
        output_dir=Path(args.output_dir).resolve(),
        trading_date=trading_date,
        rows_by_symbol=canonical_rows,
        acquisition_report=acquisition_report,
        capture_proofs=capture_proofs,
    )


async def export(args: argparse.Namespace) -> dict[str, Any]:
    trading_date = date.fromisoformat(args.trading_date)
    start = datetime.combine(trading_date, time.min, tzinfo=PARIS).astimezone(UTC)
    end = datetime.combine(trading_date, time(hour=22), tzinfo=PARIS).astimezone(UTC)
    selected = [value.strip().upper() for value in args.symbols.split(",") if value.strip()]
    if set(selected) != set(SYMBOLS):
        raise ValueError("canonical export requires exactly MNQ1!,MES1!")

    sys.path.insert(0, str(Path(args.tradingview_project).resolve()))
    from scanner.live_data.mcp_live_data_probe import load_config  # type: ignore
    from scanner.mcp_adapter import MCPTradingViewAdapter  # type: ignore

    adapter = MCPTradingViewAdapter(load_config())
    rows_by_symbol: dict[str, list[dict[str, Any]]] = {}
    reports: list[dict[str, Any]] = []
    capture_proofs: list[dict[str, Any]] = []
    started_at = datetime.now(UTC)
    try:
        connection = await adapter.connect()
        if not connection.get("ok"):
            raise RuntimeError(f"mcp_connect_failed:{connection.get('error')}")
        for symbol in SYMBOLS:
            print(f"[replay] {symbol} {start.isoformat()}..{end.isoformat()}", flush=True)
            feed_rows, validation, proofs = await replay_symbol(
                adapter,
                symbol=symbol,
                provider_symbol=SYMBOLS[symbol],
                start=start,
                end=end,
                poll_seconds=args.poll_seconds,
                timeout_seconds=args.timeout_seconds,
            )
            rows_by_symbol[symbol] = feed_rows
            capture_proofs.extend(proofs)
            reports.append({
                "feed_id": f"prod__tradingview__{symbol}__1",
                "symbol_code": symbol,
                "provider_symbol": SYMBOLS[symbol],
                "timeframe": "1",
                "validation": validation,
            })
            print(f"[ok] {symbol} M1 bars={validation['bar_count']}", flush=True)
    finally:
        await adapter.disconnect()

    generated_at = datetime.now(UTC)
    acquisition_report = {
        "schema_version": "tradingview-m1-backfill-acquisition-report-v2",
        "source_mode": "tradingview_desktop_local_mcp_bar_replay",
        "capture_policy_version": CAPTURE_POLICY_VERSION,
        "trading_date_paris": trading_date.isoformat(),
        "window_utc": {
            "from_timestamp_utc": start.isoformat().replace("+00:00", "Z"),
            "to_timestamp_exclusive_utc": end.isoformat().replace("+00:00", "Z"),
        },
        "generated_at_utc": generated_at.isoformat().replace("+00:00", "Z"),
        "duration_seconds": round((generated_at - started_at).total_seconds(), 3),
        "feed_count": len(reports),
        "row_count": sum(report["validation"]["bar_count"] for report in reports),
        "feeds": reports,
        "validation": {
            "status": "passed",
            "exact_1320_rows_per_feed": True,
            "exact_minute_grid": True,
            "all_bars_closed_proven": True,
            "premature_capture_count": 0,
            "proofed_bar_count": len(capture_proofs),
            "minimum_settlement_lag_seconds": min(
                item["settlement_lag_seconds"] for item in capture_proofs
            ),
            "no_replay_trades": True,
        },
    }
    return write_canonical_envelope(
        output_dir=Path(args.output_dir).resolve(),
        trading_date=trading_date,
        rows_by_symbol=rows_by_symbol,
        acquisition_report=acquisition_report,
        capture_proofs=capture_proofs,
    )


def main() -> int:
    args = parse_args()
    try:
        result = convert_combined_csv(args) if args.convert_combined_csv else asyncio.run(export(args))
    except Exception as exc:
        print(f"REPLAY_M1_BACKFILL_EXPORT_FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
