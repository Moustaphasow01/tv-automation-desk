import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateHumanGateUndoV1, humanGateUndoDeadlineV1 } from "../index.js";

const policy = { enabled: true, windowSeconds: 10 };

describe("human execution gate v1", () => {
  test("allows a revision-matched undo inside the bounded window", () => {
    const result = evaluateHumanGateUndoV1({
      gate: { status: "CONFIRMED", revision: 2, confirmed_at_utc: "2026-08-30T10:00:00.000Z", expires_at_utc: "2026-08-30T10:15:00.000Z" },
      nowUtc: "2026-08-30T10:00:05.000Z",
      expectedRevision: 2,
      providerCommandCount: 0,
      policy,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.nextState, "AWAITING_MANUAL_CONFIRMATION");
    assert.equal(result.undoExpiresAtUtc, "2026-08-30T10:00:10.000Z");
  });

  test("fails closed after provider dispatch, expiry, revision drift or disabled policy", () => {
    const gate = { status: "REJECTED", revision: 3, rejected_at_utc: "2026-08-30T10:00:00.000Z", expires_at_utc: "2026-08-30T10:15:00.000Z" };
    assert.equal(evaluateHumanGateUndoV1({ gate, nowUtc: "2026-08-30T10:00:05.000Z", expectedRevision: 3, providerCommandCount: 1, policy }).reason, "HUMAN_GATE_PROVIDER_COMMAND_EXISTS");
    assert.equal(evaluateHumanGateUndoV1({ gate, nowUtc: "2026-08-30T10:00:11.000Z", expectedRevision: 3, policy }).reason, "HUMAN_GATE_UNDO_WINDOW_EXPIRED");
    assert.equal(evaluateHumanGateUndoV1({ gate, nowUtc: "2026-08-30T10:00:05.000Z", expectedRevision: 2, policy }).reason, "HUMAN_GATE_REVISION_CONFLICT");
    assert.equal(evaluateHumanGateUndoV1({ gate, nowUtc: "2026-08-30T10:00:05.000Z", expectedRevision: 3, policy: { enabled: false } }).reason, "HUMAN_GATE_UNDO_DISABLED");
  });

  test("never extends undo beyond the gate expiry", () => {
    assert.equal(humanGateUndoDeadlineV1({
      decidedAtUtc: "2026-08-30T10:00:00.000Z",
      gateExpiresAtUtc: "2026-08-30T10:00:04.000Z",
      policy,
    }), "2026-08-30T10:00:04.000Z");
  });
});
