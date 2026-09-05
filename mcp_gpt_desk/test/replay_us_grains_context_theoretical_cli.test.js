import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTEXT_ONLY_HUMAN_GATE } from "../src/us-grains-context-theoretical-replay.js";
import { runUsGrainsContextTheoreticalReplayCli } from "../scripts/replay_us_grains_context_theoretical.mjs";

test("offline context theoretical CLI writes a non-tradable manifest-backed report", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "grains-context-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, "input.json");
  const output = join(directory, "nested", "output.json");
  await writeFile(input, JSON.stringify(causalInput()), "utf8");

  const artifact = await runUsGrainsContextTheoreticalReplayCli([
    "--input", input, "--output", output, "--start", "2026-07-07", "--end", "2026-07-07", "--as-of", "2026-07-07T18:20:00.000Z",
  ]);
  const saved = JSON.parse(await readFile(output, "utf8"));

  assert.equal(artifact.report_title, CONTEXT_ONLY_HUMAN_GATE);
  assert.equal(saved.report.simulation_constraints.tradable, false);
  assert.equal(saved.manifest.as_of_utc, "2026-07-07T18:20:00.000Z");
  assert.match(saved.manifest.input_sha256, /^sha256:/);
  for (const path of [
    "mcp_gpt_desk/src/us-grains-causal-context.js",
    "mcp_gpt_desk/src/us-grains-causal-session.js",
    "mcp_gpt_desk/src/us-grains-causal-values.js",
    "mcp_gpt_desk/src/us-grains-signal-proposal.js",
    "mcp_gpt_desk/src/us-grains-data-quality.js",
    "mcp_gpt_desk/src/us-grains-strategy-catalog.js",
    "mcp_gpt_desk/src/theoretical-execution-engine.js",
    "packages/desk-domain/package.json",
    "packages/desk-replay-engine/package.json",
  ]) assert.match(saved.manifest.dependency_sha256[path], /^[a-f0-9]{64}$/);
  assert.ok(saved.report.context.raw_signal_count > 0);
});

test("offline context theoretical CLI accepts a frozen ledger and rejects unknown source shapes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "grains-context-ledger-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledgerInput = join(directory, "ledger.json");
  const invalidInput = join(directory, "invalid.json");
  const output = join(directory, "report.json");
  await writeFile(ledgerInput, JSON.stringify({ ledger_frozen: frozenLedger(causalInput()) }), "utf8");
  await writeFile(invalidInput, JSON.stringify({ unsupported: true }), "utf8");

  const artifact = await runUsGrainsContextTheoreticalReplayCli([
    "--input", ledgerInput, "--output", output, "--start", "2026-07-07", "--end", "2026-07-07", "--as-of", "2026-07-07T18:20:00.000Z",
  ]);
  assert.ok(artifact.report.context.raw_signal_count > 0);
  await assert.rejects(
    () => runUsGrainsContextTheoreticalReplayCli(["--input", invalidInput, "--output", join(directory, "invalid-output.json"), "--start", "2026-07-07", "--end", "2026-07-07", "--as-of", "2026-07-07T18:20:00.000Z"]),
    /OFFLINE_REPLAY_SOURCE_INVALID/,
  );
});

test("offline context theoretical CLI requires separate input/output and explicit bounds", async () => {
  await assert.rejects(
    () => runUsGrainsContextTheoreticalReplayCli(["--input", "same.json", "--output", "same.json", "--start", "2026-07-07", "--end", "2026-07-07", "--as-of", "2026-07-07T18:20:00.000Z"]),
    /INPUT_AND_OUTPUT_MUST_DIFFER/,
  );
  await assert.rejects(
    () => runUsGrainsContextTheoreticalReplayCli(["--input", "input.json", "--output", "output.json"]),
    /VALID_DATE_REQUIRED:--start/,
  );
});

function causalInput() {
  return {
    instruments: ["ZW"],
    rowsBySymbol: {
      "ZW1!:5": [...m5Day("2026-07-06T13:30:00.000Z", Array.from({ length: 58 }, () => 99)), ...m5Day("2026-07-07T13:30:00.000Z", Array.from({ length: 20 }, (_, index) => 100 + index * 0.5))],
      "ZW1!:1": warmupM1Prefix(),
    },
    agriEvents: [],
  };
}

function frozenLedger(input) {
  const candles = Object.entries(input.rowsBySymbol).flatMap(([key, rows]) => {
    const [symbol, timeframe] = key.split(":");
    return rows.map((candle) => ({ ...candle, feed_id: `prod__tradingview__${symbol}__${timeframe}` }));
  });
  return { candles, agriEvents: input.agriEvents };
}

function m5Day(startUtc, prices) {
  return prices.map((price, index) => row(addMinutes(startUtc, index * 5), price, price + 0.75, price - 0.25));
}

function warmupM1Prefix() {
  return Array.from({ length: 65 }, (_, index) => row(addMinutes("2026-07-07T13:30:00.000Z", index), 100, 100.5, 99.5));
}

function row(timestamp_utc, open, high, low) {
  return { timestamp_utc, timeframe: "1", is_closed: true, open, high, low, close: open, volume: 10 };
}

function addMinutes(timestamp, minutes) {
  return new Date(Date.parse(timestamp) + minutes * 60_000).toISOString();
}
