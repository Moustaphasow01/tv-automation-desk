import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";
import { MarketContextRepository } from "../src/market-context-repository.js";
import { DomainEventOutboxRepository } from "../src/domain-event-outbox-repository.js";
import { StrategySignalBusService } from "../src/strategy-signal-bus-service.js";
import { PostgresStrategySignalBusRepository } from "../src/strategy-signal-bus-repository.js";
import { createStrategySignalDecisionPipelineService } from "../src/strategy-signal-decision-pipeline-service.js";
import { grainSignal } from "./support/causal-grain-signal-fixture.js";

const NOW = "2026-09-04T15:00:00.000Z";

test(
  "TD2-429 raw bus persists context refusal and admitted Risk/Intent/HumanGate without provider commands",
  {
    skip: process.env.RUN_POSTGRES_TESTS !== "1",
  },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const store = await createStore(database.pool);
    const ids = await seedStrategy(database.pool);
    const bus = new StrategySignalBusService({
      repository: new PostgresStrategySignalBusRepository(store.persistence),
      clock: store.clock,
    });
    const long = grainSignal({ ...ids, direction: "LONG" });
    const short = grainSignal({ ...ids, direction: "SHORT" });
    await bus.publishSignal(long, {}, { requireRunningInstance: true });
    await bus.publishSignal(short, {}, { requireRunningInstance: true });
    assert.equal((await bus.pollPendingSignals({ now_utc: NOW })).count, 2);

    const pipeline = createStrategySignalDecisionPipelineService({ store });
    const result = await pipeline.runOnce({
      now_utc: NOW,
      account_id: "causal-shadow",
      prefer_embedded_context_gate_decision: true,
    });
    assert.equal(result.context_prefilter.admissible, 1);
    assert.equal(result.context_prefilter.rejected, 1);
    assert.equal(result.human_gate_count, 1);
    assert.equal(result.order_intent_count, 1);
    const decisions = (
      await database.pool.query(
        "SELECT signal_id, decision, market_context_snapshot_id FROM market_context_prefilter_decisions",
      )
    ).rows;
    assert.equal(
      decisions.find((row) => row.signal_id === short.signal_id).decision,
      "REJECT",
    );
    assert.equal(
      decisions.find((row) => row.signal_id === long.signal_id)
        .market_context_snapshot_id,
      null,
    );
    const contextEvents = (
      await database.pool.query(
        "SELECT payload FROM domain_event_outbox WHERE event_type = 'market.context.prefilter.decided'",
      )
    ).rows;
    assert.equal(contextEvents.length, 2);
    assert.ok(
      contextEvents.every(
        (row) => row.payload.contextSource === "CAUSAL_SIGNAL_PREFIX",
      ),
    );
    assert.equal(
      contextEvents.find((row) => row.payload.signalId === long.signal_id)
        .payload.contextGate.recommendation,
      "TAKE",
    );
    const intent = (
      await database.pool.query(
        "SELECT payload FROM portfolio_order_intent_lineage",
      )
    ).rows[0].payload;
    assert.equal(intent.instrument, "ZW");
    assert.equal(intent.execution_terms.entry.price, 500);
    assert.equal(intent.execution_terms.stop.price, 498);
    assert.equal(intent.execution_terms.targets[0].price, 503);
    assert.equal(
      (await database.pool.query("SELECT status FROM human_execution_gates"))
        .rows[0].status,
      "AWAITING_MANUAL_CONFIRMATION",
    );
    assert.equal(
      Number(
        (
          await database.pool.query(
            "SELECT count(*) AS count FROM broker_provider_commands",
          )
        ).rows[0].count,
      ),
      0,
    );
    assert.equal(result.provider_counts.unchanged, true);
    assert.equal(
      (await pipeline.runOnce({ now_utc: NOW, account_id: "causal-shadow" }))
        .human_gate_count || 0,
      0,
    );
  },
);

async function createStore(pool) {
  const persistence = { pool, initialized: Promise.resolve() };
  const clock = { now: () => ({ utc: NOW, epochMs: Date.parse(NOW) }) };
  return {
    persistence,
    clock,
    marketContext: new MarketContextRepository(persistence, { clock }),
    domainEvents: new DomainEventOutboxRepository(persistence),
  };
}

async function seedStrategy(pool) {
  const ids = {
    strategy_definition_id: randomUUID(),
    strategy_version_id: randomUUID(),
    strategy_instance_id: randomUUID(),
  };
  await pool.query(
    `INSERT INTO strategy_definitions (strategy_definition_id,external_key,name,owner)
    VALUES ($1,'causal-pipeline-test','Causal grains test','test')`,
    [ids.strategy_definition_id],
  );
  await pool.query(
    `INSERT INTO strategy_versions (strategy_version_id,strategy_definition_id,version_label,
    dsl_source_hash,compiled_artifact_ref,runtime_contract_bundle_version)
    VALUES ($1,$2,'test-v2',$3,'test://causal-grains','test-v2')`,
    [
      ids.strategy_version_id,
      ids.strategy_definition_id,
      `sha256:${"a".repeat(64)}`,
    ],
  );
  await pool.query(
    `INSERT INTO strategy_instances (strategy_instance_id,strategy_version_id,runtime_state,execution_mode,instrument_scope,last_heartbeat_at)
    VALUES ($1,$2,'running','shadow',ARRAY['ZW'],$3)`,
    [ids.strategy_instance_id, ids.strategy_version_id, NOW],
  );
  return ids;
}
