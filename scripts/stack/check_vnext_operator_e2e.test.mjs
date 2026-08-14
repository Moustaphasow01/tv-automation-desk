import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseVNextOperatorE2EArgs, runVNextOperatorE2E } from "./check_vnext_operator_e2e.mjs";

describe("VNext operator E2E gate", () => {
  it("blocks when no operator PIN is provided by the caller environment", async () => {
    const result = await runVNextOperatorE2E({ pin: "", fetchImpl: async () => new Response("{}") });

    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((blocker) => blocker.id === "operator.pin_configured"));
  });

  it("validates login, auth projection, persisted command and idempotent replay", async () => {
    const calls = [];
    const result = await runVNextOperatorE2E({
      baseUrl: "http://desk.test",
      pin: "operator-pin",
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        if (String(url).endsWith("/api/v1/auth/operator/login")) {
          assert.equal(JSON.parse(String(init.body)).pin, "operator-pin");
          return json({ ok: true, authenticated: true, expires_at: "2026-08-12T09:00:00.000Z" }, {
            "set-cookie": "desk_operator_session=session-value; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800",
          });
        }
        if (String(url).endsWith("/front-api/v1/views/auth-session")) {
          assert.match(String(init.headers.Cookie), /^desk_operator_session=/);
          return json({
            data: {
              summary: { authenticated: true, readOnly: false },
              permissions: [{ capability: "front.command", decision: "ALLOW" }],
            },
          });
        }
        if (String(url).endsWith("/front-api/v1/commands")) {
          assert.match(String(init.headers.Cookie), /^desk_operator_session=/);
          const count = calls.filter((call) => String(call.url).endsWith("/front-api/v1/commands")).length;
          return json({
            status: "ACCEPTED",
            persisted: true,
            idempotent: count > 1,
            commandId: "cmd_front_test",
            auditId: "cmd_front_test_audit",
          });
        }
        if (String(url).endsWith("/front-api/v1/commands/cmd_front_test")) {
          return json({ commandId: "cmd_front_test", status: "SUCCEEDED", auditId: "cmd_front_test_audit" });
        }
        throw new Error(`unexpected_url:${url}`);
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.checks.find((check) => check.id === "operator.cookie_path_front_api")?.ok, true);
    assert.equal(result.checks.find((check) => check.id === "operator.command_idempotent_replay")?.ok, true);
  });

  it("parses base URL and output flags without requiring the PIN value in argv", () => {
    const options = parseVNextOperatorE2EArgs(["--base-url=http://desk.local", "--json", "--exit-zero"], {
      DESK_OPERATOR_ADMIN_PIN: "from-env",
    });

    assert.deepEqual(options, {
      baseUrl: "http://desk.local",
      pin: "from-env",
      output: "json",
      exitZero: true,
    });
  });
});

function json(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}
