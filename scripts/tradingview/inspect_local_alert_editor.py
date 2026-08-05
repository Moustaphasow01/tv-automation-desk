#!/usr/bin/env python3
"""Open the local TradingView alerts panel and capture safe editor diagnostics."""

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
        await adapter.call_tool("ui_evaluate", {
            "expression": """
            (function() {
              var candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
              var close = candidates.find(function(element) {
                var rect = element.getBoundingClientRect();
                var label = String(element.getAttribute('aria-label') || element.textContent || '');
                return rect.width > 0 && rect.height > 0
                  && rect.x > window.innerWidth * 0.8
                  && rect.y < window.innerHeight * 0.2
                  && /close|fermer|dismiss/i.test(label);
              });
              if (close) { close.click(); return { dismissed: true }; }
              return { dismissed: false };
            })()
            """,
        })
        await adapter.call_tool("ui_mouse_click", {
            "x": 680,
            "y": 45,
            "button": "left",
            "double_click": False,
        })
        await adapter.call_tool("ui_keyboard", {"key": "Escape"})
        await asyncio.sleep(1)
        await adapter.call_tool("ui_open_panel", {"panel": "alerts", "action": "open"})
        await adapter.call_tool("ui_mouse_click", {
            "x": 688,
            "y": 108,
            "button": "left",
            "double_click": False,
        })
        await asyncio.sleep(0.5)
        await adapter.call_tool("ui_mouse_click", {
            "x": 440,
            "y": 72,
            "button": "left",
            "double_click": False,
        })
        await asyncio.sleep(1)
        await adapter.call_tool("ui_mouse_click", {
            "x": 405,
            "y": 320,
            "button": "left",
            "double_click": True,
        })
        await asyncio.sleep(1)
        await adapter.call_tool("ui_click", {"by": "text", "value": "Webhook"})
        await asyncio.sleep(1)
        diagnostics = await adapter.call_tool("ui_evaluate", {
            "expression": """
            (function() {
              var items = Array.from(document.querySelectorAll('[data-alert-id], [class*="alert"], button, [role="button"]'));
              var diagnostics = items.slice(0, 80).map(function(element) {
                var rect = element.getBoundingClientRect();
                return {
                  tag: element.tagName.toLowerCase(),
                  alert_id: element.getAttribute('data-alert-id'),
                  data_name: element.getAttribute('data-name'),
                  aria_label: element.getAttribute('aria-label'),
                  text: String(element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                };
              }).filter(function(item) { return item.width > 0 && item.height > 0; });
              var point = document.elementFromPoint(920, 60);
              diagnostics.unshift({
                viewport: { width: window.innerWidth, height: window.innerHeight, device_pixel_ratio: window.devicePixelRatio },
                point_920_60: point ? {
                  tag: point.tagName.toLowerCase(),
                  text: String(point.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
                  aria_label: point.getAttribute('aria-label'),
                  class_name: String(point.className || '').slice(0, 160)
                } : null
              });
              return diagnostics;
            })()
            """,
        })
        screenshot = await adapter.call_tool("capture_screenshot", {
            "region": "full",
            "filename": "alert_panel_audit",
            "method": "cdp",
        })
        print(json.dumps({
            "diagnostics": payload(diagnostics),
            "screenshot": payload(screenshot),
        }, indent=2, ensure_ascii=False))
    finally:
        await adapter.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
