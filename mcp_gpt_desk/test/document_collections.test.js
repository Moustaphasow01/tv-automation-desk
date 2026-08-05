import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  CDC_TARGET_COLLECTIONS,
  DESK_COLLECTIONS,
} from "@tv-automation/desk-contracts/collections";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("desk contracts expose provider-neutral document collections", () => {
  assert.equal(CDC_TARGET_COLLECTIONS.length, 14);
  assert.equal(DESK_COLLECTIONS.marketFeeds, "market_feeds");
  assert.equal(DESK_COLLECTIONS.marketFeedCandles, "candles");
  assert.equal(DESK_COLLECTIONS.deskFrontCurrentStates, "desk_front_current_states");
  assert.equal(DESK_COLLECTIONS.deskFrontSnapshots, "desk_front_snapshots");
  assert.equal(DESK_COLLECTIONS.deskFrontEvents, "desk_front_events");
  assert.equal(DESK_COLLECTIONS.deskFrontProjectionErrors, "desk_front_projection_errors");
  assert.equal(DESK_COLLECTIONS.deskObservabilityPolicies, "desk_observability_policies");
  assert.equal(DESK_COLLECTIONS.deskAiRuntimeSettings, "desk_ai_runtime_settings");
});

test("PersistentDeskStore delegates I/O to the configured persistence port", () => {
  const storeSource = readFileSync(join(ROOT, "src/store.js"), "utf8");
  const persistentSection = storeSource.slice(storeSource.indexOf("export class PersistentDeskStore"));

  assert.match(storeSource, /PostgresDeskPersistence/);
  assert.match(persistentSection, /this\.persistence/);
  assert.doesNotMatch(storeSource, /desk-firebase-adapter|firebase-admin|firestore\.googleapis|storage\.googleapis/);
});

test("indexed document reads avoid collection-wide scans", () => {
  const storeSource = readFileSync(join(ROOT, "src/store.js"), "utf8");
  const persistentSection = storeSource.slice(storeSource.indexOf("export class PersistentDeskStore"));

  assert.match(persistentSection, /#queryCollectionDocuments/);
  assert.doesNotMatch(persistentSection, /#listDocuments\(COLLECTIONS\.deskActiveTheses/);
  assert.doesNotMatch(persistentSection, /#listDocuments\(COLLECTIONS\.deskMasterAnalyses/);
  assert.doesNotMatch(persistentSection, /#listDocuments\(COLLECTIONS\.deskHourlyMonitors/);
});

test("PostgreSQL schema declares the document primary key and indexes", () => {
  const schema = readFileSync(new URL("../../infra/postgres/init/001_schema.sql", import.meta.url), "utf8");
  assert.match(schema, /PRIMARY KEY \(collection, document_id\)/);
  assert.match(schema, /USING gin \(data\)/);
});
