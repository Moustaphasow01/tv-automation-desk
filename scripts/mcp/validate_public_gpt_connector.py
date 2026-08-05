#!/usr/bin/env python3
"""Validate the public GPT -> OAuth -> MCP path without printing credentials."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import ssl
import subprocess
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import (
    HTTPRedirectHandler,
    HTTPSHandler,
    Request,
    build_opener,
)


VPS_HOST = "145.239.73.250"
VPS_USER = "Administrator"
VPS_KEY = "/home/u01i003/.ssh/tv-desk-ovh-2026"
PUBLIC_BASE_URL = "https://vps-6d6969db.vps.ovh.net"
REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect"
EXPECTED_REQUIRED_TOOLS = {
    "desk_ping",
    "get_active_contracts",
    "get_master_analysis_bundle",
    "get_monitor_context_bundle",
    "claim_next_desk_work",
    "heartbeat_desk_work",
    "complete_desk_work",
    "fail_desk_work",
    "save_master_analysis",
    "save_hourly_monitor",
    "start_or_resume_replay_autopilot",
    "save_replay_master_analysis",
    "save_replay_monitor",
}
FORBIDDEN_LEGACY_TOOLS = {
    "get_cross_asset_delta",
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(
        self,
        req: Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Any
    body: bytes


def read_vps_oauth_pin() -> str:
    script = (
        "$line = Get-Content 'C:\\ProgramData\\DeskFutures\\config\\desk.env' "
        "| Where-Object { $_ -match '^DESK_OAUTH_ADMIN_PIN=' } "
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
    pin = result.stdout.strip()
    if len(pin) < 8:
        raise RuntimeError("vps_oauth_pin_invalid")
    return pin


def request(
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    form: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> HttpResponse:
    if payload is not None and form is not None:
        raise ValueError("payload_and_form_are_mutually_exclusive")
    body = None
    request_headers = {
        "User-Agent": "desk-public-gpt-connector-validator/1.0",
        **(headers or {}),
    }
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    elif form is not None:
        body = urlencode(form).encode("utf-8")
        request_headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = Request(
        f"{PUBLIC_BASE_URL}{path}",
        data=body,
        headers=request_headers,
        method=method,
    )
    opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
    try:
        with opener.open(req, timeout=20) as response:
            return HttpResponse(response.status, response.headers, response.read())
    except HTTPError as error:
        return HttpResponse(error.code, error.headers, error.read())


def require_json(response: HttpResponse, expected_status: int) -> dict[str, Any]:
    if response.status != expected_status:
        raise RuntimeError(f"http_status_mismatch:{response.status}:{expected_status}")
    try:
        value = json.loads(response.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("invalid_json_response") from error
    if not isinstance(value, dict):
        raise RuntimeError("json_object_expected")
    return value


def parse_mcp_message(response: HttpResponse, expected_status: int = 200) -> dict[str, Any]:
    if response.status != expected_status:
        raise RuntimeError(f"mcp_http_status_mismatch:{response.status}:{expected_status}")
    content_type = str(response.headers.get("content-type") or "").lower()
    text = response.body.decode("utf-8")
    if "text/event-stream" in content_type:
        for line in reversed(text.splitlines()):
            if line.startswith("data:"):
                value = json.loads(line[5:].strip())
                if isinstance(value, dict):
                    return value
        raise RuntimeError("mcp_sse_data_missing")
    value = json.loads(text)
    if not isinstance(value, dict):
        raise RuntimeError("mcp_json_object_expected")
    return value


def assert_endpoint(value: Any, path: str) -> None:
    if value != f"{PUBLIC_BASE_URL}{path}":
        raise RuntimeError(f"oauth_endpoint_mismatch:{path}")


def main() -> None:
    oauth_pin = read_vps_oauth_pin()
    access_token = ""
    refresh_token = ""
    authorization_code = ""
    try:
        resource_metadata = require_json(
            request("/.well-known/oauth-protected-resource"),
            200,
        )
        authorization_metadata = require_json(
            request("/.well-known/oauth-authorization-server"),
            200,
        )
        if resource_metadata.get("resource") != PUBLIC_BASE_URL:
            raise RuntimeError("oauth_resource_mismatch")
        if resource_metadata.get("authorization_servers") != [PUBLIC_BASE_URL]:
            raise RuntimeError("oauth_authorization_server_mismatch")
        if authorization_metadata.get("issuer") != PUBLIC_BASE_URL:
            raise RuntimeError("oauth_issuer_mismatch")
        assert_endpoint(authorization_metadata.get("authorization_endpoint"), "/oauth/authorize")
        assert_endpoint(authorization_metadata.get("token_endpoint"), "/oauth/token")
        assert_endpoint(authorization_metadata.get("registration_endpoint"), "/oauth/register")
        if "S256" not in authorization_metadata.get("code_challenge_methods_supported", []):
            raise RuntimeError("oauth_pkce_s256_missing")

        registration = require_json(
            request(
                "/oauth/register",
                method="POST",
                payload={
                    "client_name": "Desk Public GPT Connector Validator",
                    "redirect_uris": [REDIRECT_URI],
                    "scope": "desk.read desk.write",
                },
            ),
            201,
        )
        client_id = registration.get("client_id")
        if not isinstance(client_id, str) or not client_id.startswith("desk_dcr_"):
            raise RuntimeError("oauth_dynamic_registration_failed")

        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        state = secrets.token_urlsafe(18)
        authorization = request(
            "/oauth/authorize",
            method="POST",
            form={
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": REDIRECT_URI,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": state,
                "scope": "desk.read desk.write",
                "resource": PUBLIC_BASE_URL,
                "pin": oauth_pin,
            },
        )
        if authorization.status != 302:
            raise RuntimeError(f"oauth_authorization_failed:{authorization.status}")
        redirect_location = str(authorization.headers.get("location") or "")
        redirect = urlparse(redirect_location)
        if f"{redirect.scheme}://{redirect.netloc}{redirect.path}" != REDIRECT_URI:
            raise RuntimeError("oauth_redirect_uri_mismatch")
        redirect_query = parse_qs(redirect.query)
        if redirect_query.get("state") != [state]:
            raise RuntimeError("oauth_state_mismatch")
        codes = redirect_query.get("code") or []
        if len(codes) != 1:
            raise RuntimeError("oauth_authorization_code_missing")
        authorization_code = codes[0]

        token_payload = require_json(
            request(
                "/oauth/token",
                method="POST",
                form={
                    "grant_type": "authorization_code",
                    "client_id": client_id,
                    "redirect_uri": REDIRECT_URI,
                    "code": authorization_code,
                    "code_verifier": verifier,
                    "resource": PUBLIC_BASE_URL,
                },
            ),
            200,
        )
        access_token = str(token_payload.get("access_token") or "")
        refresh_token = str(token_payload.get("refresh_token") or "")
        if not access_token or token_payload.get("token_type") != "Bearer":
            raise RuntimeError("oauth_access_token_missing")

        mcp_headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-03-26",
        }
        initialize_response = request(
            "/mcp",
            method="POST",
            headers=mcp_headers,
            payload={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "desk-public-gpt-connector-validator",
                        "version": "1.0.0",
                    },
                },
            },
        )
        initialize = parse_mcp_message(initialize_response)
        if initialize.get("error"):
            raise RuntimeError("mcp_initialize_jsonrpc_error")
        session_id = str(initialize_response.headers.get("mcp-session-id") or "")
        if not session_id:
            raise RuntimeError("mcp_session_id_missing")
        negotiated_protocol = (
            initialize.get("result", {}).get("protocolVersion")
            if isinstance(initialize.get("result"), dict)
            else None
        )

        session_headers = {
            **mcp_headers,
            "Mcp-Session-Id": session_id,
        }
        initialized_response = request(
            "/mcp",
            method="POST",
            headers=session_headers,
            payload={
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            },
        )
        if initialized_response.status not in {200, 202, 204}:
            raise RuntimeError(
                f"mcp_initialized_notification_failed:{initialized_response.status}"
            )

        tools_response = request(
            "/mcp",
            method="POST",
            headers=session_headers,
            payload={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            },
        )
        tools_message = parse_mcp_message(tools_response)
        tools = tools_message.get("result", {}).get("tools", [])
        tool_names = {
            str(tool.get("name"))
            for tool in tools
            if isinstance(tool, dict) and tool.get("name")
        }
        missing_tools = sorted(EXPECTED_REQUIRED_TOOLS - tool_names)
        exposed_legacy_tools = sorted(FORBIDDEN_LEGACY_TOOLS & tool_names)
        if missing_tools:
            raise RuntimeError(f"mcp_required_tools_missing:{','.join(missing_tools)}")
        if exposed_legacy_tools:
            raise RuntimeError(f"mcp_legacy_tools_exposed:{','.join(exposed_legacy_tools)}")

        ping_response = request(
            "/mcp",
            method="POST",
            headers=session_headers,
            payload={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "desk_ping",
                    "arguments": {},
                },
            },
        )
        ping_message = parse_mcp_message(ping_response)
        ping_result = ping_message.get("result", {})
        if ping_message.get("error") or ping_result.get("isError") is True:
            raise RuntimeError("mcp_desk_ping_failed")

        print(
            json.dumps(
                {
                    "ok": True,
                    "public_base_url": PUBLIC_BASE_URL,
                    "oauth": {
                        "metadata": True,
                        "dynamic_registration": True,
                        "authorization_code_pkce_s256": True,
                        "token_exchange": True,
                    },
                    "mcp": {
                        "initialize": True,
                        "protocol_version": negotiated_protocol,
                        "session_transport": True,
                        "tool_count": len(tool_names),
                        "required_autopilot_v4_tools": True,
                        "legacy_cross_asset_tool_exposed": False,
                        "desk_ping": True,
                    },
                    "secrets_exposed": False,
                },
                indent=2,
            )
        )
    finally:
        oauth_pin = ""
        access_token = ""
        refresh_token = ""
        authorization_code = ""


if __name__ == "__main__":
    main()
