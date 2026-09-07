import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { MarketContextRepository } from "../src/market-context-repository.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

test("market context read fails fast on a saturated one-client pool and recovers after release",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
    const database = await createTheoreticalTestDatabase();
    const constrained = new pg.Pool({
      host: database.pool.options.host,
      port: database.pool.options.port,
      user: database.pool.options.user,
      password: database.pool.options.password,
      database: database.pool.options.database,
      max: 1,
      connectionTimeoutMillis: 75,
    });
    const held = await constrained.connect();
    let heldReleased = false;
    const repository = new MarketContextRepository({ pool: constrained, initialized: Promise.resolve() });
    try {
      await assert.rejects(
        () => repository.current("US_GRAINS_CBOT", "2026-09-07T18:30:00.000Z"),
        { code: "MARKET_CONTEXT_POOL_CHECKOUT_TIMEOUT" },
      );
      held.release();
      heldReleased = true;
      const recovered = await repository.current("US_GRAINS_CBOT", "2026-09-07T18:30:00.000Z");
      assert.equal(recovered.readStatus, "AVAILABLE");
      assert.equal(recovered.snapshot, null);
      assert.equal(recovered.brief, null);
    } finally {
      if (!heldReleased) held.release();
      await constrained.end();
      await database.close();
    }
  });
