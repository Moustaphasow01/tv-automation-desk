#!/usr/bin/env python3
"""Export a validated TradingView Desktop MCP OHLCV backfill window.

The script is deliberately read-only toward PostgreSQL. It drives the local
TradingView Desktop through the existing MCP server, loads enough chart
history, extracts one UTC day at a time, validates the bars, and writes a
single CSV plus a JSON manifest for the transactional VPS importer.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


UTC = timezone.utc
PARIS = ZoneInfo("Europe/Paris")

TRADINGVIEW_SYMBOLS = {
    "AAPL": "NASDAQ:AAPL",
    "CL1!": "NYMEX:CL1!",
    "DAX": "XETR:DAX",
    "DXY": "TVC:DXY",
    "ES1!": "CME_MINI:ES1!",
    "GC1!": "COMEX:GC1!",
    "HSI": "HSI:HSI",
    "MES1!": "CME_MINI:MES1!",
    "MNQ1!": "CME_MINI:MNQ1!",
    "MSFT": "NASDAQ:MSFT",
    "NI225": "TVC:NI225",
    "NQ1!": "CME_MINI:NQ1!",
    "NVDA": "NASDAQ:NVDA",
    "SMH": "NASDAQ:SMH",
    "SOXX": "NASDAQ:SOXX",
    "SX5E": "TVC:SX5E",
    "TSLA": "NASDAQ:TSLA",
    "US02Y": "TVC:US02Y",
    "US10Y": "TVC:US10Y",
    "VIX": "CBOE:VIX",
}

FEED_TIMEFRAMES = {
    "AAPL": ("5", "4H"),
    "CL1!": ("5", "4H"),
    "DAX": ("5", "4H"),
    "DXY": ("5", "4H"),
    "ES1!": ("5", "15", "1H", "4H"),
    "GC1!": ("5", "4H"),
    "HSI": ("5", "4H"),
    "MES1!": ("1", "5", "15", "1H", "4H"),
    "MNQ1!": ("1", "5", "15", "1H", "4H"),
    "MSFT": ("5", "4H"),
    "NI225": ("5", "4H"),
    "NQ1!": ("5", "15", "1H", "4H"),
    "NVDA": ("5", "4H"),
    "SMH": ("5", "4H"),
    "SOXX": ("5", "4H"),
    "SX5E": ("5", "4H"),
    "TSLA": ("5", "4H"),
    "US02Y": ("5", "4H"),
    "US10Y": ("5", "4H"),
    "VIX": ("5", "4H"),
}

TIMEFRAME_RESOLUTION = {"1": "1", "5": "5", "15": "15", "1H": "60", "4H": "240"}
TIMEFRAME_SECONDS = {"1": 60, "5": 300, "15": 900, "1H": 3600, "4H": 14400}
STRICT_WEEKDAY_SYMBOLS = {"MNQ1!", "MES1!", "NQ1!", "ES1!"}
CSV_FIELDS = (
    "feed_id",
    "symbol_code",
    "provider_symbol",
    "timeframe",
    "timestamp_utc",
    "timestamp_paris",
    "trading_date",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "is_closed",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-date", required=True, help="Inclusive UTC date (YYYY-MM-DD).")
    parser.add_argument("--to-date", required=True, help="Inclusive UTC date (YYYY-MM-DD).")
    parser.add_argument(
        "--tradingview-project",
        default="/mnt/c/Users/CES/Desktop/TV_Automation",
        help="Project containing scanner.mcp_adapter and TradingView MCP configuration.",
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--symbols",
        help="Optional comma-separated canonical symbols. Default: all enabled PREPROD feed symbols.",
    )
    return parser.parse_args()


def utc_bounds(from_date: date, to_date: date) -> tuple[datetime, datetime]:
    if to_date < from_date:
        raise ValueError("to-date must be on or after from-date")
    start = datetime.combine(from_date, time.min, tzinfo=UTC)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=UTC)
    return start, end


def feed_id(symbol: str, timeframe: str) -> str:
    return f"prod__tradingview__{symbol}__{timeframe}"


def mcp_payload(response: dict[str, Any]) -> Any:
    result = response.get("result")
    if isinstance(result, dict) and result.get("success") is True and "result" in result:
        return result["result"]
    return result


async def chart_stats(adapter: Any) -> dict[str, Any]:
    expression = """
    (function() {
      var model = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().model();
      var series = model.mainSeries();
      var bars = series.bars();
      var firstIndex = bars.firstIndex();
      var lastIndex = bars.lastIndex();
      var first = Number.isFinite(firstIndex) ? bars.valueAt(firstIndex) : null;
      var last = Number.isFinite(lastIndex) ? bars.valueAt(lastIndex) : null;
      return {
        size: bars.size(),
        first_index: firstIndex,
        last_index: lastIndex,
        first_time: first ? first[0] : null,
        last_time: last ? last[0] : null,
        loading: series.isLoading(),
        request_more_available: series.requestMoreDataAvailable(),
        end_of_data: series.endOfData()
      };
    })()
    """
    response = await adapter.call_tool("ui_evaluate", {"expression": expression})
    if not response.get("ok"):
        raise RuntimeError(f"chart_stats_failed:{response.get('error')}")
    payload = mcp_payload(response)
    if not isinstance(payload, dict):
        raise RuntimeError("chart_stats_invalid_payload")
    return payload


async def load_history(adapter: Any, from_epoch: int, timeframe: str) -> dict[str, Any]:
    seconds = TIMEFRAME_SECONDS[timeframe]
    previous_size = -1
    attempts: list[dict[str, Any]] = []

    for _ in range(4):
        before = await chart_stats(adapter)
        attempts.append({"phase": "before", **before})
        first_time = int(before.get("first_time") or 0)
        if first_time and first_time <= from_epoch:
            return {"status": "covered", "attempts": attempts, "stats": before}
        if not before.get("request_more_available", True):
            break

        last_time = int(before.get("last_time") or from_epoch)
        estimated = max(600, math.ceil(max(0, last_time - from_epoch) / seconds * 1.15))
        request_count = min(max(estimated, 2_000), 20_000)
        expression = (
            "(function(){"
            "var model=window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().model();"
            f"model.timeScale().requestMoreHistoryPoints({request_count});"
            f"return {{requested:{request_count}}};"
            "})()"
        )
        request = await adapter.call_tool("ui_evaluate", {"expression": expression})
        if not request.get("ok"):
            raise RuntimeError(f"history_request_failed:{timeframe}:{request.get('error')}")

        current = before
        for _poll in range(30):
            await asyncio.sleep(1)
            current = await chart_stats(adapter)
            if int(current.get("size") or 0) > int(before.get("size") or 0) and not current.get("loading"):
                break
        attempts.append({"phase": "after", **current})
        size = int(current.get("size") or 0)
        if size <= previous_size or size <= int(before.get("size") or 0):
            break
        previous_size = size

    final = await chart_stats(adapter)
    if int(final.get("first_time") or 0) > from_epoch:
        raise RuntimeError(
            f"history_window_not_covered:{timeframe}:"
            f"first={final.get('first_time')}:required={from_epoch}:size={final.get('size')}"
        )
    return {"status": "covered", "attempts": attempts, "stats": final}


async def extract_day(adapter: Any, start_epoch: int, end_epoch: int) -> list[dict[str, Any]]:
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
        raise RuntimeError(f"ohlcv_day_extract_failed:{response.get('error')}")
    payload = mcp_payload(response)
    if not isinstance(payload, list):
        raise RuntimeError("ohlcv_day_extract_invalid_payload")
    return [row for row in payload if isinstance(row, dict)]


def normalize_and_validate(
    *,
    symbol: str,
    provider_symbol: str,
    timeframe: str,
    bars: list[dict[str, Any]],
    start: datetime,
    end: datetime,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    timestamps: set[int] = set()
    errors: list[str] = []
    daily_counts: Counter[str] = Counter()

    for raw in bars:
        try:
            timestamp = int(raw["time"])
            values = {
                name: float(raw[name])
                for name in ("open", "high", "low", "close")
            }
            volume = float(raw.get("volume") or 0)
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"invalid_row:{exc}")
            continue

        timestamp_dt = datetime.fromtimestamp(timestamp, tz=UTC)
        if not start <= timestamp_dt < end:
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

        paris_dt = timestamp_dt.astimezone(PARIS)
        daily_counts[timestamp_dt.date().isoformat()] += 1
        normalized.append(
            {
                "feed_id": feed_id(symbol, timeframe),
                "symbol_code": symbol,
                "provider_symbol": provider_symbol,
                "timeframe": timeframe,
                "timestamp_utc": timestamp_dt.isoformat().replace("+00:00", "Z"),
                "timestamp_paris": paris_dt.isoformat(),
                "trading_date": paris_dt.date().isoformat(),
                "open": format(values["open"], ".12g"),
                "high": format(values["high"], ".12g"),
                "low": format(values["low"], ".12g"),
                "close": format(values["close"], ".12g"),
                "volume": format(volume, ".12g"),
                "is_closed": "true",
            }
        )

    normalized.sort(key=lambda row: row["timestamp_utc"])
    required_weekdays = [
        (start.date() + timedelta(days=offset)).isoformat()
        for offset in range((end.date() - start.date()).days)
        if (start.date() + timedelta(days=offset)).weekday() < 5
    ]
    missing_weekdays = [day for day in required_weekdays if not daily_counts[day]]
    active_weekdays = [day for day in required_weekdays if daily_counts[day]]
    if missing_weekdays and symbol in STRICT_WEEKDAY_SYMBOLS:
        errors.append(f"missing_weekdays:{','.join(missing_weekdays)}")
    if len(active_weekdays) < 3:
        errors.append(
            f"insufficient_active_weekdays:{len(active_weekdays)}:"
            f"missing={','.join(missing_weekdays)}"
        )
    if not normalized:
        errors.append("no_bars_in_window")
    if errors:
        raise RuntimeError(f"validation_failed:{symbol}:{timeframe}:{'|'.join(errors[:30])}")

    return normalized, {
        "bar_count": len(normalized),
        "first_timestamp_utc": normalized[0]["timestamp_utc"],
        "last_timestamp_utc": normalized[-1]["timestamp_utc"],
        "daily_counts_utc": dict(sorted(daily_counts.items())),
        "missing_weekdays_utc": missing_weekdays,
        "active_weekdays_utc": active_weekdays,
        "duplicate_timestamps": 0,
        "ohlcv_valid": True,
        "volume_valid": True,
        "all_bars_closed": True,
    }


async def export(args: argparse.Namespace) -> dict[str, Any]:
    from_date = date.fromisoformat(args.from_date)
    to_date = date.fromisoformat(args.to_date)
    start, end = utc_bounds(from_date, to_date)
    selected = (
        {item.strip().upper() for item in args.symbols.split(",") if item.strip()}
        if args.symbols
        else set(FEED_TIMEFRAMES)
    )
    unknown = sorted(selected - set(FEED_TIMEFRAMES))
    if unknown:
        raise ValueError(f"unknown symbols: {', '.join(unknown)}")

    tv_project = Path(args.tradingview_project).resolve()
    sys.path.insert(0, str(tv_project))
    from scanner.live_data.mcp_live_data_probe import load_config  # type: ignore
    from scanner.mcp_adapter import MCPTradingViewAdapter  # type: ignore

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "tradingview_ohlcv_backfill.csv"
    manifest_path = output_dir / "tradingview_ohlcv_backfill_manifest.json"

    adapter = MCPTradingViewAdapter(load_config())
    rows: list[dict[str, Any]] = []
    feed_reports: list[dict[str, Any]] = []
    started_at = datetime.now(UTC)
    try:
        connection = await adapter.connect()
        if not connection.get("ok"):
            raise RuntimeError(f"mcp_connect_failed:{connection.get('error')}")

        for symbol in sorted(selected):
            provider_symbol = TRADINGVIEW_SYMBOLS[symbol]
            print(f"[symbol] {symbol} -> {provider_symbol}", flush=True)
            symbol_response = await adapter.call_tool("chart_set_symbol", {"symbol": provider_symbol})
            if not symbol_response.get("ok"):
                raise RuntimeError(f"chart_set_symbol_failed:{symbol}:{symbol_response.get('error')}")
            await asyncio.sleep(1)
            info_response = await adapter.call_tool("symbol_info", {})
            resolved_info = mcp_payload(info_response) if info_response.get("ok") else {}

            for timeframe in FEED_TIMEFRAMES[symbol]:
                resolution = TIMEFRAME_RESOLUTION[timeframe]
                print(f"[feed] {feed_id(symbol, timeframe)} resolution={resolution}", flush=True)
                timeframe_response = await adapter.call_tool(
                    "chart_set_timeframe",
                    {"timeframe": resolution},
                )
                if not timeframe_response.get("ok"):
                    raise RuntimeError(
                        f"chart_set_timeframe_failed:{symbol}:{timeframe}:{timeframe_response.get('error')}"
                    )
                await asyncio.sleep(1)
                history = await load_history(adapter, int(start.timestamp()), timeframe)

                raw_bars: list[dict[str, Any]] = []
                cursor = start
                while cursor < end:
                    next_day = min(cursor + timedelta(days=1), end)
                    raw_bars.extend(
                        await extract_day(
                            adapter,
                            int(cursor.timestamp()),
                            int(next_day.timestamp()),
                        )
                    )
                    cursor = next_day

                feed_rows, validation = normalize_and_validate(
                    symbol=symbol,
                    provider_symbol=provider_symbol,
                    timeframe=timeframe,
                    bars=raw_bars,
                    start=start,
                    end=end,
                )
                rows.extend(feed_rows)
                feed_reports.append(
                    {
                        "feed_id": feed_id(symbol, timeframe),
                        "symbol_code": symbol,
                        "provider_symbol": provider_symbol,
                        "resolved_symbol": (
                            resolved_info.get("full_name")
                            or resolved_info.get("pro_name")
                            or resolved_info.get("symbol")
                            if isinstance(resolved_info, dict)
                            else None
                        ),
                        "timeframe": timeframe,
                        "resolution": resolution,
                        "history": {
                            "status": history["status"],
                            "final_stats": history["stats"],
                            "request_rounds": len(
                                [item for item in history["attempts"] if item.get("phase") == "after"]
                            ),
                        },
                        "validation": validation,
                    }
                )
                print(
                    f"[ok] {feed_id(symbol, timeframe)} bars={validation['bar_count']} "
                    f"{validation['first_timestamp_utc']}..{validation['last_timestamp_utc']}",
                    flush=True,
                )
    finally:
        await adapter.disconnect()

    rows.sort(key=lambda row: (row["feed_id"], row["timestamp_utc"]))
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    csv_sha256 = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    manifest = {
        "schema_version": "tradingview-mcp-backfill-manifest-v1",
        "source": "tradingview_desktop_local_mcp",
        "mcp_transport": "stdio",
        "cdp_endpoint": "127.0.0.1:9222",
        "window": {
            "from_date_utc": from_date.isoformat(),
            "to_date_utc": to_date.isoformat(),
            "from_timestamp_utc": start.isoformat().replace("+00:00", "Z"),
            "to_timestamp_exclusive_utc": end.isoformat().replace("+00:00", "Z"),
        },
        "generated_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "duration_seconds": round((datetime.now(UTC) - started_at).total_seconds(), 3),
        "feed_count": len(feed_reports),
        "row_count": len(rows),
        "csv_file": csv_path.name,
        "csv_sha256": csv_sha256,
        "feeds": feed_reports,
        "validation": {
            "status": "passed",
            "all_feeds_non_empty": all(item["validation"]["bar_count"] > 0 for item in feed_reports),
            "all_ohlcv_valid": all(item["validation"]["ohlcv_valid"] for item in feed_reports),
            "all_volumes_valid": all(item["validation"]["volume_valid"] for item in feed_reports),
            "all_bars_closed": all(item["validation"]["all_bars_closed"] for item in feed_reports),
            "duplicate_feed_timestamps": len(rows)
            - len({(row["feed_id"], row["timestamp_utc"]) for row in rows}),
        },
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"csv": str(csv_path), "manifest": str(manifest_path), **manifest}


def main() -> int:
    args = parse_args()
    try:
        result = asyncio.run(export(args))
    except Exception as exc:
        print(f"BACKFILL_EXPORT_FAILED: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "status": "ok",
                "feed_count": result["feed_count"],
                "row_count": result["row_count"],
                "csv": result["csv"],
                "manifest": result["manifest"],
                "csv_sha256": result["csv_sha256"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
