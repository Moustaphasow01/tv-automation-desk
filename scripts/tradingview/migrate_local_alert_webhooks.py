#!/usr/bin/env python3
"""Move active TVAutomation feed alerts to the VPS webhook without logging secrets."""

from __future__ import annotations

import asyncio
import base64
import json
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlencode


VPS_HOST = "145.239.73.250"
VPS_USER = "Administrator"
VPS_KEY = "/home/u01i003/.ssh/tv-desk-ovh-2026"
PUBLIC_HOST = "vps-6d6969db.vps.ovh.net"
ALERT_LABELS = ("M1", "M5", "M15", "H1", "H4")


def payload(response: dict[str, Any]) -> Any:
    result = response.get("result")
    if isinstance(result, dict) and result.get("success") is True and "result" in result:
        return result["result"]
    return result


def read_vps_webhook_secret() -> str:
    script = (
        "$line = Get-Content 'C:\\ProgramData\\DeskFutures\\config\\desk.env' "
        "| Where-Object { $_ -match '^TRADINGVIEW_WEBHOOK_SECRET=' } "
        "| Select-Object -First 1; "
        "if (-not $line) { exit 2 }; "
        "[Console]::Out.Write(($line -split '=', 2)[1].Trim())"
    )
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    result = subprocess.run(
        [
            "ssh",
            "-i",
            VPS_KEY,
            "-o",
            "BatchMode=yes",
            f"{VPS_USER}@{VPS_HOST}",
            f"powershell -NoProfile -EncodedCommand {encoded}",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    secret = result.stdout.strip()
    if len(secret) < 16 or secret.startswith("__"):
        raise RuntimeError("vps_webhook_secret_invalid")
    return secret


async def checked_call(adapter: Any, tool: str, args: dict[str, Any]) -> Any:
    response = await adapter.call_tool(tool, args)
    if not response.get("ok"):
        raise RuntimeError(f"{tool}_failed:{response.get('error')}")
    return payload(response)


async def click_text_coordinates(adapter: Any, needle: str, *, double: bool = False) -> None:
    expression = f"""
    (function() {{
      var needle = {json.dumps(needle)};
      var matches = Array.from(document.querySelectorAll('*')).map(function(element) {{
        var rect = element.getBoundingClientRect();
        return {{
          element: element,
          rect: rect,
          text: String(element.textContent || '').trim().replace(/\\s+/g, ' ')
        }};
      }}).filter(function(item) {{
        return item.rect.width > 4 && item.rect.height > 4
          && item.rect.x >= 0 && item.rect.y >= 0
          && item.text.indexOf(needle) !== -1;
      }}).sort(function(left, right) {{
        return left.rect.width * left.rect.height - right.rect.width * right.rect.height;
      }});
      if (!matches.length) return null;
      var target = matches[0].rect;
      return {{ x: target.x + target.width / 2, y: target.y + target.height / 2 }};
    }})()
    """
    coordinates = await checked_call(adapter, "ui_evaluate", {"expression": expression})
    if not coordinates:
        raise RuntimeError(f"tradingview_text_not_found:{needle}")
    await checked_call(adapter, "ui_mouse_click", {
        "x": coordinates["x"],
        "y": coordinates["y"],
        "button": "left",
        "double_click": double,
    })


async def ensure_alert_panel(adapter: Any) -> None:
    visible = await checked_call(adapter, "ui_evaluate", {
        "expression": """
        (function() {
          return Array.from(document.querySelectorAll('button, [role="tab"]')).some(function(element) {
            var rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && String(element.textContent || '').trim() === 'Alertes';
          });
        })()
        """,
    })
    if not visible:
        viewport = await checked_call(adapter, "ui_evaluate", {
            "expression": "({width: window.innerWidth, height: window.innerHeight})",
        })
        await checked_call(adapter, "ui_mouse_click", {
            "x": float(viewport["width"]) - 23,
            "y": 108,
            "button": "left",
            "double_click": False,
        })
        await asyncio.sleep(0.8)
    await click_text_coordinates(adapter, "Alertes")
    await asyncio.sleep(0.8)


async def edit_alert(adapter: Any, label: str, webhook_url: str) -> None:
    await click_text_coordinates(adapter, f"TVAutomation Market Feed Batch {label}:", double=True)
    await asyncio.sleep(0.8)
    await checked_call(adapter, "ui_click", {"by": "text", "value": "Webhook"})
    await asyncio.sleep(0.5)
    changed = await checked_call(adapter, "ui_evaluate", {
        "expression": f"""
        (function() {{
          var value = {json.dumps(webhook_url)};
          var inputs = Array.from(document.querySelectorAll('input'));
          var input = inputs.find(function(element) {{
            return /^https?:\\/\\//i.test(String(element.value || ''));
          }});
          if (!input) return false;
          var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', {{ bubbles: true }}));
          input.dispatchEvent(new Event('change', {{ bubbles: true }}));
          return true;
        }})()
        """,
    })
    if not changed:
        raise RuntimeError(f"webhook_input_not_found:{label}")
    await checked_call(adapter, "ui_click", {"by": "text", "value": "Appliquer"})
    await asyncio.sleep(0.5)
    await checked_call(adapter, "ui_click", {"by": "text", "value": "Sauvegarder"})
    await asyncio.sleep(1.0)


async def main() -> None:
    tradingview_project = Path("/mnt/c/Users/CES/Desktop/TV_Automation")
    sys.path.insert(0, str(tradingview_project))
    from scanner.live_data.mcp_live_data_probe import load_config  # type: ignore
    from scanner.mcp_adapter import MCPTradingViewAdapter  # type: ignore

    secret = read_vps_webhook_secret()
    webhook_url = (
        f"https://{PUBLIC_HOST}/api/v1/webhooks/tradingview?"
        f"{urlencode({'token': secret})}"
    )
    adapter = MCPTradingViewAdapter(load_config())
    migrated: list[str] = []
    already_migrated: list[str] = []
    try:
        connection = await adapter.connect()
        if not connection.get("ok"):
            raise RuntimeError(f"mcp_connect_failed:{connection.get('error')}")
        for _ in range(3):
            await checked_call(adapter, "ui_keyboard", {"key": "Escape"})
            await asyncio.sleep(0.15)
        await ensure_alert_panel(adapter)
        initial_audit = await checked_call(adapter, "alert_webhook_audit", {})
        labels_to_migrate = []
        for label in ALERT_LABELS:
            alert = next((
                item for item in initial_audit.get("active", [])
                if f"Batch {label}:" in str(item.get("name") or "")
            ), None)
            current = any(
                webhook.get("host") == PUBLIC_HOST
                and webhook.get("path") == "/api/v1/webhooks/tradingview"
                and webhook.get("has_token_query") is True
                for webhook in (alert or {}).get("webhooks", [])
            )
            if current:
                already_migrated.append(label)
            else:
                labels_to_migrate.append(label)
        for label in labels_to_migrate:
            await edit_alert(adapter, label, webhook_url)
            migrated.append(label)
        audit = await checked_call(adapter, "alert_webhook_audit", {})
        vps_alerts = [
            alert for alert in audit.get("active", [])
            if alert.get("symbol") == "CME_MINI:MES1!"
            and any(
                webhook.get("host") == PUBLIC_HOST
                and webhook.get("path") == "/api/v1/webhooks/tradingview"
                and webhook.get("has_token_query") is True
                for webhook in alert.get("webhooks", [])
            )
        ]
        if len(vps_alerts) != len(ALERT_LABELS):
            raise RuntimeError(f"alert_webhook_verification_failed:{len(vps_alerts)}")
        print(json.dumps({
            "ok": True,
            "migrated": migrated,
            "already_migrated": already_migrated,
            "verified_alerts": len(vps_alerts),
            "public_host": PUBLIC_HOST,
            "path": "/api/v1/webhooks/tradingview",
            "secret_exposed": False,
        }, indent=2))
    finally:
        secret = ""
        webhook_url = ""
        await adapter.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
