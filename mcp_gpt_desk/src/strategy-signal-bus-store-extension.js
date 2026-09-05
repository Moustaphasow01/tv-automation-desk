import { StrategySignalBusService } from "./strategy-signal-bus-service.js";
import { createStrategySignalBusRepository } from "./strategy-signal-bus-repository.js";

const services = new WeakMap();

export function attachStrategySignalBusStoreMethods(StoreClass, helpers = {}) {
  const response = helpers.strategyKernelResponse || defaultResponse;
  const commandActor = helpers.commandActor || defaultCommandActor;
  StoreClass.prototype.publishStrategyV2Signal = async function publishStrategyV2Signal({ input = {}, actor = {} } = {}) {
    const result = await signalBusService(this).publishSignal(input, commandActor(input, actor));
    return response("DeskStrategySignalPublishResultV2", result);
  };
  StoreClass.prototype.publishRunningStrategyV2Signal = async function publishRunningStrategyV2Signal({ input = {}, actor = {} } = {}) {
    const result = await signalBusService(this).publishSignal(input, commandActor(input, actor), { requireRunningInstance: true });
    return response("DeskStrategySignalPublishResultV2", result);
  };
  StoreClass.prototype.pollStrategyV2Signals = async function pollStrategyV2Signals(args = {}) {
    return response("DeskStrategySignalPollResultV2", await signalBusService(this).pollPendingSignals(args));
  };
  StoreClass.prototype.listStrategyV2Signals = async function listStrategyV2Signals(args = {}) {
    return response("DeskStrategySignalListResultV2", await signalBusService(this).listRecentSignals(args));
  };
  StoreClass.prototype.consumeStrategyV2Signal = async function consumeStrategyV2Signal({ signal_outbox_id, input = {} } = {}) {
    return response("DeskStrategySignalConsumeResultV2", await signalBusService(this).markConsumed({ signal_outbox_id, ...input }));
  };
}

function signalBusService(store) {
  if (!services.has(store)) {
    services.set(store, new StrategySignalBusService({
      repository: createStrategySignalBusRepository(store.persistence),
      clock: store.clock,
    }));
  }
  return services.get(store);
}

function defaultResponse(contract, payload = {}) {
  return { contract, schemaVersion: "strategy_registry_rest_v2", ...payload };
}

function defaultCommandActor(input = {}, actor = {}) {
  return {
    idempotency_key: input.idempotencyKey || input.idempotency_key || null,
    actor: actor.email || actor.uid || actor.kind || "operator",
    reason: input.reason || null,
  };
}
