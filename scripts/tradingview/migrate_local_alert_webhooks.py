#!/usr/bin/env python3
"""Audit or move active TVAutomation feed alerts to the VPS webhook.

Dry-run is the default: the script audits TradingView Desktop and reports which
alerts still need migration without reading or printing the webhook secret. Use
``--execute`` only when the operator intentionally wants to update TradingView.
"""

from __future__ import annotations

import argparse
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
WEBHOOK_PATH = "/api/v1/webhooks/tradingview"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Actually update TradingView alert webhook URLs.")
    parser.add_argument("--tradingview-project", default="/mnt/c/Users/CES/Desktop/TV_Automation")
    parser.add_argument("--public-host", default=PUBLIC_HOST)
    parser.add_argument("--labels", default=",".join(ALERT_LABELS), help="Comma-separated batch labels to audit or migrate.")
    return parser.parse_args()


def requested_labels(raw: str) -> tuple[str, ...]:
    labels = tuple(label.strip().upper() for label in raw.split(",") if label.strip())
    unknown = [label for label in labels if label not in ALERT_LABELS]
    if unknown:
        raise SystemExit(f"unsupported_alert_labels:{','.join(unknown)}")
    return labels


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


def target_webhook_url(secret: str, public_host: str) -> str:
    return f"https://{public_host}{WEBHOOK_PATH}?{urlencode({'token': secret})}"


def alert_for_label(audit: dict[str, Any], label: str) -> dict[str, Any] | None:
    return next((
        item for item in audit.get("active", [])
        if f"Batch {label}:" in str(item.get("name") or "")
    ), None)


def alert_points_to_target(alert: dict[str, Any] | None, public_host: str) -> bool:
    return any(
        webhook.get("host") == public_host
        and webhook.get("path") == WEBHOOK_PATH
        and webhook.get("has_token_query") is True
        for webhook in (alert or {}).get("webhooks", [])
    )


def migration_plan(audit: dict[str, Any], labels: tuple[str, ...], public_host: str) -> dict[str, list[str]]:
    already_migrated: list[str] = []
    needs_migration: list[str] = []
    missing_alerts: list[str] = []
    for label in labels:
        alert = alert_for_label(audit, label)
        if not alert:
            missing_alerts.append(label)
        elif alert_points_to_target(alert, public_host):
            already_migrated.append(label)
        else:
            needs_migration.append(label)
    return {
        "already_migrated": already_migrated,
        "needs_migration": needs_migration,
        "missing_alerts": missing_alerts,
    }


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
    args = parse_args()
    labels = requested_labels(args.labels)
    tradingview_project = Path(args.tradingview_project)
    sys.path.insert(0, str(tradingview_project))
    from scanner.live_data.mcp_live_data_probe import load_config  # type: ignore
    from scanner.mcp_adapter import MCPTradingViewAdapter  # type: ignore

    adapter = MCPTradingViewAdapter(load_config())
    migrated: list[str] = []
    try:
        connection = await adapter.connect()
        if not connection.get("ok"):
            raise RuntimeError(f"mcp_connect_failed:{connection.get('error')}")
        for _ in range(3):
            await checked_call(adapter, "ui_keyboard", {"key": "Escape"})
            await asyncio.sleep(0.15)
        await ensure_alert_panel(adapter)
        initial_audit = await checked_call(adapter, "alert_webhook_audit", {})
        plan = migration_plan(initial_audit, labels, args.public_host)
        if args.execute:
            secret = read_vps_webhook_secret()
            webhook_url = target_webhook_url(secret, args.public_host)
            for label in plan["needs_migration"]:
                await edit_alert(adapter, label, webhook_url)
                migrated.append(label)
            secret = ""
            webhook_url = ""
            audit = await checked_call(adapter, "alert_webhook_audit", {})
        else:
            audit = initial_audit
        verified_plan = migration_plan(audit, labels, args.public_host)
        verified_labels = sorted(set(labels) - set(verified_plan["needs_migration"]) - set(verified_plan["missing_alerts"]))
        if args.execute and len(verified_labels) != len(labels):
            raise RuntimeError(f"alert_webhook_verification_failed:{len(verified_labels)}")
        print(json.dumps({
            "ok": True,
            "status": "EXECUTED" if args.execute else ("READY" if len(verified_labels) == len(labels) else "DRY_RUN_NEEDS_MIGRATION"),
            "execute": args.execute,
            "migrated": migrated,
            "already_migrated": plan["already_migrated"],
            "needs_migration": verified_plan["needs_migration"],
            "missing_alerts": verified_plan["missing_alerts"],
            "verified_labels": verified_labels,
            "verified_alerts": len(verified_labels),
            "public_host": args.public_host,
            "path": WEBHOOK_PATH,
            "secret_exposed": False,
            "execute_command": "python3 scripts/tradingview/migrate_local_alert_webhooks.py --execute",
        }, indent=2))
    finally:
        await adapter.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
