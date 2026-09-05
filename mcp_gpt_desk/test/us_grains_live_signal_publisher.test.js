import assert from "node:assert/strict";
import test from "node:test";
import { publishActionableGrainSignals } from "../src/us-grains-live-signal-publisher.js";

test("TD2-429 uses the internal running-instance publisher for grains", async () => {
  const calls = [];
  const store = {
    async publishRunningStrategyV2Signal({ input }) {
      calls.push(input.strategy_instance_id);
      return { status: "PUBLISHED", signal: input, outbox: { signal_outbox_id: "outbox-1" } };
    },
  };
  const result = await publishActionableGrainSignals({ store, signals: [signal()], requireRunningInstance: true });

  assert.deepEqual(calls, ["11111111-1111-4111-8111-111111111111"]);
  assert.equal(result.published_count, 1);
});

test("TD2-429 does not silently downgrade a guarded grains publish", async () => {
  await assert.rejects(
    () => publishActionableGrainSignals({ store: { publishStrategyV2Signal: async () => ({}) }, signals: [signal()], requireRunningInstance: true }),
    /publishRunningStrategyV2Signal/,
  );
});

test("TD2-429 skips a paused instance and continues the guarded grains batch", async () => {
  const published = [];
  const result = await publishActionableGrainSignals({
    requireRunningInstance: true,
    store: {
      async publishRunningStrategyV2Signal({ input }) {
        if (input.strategy_instance_id.endsWith("222222222222")) {
          const error = new Error("paused");
          error.code = "STRATEGY_SIGNAL_INSTANCE_NOT_RUNNING";
          throw error;
        }
        published.push(input.strategy_instance_id);
        return { status: "PUBLISHED", signal: input, outbox: { signal_outbox_id: `outbox-${input.signal_id}` } };
      },
    },
    signals: [signal(), { ...signal(), signal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", strategy_instance_id: "22222222-2222-4222-8222-222222222222" }],
  });

  assert.deepEqual(published, ["11111111-1111-4111-8111-111111111111"]);
  assert.equal(result.published_count, 1);
  assert.equal(result.skipped_count, 1);
  assert.equal(result.skipped[0].reason, "STRATEGY_SIGNAL_INSTANCE_NOT_RUNNING");
});

function signal() {
  return {
    signal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    strategy_instance_id: "11111111-1111-4111-8111-111111111111",
    instrument: "ZW", direction: "LONG",
    generated_at_utc: "2026-08-10T14:45:00.000Z", expires_at_utc: "2026-08-10T16:00:00.000Z",
  };
}
