import test from "node:test";
import assert from "node:assert/strict";
import {
  executeFrontOperatorCommand,
  FRONT_OPERATOR_CONFIRMATION_PHRASES,
  frontOperatorCommandId,
  frontOperatorStateId,
  loadFrontOperatorState,
} from "../src/front-operator-commands.js";
import { loadFrontDeskSession } from "../src/front-session-projection.js";

const scope = {
  strategyId: "asia_open",
  session: "asia_open",
  tradingDate: "2026-07-14",
  mode: "live",
};

function operatorStore() {
  const setup = {
    setup_record_id: "master-1_setup-1",
    setup_id: "setup-1",
    label: "Rebond support",
    instrument: "MNQ",
    direction: "long",
    status: "ARMED",
    entry_zone: { from: 22_000, to: 22_010 },
    stop_loss: 21_980,
  };
  const thesis = {
    thesis_id: "thesis-1",
    instrument: "MNQ",
    direction: "long",
    status: "THESIS_ACTIVE",
    confidence_pct: 65,
    health_score: 70,
  };
  const position = {
    position_id: "position-1",
    linked_thesis_id: "thesis-1",
    instrument: "MNQ",
    direction: "long",
    status: "active",
    entry_price: 22_000,
    current_price: 22_025,
  };
  const monitor = {
    monitor_id: "monitor-1",
    linked_master_analysis_id: "master-1",
    linked_active_thesis_id: "thesis-1",
    timestamp_paris: "2026-07-14T10:15:00+02:00",
    monitor_decision: { action: "MAINTAIN", reason_summary: "Le support reste valide." },
    thesis_health_score: { previous_score: 68, current_score: 70 },
  };
  const state = { setup, thesis, position, monitor, operatorState: null, commands: new Map(), audits: new Map(), jobs: new Map() };
  const store = {
    state,
    clock: { now: () => ({ utc: "2026-07-14T08:20:00.000Z", paris: "2026-07-14T10:20:00+02:00", epochMs: 1 }) },
    async getLiveDeskState(input) {
      return {
        ...input,
        strategy_id: input.strategy_id,
        session: input.session,
        trading_date: input.trading_date,
        mode: input.mode,
        resolved_scope: input,
        desk_status: state.thesis.status,
        action_now: { decision: "WAIT", message: "Surveiller le support." },
        active_thesis: state.thesis,
        latest_master: { analysis_id: "master-1", instrument: "MNQ" },
        active_position: state.position,
        key_levels: [],
        data_readiness: {},
        jobs: [...state.jobs.values()],
        alerts: [],
        contracts: {},
      };
    },
    async getLatestMasterAnalysis() {
      return {
        analysis: {
          analysis_id: "master-1",
          created_at_paris: "2026-07-14T08:00:00+02:00",
          full_analysis: { executive_summary: { summary: "Plan courant.", final_instrument: "MNQ", final_direction: "long" } },
        },
      };
    },
    async getLatestManualMonitor() { return { monitors: [state.monitor] }; },
    async getLatestHourlyMonitor() { return { monitors: [] }; },
    async getAuditState() { return {}; },
    async getSessionSnapshot() { return {}; },
    async getDeskSetups() { return { setups: [state.setup] }; },
    async getFrontOperatorCommandState() {
      if (!state.operatorState) throw new Error("not_found");
      return state.operatorState;
    },
    async getFrontOperatorCommand({ command_id }) {
      const command = state.commands.get(command_id);
      if (!command) throw new Error("not_found");
      return command;
    },
    async commitFrontOperatorCommandMutation(plan) {
      const existing = state.commands.get(plan.commandId);
      if (existing) return { replayed: true, command: existing, result: existing.result };
      assert.equal(Number(state.operatorState?.revision || 0), plan.expectedRevision);
      for (const write of plan.writes) {
        if (write.collection === "desk_setups") state.setup = write.data;
        if (write.collection === "desk_active_theses") state.thesis = write.data;
        if (write.collection === "desk_positions") state.position = write.data;
        if (write.collection === "desk_jobs") state.jobs.set(write.documentId, write.data);
      }
      state.operatorState = plan.stateDoc;
      state.commands.set(plan.commandId, plan.commandDoc);
      state.audits.set(plan.auditDoc.audit_id, plan.auditDoc);
      return { replayed: false, command: plan.commandDoc, result: plan.result };
    },
  };
  return store;
}

test("operator state exposes revisioned canonical capabilities without broker execution", async () => {
  const store = operatorStore();
  const value = await loadFrontOperatorState(store, scope);
  assert.equal(value.revision, 0);
  assert.equal(value.setup.id, "master-1_setup-1");
  assert.equal(value.position.id, "position-1");
  assert.equal(value.allowedCommands.find((item) => item.command === "confirm_trigger").enabled, true);
  assert.equal(value.allowedCommands.find((item) => item.command === "move_break_even").enabled, true);
  assert.equal(value.brokerExecution, false);
});

test("confirmed command updates canonical state, audit and revision and is idempotent", async () => {
  const store = operatorStore();
  const input = {
    ...scope,
    command: "confirm_trigger",
    targetId: "master-1_setup-1",
    expectedRevision: 0,
    idempotencyKey: "confirm-trigger-20260714-1",
    confirmationPhrase: FRONT_OPERATOR_CONFIRMATION_PHRASES.confirm_trigger,
    reason: "Déclencheur prix confirmé par l’opérateur.",
  };
  const first = await executeFrontOperatorCommand(store, input, { kind: "local_operator", email: "operator@example.com" });
  assert.equal(first.idempotent, false);
  assert.equal(first.command.revision, 1);
  assert.equal(first.session.setup.status, "SETUP_TRIGGERED");
  assert.equal(store.state.thesis.status, "SETUP_TRIGGERED");
  assert.equal(store.state.audits.size, 1);
  assert.equal(first.command.brokerExecution, false);

  const replay = await executeFrontOperatorCommand(store, input, { kind: "local_operator", email: "operator@example.com" });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.command.id, first.command.id);
  assert.equal(store.state.audits.size, 1);
});

test("stale revision and incorrect confirmation are rejected", async () => {
  const store = operatorStore();
  const base = {
    ...scope,
    command: "take_partial",
    targetId: "position-1",
    expectedRevision: 0,
    idempotencyKey: "take-partial-20260714-1",
    confirmationPhrase: FRONT_OPERATOR_CONFIRMATION_PHRASES.take_partial,
    reason: "TP1 atteint et réduction du risque confirmée.",
    partialFraction: 0.5,
  };
  await executeFrontOperatorCommand(store, base, { kind: "api_key" });
  await assert.rejects(
    executeFrontOperatorCommand(store, { ...base, idempotencyKey: "take-partial-20260714-2" }, { kind: "api_key" }),
    (error) => error.code === "REVISION_CONFLICT" && error.statusCode === 409,
  );
  await assert.rejects(
    executeFrontOperatorCommand(operatorStore(), { ...base, confirmationPhrase: "YES" }, { kind: "api_key" }),
    (error) => error.code === "INVALID_OPERATOR_COMMAND" && error.statusCode === 400,
  );
});

test("E2E Master → Monitor → Setup → Position → clôture conserve révisions et audit", async () => {
  const store = operatorStore();
  const initial = await loadFrontDeskSession(store, scope);
  assert.equal(initial.master.id, "master-1");
  assert.equal(initial.monitors[0].id, "monitor-1");
  assert.equal(initial.setup.status, "ARMED");
  assert.equal(initial.position.active, true);

  const commands = [
    {
      command: "confirm_trigger",
      targetId: "master-1_setup-1",
      confirmationPhrase: FRONT_OPERATOR_CONFIRMATION_PHRASES.confirm_trigger,
      reason: "Déclencheur déterministe validé après le Monitor.",
    },
    {
      command: "move_break_even",
      targetId: "position-1",
      confirmationPhrase: FRONT_OPERATOR_CONFIRMATION_PHRASES.move_break_even,
      reason: "Le prix autorise la protection au niveau d’entrée.",
    },
    {
      command: "take_partial",
      targetId: "position-1",
      confirmationPhrase: FRONT_OPERATOR_CONFIRMATION_PHRASES.take_partial,
      reason: "Premier objectif atteint, réduction du risque.",
      partialFraction: 0.5,
    },
    {
      command: "exit_position",
      targetId: "position-1",
      confirmationPhrase: FRONT_OPERATOR_CONFIRMATION_PHRASES.exit_position,
      reason: "Clôture opérateur confirmée au prix canonique courant.",
    },
  ];

  let result;
  for (const [index, command] of commands.entries()) {
    result = await executeFrontOperatorCommand(store, {
      ...scope,
      ...command,
      expectedRevision: index,
      idempotencyKey: `lifecycle-command-${index + 1}`,
    }, { kind: "local_operator", email: "operator@example.com" });
    assert.equal(result.command.revision, index + 1);
    assert.equal(result.command.brokerExecution, false);
  }

  assert.equal(store.state.setup.status, "SETUP_TRIGGERED");
  assert.equal(store.state.position.status, "closed");
  assert.equal(store.state.position.exit_price, 22_025);
  assert.equal(result.session.position.active, false);
  assert.equal(result.session.position.status, "closed");
  assert.equal(store.state.commands.size, 4);
  assert.equal(store.state.audits.size, 4);
});

test("operator ids are stable per scope and idempotency key", () => {
  assert.equal(frontOperatorStateId(scope), "front_operator__asia_open__2026-07-14__asia_open__live");
  assert.equal(frontOperatorCommandId(scope, "stable-key-123"), frontOperatorCommandId(scope, "stable-key-123"));
  assert.notEqual(frontOperatorCommandId(scope, "stable-key-123"), frontOperatorCommandId(scope, "stable-key-456"));
});
