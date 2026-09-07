import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { adjudicateHistoricalInvalidOriginIntents }
  from "../src/application/adjudicate-historical-invalid-origin-intents.js";
import { createPostgresInvalidOriginIntentAdjudication }
  from "../src/persistence/postgres-invalid-origin-intent-adjudication.js";
import { createTheoreticalTestDatabase, seedAuthorizedIntent }
  from "./support/theoretical-postgres-fixtures.js";

const sourceManifest = JSON.parse(await readFile(new URL(
  "../../reports/research/GRAINS_HISTORICAL_INTENT_QUALIFICATIONS_20260907.json",
  import.meta.url)));
const manifest = JSON.parse(await readFile(new URL(
  "../../reports/research/GRAINS_HISTORICAL_INVALID_ORIGIN_ADJUDICATIONS_20260907.json",
  import.meta.url)));
const SOURCE_MANIFEST_HASH = "831b7fa057f851ef81a5eaaf270d1118d63b83ac3793d3c295717aa8586c9ba1";

test("invalid-origin APPLY waits for prior uncommitted evidence then refuses the whole batch", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  await seedRetainedQualifications(database.pool);
  const repository = createPostgresInvalidOriginIntentAdjudication(database.pool);
  const intentId = manifest.adjudications[0].portfolio_order_intent_id;
  const writer = await database.pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query(`INSERT INTO trade_manual_execution_events
      (manual_execution_event_id,portfolio_order_intent_id,event_type,occurred_at_utc,payload,raw)
      VALUES ($1,$2,'filled','2026-09-07T09:30Z','{}','{}')`, [randomUUID(), intentId]);

    let settled = false;
    const applying = adjudicateHistoricalInvalidOriginIntents(command(), { repository })
      .then((value) => ({ status: "fulfilled", value }), (error) => ({ status: "rejected", error }))
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(settled, false, "APPLY must wait for the writer holding the lineage FK lock");
    assert.equal(await count(database.pool, "portfolio_invalid_origin_adjudications"), 0);

    await writer.query("COMMIT");
    const outcome = await applying;
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error?.code, "ADJUDICATION_EXECUTION_EVIDENCE_PRESENT");
    assert.equal(await count(database.pool, "portfolio_invalid_origin_adjudications"), 0,
      "the exact eight-item batch must roll back atomically");
    assert.equal(await count(database.pool, "trade_manual_execution_events"), 1,
      "the prior evidence remains committed");
  } finally {
    await writer.query("ROLLBACK").catch(() => undefined);
    writer.release();
  }
});

async function seedRetainedQualifications(pool) {
  for (const source of sourceManifest.qualifications) {
    await seedAuthorizedIntent(pool, source.portfolio_order_intent_id, {
      status: "EXPIRED", gate: "EXPIRED",
    });
    await pool.query(`UPDATE portfolio_order_intent_lineage
      SET payload_hash=$2,risk_snapshot='{}'::jsonb,
          payload=jsonb_set(payload,'{approved_trade_plan,economics,availability}','\"UNAVAILABLE\"'::jsonb)
      WHERE portfolio_order_intent_id=$1`, [
      source.portfolio_order_intent_id, source.expected_lineage_payload_hash,
    ]);
    await insertQualification(pool, source);
  }
}

async function insertQualification(pool, source) {
  await pool.query(`INSERT INTO portfolio_historical_intent_qualifications (
      historical_intent_qualification_id,idempotency_key,portfolio_order_intent_id,revision,
      expected_previous_revision,expected_lineage_payload_hash,expected_target_payload_hash,
      expected_signal_payload_hash,origin_classification,reconstruction_status,provider_evidence_status,
      reservation_disposition,qualified_at_utc,qualified_by,qualification_reason,manifest_hash,evidence)
    VALUES ($1,$2,$3,1,0,$4,$5,$6,'INVALID_ORIGIN_PLAN','UNQUALIFIABLE','ABSENT','RETAINED',
      '2026-09-07T09:00Z','qualification-test','Missing executable origin plan',$7,'{}')`, [
    `qualification:${source.portfolio_order_intent_id}`, source.idempotency_key,
    source.portfolio_order_intent_id, source.expected_lineage_payload_hash,
    source.expected_target_payload_hash, source.expected_signal_payload_hash, SOURCE_MANIFEST_HASH,
  ]);
}

function command() {
  return { mode: "APPLY", manifest, effective_at_utc: "2026-09-07T10:00:00.000Z",
    actor: "operator-test", reason: "Explicit administrative closure; no open order or position.",
    operator_attestation: { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true, no_open_positions: true } };
}

async function count(pool, table) {
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
}
