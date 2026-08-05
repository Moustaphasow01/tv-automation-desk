import assert from "node:assert/strict";
import test from "node:test";

import { DESK_MARKET_CONTEXT_DOMAINS } from "../src/desk-ai-context-capability.js";
import {
  DESK_CONTEXT_DEEP_ROW_ORDER,
  deskContextToolNamesForScope,
  evaluateDeskMarketContextCoverage,
  requireDeskContextNewsSession,
} from "../src/desk-ai-context-policy.js";

test("claim-scoped context tools expose replay pagination only to Replay", () => {
  const live = deskContextToolNamesForScope("live");
  const replay = deskContextToolNamesForScope("replay");

  assert.equal(live.includes("get_replay_section_page"), false);
  assert.equal(replay.includes("get_replay_section_page"), true);
  assert.equal(live.includes("get_market_dataset"), true);
  assert.equal(DESK_CONTEXT_DEEP_ROW_ORDER, "latest_first");
});

test("cutoff-safe news refuses an invalid claim session instead of defaulting to Asia", () => {
  assert.equal(requireDeskContextNewsSession("ny_open"), "ny_open");
  assert.throws(
    () => requireDeskContextNewsSession("custom"),
    (error) => error.code === "AI_CONTEXT_NEWS_SESSION_INVALID",
  );
  assert.throws(
    () => requireDeskContextNewsSession(null),
    (error) => error.code === "AI_CONTEXT_NEWS_SESSION_INVALID",
  );
});

test("core and index coverage are complete only when every required instrument is present", () => {
  const complete = evaluateDeskMarketContextCoverage({
    domainName: "core_market",
    domain: DESK_MARKET_CONTEXT_DOMAINS.core_market,
    snapshots: {
      "15m": {
        instruments: {
          MNQ: { close: 22_000 },
          MES: { close: 6_000 },
        },
      },
    },
  });
  assert.equal(complete.status, "COMPLETE");
  assert.deepEqual(complete.missing_units, []);

  const degraded = evaluateDeskMarketContextCoverage({
    domainName: "index_confirmation",
    domain: DESK_MARKET_CONTEXT_DOMAINS.index_confirmation,
    datasets: [{
      ok: true,
      dataset: "NQ_M15",
      rows: [{ asset: "NQ", close: 22_050 }],
    }],
  });
  assert.equal(degraded.status, "DEGRADED");
  assert.deepEqual(degraded.missing_units, ["ES"]);

  const unavailable = evaluateDeskMarketContextCoverage({
    domainName: "core_market",
    domain: DESK_MARKET_CONTEXT_DOMAINS.core_market,
  });
  assert.equal(unavailable.status, "UNAVAILABLE");
});

test("cross-asset and megacap coverage distinguish complete and partial evidence", () => {
  const crossAsset = evaluateDeskMarketContextCoverage({
    domainName: "cross_asset",
    domain: DESK_MARKET_CONTEXT_DOMAINS.cross_asset,
    datasets: [
      {
        ok: true,
        dataset: "US10Y_US02Y",
        rows: [{ asset: "US10Y", close: 4.1 }, { asset: "US02Y", close: 3.8 }],
      },
      {
        ok: true,
        dataset: "DXY_CL_GC_VIX",
        rows: ["DXY", "CL1!", "GC1!", "VIX"].map((asset) => ({ asset, close: 1 })),
      },
    ],
  });
  assert.equal(crossAsset.status, "COMPLETE");

  const partialCrossAsset = evaluateDeskMarketContextCoverage({
    domainName: "cross_asset",
    domain: DESK_MARKET_CONTEXT_DOMAINS.cross_asset,
    datasets: [{
      ok: true,
      dataset: "DXY_CL_GC_VIX",
      rows: [{ asset: "VIX", close: 17 }],
    }],
  });
  assert.equal(partialCrossAsset.status, "DEGRADED");
  assert.ok(partialCrossAsset.missing_units.includes("GC"));

  const megacaps = evaluateDeskMarketContextCoverage({
    domainName: "megacaps",
    domain: DESK_MARKET_CONTEXT_DOMAINS.megacaps,
    datasets: [
      {
        ok: true,
        dataset: "indices_asie_europe",
        rows: [{ asset: "DAX", close: 24_000 }],
      },
      {
        ok: true,
        dataset: "mega_caps_premarket",
        rows: [{ asset: "NVDA", close: 180 }],
      },
    ],
  });
  assert.equal(megacaps.status, "COMPLETE");
  assert.deepEqual(megacaps.present_units, ["INDICES", "MEGACAPS"]);
});
