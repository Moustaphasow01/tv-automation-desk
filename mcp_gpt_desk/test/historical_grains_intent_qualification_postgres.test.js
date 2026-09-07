import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { qualifyHistoricalGrainsIntents } from "../src/application/qualify-historical-grains-intents.js";
import { createPostgresHistoricalGrainsIntentQualification } from "../src/persistence/postgres-historical-grains-intent-qualification.js";
import { createTheoreticalTestDatabase, seedAuthorizedIntent } from "./support/theoretical-postgres-fixtures.js";

const sourceManifest = JSON.parse(await readFile(new URL("../../reports/research/GRAINS_HISTORICAL_INTENT_QUALIFICATIONS_20260907.json", import.meta.url)));
const hash = `sha256:${"1".repeat(64)}`;

test("historical intent qualification is exact, append-only, idempotent and has no reservation side effect", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  const manifest = await seedQualificationCandidates(database.pool);
  const repository = createPostgresHistoricalGrainsIntentQualification(database.pool);

  const before = await reservationCount(database.pool);
  const dryRun = await qualifyHistoricalGrainsIntents({ mode: "DRY_RUN", manifest,
    qualified_at_utc: "2026-09-07T09:00:00Z" }, { repository });
  assert.equal(dryRun.item_count, 8);
  assert.equal(await count(database.pool), 0);
  assert.equal(await reservationCount(database.pool), before);

  const applied = await qualifyHistoricalGrainsIntents({ mode: "APPLY", manifest,
    qualified_at_utc: "2026-09-07T09:00:00Z", qualified_by: "operator-test",
    reason: "Missing canonical entry and economics; no provider, trade, or fill evidence." }, { repository });
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.reservation_effect, "NONE_RETAINED");
  assert.equal(await count(database.pool), 8);
  assert.equal(await reservationCount(database.pool), before);

  const replayed = await qualifyHistoricalGrainsIntents({ mode: "APPLY", manifest,
    qualified_at_utc: "2026-09-07T09:30:00Z", qualified_by: "operator-test",
    reason: "Idempotent replay." }, { repository });
  assert.equal(replayed.replayed_count, 8);
  assert.equal(await count(database.pool), 8);
  await assert.rejects(database.pool.query("UPDATE portfolio_historical_intent_qualifications SET qualified_by='changed'"),
    /append-only/);
});

async function seedQualificationCandidates(pool) {
  const instanceId = await seedStrategy(pool);
  const qualifications = [];
  for (const item of sourceManifest.qualifications) {
    await seedAuthorizedIntent(pool, item.portfolio_order_intent_id);
    await pool.query("UPDATE portfolio_order_intent_lineage SET status='EXPIRED' WHERE portfolio_order_intent_id=$1", [item.portfolio_order_intent_id]);
    await pool.query(`UPDATE portfolio_order_intent_lineage SET payload=jsonb_set(
      jsonb_set(payload,'{approved_trade_plan,entry,price}','null'::jsonb),
      '{approved_trade_plan,economics,availability}','"UNAVAILABLE"'::jsonb)
      WHERE portfolio_order_intent_id=$1`, [item.portfolio_order_intent_id]);
    await pool.query(`UPDATE portfolio_target_positions SET approved_trade_plan=jsonb_set(
      jsonb_set(approved_trade_plan,'{entry,price}','null'::jsonb),
      '{economics,availability}','"UNAVAILABLE"'::jsonb)
      WHERE target_position_id=$1`, [item.portfolio_order_intent_id]);
    const signalOutboxId = randomUUID();
    await pool.query(`INSERT INTO strategy_signal_outbox (signal_outbox_id,signal_id,strategy_instance_id,
      instrument,direction,execution_mode_origin,generated_at_utc,expires_at_utc,correlation_id,payload,payload_hash,dedupe_key)
      VALUES ($1,$2,$3,'ZC','LONG','shadow','2026-08-27T14:00Z','2026-08-27T19:00Z',$5,
        '{"entry":{"price":null},"entry_zone":{"low":100,"high":101}}',$4,$6)`,
    [signalOutboxId, item.source_signal_id, instanceId, hash, signalOutboxId, signalOutboxId]);
    if (item.expected_theoretical_event_count === 1) await pool.query(`INSERT INTO trade_theoretical_execution_events
      (theoretical_execution_event_id,portfolio_order_intent_id,event_type,event_at_utc,payload,raw)
      VALUES ($1,$2,'entry_expired','2026-08-27T18:05Z','{}','{}')`, [randomUUID(), item.portfolio_order_intent_id]);
    qualifications.push({ ...item, target_position_id: item.portfolio_order_intent_id,
      expected_lineage_payload_hash: hash, expected_target_payload_hash: hash, expected_signal_payload_hash: hash });
  }
  return { ...sourceManifest, qualifications };
}

async function seedStrategy(pool) {
  const definitionId = randomUUID();
  const versionId = randomUUID();
  const instanceId = randomUUID();
  await pool.query("INSERT INTO strategy_definitions(strategy_definition_id,external_key,name,owner) VALUES ($1,'qualification-test','qualification','test')", [definitionId]);
  await pool.query(`INSERT INTO strategy_versions(strategy_version_id,strategy_definition_id,version_label,
    dsl_source_hash,compiled_artifact_ref,runtime_contract_bundle_version) VALUES ($1,$2,'v1',$3,'test://qualification','v1')`,
  [versionId, definitionId, hash]);
  await pool.query(`INSERT INTO strategy_instances(strategy_instance_id,strategy_version_id,runtime_state,
    execution_mode,instrument_scope,last_heartbeat_at) VALUES ($1,$2,'running','shadow',ARRAY['ZC'],'2026-09-07T09:00Z')`,
  [instanceId, versionId]);
  return instanceId;
}

async function count(pool) {
  return Number((await pool.query("SELECT count(*) FROM portfolio_historical_intent_qualifications")).rows[0].count);
}

async function reservationCount(pool) {
  return Number((await pool.query(`SELECT count(*) FROM portfolio_order_intent_lineage lineage
    WHERE NOT EXISTS (SELECT 1 FROM trade_theoretical_execution_events event
      WHERE event.portfolio_order_intent_id=lineage.portfolio_order_intent_id
        AND event.event_type='entry_expired' AND event.source_candle_feed_id IS NOT NULL
        AND event.source_candle_timestamp_utc IS NOT NULL)`)).rows[0].count);
}
