#!/usr/bin/env python3
"""Import recent real TradingView Desktop OHLCV bars through the desk webhook.

This is an operator rescue path for preprod when TradingView alerts/webhooks are
expired. It does not synthesize market data and it does not write PostgreSQL
directly: every accepted candle still passes through `/api/v1/webhooks/tradingview`.

Dry-run is the default. Use `--execute` only after checking the summary.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


UTC = timezone.utc
DEFAULT_TRADINGVIEW_PROJECT = Path("/mnt/c/Users/CES/Desktop/TV_Automation")
DEFAULT_WEBHOOK_URL = "http://127.0.0.1:8787/api/v1/webhooks/tradingview"
SYMBOLS = {
    "MNQ1!": "CME_MINI:MNQ1!",
    "MES1!": "CME_MINI:MES1!",
}
TIMEFRAMES = ("1", "5")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tradingview-project", default=str(DEFAULT_TRADINGVIEW_PROJECT))
    parser.add_argument("--webhook-url", default=DEFAULT_WEBHOOK_URL)
    parser.add_argument("--symbols", default="MNQ1!,MES1!")
    parser.add_argument("--timeframes", default="1,5")
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--closed-grace-seconds", type=int, default=15)
    parser.add_argument("--max-age-seconds", type=int, default=15 * 60)
    parser.add_argument("--chunk-size", type=int, default=100)
    parser.add_argument("--env-file", default=".env.preprod")
    parser.add_argument("--execute", action="store_true", help="Actually POST to the webhook.")
    return parser.parse_args()


def mcp_payload(response: dict[str, Any]) -> Any:
    result = response.get("result")
    if isinstance(result, dict) and result.get("success") is True and "result" in result:
        return result["result"]
    return result


def extract_bars(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("bars", "candles", "data", "last_20_bars", "last_5_bars"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def parse_timestamp(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)) or str(value).isdigit():
        raw = float(value)
        if raw > 10_000_000_000:
            raw /= 1000
        dt = datetime.fromtimestamp(raw, tz=UTC)
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed and parsed not in (float("inf"), float("-inf")) else None


def normalize_bar(raw: dict[str, Any], *, symbol: str, timeframe: str) -> dict[str, Any] | None:
    timestamp = parse_timestamp(
        raw.get("timestamp_utc")
        or raw.get("timestamp")
        or raw.get("time")
        or raw.get("datetime")
    )
    if not timestamp:
        return None
    values = {
        "open": number(raw.get("open") or raw.get("o")),
        "high": number(raw.get("high") or raw.get("h")),
        "low": number(raw.get("low") or raw.get("l")),
        "close": number(raw.get("close") or raw.get("c")),
        "volume": number(raw.get("volume") or raw.get("v") or 0),
    }
    if any(value is None for value in values.values()):
        return None
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "timestamp_utc": timestamp.isoformat().replace("+00:00", "Z"),
        "bar_status": "closed",
        **values,
        "source": "tradingview_desktop_recent_ohlcv_rescue",
    }


def select_settled_recent_bars(
    bars: list[dict[str, Any]],
    *,
    timeframe: str,
    now: datetime,
    closed_grace_seconds: int,
    max_age_seconds: int,
) -> list[dict[str, Any]]:
    timeframe_seconds = {"1": 60, "5": 5 * 60, "15": 15 * 60, "60": 60 * 60}.get(timeframe, 60)
    selected = []
    seen: set[str] = set()
    for bar in sorted(bars, key=lambda item: item["timestamp_utc"]):
        timestamp = parse_timestamp(bar["timestamp_utc"])
        if not timestamp:
            continue
        age_seconds = (now - timestamp).total_seconds()
        closed_age_seconds = age_seconds - timeframe_seconds
        if closed_age_seconds < closed_grace_seconds:
            continue
        if age_seconds > max_age_seconds:
            continue
        key = f"{bar['symbol']}:{bar['timeframe']}:{bar['timestamp_utc']}"
        if key in seen:
            continue
        seen.add(key)
        selected.append(bar)
    return selected


def read_secret(env_file: str) -> str:
    value = os.getenv("TRADINGVIEW_WEBHOOK_SECRET", "").strip()
    if value:
        return value
    path = Path(env_file)
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, raw = stripped.split("=", 1)
            if key.strip() == "TRADINGVIEW_WEBHOOK_SECRET":
                return raw.strip().strip('"').strip("'")
    return ""


def post_webhook(url: str, secret: str, candles: list[dict[str, Any]]) -> dict[str, Any]:
    payload = json.dumps({"token": secret, "candles": candles}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return {
                "http_status": response.status,
                "body": json.loads(response.read().decode("utf-8")),
            }
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return {
            "http_status": exc.code,
            "body": json.loads(body) if body.startswith("{") else {"error": body},
        }


def chunks(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    if size <= 0:
        raise SystemExit("chunk_size_must_be_positive")
    return [items[index:index + size] for index in range(0, len(items), size)]


def post_webhook_chunks(url: str, secret: str, candles: list[dict[str, Any]], chunk_size: int) -> list[dict[str, Any]]:
    responses = []
    for index, chunk in enumerate(chunks(candles, chunk_size), start=1):
        response = post_webhook(url, secret, chunk)
        responses.append({
            "chunk": index,
            "count": len(chunk),
            **response,
        })
        if response.get("http_status") not in (200, 202):
            break
    return responses


def accepted_count(responses: list[dict[str, Any]]) -> int:
    total = 0
    for response in responses:
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        total += int(body.get("accepted") or 0)
    return total


def rejected_count(responses: list[dict[str, Any]]) -> int:
    total = 0
    for response in responses:
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        total += int(body.get("rejected") or 0)
    return total


def all_chunks_accepted(responses: list[dict[str, Any]]) -> bool:
    return bool(responses) and all(response.get("http_status") in (200, 202) for response in responses)


async def main() -> int:
    args = parse_args()
    project = Path(args.tradingview_project)
    sys.path.insert(0, str(project))
    from scanner.live_data.mcp_live_data_probe import load_config  # type: ignore
    from scanner.mcp_adapter import MCPTradingViewAdapter  # type: ignore

    requested_symbols = [item.strip().upper() for item in args.symbols.split(",") if item.strip()]
    requested_timeframes = [item.strip() for item in args.timeframes.split(",") if item.strip()]
    unknown = [symbol for symbol in requested_symbols if symbol not in SYMBOLS]
    if unknown:
        raise SystemExit(f"unsupported_symbol:{','.join(unknown)}")
    if any(timeframe not in TIMEFRAMES for timeframe in requested_timeframes):
        raise SystemExit("unsupported_timeframe: only 1 and 5 are supported")

    adapter = MCPTradingViewAdapter(load_config())
    now = datetime.now(UTC)
    fetched: list[dict[str, Any]] = []
    fetch_summary: list[dict[str, Any]] = []
    try:
        connection = await adapter.connect()
        if not connection.get("ok"):
            raise RuntimeError(f"mcp_connect_failed:{connection.get('error')}")
        for symbol in requested_symbols:
            provider_symbol = SYMBOLS[symbol]
            await adapter.call_tool("chart_set_symbol", {"symbol": provider_symbol})
            for timeframe in requested_timeframes:
                await adapter.call_tool("chart_set_timeframe", {"timeframe": timeframe})
                response = await adapter.call_tool("data_get_ohlcv", {
                    "symbol": provider_symbol,
                    "timeframe": timeframe,
                    "count": args.count,
                    "summary": False,
                })
                payload = mcp_payload(response)
                bars = [
                    normalized
                    for raw in extract_bars(payload)
                    if (normalized := normalize_bar(raw, symbol=symbol, timeframe=timeframe))
                ]
                selected = select_settled_recent_bars(
                    bars,
                    timeframe=timeframe,
                    now=now,
                    closed_grace_seconds=args.closed_grace_seconds,
                    max_age_seconds=args.max_age_seconds,
                )
                fetched.extend(selected)
                latest = selected[-1]["timestamp_utc"] if selected else None
                fetch_summary.append({
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "raw_bars": len(bars),
                    "selected_closed_recent": len(selected),
                    "latest_selected_utc": latest,
                    "ok": bool(response.get("ok")),
                    "error": response.get("error"),
                })
    finally:
        await adapter.disconnect()

    result: dict[str, Any] = {
        "status": "DRY_RUN" if not args.execute else "EXECUTED",
        "generated_at_utc": now.isoformat().replace("+00:00", "Z"),
        "webhook_url": args.webhook_url,
        "symbols": requested_symbols,
        "timeframes": requested_timeframes,
        "selected_count": len(fetched),
        "chunk_size": args.chunk_size,
        "fetch_summary": fetch_summary,
    }
    if args.execute:
      secret = read_secret(args.env_file)
      if not secret:
          raise SystemExit("TRADINGVIEW_WEBHOOK_SECRET missing from env or env-file")
      responses = post_webhook_chunks(args.webhook_url, secret, fetched, args.chunk_size)
      result["webhook_responses"] = responses
      result["accepted_count"] = accepted_count(responses)
      result["rejected_count"] = rejected_count(responses)
      if not all_chunks_accepted(responses):
          print(json.dumps(result, indent=2, ensure_ascii=False))
          return 1
    else:
      result["dry_run_note"] = "No webhook call performed. Re-run with --execute to write real closed bars."
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
