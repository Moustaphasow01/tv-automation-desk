#!/usr/bin/env python3
"""Audit TradingView Desktop alert webhook metadata without exposing secrets."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any


def payload(response: dict[str, Any]) -> Any:
    result = response.get("result")
    if isinstance(result, dict) and result.get("success") is True and "result" in result:
        return result["result"]
    return result


async def main() -> None:
    tradingview_project = Path("/mnt/c/Users/CES/Desktop/TV_Automation")
    sys.path.insert(0, str(tradingview_project))
    from scanner.live_data.mcp_live_data_probe import load_config  # type: ignore
    from scanner.mcp_adapter import MCPTradingViewAdapter  # type: ignore

    adapter = MCPTradingViewAdapter(load_config())
    try:
        connection = await adapter.connect()
        if not connection.get("ok"):
            raise RuntimeError(f"mcp_connect_failed:{connection.get('error')}")
        response = await adapter.call_tool("alert_webhook_audit", {})
        if not response.get("ok"):
            raise RuntimeError(f"alert_audit_failed:{response.get('error')}")
        print(json.dumps(payload(response), indent=2, ensure_ascii=False))
    finally:
        await adapter.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
