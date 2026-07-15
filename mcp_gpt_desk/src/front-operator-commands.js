import { createHash } from "node:crypto";
import { z } from "zod";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { loadFrontDeskSession, normalizeFrontApiScope } from "./front-session-projection.js";

export const FRONT_OPERATOR_STATE_PATH = "/api/v1/operator/state";
export const FRONT_OPERATOR_COMMANDS_PATH = "/api/v1/operator/commands";

export const FRONT_OPERATOR_COMMANDS = Object.freeze([
  "cancel_setup",
  "confirm_trigger",
  "move_break_even",
  "take_partial",
  "exit_position",
  "request_replan",
]);

export const FRONT_OPERATOR_CONFIRMATION_PHRASES = Object.freeze({
  cancel_setup: "CANCEL_SETUP",
  confirm_trigger: "CONFIRM_TRIGGER",
  move_break_even: "MOVE_BREAK_EVEN",
  take_partial: "TAKE_PARTIAL",
  exit_position: "EXIT_POSITION",
  request_replan: "REQUEST_REPLAN",
});

const commandSchema = z.enum(FRONT_OPERATOR_COMMANDS);
const sessionSchema = z.enum(["asia_open", "ny_open"]);
const modeSchema = z.enum(["live", "paper"]);
const entityIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);

export const frontOperatorCommandInputSchema = z.object({
  command: commandSchema,
  session: sessionSchema,
  strategyId: z.string().min(1).max(200),
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: modeSchema.default("live"),
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(8).max(200),
  confirmationPhrase: z.string().min(1).max(80),
  targetId: entityIdSchema.optional(),
  reason: z.string().trim().min(3).max(500),
  partialFraction: z.number().gt(0).lte(1).optional(),
}).strict().superRefine((value, context) => {
  const expectedPhrase = FRONT_OPERATOR_CONFIRMATION_PHRASES[value.command];
  if (value.confirmationPhrase !== expectedPhrase) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmationPhrase"],
      message: `confirmation_phrase_mismatch:${expectedPhrase}`,
    });
  }
  if (value.command !== "request_replan" && !value.targetId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetId"], message: "target_id_required" });
  }
  if (value.command === "take_partial" && value.partialFraction === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["partialFraction"], message: "partial_fraction_required" });
  }
});

const scopeSchema = z.object({
  strategyId: z.string(),
  session: sessionSchema,
  tradingDate: z.string(),
  mode: modeSchema,
});

const capabilitySchema = z.object({
  command: commandSchema,
  enabled: z.boolean(),
  reason: z.string().nullable(),
  targetId: z.string().nullable(),
  confirmationPhrase: z.string(),
  dangerLevel: z.enum(["medium", "high", "critical"]),
});

export const frontOperatorStateSchema = z.object({
  contract: z.literal("DeskFrontOperatorState"),
  schemaVersion: z.literal("1.0.0"),
  scope: scopeSchema,
  revision: z.number().int().min(0),
  setup: z.object({ id: z.string(), status: z.string() }).nullable(),
  position: z.object({ id: z.string(), status: z.string(), entry: z.number().nullable() }).nullable(),
  thesis: z.object({ id: z.string(), status: z.string() }).nullable(),
  allowedCommands: z.array(capabilitySchema),
  brokerExecution: z.literal(false),
});

export const frontOperatorCommandResponseSchema = z.object({
  contract: z.literal("DeskFrontOperatorCommandResult"),
  schemaVersion: z.literal("1.0.0"),
  ok: z.literal(true),
  idempotent: z.boolean(),
  command: z.object({
    id: z.string(),
    type: commandSchema,
    status: z.literal("APPLIED"),
    revision: z.number().int().min(1),
    auditId: z.string(),
    brokerExecution: z.literal(false),
  }),
  operatorState: frontOperatorStateSchema,
  session: z.object({
    id: sessionSchema,
    strategyId: z.string(),
    date: z.string(),
    setup: z.object({ id: z.string(), status: z.string() }).passthrough(),
    position: z.object({ active: z.boolean(), status: z.string() }).passthrough(),
  }).passthrough(),
});

export async function loadFrontOperatorState(store, input = {}) {
  const context = await loadOperatorContext(store, input);
  return operatorStateFromContext(context);
}

export async function executeFrontOperatorCommand(store, rawInput, actor = {}) {
  const input = parseCommandInput(rawInput);
  const scope = normalizeCommandScope(input);
  const stateId = frontOperatorStateId(scope);
  const commandId = frontOperatorCommandId(scope, input.idempotencyKey);
  const requestHash = frontOperatorRequestHash(input);

  const existing = await store.getFrontOperatorCommand({ command_id: commandId }).catch(() => null);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw operatorError("IDEMPOTENCY_CONFLICT", "Cette clé d’idempotence appartient déjà à une autre commande.", 409, {
        idempotency_key: input.idempotencyKey,
      });
    }
    return buildCommandResponse(store, scope, existing, true);
  }

  const context = await loadOperatorContext(store, scope);
  if (context.revision !== input.expectedRevision) {
    throw operatorError("REVISION_CONFLICT", "L’état opérateur a changé. Rechargez la session avant de confirmer.", 409, {
      expected_revision: input.expectedRevision,
      actual_revision: context.revision,
    });
  }

  const capability = operatorCapabilities(context).find((item) => item.command === input.command);
  if (!capability?.enabled) {
    throw operatorError("COMMAND_NOT_ALLOWED", capability?.reason || "Commande indisponible dans l’état canonique courant.", 409);
  }
  if (input.targetId && capability.targetId !== input.targetId) {
    throw operatorError("TARGET_CONFLICT", "La cible n’est plus la cible canonique active.", 409, {
      requested_target_id: input.targetId,
      actual_target_id: capability.targetId,
    });
  }

  const tick = operatorTick(store);
  const nextRevision = context.revision + 1;
  const mutation = prepareCanonicalMutation(context, input, tick, commandId);
  const auditId = `${commandId}_audit`;
  const eventId = `${commandId}_applied`;
  const actorView = normalizeActor(actor);
  const result = {
    command_id: commandId,
    command: input.command,
    status: "APPLIED",
    revision: nextRevision,
    audit_id: auditId,
    broker_execution: false,
    canonical_refs: mutation.refs,
  };
  const stateDoc = {
    schema_version: "desk_front_operator_state_v1",
    state_id: stateId,
    ...scope,
    revision: nextRevision,
    last_command_id: commandId,
    last_command: input.command,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  const commandDoc = {
    schema_version: "desk_front_operator_command_v1",
    command_id: commandId,
    action_id: `front.${input.command}`,
    command: input.command,
    status: "APPLIED",
    scope,
    target_ref: capability.targetId,
    reason: input.reason,
    confirmation_phrase: input.confirmationPhrase,
    idempotency_key: input.idempotencyKey,
    request_hash: requestHash,
    expected_revision: input.expectedRevision,
    applied_revision: nextRevision,
    requested_by: actorView,
    runtime_mutation: true,
    broker_execution: false,
    order_submission_enabled: false,
    result,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  const eventDoc = {
    schema_version: "desk_front_operator_command_event_v1",
    event_id: eventId,
    command_id: commandId,
    event_type: "APPLIED",
    revision: nextRevision,
    message: operatorSuccessMessage(input.command),
    payload: result,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  const auditDoc = {
    schema_version: "desk_front_operator_audit_v1",
    audit_id: auditId,
    strategy_id: scope.strategy_id,
    session: scope.session,
    trading_date: scope.trading_date,
    mode: scope.mode,
    action: input.command,
    document_type: mutation.refs[0]?.collection || "desk",
    document_id: mutation.refs[0]?.document_id || capability.targetId,
    previous_value: mutation.previousValue,
    new_value: mutation.newValue,
    performed_by: actorView.email || actorView.kind,
    reason: input.reason,
    command_id: commandId,
    revision: nextRevision,
    broker_execution: false,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };

  const committed = await store.commitFrontOperatorCommandMutation({
    stateId,
    commandId,
    expectedRevision: input.expectedRevision,
    requestHash,
    stateDoc,
    commandDoc,
    eventDoc,
    auditDoc,
    writes: mutation.writes,
    preconditions: mutation.preconditions,
    result,
  });
  const committedCommand = committed.command || commandDoc;
  return buildCommandResponse(store, scope, committedCommand, committed.replayed === true);
}

export function frontOperatorStateId(input) {
  const scope = normalizeCommandScope(input);
  return ["front_operator", scope.strategy_id, scope.trading_date, scope.session, scope.mode]
    .map(safeIdPart)
    .join("__");
}

export function frontOperatorCommandId(input, idempotencyKey) {
  const digest = createHash("sha256")
    .update(`${frontOperatorStateId(input)}:${String(idempotencyKey)}`)
    .digest("hex")
    .slice(0, 32);
  return `front_operator_command_${digest}`;
}

export function frontOperatorRequestHash(input) {
  const parsed = parseCommandInput(input);
  return canonicalSha256({
    command: parsed.command,
    session: parsed.session,
    strategyId: parsed.strategyId,
    tradingDate: parsed.tradingDate,
    mode: parsed.mode,
    expectedRevision: parsed.expectedRevision,
    confirmationPhrase: parsed.confirmationPhrase,
    targetId: parsed.targetId || null,
    reason: parsed.reason,
    partialFraction: parsed.partialFraction ?? null,
  });
}

async function loadOperatorContext(store, input) {
  const scope = normalizeCommandScope(input);
  const [session, live, stateDoc] = await Promise.all([
    loadFrontDeskSession(store, scope),
    store.getLiveDeskState(scope),
    store.getFrontOperatorCommandState({ state_id: frontOperatorStateId(scope) }).catch(() => null),
  ]);
  const masterId = live.latest_master?.analysis_id || session.master?.id;
  const setupResult = masterId && !String(masterId).startsWith("no-")
    ? await store.getDeskSetups({ analysis_id: masterId, status: "any", limit: 100 }).catch(() => ({ setups: [] }))
    : { setups: [] };
  const setup = (setupResult.setups || []).find((item) => {
    const ids = [item.setup_record_id, item.setup_id, item.id].filter(Boolean);
    return ids.includes(session.setup?.id);
  }) || null;
  const position = live.active_position?.position_id ? live.active_position : null;
  const thesis = live.active_thesis?.thesis_id ? live.active_thesis : null;
  return {
    scope,
    session,
    live,
    revision: Number(stateDoc?.revision || 0),
    setup,
    setupDocumentId: setup ? String(setup.setup_record_id || setup.setup_id || setup.id) : null,
    position,
    positionDocumentId: position ? String(position.position_id) : null,
    thesis,
    thesisDocumentId: thesis ? String(thesis.thesis_id) : null,
  };
}

function operatorStateFromContext(context) {
  return frontOperatorStateSchema.parse({
    contract: "DeskFrontOperatorState",
    schemaVersion: "1.0.0",
    scope: publicScope(context.scope),
    revision: context.revision,
    setup: context.setup ? { id: context.setupDocumentId, status: String(context.setup.status || context.setup.lifecycle_status || "UNKNOWN") } : null,
    position: context.position ? {
      id: context.positionDocumentId,
      status: String(context.position.status || "UNKNOWN"),
      entry: firstFinite(context.position.entry_price, context.position.entry),
    } : null,
    thesis: context.thesis ? { id: context.thesisDocumentId, status: String(context.thesis.status || "UNKNOWN") } : null,
    allowedCommands: operatorCapabilities(context),
    brokerExecution: false,
  });
}

function operatorCapabilities(context) {
  const setupStatus = String(context.setup?.status || context.setup?.lifecycle_status || "").toUpperCase();
  const setupTerminal = ["CANCELLED", "EXPIRED", "STOPPED", "CLOSED", "TP3_TAKEN"].includes(setupStatus);
  const setupTriggered = ["SETUP_TRIGGERED", "TRIGGERED", "FILLED", "ACTIVE"].includes(setupStatus);
  const positionStatus = String(context.position?.status || "").toLowerCase();
  const positionActive = ["active", "open", "protected", "partial_taken", "position_active", "position_protected"].includes(positionStatus);
  const hasEntry = firstFinite(context.position?.entry_price, context.position?.entry) !== null;
  const hasThesis = Boolean(context.thesisDocumentId);
  return [
    capability("cancel_setup", Boolean(context.setupDocumentId) && !setupTerminal, context.setupDocumentId, context.setupDocumentId ? (setupTerminal ? "setup_terminal" : null) : "canonical_setup_missing", "high"),
    capability("confirm_trigger", Boolean(context.setupDocumentId) && !setupTerminal && !setupTriggered, context.setupDocumentId, context.setupDocumentId ? (setupTerminal ? "setup_terminal" : setupTriggered ? "setup_already_triggered" : null) : "canonical_setup_missing", "high"),
    capability("move_break_even", Boolean(context.positionDocumentId) && positionActive && hasEntry, context.positionDocumentId, !context.positionDocumentId ? "active_position_missing" : !positionActive ? "position_not_active" : !hasEntry ? "position_entry_missing" : null, "high"),
    capability("take_partial", Boolean(context.positionDocumentId) && positionActive, context.positionDocumentId, !context.positionDocumentId ? "active_position_missing" : !positionActive ? "position_not_active" : null, "high"),
    capability("exit_position", Boolean(context.positionDocumentId) && positionActive, context.positionDocumentId, !context.positionDocumentId ? "active_position_missing" : !positionActive ? "position_not_active" : null, "critical"),
    capability("request_replan", hasThesis, context.thesisDocumentId, hasThesis ? null : "active_thesis_missing", "medium"),
  ];
}

function capability(command, enabled, targetId, reason, dangerLevel) {
  return {
    command,
    enabled,
    reason: enabled ? null : reason,
    targetId: targetId || null,
    confirmationPhrase: FRONT_OPERATOR_CONFIRMATION_PHRASES[command],
    dangerLevel,
  };
}

function prepareCanonicalMutation(context, input, tick, commandId) {
  const common = {
    operator_command_id: commandId,
    operator_reason: input.reason,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  if (["cancel_setup", "confirm_trigger"].includes(input.command)) {
    const status = input.command === "cancel_setup" ? "CANCELLED" : "SETUP_TRIGGERED";
    const next = {
      ...context.setup,
      ...common,
      status,
      lifecycle_status: status,
      operator_confirmed: true,
      operator_confirmed_at_utc: tick.utc,
    };
    const writes = [canonicalWrite(DESK_COLLECTIONS.deskSetups, context.setupDocumentId, next)];
    const preconditions = [canonicalPrecondition(DESK_COLLECTIONS.deskSetups, context.setupDocumentId, context.setup)];
    if (input.command === "confirm_trigger" && context.thesis) {
      const thesisNext = {
        ...context.thesis,
        ...common,
        previous_status: context.thesis.status || null,
        status: "SETUP_TRIGGERED",
      };
      writes.push(canonicalWrite(DESK_COLLECTIONS.deskActiveTheses, context.thesisDocumentId, thesisNext));
      preconditions.push(canonicalPrecondition(DESK_COLLECTIONS.deskActiveTheses, context.thesisDocumentId, context.thesis));
    }
    return {
      writes,
      preconditions,
      refs: writes.map(writeRef),
      previousValue: context.setup.status || context.setup.lifecycle_status || null,
      newValue: status,
    };
  }

  if (["move_break_even", "take_partial", "exit_position"].includes(input.command)) {
    const status = input.command === "move_break_even" ? "protected" : input.command === "take_partial" ? "partial_taken" : "closed";
    const action = input.command === "move_break_even" ? "break_even" : input.command === "take_partial" ? "partial" : "exit";
    const entry = firstFinite(context.position.entry_price, context.position.entry);
    const next = {
      ...context.position,
      ...common,
      status,
      management_action: action,
      management_note: input.reason,
      ...(input.command === "move_break_even" ? { stop_loss: entry, current_stop: entry, break_even_at_utc: tick.utc } : {}),
      ...(input.command === "take_partial" ? { partial_fraction: input.partialFraction, partial_taken_at_utc: tick.utc } : {}),
      ...(input.command === "exit_position" ? {
        closed_at: tick.utc,
        closed_at_utc: tick.utc,
        exit_price: firstFinite(context.position.current_price, context.position.current, context.position.mark_price),
      } : {}),
    };
    const write = canonicalWrite(DESK_COLLECTIONS.deskPositions, context.positionDocumentId, next);
    return {
      writes: [write],
      preconditions: [canonicalPrecondition(DESK_COLLECTIONS.deskPositions, context.positionDocumentId, context.position)],
      refs: [writeRef(write)],
      previousValue: context.position.status || null,
      newValue: status,
    };
  }

  const thesisNext = {
    ...context.thesis,
    ...common,
    previous_status: context.thesis.status || null,
    status: "REPLAN_REQUIRED",
    replan_requested: true,
    replan_requested_at_utc: tick.utc,
  };
  const jobId = `front_replan_${safeIdPart(context.scope.strategy_id)}_${safeIdPart(context.scope.trading_date)}_${createHash("sha1").update(commandId).digest("hex").slice(0, 12)}`;
  const job = {
    schema_version: "desk_job_v1",
    job_id: jobId,
    job_type: "REPLAN",
    status: "READY_FOR_GPT",
    strategy_id: context.scope.strategy_id,
    session: context.scope.session,
    mode: context.scope.mode,
    date: context.scope.trading_date,
    trading_date: context.scope.trading_date,
    run_id: context.scope.run_id,
    linked_thesis_id: context.thesisDocumentId,
    requested_by: "front_operator",
    broker_execution: false,
    metadata: { operator_command_id: commandId, reason: input.reason, source: "desk_front_vnext" },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
  const writes = [
    canonicalWrite(DESK_COLLECTIONS.deskActiveTheses, context.thesisDocumentId, thesisNext),
    canonicalWrite(DESK_COLLECTIONS.deskJobs, jobId, job),
  ];
  return {
    writes,
    preconditions: [canonicalPrecondition(DESK_COLLECTIONS.deskActiveTheses, context.thesisDocumentId, context.thesis)],
    refs: writes.map(writeRef),
    previousValue: context.thesis.status || null,
    newValue: "REPLAN_REQUIRED",
  };
}

async function buildCommandResponse(store, scope, commandDoc, idempotent) {
  const [operatorState, session] = await Promise.all([
    loadFrontOperatorState(store, scope),
    loadFrontDeskSession(store, scope),
  ]);
  const result = commandDoc.result || {};
  return frontOperatorCommandResponseSchema.parse({
    contract: "DeskFrontOperatorCommandResult",
    schemaVersion: "1.0.0",
    ok: true,
    idempotent,
    command: {
      id: commandDoc.command_id,
      type: commandDoc.command,
      status: "APPLIED",
      revision: Number(commandDoc.applied_revision || result.revision),
      auditId: result.audit_id || `${commandDoc.command_id}_audit`,
      brokerExecution: false,
    },
    operatorState,
    session,
  });
}

function parseCommandInput(value) {
  const parsed = frontOperatorCommandInputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw operatorError("INVALID_OPERATOR_COMMAND", parsed.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`).join(", "), 400);
}

function normalizeCommandScope(input) {
  const normalized = normalizeFrontApiScope({
    strategy_id: input.strategy_id || input.strategyId,
    session: input.session,
    trading_date: input.trading_date || input.tradingDate,
    mode: input.mode,
    run_id: input.run_id,
    as_of_utc: input.as_of_utc,
  });
  return normalized;
}

function publicScope(scope) {
  return {
    strategyId: scope.strategy_id,
    session: scope.session,
    tradingDate: scope.trading_date,
    mode: scope.mode,
  };
}

function canonicalWrite(collection, documentId, data) {
  return { collection, documentId, data, merge: false };
}

function canonicalPrecondition(collection, documentId, data) {
  return { collection, documentId, expectedHash: canonicalSha256(data) };
}

function writeRef(write) {
  return { collection: write.collection, document_id: write.documentId };
}

function normalizeActor(actor) {
  return {
    kind: String(actor.kind || "operator"),
    email: actor.email ? String(actor.email) : null,
    uid: actor.uid ? String(actor.uid) : null,
    client_ip: actor.clientIp ? String(actor.clientIp) : null,
  };
}

function operatorTick(store) {
  if (store?.clock?.now) return store.clock.now();
  const now = new Date();
  return { utc: now.toISOString(), paris: now.toISOString(), epochMs: now.getTime() };
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function safeIdPart(value) {
  return String(value || "none").replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 120);
}

function operatorSuccessMessage(command) {
  return {
    cancel_setup: "Setup annulé dans l’état Desk canonique.",
    confirm_trigger: "Déclenchement confirmé dans l’état Desk canonique.",
    move_break_even: "Stop canonique déplacé au break-even.",
    take_partial: "Prise partielle enregistrée dans la position canonique.",
    exit_position: "Sortie enregistrée dans la position canonique.",
    request_replan: "Demande de replan créée pour le workflow Desk.",
  }[command];
}

function operatorError(code, message, statusCode, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}
