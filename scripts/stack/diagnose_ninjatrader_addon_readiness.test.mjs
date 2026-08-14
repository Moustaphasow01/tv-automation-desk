import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNinjaAddonReadinessDiagnosis,
  formatNinjaAddonReadinessDiagnosis,
  parseNinjaAddonDoctorArgs,
} from "./diagnose_ninjatrader_addon_readiness.mjs";

describe("NinjaTrader AddOn readiness doctor", () => {
  it("passes when the physical Sim101 AddOn is armed with a fresh snapshot", () => {
    const diagnosis = buildNinjaAddonReadinessDiagnosis(readyOverview(), {
      checkedAtUtc: "2026-08-12T10:00:20.000Z",
    });

    assert.equal(diagnosis.ok, true);
    assert.equal(diagnosis.status, "READY");
    assert.deepEqual(diagnosis.blockers, []);
  });

  it("blocks when NinjaTrader still requires login", () => {
    const overview = readyOverview();
    overview.ninjaTraderStartup.state = "login_required";
    overview.ninjaTraderStartup.loginRequired = true;
    overview.ninjaTraderStartup.processWindowTitle = "Bienvenue !";

    const diagnosis = buildNinjaAddonReadinessDiagnosis(overview, {
      checkedAtUtc: "2026-08-12T10:00:20.000Z",
    });

    assert.equal(diagnosis.ok, false);
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "ninjatrader.login_required"));
    assert.ok(diagnosis.actions.some((action) => action.title === "Finaliser le login NinjaTrader"));
  });

  it("blocks when the AddOn is stale and read-only", () => {
    const overview = readyOverview();
    overview.ninjaTraderStartup.addonHeartbeatFresh = false;
    overview.bridges[0].status = "read_only";
    overview.bridges[0].command_enabled = false;
    overview.bridges[0].last_seen_at = "2026-08-12T09:55:00.000Z";
    overview.addonSnapshots[0].captured_at = "2026-08-12T09:55:00.000Z";

    const diagnosis = buildNinjaAddonReadinessDiagnosis(overview, {
      checkedAtUtc: "2026-08-12T10:00:20.000Z",
    });

    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "addon.heartbeat_stale"));
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "addon.commands_disabled"));
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "addon.snapshot_stale"));
  });

  it("blocks non-Sim accounts and live-account permission", () => {
    const overview = readyOverview();
    overview.safety.liveAccountAllowed = true;
    overview.bridges[0].account_name = "Live123";
    overview.addonSnapshots[0].account_name = "Live123";

    const diagnosis = buildNinjaAddonReadinessDiagnosis(overview, {
      checkedAtUtc: "2026-08-12T10:00:20.000Z",
    });

    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "safety.live_account_allowed"));
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "account.not_sim101"));
  });

  it("formats a readable operator report", () => {
    const overview = readyOverview();
    overview.bridges = [];

    const output = formatNinjaAddonReadinessDiagnosis(buildNinjaAddonReadinessDiagnosis(overview, {
      checkedAtUtc: "2026-08-12T10:00:20.000Z",
    }));

    assert.match(output, /NinjaTrader AddOn doctor: BLOCKED/);
    assert.match(output, /addon.bridge_missing/);
    assert.match(output, /Actions opérateur/);
  });

  it("parses CLI options", () => {
    assert.deepEqual(parseNinjaAddonDoctorArgs([
      "--json",
      "--exit-zero",
      "--execution-overview-url=http://desk/api/v1/execution/overview",
    ]), {
      executionOverviewUrl: "http://desk/api/v1/execution/overview",
      output: "json",
      exitZero: true,
    });
  });
});

function readyOverview() {
  return {
    safety: {
      executionEnabled: true,
      bridgeMode: "sim101_addon_approved_only",
      liveAccountAllowed: false,
      submissionPossible: true,
      accountSnapshotMaxAgeSeconds: 60,
    },
    ninjaTraderStartup: {
      state: "running",
      processWindowTitle: "NinjaTrader",
      loginRequired: false,
      platformReady: true,
      connectionName: "Simulation",
      connectionReady: true,
      addonHeartbeatFresh: true,
      addonConnected: true,
    },
    bridges: [{
      bridge_id: "DESKTOP-A0TIK79_nt8_addon",
      adapter_kind: "addon",
      status: "armed",
      command_enabled: true,
      account_name: "Sim101",
      last_seen_at: "2026-08-12T10:00:10.000Z",
      capabilities: { approved_commands: true, simulator: false },
    }],
    addonSnapshots: [{
      bridge_id: "DESKTOP-A0TIK79_nt8_addon",
      account_name: "Sim101",
      captured_at: "2026-08-12T10:00:00.000Z",
      connection: { status: "Connected" },
      orders: [],
      positions: [],
    }],
  };
}
