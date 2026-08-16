import { randomUUID } from "node:crypto";
import { SystemClock } from "@tv-automation/desk-time";
import {
  normalizeStrategySignalV1,
  strategySignalEnvelopeV1,
} from "@tv-automation/desk-domain";

export class StrategySignalBusService {
  constructor({ repository, clock } = {}) {
    this.repository = repository;
    this.clock = clock || new SystemClock();
  }

  async publishSignal(input = {}, command = {}) {
    const signalInput = { ...input, signal_id: input.signal_id || input.id || randomUUID() };
    const normalized = normalizeStrategySignalV1(signalInput);
    if (!normalized.ok) throw serviceError("STRATEGY_SIGNAL_INVALID", `Strategy signal invalid: ${normalized.reasons.join(", ")}`, normalized);
    const saved = await this.repository.publish({
      ...normalized.signal,
      source_class: input.source_class || input.sourceClass || "LIVE",
      certification_run_id: input.certification_run_id || input.certificationRunId || null,
      causation_id: input.causation_id || input.causationId || input.strategy_evaluation_id || input.strategyEvaluationId || null,
      signal_outbox_id: input.signal_outbox_id || input.signalOutboxId || randomUUID(),
      signal_type: "signal.emitted",
      payload: strategySignalEnvelopeV1(normalized.signal),
      payload_hash: normalized.outbox.payload_hash,
      dedupe_key: normalized.outbox.dedupe_key,
      status: "PENDING",
    });
    return { status: "PUBLISHED", command_idempotency_key: command.idempotency_key || command.idempotencyKey || null, signal: normalized.signal, outbox: saved };
  }

  async pollPendingSignals(input = {}) {
    const items = await this.repository.pollPending({
      limit: input.limit || 100,
      now_utc: input.now_utc || input.nowUtc || this.#nowIso(),
    });
    return { status: "OK", count: items.length, items };
  }

  async listRecentSignals(input = {}) {
    const items = await this.repository.listRecent({ limit: input.limit || 100 });
    return { status: "OK", count: items.length, items };
  }

  async markConsumed(input = {}) {
    const outbox = await this.repository.markConsumed({
      signal_outbox_id: input.signal_outbox_id || input.signalOutboxId,
      consumer_id: input.consumer_id || input.consumerId || "strategy-signal-consumer",
      now_utc: input.now_utc || input.nowUtc || this.#nowIso(),
    });
    if (!outbox) throw serviceError("STRATEGY_SIGNAL_OUTBOX_NOT_FOUND", "Signal outbox item not found or not consumable.", input);
    return { status: "CONSUMED", outbox };
  }

  #nowIso() {
    const value = typeof this.clock.now === "function" ? this.clock.now() : new SystemClock().now();
    if (typeof value === "string") return new Date(value).toISOString();
    if (value?.utc) return new Date(value.utc).toISOString();
    return new Date(value).toISOString();
  }
}

function serviceError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details;
  error.statusCode = code.endsWith("_NOT_FOUND") ? 404 : 422;
  return error;
}
