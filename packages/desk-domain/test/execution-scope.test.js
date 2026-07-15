import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSameExecutionScope,
  canonicalSha256,
  createDeskExecutionScope,
  defaultCutoffParis,
} from "../index.js";

const base = {
  strategy_id: "ny_open_1530",
  session: "ny_open",
  mode: "replay",
  trading_date: "2026-07-09",
  timezone: "Europe/Paris",
  cutoff_paris: "2026-07-09T15:30:00+02:00",
  cutoff_utc: "2026-07-09T13:30:00Z",
  backtest_id: "bt__ny_open_1530__2026-07-09__fixture",
  pack_id: "2026-07-09_ny_open",
  pack_build_id: "packbuild__2026-07-09_ny_open__fixture",
};

test("creates a deterministic replay scope hash", () => {
  const first = createDeskExecutionScope(base);
  const second = createDeskExecutionScope({ ...base });
  assert.equal(first.scope_hash, second.scope_hash);
  assert.equal(first.cutoff_utc, "2026-07-09T13:30:00.000Z");
  assert.equal(first.scope_hash.length, 64);
  assert.equal(canonicalSha256({ b: 2, a: 1 }), canonicalSha256({ a: 1, b: 2 }));
});

test("rejects a strategy/session mismatch", () => {
  assert.throws(
    () => createDeskExecutionScope({ ...base, session: "asia_open" }),
    (error) => error.code === "STRATEGY_SESSION_MISMATCH",
  );
});

test("requires run and immutable build identifiers in replay mode", () => {
  assert.throws(
    () => createDeskExecutionScope({ ...base, pack_build_id: undefined }),
    (error) => error.code === "SCOPE_REQUIRED" && error.details.field === "pack_build_id",
  );
});

test("validates Europe/Paris summer, winter and DST offsets", () => {
  assert.equal(defaultCutoffParis("asia_open", "2026-07-09"), "2026-07-09T00:15:00+02:00");
  assert.equal(defaultCutoffParis("asia_open", "2026-01-09"), "2026-01-09T00:15:00+01:00");
  assert.equal(defaultCutoffParis("ny_open_1530", "2026-07-09"), "2026-07-09T15:30:00+02:00");
  assert.equal(defaultCutoffParis("ny_open_1530", "2026-01-09"), "2026-01-09T15:30:00+01:00");
  assert.throws(
    () => createDeskExecutionScope({ ...base, cutoff_paris: "2026-07-09T13:30:00+00:00" }),
    (error) => error.code === "TIMEZONE_INVALID",
  );
});

test("blocks cross-run and cross-strategy references", () => {
  const parent = createDeskExecutionScope(base);
  assert.equal(assertSameExecutionScope(parent, createDeskExecutionScope(base)), true);
  assert.throws(
    () => assertSameExecutionScope(parent, { ...parent, backtest_id: "bt__other" }),
    (error) => error.code === "CROSS_SCOPE_REFERENCE",
  );
});
