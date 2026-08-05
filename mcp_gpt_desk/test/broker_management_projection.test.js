import assert from "node:assert/strict";
import test from "node:test";
import { BrokerExecutionService } from "../src/broker-execution-service.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

const now = "2026-07-22T14:00:00.000Z";
const clock = { now: () => ({ utc: now }) };

class ProjectionRepository {
  available = true;
  constructor() {
    this.intent = { management_intent_id: "management_1", action: "move_stop" };
    this.trade = {
      trade_id: "trade_1", position_id: "position_1", revision: 4, status: "protected", side: "long",
      quantity_planned: 2, quantity_open: 2, quantity_closed: 0, avg_entry_price: 100,
      initial_stop_price: 98, current_stop_price: 100, result_r: null,
    };
  }
  async recordManagementBrokerUpdate() { return { broker_order_id: "order_management_1" }; }
  async managementIntentDetail() { return { intent: this.intent, trade: this.trade, approvals: [], outbox: null, orders: [] }; }
}

function serviceFixture() {
  const persistence = new InMemoryDeskPersistence({
    documents: {
      desk_positions: {
        position_1: {
          position_id: "position_1", status: "OPEN", execution_mode: "paper", paper_simulated: true,
          broker_execution: false, direction: "long", entry_price: 100, initial_stop_loss: 98,
          stop_loss: 98, initial_quantity: 2, remaining_quantity: 2,
        },
      },
    },
  });
  const repository = new ProjectionRepository();
  return { persistence, repository, service: new BrokerExecutionService({ repository, persistence, clock }) };
}

test("management intent does not project before an executable broker ACK", async () => {
  const { service, persistence } = serviceFixture();
  const result = await service.recordBrokerEvent({
    managementIntentId: "management_1",
    update: { broker_order_ref: "NT-MGMT-1", status: "submitted", occurred_at: now },
  });
  assert.equal(result.canonicalPositionProjection.reason, "BROKER_ACK_REQUIRED");
  const position = persistence.peek("desk_positions", "position_1");
  assert.equal(position.broker_execution, false);
  assert.equal(position.stop_loss, 98);
});

test("broker ACK projects canonical position once and ignores retry or out-of-order revisions", async () => {
  const { service, persistence, repository } = serviceFixture();
  const accepted = await service.recordBrokerEvent({
    managementIntentId: "management_1",
    externalEventKey: "event_accept_1",
    update: { broker_order_ref: "NT-MGMT-1", status: "accepted", occurred_at: now },
  });
  assert.equal(accepted.canonicalPositionProjection.applied, true);
  let position = persistence.peek("desk_positions", "position_1");
  assert.equal(position.broker_execution, true);
  assert.equal(position.paper_simulated, false);
  assert.equal(position.execution_mode, "broker_paper");
  assert.equal(position.stop_loss, 100);
  assert.equal(position.broker_projection_revision, 4);
  assert.equal(persistence.count("desk_decision_journal"), 1);

  const retry = await service.recordBrokerEvent({
    managementIntentId: "management_1",
    externalEventKey: "event_accept_1",
    update: { broker_order_ref: "NT-MGMT-1", status: "accepted", occurred_at: now },
  });
  assert.equal(retry.canonicalPositionProjection.replayed, true);
  assert.equal(persistence.count("desk_decision_journal"), 1);

  repository.trade = { ...repository.trade, revision: 3, current_stop_price: 99 };
  const stale = await service.recordBrokerEvent({
    managementIntentId: "management_1",
    externalEventKey: "event_old_1",
    update: { broker_order_ref: "NT-MGMT-1", status: "working", occurred_at: "2026-07-22T13:59:00.000Z" },
  });
  assert.equal(stale.canonicalPositionProjection.replayed, true);
  position = persistence.peek("desk_positions", "position_1");
  assert.equal(position.stop_loss, 100);
  assert.equal(position.broker_projection_revision, 4);
});

test("partial management projects quantity only after fill ACK", async () => {
  const { service, persistence, repository } = serviceFixture();
  repository.intent = { management_intent_id: "management_1", action: "reduce_position" };
  repository.trade = { ...repository.trade, revision: 5, status: "protected", quantity_open: 1, quantity_closed: 1, avg_exit_price: 104, result_r: 1 };
  const result = await service.recordBrokerEvent({
    managementIntentId: "management_1",
    externalEventKey: "event_partial_1",
    update: { broker_order_ref: "NT-MGMT-2", status: "partially_filled", filled_quantity: 1, average_fill_price: 104, occurred_at: now },
  });
  assert.equal(result.canonicalPositionProjection.applied, true);
  const position = persistence.peek("desk_positions", "position_1");
  assert.equal(position.status, "PROTECTED");
  assert.equal(position.remaining_quantity, 1);
  assert.equal(position.exited_quantity, 1);
  assert.equal(position.result_R, 1);
  assert.equal(position.broker_projection_revision, 5);
});


test("broker ACK fails closed when canonical trade projection data is incomplete", async () => {
  const { service, persistence, repository } = serviceFixture();
  repository.trade = { ...repository.trade, revision: 6, current_stop_price: null };
  const result = await service.recordBrokerEvent({
    managementIntentId: "management_1",
    externalEventKey: "event_incomplete_1",
    update: { broker_order_ref: "NT-MGMT-3", status: "accepted", occurred_at: now },
  });
  assert.equal(result.canonicalPositionProjection.reason, "BROKER_PROJECTION_DATA_INCOMPLETE");
  assert.deepEqual(result.canonicalPositionProjection.missing_fields, ["current_stop_price"]);
  const position = persistence.peek("desk_positions", "position_1");
  assert.equal(position.broker_execution, false);
  assert.equal(position.stop_loss, 98);
  assert.equal(position.broker_projection_revision, undefined);
  assert.equal(persistence.count("desk_decision_journal"), 0);
});
