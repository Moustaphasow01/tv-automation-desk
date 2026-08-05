import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const protectedActiveWorkflowFiles = [
  "src/desk-state-algorithms.js",
  "src/desk-live-bundle-algorithms.js",
  "src/desk-strategy-audit-algorithms.js",
  "src/desk-replay-orchestration-algorithms.js",
  "src/desk-replay-service.js",
  "src/replay-agent-work.js",
  "src/front-api-resources.js",
  "src/front-session-projection.js",
];

const forbiddenLegacyReads = [
  /\bgetCrossAssetDelta\s*\(/,
  /\bensureCrossAssetDelta\s*\(/,
  /\bget_cross_asset_delta\b/,
  /\bdesk_cross_asset_deltas\b/,
  /\bdeskCrossAssetDeltas\b/,
];

test("active front/live/replay V4 workflows do not depend on legacy desk_cross_asset_deltas", () => {
  for (const file of protectedActiveWorkflowFiles) {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const pattern of forbiddenLegacyReads) {
      assert.doesNotMatch(
        source,
        pattern,
        `${file} must consume cross-asset context through immutable pack raw windows/bundle snapshots, not legacy desk_cross_asset_deltas.`,
      );
    }
  }
});

test("GPT-facing contracts do not recommend the legacy get_cross_asset_delta tool", () => {
  for (const file of [
    "packages/desk-contracts/contracts/DeskMasterAnalysisContract_v4_0_0.md",
    "packages/desk-contracts/contracts/DeskHourlyThesisMonitorContract_v1_0_0.md",
  ]) {
    const source = readFileSync(join(PROJECT_ROOT, file), "utf8");
    assert.doesNotMatch(
      source,
      /\bget_cross_asset_delta\b/,
      `${file} must reference bundle snapshots/scoped get_raw_window instead of the legacy get_cross_asset_delta diagnostic tool.`,
    );
  }
});

test("runtime services do not read or write the decommissioned cross-asset delta store", () => {
  const source = readFileSync(join(ROOT, "src/desk-market-feature-service.js"), "utf8");
  for (const pattern of [
    /\blistDocuments\(COLLECTIONS\.deskCrossAssetDeltas/,
    /\bsetDocument\(COLLECTIONS\.deskCrossAssetDeltas/,
    /\bPERSIST_CROSS_ASSET_DELTAS\b/,
    /\bshouldPersistCrossAssetDelta\b/,
  ]) {
    assert.doesNotMatch(
      source,
      pattern,
      "DeskMarketFeatureService must not read, write or re-enable the decommissioned cross-asset delta store.",
    );
  }
});
