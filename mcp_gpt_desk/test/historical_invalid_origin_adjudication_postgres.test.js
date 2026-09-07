import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { adjudicateHistoricalInvalidOriginIntents } from "../src/application/adjudicate-historical-invalid-origin-intents.js";
import { createPostgresInvalidOriginIntentAdjudication } from "../src/persistence/postgres-invalid-origin-intent-adjudication.js";
import { loadTheoreticalExposureAsOf } from "../src/portfolio-theoretical-exposure-repository.js";
import { listTheoreticalEntryCandidates, recordTheoreticalEntryExpired }
  from "../src/broker-theoretical-execution-repository.js";
import { createTheoreticalTestDatabase, seedAuthorizedIntent } from "./support/theoretical-postgres-fixtures.js";

const sourceManifest = JSON.parse(await readFile(new URL(
  "../../reports/research/GRAINS_HISTORICAL_INTENT_QUALIFICATIONS_20260907.json", import.meta.url)));
const manifest = JSON.parse(await readFile(new URL(
  "../../reports/research/GRAINS_HISTORICAL_INVALID_ORIGIN_ADJUDICATIONS_20260907.json", import.meta.url)));
const SOURCE_MANIFEST_HASH = "831b7fa057f851ef81a5eaaf270d1118d63b83ac3793d3c295717aa8586c9ba1";
const EFFECTIVE_AT = "2026-09-07T10:00:00.000Z";

test("invalid-origin adjudication is prospective, exact, idempotent, and execution-neutral", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  await seedRetainedQualifications(database.pool);
  const repository = createPostgresInvalidOriginIntentAdjudication(database.pool);
  const candidateRepository = { pool: database.pool, ready: async () => undefined, available: true };
  const intentIds = manifest.adjudications.map((entry) => entry.portfolio_order_intent_id);

  const beforeCutoff = await exposure(database.pool, "2026-09-07T09:59:59Z");
  assert.equal(beforeCutoff.pending_order_intents.length, 8);
  assert.equal(beforeCutoff.loss_usage.monetary_availability, "UNAVAILABLE");
  assert.equal((await listTheoreticalEntryCandidates(candidateRepository, {
    limit: 100, portfolioOrderIntentIds: intentIds, now: "2026-09-07T09:59:59Z",
  })).length, 8);

  await assertContradictoryEvidenceRefused(database.pool, repository);
  const dryRun = await adjudicateHistoricalInvalidOriginIntents(command("DRY_RUN"), { repository });
  assert.equal(dryRun.item_count, 8);
  assert.equal(await count(database.pool, "portfolio_invalid_origin_adjudications"), 0);

  const executionRowsBefore = await executionRowCounts(database.pool);
  const applied = await adjudicateHistoricalInvalidOriginIntents(command("APPLY"), { repository });
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.item_count, 8);
  assert.equal(applied.market_execution_effect, "NONE");
  assert.equal(await count(database.pool, "portfolio_invalid_origin_adjudications"), 8);
  assert.deepEqual(await executionRowCounts(database.pool), executionRowsBefore);

  const replayed = await adjudicateHistoricalInvalidOriginIntents(command("APPLY"), { repository });
  assert.equal(replayed.replayed_count, 8);
  assert.equal(await count(database.pool, "portfolio_invalid_origin_adjudications"), 8);

  const knowledgeWindow = await adjudicationKnowledgeWindow(database.pool);
  const stillHistorical = await exposure(database.pool, "2026-09-07T09:59:59Z");
  assert.equal(stillHistorical.pending_order_intents.length, 8);
  const beforeKnowledge = await exposure(database.pool, instantBefore(knowledgeWindow.first));
  assert.equal(beforeKnowledge.pending_order_intents.length, 8,
    "a backdated effective timestamp cannot release before the append was known");
  const afterCutoff = await exposure(database.pool, instantAfter(knowledgeWindow.last));
  assert.equal(afterCutoff.pending_order_intents.length, 0);
  assert.equal(afterCutoff.loss_usage.monetary_availability, "KNOWN");
  assert.equal(afterCutoff.loss_usage.reserved_monetary_risk, 0);
  assert.equal(afterCutoff.loss_usage.daily_loss_monetary, 0);
  assert.equal(afterCutoff.loss_usage.weekly_loss_monetary, 0);
  assert.equal((await listTheoreticalEntryCandidates(candidateRepository, {
    limit: 100, portfolioOrderIntentIds: intentIds, now: instantAfter(knowledgeWindow.last),
  })).length, 0);
  const staleIntentId = intentIds[0];
  await assert.rejects(recordTheoreticalEntryExpired(candidateRepository, {
    result: { portfolio_order_intent_id: staleIntentId, order_intent_id: staleIntentId,
      action: "expire_entry", status: "EXPIRED", reason: "ORDER_INTENT_EXPIRED",
      event_at_utc: "2026-08-27T00:00:00Z" },
    now: instantAfter(knowledgeWindow.last),
  }), { code: "THEORETICAL_INTENT_ADMINISTRATIVELY_CANCELLED" });
  await assertInvalidAttestationRowsRefused(database.pool);

  await seedUnrelatedUnknownReservation(database.pool);
  const preserved = await exposure(database.pool, instantAfter(knowledgeWindow.last));
  assert.equal(preserved.pending_order_intents.length, 1);
  assert.equal(preserved.pending_order_intents[0].portfolio_order_intent_id, "unrelated-reservation");
  assert.equal(preserved.loss_usage.monetary_availability, "UNAVAILABLE");
  await assert.rejects(database.pool.query(
    "UPDATE portfolio_invalid_origin_adjudications SET adjudicated_by='changed'"), /append-only/);
});

async function assertContradictoryEvidenceRefused(pool, repository) {
  const intentId = manifest.adjudications[0].portfolio_order_intent_id;
  await pool.query(`INSERT INTO trade_manual_execution_events
    (manual_execution_event_id,portfolio_order_intent_id,event_type,occurred_at_utc,payload,raw)
    VALUES ($1,$2,'filled','2026-09-07T09:30Z','{}','{}')`, [randomUUID(), intentId]);
  await assert.rejects(adjudicateHistoricalInvalidOriginIntents(command("DRY_RUN"), { repository }),
    { code: "ADJUDICATION_EXECUTION_EVIDENCE_PRESENT" });
  await pool.query("DELETE FROM trade_manual_execution_events WHERE portfolio_order_intent_id=$1", [intentId]);
  await pool.query(`INSERT INTO portfolio_order_intent_execution_states
    (portfolio_order_intent_id,lifecycle_status,provider_order_ref,filled_quantity,payload)
    VALUES ($1,'AWAITING_MANUAL_CONFIRMATION','third-party-order-42',0,'{}')`, [intentId]);
  await assert.rejects(adjudicateHistoricalInvalidOriginIntents(command("DRY_RUN"), { repository }),
    { code: "ADJUDICATION_THIRD_PARTY_REFERENCE_REFUSED" });
  await pool.query("DELETE FROM portfolio_order_intent_execution_states WHERE portfolio_order_intent_id=$1", [intentId]);
}

async function seedRetainedQualifications(pool) {
  for (const [index, source] of sourceManifest.qualifications.entries()) {
    await seedAuthorizedIntent(pool, source.portfolio_order_intent_id, { status: "EXPIRED", gate: "EXPIRED" });
    await pool.query(`UPDATE portfolio_arbitration_runs SET account_id='shadow-grains',portfolio_scope=$2
      WHERE portfolio_arbitration_run_id=$1`, [source.portfolio_order_intent_id, index % 2 ? "scope-b" : "scope-a"]);
    await pool.query("UPDATE portfolio_target_positions SET account_id='shadow-grains' WHERE target_position_id=$1",
      [source.portfolio_order_intent_id]);
    await pool.query(`UPDATE portfolio_order_intent_lineage SET payload_hash=$2,risk_snapshot='{}'::jsonb,
      payload=jsonb_set(payload,'{approved_trade_plan,economics,availability}','\"UNAVAILABLE\"'::jsonb)
      WHERE portfolio_order_intent_id=$1`, [source.portfolio_order_intent_id, source.expected_lineage_payload_hash]);
    await pool.query(`UPDATE human_execution_gates SET payload='{"expired_by":"theoretical_execution_sweeper"}'
      WHERE portfolio_order_intent_id=$1`, [source.portfolio_order_intent_id]);
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
      '2026-09-07T09:00Z','qualification-test','Missing executable origin plan',$7,'{}')`,
  [`qualification:${source.portfolio_order_intent_id}`, source.idempotency_key, source.portfolio_order_intent_id,
    source.expected_lineage_payload_hash, source.expected_target_payload_hash, source.expected_signal_payload_hash,
    SOURCE_MANIFEST_HASH]);
}

async function seedUnrelatedUnknownReservation(pool) {
  await seedAuthorizedIntent(pool, "unrelated-reservation", { status: "EXPIRED" });
  await pool.query("UPDATE portfolio_arbitration_runs SET account_id='shadow-grains',portfolio_scope='scope-c' WHERE portfolio_arbitration_run_id='unrelated-reservation'");
  await pool.query("UPDATE portfolio_target_positions SET account_id='shadow-grains' WHERE target_position_id='unrelated-reservation'");
  await pool.query(`UPDATE portfolio_order_intent_lineage SET risk_snapshot='{}'::jsonb,
    payload=jsonb_set(payload,'{approved_trade_plan,economics,availability}','\"UNAVAILABLE\"'::jsonb)
    WHERE portfolio_order_intent_id='unrelated-reservation'`);
}

function command(mode) {
  return { mode, manifest, effective_at_utc: EFFECTIVE_AT, actor: "operator-test",
    reason: "Explicit administrative closure; operator confirms no open order or position.",
    operator_attestation: { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true, no_open_positions: true } };
}

async function assertInvalidAttestationRowsRefused(pool) {
  for (const [suffix, invalid] of [["empty", {}], ["missing", {
    schema_version: "operator_no_open_exposure_attestation_v1", no_open_orders: true,
  }], ["extra", {
    schema_version: "operator_no_open_exposure_attestation_v1", no_open_orders: true,
    no_open_positions: true, no_provider_execution: true,
  }]]) {
    await assert.rejects(pool.query(`INSERT INTO portfolio_invalid_origin_adjudications (
        portfolio_invalid_origin_adjudication_id,idempotency_key,portfolio_order_intent_id,
        historical_intent_qualification_id,revision,expected_previous_revision,
        expected_qualification_revision,expected_qualification_manifest_hash,status,
        reservation_disposition,effective_at_utc,adjudicated_by,adjudication_reason,
        operator_attestation,operator_attestation_hash,manifest_hash,evidence)
      SELECT portfolio_invalid_origin_adjudication_id || $1,idempotency_key || $1,
        portfolio_order_intent_id,historical_intent_qualification_id,revision + 1,revision,
        expected_qualification_revision,expected_qualification_manifest_hash,status,
        reservation_disposition,effective_at_utc,adjudicated_by,adjudication_reason,
        $2::jsonb,operator_attestation_hash,manifest_hash,evidence
      FROM portfolio_invalid_origin_adjudications LIMIT 1`, [suffix, JSON.stringify(invalid)]), /check constraint/);
  }
}

async function exposure(pool, asOfUtc) {
  const client = await pool.connect();
  try { return await loadTheoreticalExposureAsOf(client, { account_id: "shadow-grains",
    portfolio_scope: "scope-a", execution_mode: "SHADOW", instruments: ["ZC", "ZW"], as_of_utc: asOfUtc,
    risk_budget: { max_monetary_risk: 500, max_daily_loss_monetary: 2000,
      max_weekly_loss_monetary: 4000, max_monetary_risk_currency: "USD" } }); }
  finally { client.release(); }
}

async function executionRowCounts(pool) {
  return { trades: await count(pool, "trades"), fills: await count(pool, "trade_fills"),
    outcomes: await count(pool, "trade_outcomes"), theoreticalEvents: await count(pool, "trade_theoretical_execution_events") };
}

async function adjudicationKnowledgeWindow(pool) {
  const row = (await pool.query(`SELECT min(created_at_utc) AS first,max(created_at_utc) AS last
    FROM portfolio_invalid_origin_adjudications`)).rows[0];
  return { first: new Date(row.first).toISOString(), last: new Date(row.last).toISOString() };
}

function instantBefore(value) { return new Date(Date.parse(value) - 1).toISOString(); }
function instantAfter(value) { return new Date(Date.parse(value) + 1).toISOString(); }

async function count(pool, table) {
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
}
