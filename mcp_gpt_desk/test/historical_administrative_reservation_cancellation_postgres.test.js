import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { cancelHistoricalAdministrativeReservations }
  from "../src/application/cancel-historical-administrative-reservations.js";
import { createPostgresAdministrativeReservationCancellation }
  from "../src/persistence/postgres-administrative-reservation-cancellation.js";
import { listTheoreticalEntryCandidates, recordTheoreticalEntryExpired }
  from "../src/broker-theoretical-execution-repository.js";
import { loadTheoreticalExposureAsOf } from "../src/portfolio-theoretical-exposure-repository.js";
import { createTheoreticalTestDatabase, seedAuthorizedIntent } from "./support/theoretical-postgres-fixtures.js";

const manifest = JSON.parse(await readFile(new URL(
  "../../reports/research/GRAINS_HISTORICAL_ADMINISTRATIVE_RESERVATION_CANCELLATIONS_20260907.json",
  import.meta.url)));
const EFFECTIVE_AT = "2026-09-07T10:00:00.000Z";

test("exact 49 administrative cancellations are prospective, idempotent, and execution neutral", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  await seedReservations(database.pool);
  const repository = createPostgresAdministrativeReservationCancellation(database.pool);

  const candidateRepository = { pool: database.pool, ready: async () => undefined, available: true };
  const historical = await exposure(database.pool, "scope-a", "2026-09-07T09:59:59Z");
  assert.equal(historical.pending_order_intents.length, 49);
  assert.equal((await listTheoreticalEntryCandidates(candidateRepository, {
    limit: 100, portfolioOrderIntentIds: manifest.cancellations.map((entry) => entry.portfolio_order_intent_id),
    now: "2026-09-07T09:59:59Z",
  })).length, 49);
  const lossBefore = lossProjection(historical);

  await assertConcurrentEvidenceRefused(database.pool, repository);
  await assertContradictionsRefused(database.pool, repository);
  await assertCasRefused(database.pool, repository);
  const dryRun = await cancelHistoricalAdministrativeReservations(command("DRY_RUN"), { repository });
  assert.equal(dryRun.item_count, 49);
  assert.equal(await count(database.pool, "portfolio_administrative_reservation_cancellations"), 0);

  const executionBefore = await executionRowCounts(database.pool);
  const applied = await cancelHistoricalAdministrativeReservations(command("APPLY"), { repository });
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.item_count, 49);
  assert.equal(applied.historical_outcome_effect, "UNDETERMINED_PRESERVED");
  assert.equal(applied.market_execution_effect, "NONE");
  assert.equal(await count(database.pool, "portfolio_administrative_reservation_cancellations"), 49);
  assert.deepEqual(await executionRowCounts(database.pool), executionBefore);

  const replayed = await cancelHistoricalAdministrativeReservations(command("APPLY"), { repository });
  assert.equal(replayed.replayed_count, 49);
  assert.equal(await count(database.pool, "portfolio_administrative_reservation_cancellations"), 49);
  await assert.rejects(cancelHistoricalAdministrativeReservations({
    ...command("APPLY"), effective_at_utc: "2026-09-07T12:00:01Z",
  }, { repository }), { code: "ADMIN_CANCELLATION_IDEMPOTENCY_MISMATCH" });

  const knowledge = await cancellationKnowledgeWindow(database.pool);
  const historicalAgain = await exposure(database.pool, "scope-b", "2026-09-07T09:59:59Z");
  assert.equal(historicalAgain.pending_order_intents.length, 49);
  assert.deepEqual(lossProjection(historicalAgain), lossBefore);
  const beforeKnown = await exposure(database.pool, "scope-a", instantBefore(knowledge.first));
  assert.equal(beforeKnown.pending_order_intents.length, 49,
    "effective time alone cannot release before the cancellation was known");
  const releasedA = await exposure(database.pool, "scope-a", instantAfter(knowledge.last));
  const releasedB = await exposure(database.pool, "scope-b", instantAfter(knowledge.last));
  for (const released of [releasedA, releasedB]) {
    assert.equal(released.pending_order_intents.length, 0);
    assert.equal(released.loss_usage.monetary_availability, "KNOWN");
    assert.equal(released.loss_usage.reserved_monetary_risk, 0);
    assert.deepEqual(lossProjection(released), lossBefore);
  }
  assert.equal((await listTheoreticalEntryCandidates(candidateRepository, {
    limit: 100, portfolioOrderIntentIds: manifest.cancellations.map((entry) => entry.portfolio_order_intent_id),
    now: instantAfter(knowledge.last),
  })).length, 0);
  const staleIntentId = manifest.cancellations[0].portfolio_order_intent_id;
  await assert.rejects(recordTheoreticalEntryExpired(candidateRepository, {
    result: { portfolio_order_intent_id: staleIntentId, order_intent_id: staleIntentId,
      action: "expire_entry", status: "EXPIRED", reason: "ORDER_INTENT_EXPIRED",
      event_at_utc: "2026-06-11T23:00:00Z" },
    now: instantAfter(knowledge.last),
  }), { code: "THEORETICAL_INTENT_ADMINISTRATIVELY_CANCELLED" });
  assert.equal(await count(database.pool, "trade_theoretical_execution_events"), 0);

  await assertDatabaseGuards(database.pool);
  await assertCancellationWinsStaleTheoreticalWrite(database.pool, candidateRepository);
  await seedUnrelatedReservation(database.pool);
  const preserved = await exposure(database.pool, "scope-a", instantAfter(knowledge.last));
  assert.equal(preserved.pending_order_intents.length, 1);
  assert.equal(preserved.pending_order_intents[0].portfolio_order_intent_id, "unrelated-reservation");
  await assert.rejects(database.pool.query(
    "DELETE FROM portfolio_administrative_reservation_cancellations"), /append-only/);
});

async function seedReservations(pool) {
  for (const [index, specification] of manifest.cancellations.entries()) {
    await seedAuthorizedIntent(pool, specification.portfolio_order_intent_id, {
      status: "EXPIRED", gate: "EXPIRED",
    });
    await pool.query(`UPDATE portfolio_arbitration_runs SET account_id='shadow-grains',portfolio_scope=$2
      WHERE portfolio_arbitration_run_id=$1`, [specification.portfolio_order_intent_id,
      index % 2 ? "scope-b" : "scope-a"]);
    await pool.query(`UPDATE portfolio_target_positions SET account_id='shadow-grains',instrument=$2
      WHERE target_position_id=$1`, [specification.portfolio_order_intent_id,
      index % 3 === 0 ? "MES" : index % 3 === 1 ? "MNQ" : "ZW"]);
    await pool.query(`UPDATE portfolio_order_intent_lineage SET payload_hash=$2,
      risk_snapshot=jsonb_build_object('risk_per_contract',10,'currency','USD','availability','KNOWN')
      WHERE portfolio_order_intent_id=$1`, [specification.portfolio_order_intent_id,
      specification.expected_lineage_payload_hash]);
    await pool.query(`UPDATE human_execution_gates SET payload='{"expired_by":"theoretical_execution_sweeper"}'
      WHERE portfolio_order_intent_id=$1`, [specification.portfolio_order_intent_id]);
    if (index % 2 === 0) {
      await pool.query(`INSERT INTO portfolio_order_intent_execution_states
        (portfolio_order_intent_id,lifecycle_status,filled_quantity,payload) VALUES ($1,'EXPIRED',0,'{}')`,
      [specification.portfolio_order_intent_id]);
    }
  }
}

async function assertContradictionsRefused(pool, repository) {
  const intentId = manifest.cancellations[0].portfolio_order_intent_id;
  await pool.query(`INSERT INTO trade_manual_execution_events
    (manual_execution_event_id,portfolio_order_intent_id,event_type,occurred_at_utc,payload,raw)
    VALUES ($1,$2,'filled','2026-09-07T11:30Z','{}','{}')`, [randomUUID(), intentId]);
  await assert.rejects(cancelHistoricalAdministrativeReservations(command("DRY_RUN"), { repository }),
    { code: "ADMIN_CANCELLATION_EXECUTION_EVIDENCE_PRESENT" });
  await pool.query("DELETE FROM trade_manual_execution_events WHERE portfolio_order_intent_id=$1", [intentId]);

  await pool.query(`UPDATE portfolio_order_intent_execution_states
    SET provider_order_ref='provider-order-42' WHERE portfolio_order_intent_id=$1`, [intentId]);
  await assert.rejects(cancelHistoricalAdministrativeReservations(command("DRY_RUN"), { repository }),
    { code: "ADMIN_CANCELLATION_EXECUTION_EVIDENCE_PRESENT" });
  await pool.query(`UPDATE portfolio_order_intent_execution_states
    SET provider_order_ref=NULL WHERE portfolio_order_intent_id=$1`, [intentId]);

  await pool.query(`INSERT INTO trade_theoretical_execution_events
    (theoretical_execution_event_id,portfolio_order_intent_id,event_type,event_at_utc,quantity,price,payload,raw)
    VALUES ($1,$2,'entry_filled','2026-09-07T11:30Z',1,100,'{}','{}')`, [randomUUID(), intentId]);
  await assert.rejects(cancelHistoricalAdministrativeReservations(command("DRY_RUN"), { repository }),
    { code: "ADMIN_CANCELLATION_EXECUTION_EVIDENCE_PRESENT" });
  await pool.query("DELETE FROM trade_theoretical_execution_events WHERE portfolio_order_intent_id=$1", [intentId]);
}

async function assertConcurrentEvidenceRefused(pool, repository) {
  const intentId = manifest.cancellations[0].portfolio_order_intent_id;
  const evidenceClient = await pool.connect();
  try {
    await evidenceClient.query("BEGIN");
    await evidenceClient.query(`INSERT INTO trade_manual_execution_events
      (manual_execution_event_id,portfolio_order_intent_id,event_type,occurred_at_utc,payload,raw)
      VALUES ($1,$2,'placed','2026-09-07T11:25Z','{}','{}')`, [randomUUID(), intentId]);
    const cancellation = cancelHistoricalAdministrativeReservations(command("APPLY"), { repository });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await evidenceClient.query("COMMIT");
    await assert.rejects(cancellation, { code: "ADMIN_CANCELLATION_EXECUTION_EVIDENCE_PRESENT" });
  } finally {
    await evidenceClient.query("ROLLBACK").catch(() => undefined);
    evidenceClient.release();
  }
  await pool.query("DELETE FROM trade_manual_execution_events WHERE portfolio_order_intent_id=$1", [intentId]);
  assert.equal(await count(pool, "portfolio_administrative_reservation_cancellations"), 0,
    "the exact batch remains atomic when concurrent evidence wins the lineage lock");
}

async function assertCasRefused(pool, repository) {
  const specification = manifest.cancellations[0];
  await pool.query("UPDATE portfolio_order_intent_lineage SET payload_hash=$2 WHERE portfolio_order_intent_id=$1",
    [specification.portfolio_order_intent_id, `sha256:${"f".repeat(64)}`]);
  await assert.rejects(cancelHistoricalAdministrativeReservations(command("DRY_RUN"), { repository }),
    { code: "ADMIN_CANCELLATION_LINEAGE_HASH_MISMATCH" });
  await pool.query("UPDATE portfolio_order_intent_lineage SET payload_hash=$2 WHERE portfolio_order_intent_id=$1",
    [specification.portfolio_order_intent_id, specification.expected_lineage_payload_hash]);
}

async function assertDatabaseGuards(pool) {
  const row = (await pool.query("SELECT * FROM portfolio_administrative_reservation_cancellations LIMIT 1")).rows[0];
  for (const [suffix, operatorAttestation, evidence] of [
    ["empty-attestation", {}, row.evidence],
    ["missing-attestation", { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true }, row.evidence],
    ["provider-evidence", row.operator_attestation, { ...row.evidence, provider_event_count: 1 }],
  ]) {
    await assert.rejects(pool.query(`INSERT INTO portfolio_administrative_reservation_cancellations (
        portfolio_administrative_reservation_cancellation_id,idempotency_key,portfolio_order_intent_id,
        revision,expected_previous_revision,expected_lineage_payload_hash,expected_lineage_status,status,
        reservation_disposition,historical_outcome_disposition,effective_at_utc,cancelled_by,
        cancellation_reason,operator_attestation,operator_attestation_hash,manifest_hash,evidence)
      VALUES ($1,$2,$3,2,1,$4,'EXPIRED','CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE',
        'ADMINISTRATIVELY_RELEASED','UNDETERMINED_PRESERVED',$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)`,
    [`invalid-${suffix}`, `invalid-${suffix}`, row.portfolio_order_intent_id,
      row.expected_lineage_payload_hash, row.effective_at_utc, row.cancelled_by, row.cancellation_reason,
      JSON.stringify(operatorAttestation), row.operator_attestation_hash, row.manifest_hash,
      JSON.stringify(evidence)]), /check constraint|duplicate key/);
  }
}

async function assertCancellationWinsStaleTheoreticalWrite(pool, candidateRepository) {
  const intentId = "race-cancel-reservation";
  await seedAuthorizedIntent(pool, intentId, { status: "EXPIRED", gate: "EXPIRED" });
  const cancellationClient = await pool.connect();
  try {
    await cancellationClient.query("BEGIN");
    await cancellationClient.query(`SELECT portfolio_order_intent_id FROM portfolio_order_intent_lineage
      WHERE portfolio_order_intent_id=$1 FOR UPDATE`, [intentId]);
    const staleWrite = recordTheoreticalEntryExpired(candidateRepository, {
      result: { portfolio_order_intent_id: intentId, order_intent_id: intentId,
        action: "expire_entry", status: "EXPIRED", reason: "ORDER_INTENT_EXPIRED",
      event_at_utc: "2026-09-04T14:03:00Z" }, now: "2026-09-07T10:00:00Z",
    });
    const manualWrite = pool.query(`INSERT INTO trade_manual_execution_events
      (manual_execution_event_id,portfolio_order_intent_id,event_type,occurred_at_utc,payload,raw)
      VALUES ($1,$2,'placed','2026-09-07T10:01Z','{}','{}')`, [randomUUID(), intentId]);
    const stateWrite = pool.query(`INSERT INTO portfolio_order_intent_execution_states
      (portfolio_order_intent_id,lifecycle_status,filled_quantity,payload)
      VALUES ($1,'FILLED',1,'{}')`, [intentId]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const zeroEvidence = { schema_version: "portfolio_administrative_reservation_cancellation_evidence_v1",
      provider_command_count: 0, provider_event_count: 0, broker_order_count: 0,
      broker_order_event_count: 0, trade_count: 0, fill_count: 0, manual_execution_event_count: 0,
      theoretical_entry_fill_count: 0, unexpected_theoretical_event_count: 0,
      third_party_reference_count: 0, filled_quantity: 0, lifecycle_status: null,
      market_execution_effect: "NONE" };
    const attestation = { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true, no_open_positions: true };
    await cancellationClient.query(`INSERT INTO portfolio_administrative_reservation_cancellations (
        portfolio_administrative_reservation_cancellation_id,idempotency_key,portfolio_order_intent_id,
        revision,expected_previous_revision,expected_lineage_payload_hash,expected_lineage_status,status,
        reservation_disposition,historical_outcome_disposition,effective_at_utc,cancelled_by,
        cancellation_reason,operator_attestation,operator_attestation_hash,manifest_hash,evidence)
      SELECT 'race-cancellation','race-cancellation',portfolio_order_intent_id,1,0,payload_hash,'EXPIRED',
        'CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE','ADMINISTRATIVELY_RELEASED','UNDETERMINED_PRESERVED',
        clock_timestamp(),'operator-test','Concurrency guard test',$2::jsonb,$3,$3,$4::jsonb
      FROM portfolio_order_intent_lineage WHERE portfolio_order_intent_id=$1`,
    [intentId, JSON.stringify(attestation), "a".repeat(64), JSON.stringify(zeroEvidence)]);
    await cancellationClient.query("COMMIT");
    const results = await Promise.allSettled([staleWrite, manualWrite, stateWrite]);
    assert.equal(results[0].status, "rejected");
    assert.equal(results[0].reason.code, "THEORETICAL_INTENT_ADMINISTRATIVELY_CANCELLED");
    for (const result of results.slice(1)) {
      assert.equal(result.status, "rejected");
      assert.match(result.reason.message, /execution evidence refused after administrative reservation release/);
    }
  } finally {
    await cancellationClient.query("ROLLBACK").catch(() => undefined);
    cancellationClient.release();
  }
  assert.equal(Number((await pool.query(`SELECT count(*) FROM trade_theoretical_execution_events
    WHERE portfolio_order_intent_id=$1`, [intentId])).rows[0].count), 0);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM trades
    WHERE portfolio_order_intent_id=$1`, [intentId])).rows[0].count), 0);
}

async function seedUnrelatedReservation(pool) {
  await seedAuthorizedIntent(pool, "unrelated-reservation", { status: "EXPIRED" });
  await pool.query("UPDATE portfolio_arbitration_runs SET account_id='shadow-grains' WHERE portfolio_arbitration_run_id='unrelated-reservation'");
  await pool.query("UPDATE portfolio_target_positions SET account_id='shadow-grains' WHERE target_position_id='unrelated-reservation'");
}

function command(mode) {
  return { mode, manifest, effective_at_utc: EFFECTIVE_AT, actor: "operator-test",
    reason: "Explicit administrative closure; no corresponding order or position is open.",
    operator_attestation: { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true, no_open_positions: true } };
}

async function exposure(pool, scope, asOfUtc) {
  const client = await pool.connect();
  try {
    return await loadTheoreticalExposureAsOf(client, { account_id: "shadow-grains", portfolio_scope: scope,
      execution_mode: "SHADOW", instruments: ["MES", "MNQ", "ZW"], as_of_utc: asOfUtc,
      risk_budget: { max_monetary_risk: 500, max_daily_loss_monetary: 2000,
        max_weekly_loss_monetary: 4000, max_monetary_risk_currency: "USD" } });
  } finally { client.release(); }
}

function lossProjection(snapshot) {
  return { daily_loss_monetary: snapshot.loss_usage.daily_loss_monetary,
    weekly_loss_monetary: snapshot.loss_usage.weekly_loss_monetary,
    daily_realized_r: snapshot.loss_usage.daily_realized_r,
    weekly_realized_r: snapshot.loss_usage.weekly_realized_r,
    final_outcome_count: snapshot.loss_usage.final_outcome_count };
}

async function executionRowCounts(pool) {
  return { trades: await count(pool, "trades"), fills: await count(pool, "trade_fills"),
    outcomes: await count(pool, "trade_outcomes"),
    theoreticalEvents: await count(pool, "trade_theoretical_execution_events") };
}
async function cancellationKnowledgeWindow(pool) {
  const row = (await pool.query(`SELECT min(created_at_utc) AS first,max(created_at_utc) AS last
    FROM portfolio_administrative_reservation_cancellations`)).rows[0];
  return { first: new Date(row.first).toISOString(), last: new Date(row.last).toISOString() };
}
function instantBefore(value) { return new Date(Date.parse(value) - 1).toISOString(); }
function instantAfter(value) { return new Date(Date.parse(value) + 1).toISOString(); }
async function count(pool, table) {
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
}
