import { isObject } from "@/shared/contracts";
import type { EventEnvelope } from "@/domains/realtime/eventEnvelope";

export const COMMAND_STATUSES = [
  "REQUESTED",
  "ACCEPTED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CONFLICT",
  "REJECTED",
  "CANCELLED",
  "TIMED_OUT"
] as const;

export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export type SubmitDeskCommandInput = {
  commandType: string;
  payload?: unknown;
  environment: "MOCK" | "SHADOW" | "PAPER" | "LIVE";
  expectedVersion?: string;
  reason?: string;
};

export type PreparedDeskCommand = SubmitDeskCommandInput & {
  idempotencyKey: string;
  correlationId: string;
  requestedAt: string;
  status: "REQUESTED";
};

export type CommandAccepted = {
  commandId: string;
  status: "ACCEPTED";
  correlationId: string;
  idempotencyKey: string;
  acceptedAt: string;
};

export type CommandSnapshot = {
  commandId: string;
  status: CommandStatus;
  correlationId: string;
  updatedAt: string;
  message?: string;
  auditId?: string;
  result?: unknown;
};

export type CommandRuntimeState = {
  commands: Readonly<Record<string, CommandSnapshot>>;
};

export type CommandRuntimeClock = {
  now(): Date;
  randomId(): string;
};

export function createCommandRuntimeState(): CommandRuntimeState {
  return {
    commands: {}
  };
}

export function prepareDeskCommand(input: SubmitDeskCommandInput, clock: CommandRuntimeClock = defaultCommandClock()): PreparedDeskCommand {
  const suffix = sanitizeCommandKey(input.commandType);

  return {
    ...input,
    idempotencyKey: `idem_${suffix}_${clock.randomId()}`,
    correlationId: `corr_${suffix}_${clock.randomId()}`,
    requestedAt: clock.now().toISOString(),
    status: "REQUESTED"
  };
}

export function buildCommandHeaders(command: PreparedDeskCommand): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Idempotency-Key": command.idempotencyKey,
    "X-Correlation-ID": command.correlationId,
    "X-Desk-Environment": command.environment
  };

  if (command.expectedVersion) {
    headers["If-Match"] = command.expectedVersion;
  }

  return headers;
}

export function assertCommandAccepted(value: unknown, _fallback: PreparedDeskCommand): CommandAccepted {
  if (!isObject(value)) {
    throw Object.assign(new Error("COMMAND_ACCEPTED_INVALID"), { code: "COMMAND_ACCEPTED_INVALID" });
  }

  const candidate = value as Partial<CommandAccepted>;
  if (candidate.status !== "ACCEPTED" || typeof candidate.commandId !== "string" || candidate.commandId.length === 0) {
    throw Object.assign(new Error("COMMAND_ACCEPTED_INVALID"), { code: "COMMAND_ACCEPTED_INVALID" });
  }

  if (typeof candidate.correlationId !== "string" || typeof candidate.idempotencyKey !== "string" || typeof candidate.acceptedAt !== "string") {
    throw Object.assign(new Error("COMMAND_ACCEPTED_INCOMPLETE"), { code: "COMMAND_ACCEPTED_INCOMPLETE" });
  }

  return {
    commandId: candidate.commandId,
    status: "ACCEPTED",
    correlationId: candidate.correlationId,
    idempotencyKey: candidate.idempotencyKey,
    acceptedAt: candidate.acceptedAt
  };
}

export function assertCommandSnapshot(value: unknown): CommandSnapshot {
  if (!isObject(value)) throw Object.assign(new Error("COMMAND_STATUS_INVALID"), { code: "COMMAND_STATUS_INVALID" });
  const candidate = value as Partial<CommandSnapshot>;
  if (typeof candidate.commandId !== "string" || !isCommandStatus(candidate.status) || typeof candidate.correlationId !== "string" || typeof candidate.updatedAt !== "string") {
    throw Object.assign(new Error("COMMAND_STATUS_INVALID"), { code: "COMMAND_STATUS_INVALID" });
  }
  return candidate as CommandSnapshot;
}

export function reduceCommandEvent(state: CommandRuntimeState, event: EventEnvelope): CommandRuntimeState {
  if (event.eventType !== "command.status.changed" || !isObject(event.payload)) {
    return state;
  }

  const payload = event.payload as Partial<CommandSnapshot>;
  if (typeof payload.commandId !== "string" || !isCommandStatus(payload.status)) {
    return state;
  }

  const previous = state.commands[payload.commandId];

  return {
    commands: {
      ...state.commands,
      [payload.commandId]: {
        commandId: payload.commandId,
        status: payload.status,
        correlationId: typeof payload.correlationId === "string" ? payload.correlationId : event.correlationId,
        updatedAt: event.occurredAt,
        message: typeof payload.message === "string" ? payload.message : previous?.message
      }
    }
  };
}

export function isCommandStatus(value: unknown): value is CommandStatus {
  return typeof value === "string" && COMMAND_STATUSES.includes(value as CommandStatus);
}

function defaultCommandClock(): CommandRuntimeClock {
  return {
    now: () => new Date(),
    randomId: () => {
      if (globalThis.crypto && "getRandomValues" in globalThis.crypto) {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }

      return `${Date.now().toString(36)}${nextLocalRequestSequence().toString(36)}`;
    }
  };
}

let localRequestSequence = 0;
function nextLocalRequestSequence() {
  localRequestSequence += 1;
  return localRequestSequence;
}

function sanitizeCommandKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "command";
}
