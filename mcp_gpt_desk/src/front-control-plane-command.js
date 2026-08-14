import { codedError, currentUtc, hash, safeIdPart, text } from "./front-control-plane-common.js";

export const FRONT_COMMAND_CATALOG = Object.freeze({
  "control_plane.verify": Object.freeze({
    capability: "front.command",
    environments: Object.freeze(["MOCK", "PAPER"]),
    mutation: "control_plane.verify",
    brokerExecution: false,
  }),
  "research.bootstrap_demo_paper": Object.freeze({
    capability: "research.command",
    environments: Object.freeze(["MOCK", "PAPER"]),
    mutation: "research.bootstrap_demo_paper",
    brokerExecution: false,
  }),
  "execution.order_intent.confirm": Object.freeze({
    capability: "execution.paper",
    environments: Object.freeze(["PAPER"]),
    mutation: "execution.order_intent.confirm",
    brokerExecution: false,
  }),
  "execution.order_intent.reject": Object.freeze({
    capability: "execution.paper",
    environments: Object.freeze(["PAPER"]),
    mutation: "execution.order_intent.reject",
    brokerExecution: false,
  }),
});

export async function acceptControlPlaneCommand(store, { body, headers, actor }) {
  const commandContext = buildCommandContext(store, { body, headers, actor });
  const mutationPlan = runtimeMutationPlan({ ...commandContext, body });
  if (typeof store?.commitFrontOperatorCommandMutation !== "function") return commandContext.receipt;
  const docs = buildCommandDocuments({ ...commandContext, body, headers, actor, mutationPlan });
  const committed = await store.commitFrontOperatorCommandMutation({
    stateId: docs.stateId,
    commandId: commandContext.commandId,
    expectedRevision: 0,
    requestHash: docs.requestHash,
    stateDoc: docs.stateDoc,
    commandDoc: docs.commandDoc,
    eventDoc: docs.eventDoc,
    auditDoc: docs.auditDoc,
    writes: [],
    preconditions: [],
    result: docs.result,
  });
  const committedCommand = committed?.command || docs.commandDoc;
  const mutation = committed?.replayed === true ? committedCommand?.result?.mutation_result || null : await executeRuntimeMutation(store, { ...commandContext, body, actor, mutationPlan });
  const terminalStatus = mutationPlan && mutation ? "SUCCEEDED" : "ACCEPTED";
  if (terminalStatus === "SUCCEEDED" && typeof store?.completeFrontOperatorCommand === "function") {
    await store.completeFrontOperatorCommand({ command_id: commandContext.commandId, status: terminalStatus, result: { ...docs.result, status: terminalStatus, mutation_result: mutation }, updated_at_utc: currentUtc(store?.clock) });
  }
  return {
    ...commandContext.receipt,
    acceptedAt: text(committedCommand.accepted_at_utc || committedCommand.created_at_utc, commandContext.acceptedAt),
    persisted: true,
    idempotent: committed?.replayed === true,
    auditId: docs.auditId,
    runtimeMutation: mutation ? "EXECUTED" : mutationPlan ? "SKIPPED_IDEMPOTENT_REPLAY" : "NONE",
    mutationResult: mutation || undefined,
  };
}

function buildCommandContext(store, { body, headers, actor }) {
  const commandType = text(body.commandType, "");
  const environment = String(body.environment || headers["x-desk-environment"] || "PAPER").toUpperCase();
  if (!commandType) throw codedError("FRONT_CONTROL_PLANE_COMMAND_INVALID", "commandType is required", 400);
  if (environment === "LIVE") throw codedError("FRONT_CONTROL_PLANE_LIVE_COMMAND_DISABLED", "LIVE commands are disabled until explicit cutover.", 403);
  const capability = FRONT_COMMAND_CATALOG[commandType];
  if (!capability) throw codedError("FRONT_CONTROL_PLANE_COMMAND_NOT_IMPLEMENTED", `Unsupported command: ${commandType}`, 422);
  if (!capability.environments.includes(environment)) throw codedError("FRONT_CONTROL_PLANE_COMMAND_ENVIRONMENT_DENIED", `${commandType} is not available in ${environment}.`, 403);
  if (!canWrite(actor)) throw codedError("FRONT_CONTROL_PLANE_COMMAND_FORBIDDEN", "An authenticated desk.write operator session is required.", 403);
  const idempotencyKey = text(headers["idempotency-key"] || body.idempotencyKey, `idem_${hash(JSON.stringify(body)).slice(0, 20)}`);
  const correlationId = text(headers["x-correlation-id"] || body.correlationId, `corr_${hash(`${commandType}:${idempotencyKey}`).slice(0, 20)}`);
  const causationId = text(headers["x-causation-id"] || body.causationId, correlationId);
  const aggregateId = commandAggregateId(commandType, body);
  const commandId = `cmd_front_${hash(`${commandType}:${idempotencyKey}`).slice(0, 24)}`;
  const acceptedAt = currentUtc(store?.clock);
  return {
    commandType,
    environment,
    idempotencyKey,
    correlationId,
    causationId,
    aggregateId,
    commandId,
    acceptedAt,
    receipt: { commandId, status: "ACCEPTED", correlationId, causationId, aggregateId, idempotencyKey, acceptedAt, environment, actor: actor?.kind || "operator" },
  };
}

function canWrite(actor = {}) {
  if (actor.kind === "test-operator") return actor.authorized === true;
  return ["operator_session", "api_key", "oauth"].includes(String(actor.kind || ""))
    && Array.isArray(actor.scopes)
    && actor.scopes.includes("desk.write");
}

function buildCommandDocuments({ commandId, commandType, environment, correlationId, causationId, aggregateId, idempotencyKey, acceptedAt, body, headers, actor, mutationPlan }) {
  const requestHash = controlPlaneCommandRequestHash({ body, commandType, environment });
  const stateId = `front_control_plane__${safeIdPart(commandId)}`;
  const auditId = `${commandId}_audit`;
  const eventId = `${commandId}_accepted`;
  const actorView = frontCommandActor(actor);
  const result = commandResult({ commandId, commandType, environment, correlationId, causationId, aggregateId, mutationPlan });
  const commandDoc = commandDocument({ commandId, commandType, environment, correlationId, causationId, aggregateId, idempotencyKey, requestHash, acceptedAt, body, headers, actorView, result, auditId });
  return {
    requestHash,
    stateId,
    auditId,
    commandDoc,
    stateDoc: commandStateDocument({ stateId, commandId, commandType, environment, acceptedAt }),
    eventDoc: commandEventDocument({ eventId, commandId, correlationId, causationId, aggregateId, acceptedAt, result }),
    auditDoc: commandAuditDocument({ auditId, commandId, commandType, correlationId, causationId, aggregateId, acceptedAt, actorView, reason: commandDoc.reason }),
    result,
  };
}

function frontCommandActor(actor = {}) {
  return { kind: text(actor?.kind, "operator"), email: actor?.email || null, uid: actor?.uid || null, client_ip: actor?.clientIp || null };
}

function runtimeMutationPlan(context) {
  if (context.commandType === "control_plane.verify") return { kind: "control_plane.verify", broker_execution: false };
  if (context.commandType === "research.bootstrap_demo_paper") return { kind: "research.bootstrap_demo_paper", broker_execution: false };
  if (context.commandType === "execution.order_intent.confirm") return { kind: "execution.order_intent.confirm", broker_execution: false };
  if (context.commandType === "execution.order_intent.reject") return { kind: "execution.order_intent.reject", broker_execution: false };
  return null;
}

async function executeRuntimeMutation(store, context) {
  if (!context.mutationPlan) return null;
  if (context.mutationPlan.kind === "control_plane.verify") {
    return { status: "VERIFIED", verified_at_utc: currentUtc(store?.clock), broker_execution: false };
  }
  if (context.mutationPlan.kind === "execution.order_intent.confirm" || context.mutationPlan.kind === "execution.order_intent.reject") {
    return executeOrderIntentHumanGateMutation(store, context);
  }
  if (typeof store?.executeResearchLabAction !== "function") {
    throw codedError("RESEARCH_BOOTSTRAP_ACTION_UNAVAILABLE", "Research Lab bootstrap action is unavailable.", 503);
  }
  return store.executeResearchLabAction({
    input: {
      ...(context.body.payload || {}),
      action: "bootstrap_demo_paper_research",
      idempotency_key: context.idempotencyKey,
      correlation_id: context.correlationId,
      reason: text(context.body.reason, "Operator requested demo-paper research bootstrap."),
    },
    actor: context.actor,
  });
}

async function executeOrderIntentHumanGateMutation(store, context) {
  if (typeof store?.executeBrokerAction !== "function") {
    throw codedError("HUMAN_GATE_ACTION_UNAVAILABLE", "Human Gate action service is unavailable.", 503);
  }
  const payload = context.body.payload || {};
  const portfolioOrderIntentId = text(payload.portfolioOrderIntentId || payload.portfolio_order_intent_id, "");
  if (!portfolioOrderIntentId) throw codedError("PORTFOLIO_ORDER_INTENT_ID_REQUIRED", "portfolioOrderIntentId is required.", 400);
  const confirm = context.mutationPlan.kind === "execution.order_intent.confirm";
  return store.executeBrokerAction({
    input: {
      action: confirm ? "confirm_human_execution_gate" : "reject_human_execution_gate",
      portfolioOrderIntentId,
      expectedRevision: context.body.expectedVersion || payload.expectedRevision || payload.expected_revision || null,
      idempotencyKey: context.idempotencyKey,
      reason: text(context.body.reason || payload.reason, ""),
      confirmationPhrase: confirm ? "CONFIRM_PORTFOLIO_ORDER_INTENT" : "CONFIRM_REJECT",
      approvedTerms: confirm ? (payload.approvedTerms || payload.approved_terms || {}) : undefined,
    },
    actor: context.actor,
  });
}

function commandResult({ commandId, commandType, environment, correlationId, causationId, aggregateId, mutationPlan }) {
  return {
    command_id: commandId,
    command_type: commandType,
    status: "ACCEPTED",
    environment,
    correlation_id: correlationId,
    causation_id: causationId,
    aggregate_id: aggregateId,
    broker_execution: false,
    order_submission_enabled: false,
    runtime_mutation: Boolean(mutationPlan),
    mutation_plan: mutationPlan,
    mutation_result: null,
  };
}

function commandDocument({ commandId, commandType, environment, correlationId, causationId, aggregateId, idempotencyKey, requestHash, acceptedAt, body, headers, actorView, result, auditId }) {
  return {
    schema_version: "front_control_plane_command_v1",
    command_id: commandId,
    action_id: `control-plane.${commandType}`,
    command: commandType,
    command_type: commandType,
    status: "ACCEPTED",
    environment,
    payload: body.payload || {},
    reason: text(body.reason, ""),
    expected_version: body.expectedVersion || headers["if-match"] || null,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    correlation_id: correlationId,
    causation_id: causationId,
    aggregate_id: aggregateId,
    audit_id: auditId,
    requested_by: actorView,
    runtime_mutation: result.runtime_mutation === true,
    broker_execution: false,
    order_submission_enabled: false,
    result,
    accepted_at_utc: acceptedAt,
    created_at_utc: acceptedAt,
    updated_at_utc: acceptedAt,
  };
}

function commandStateDocument({ stateId, commandId, commandType, environment, acceptedAt }) {
  return { schema_version: "front_control_plane_command_state_v1", state_id: stateId, command_id: commandId, command_type: commandType, environment, status: "ACCEPTED", revision: 1, last_command_id: commandId, updated_at_utc: acceptedAt };
}

function commandEventDocument({ eventId, commandId, correlationId, causationId, aggregateId, acceptedAt, result }) {
  return { schema_version: "front_control_plane_command_event_v1", event_id: eventId, command_id: commandId, event_type: "ACCEPTED", revision: 1, correlation_id: correlationId, causation_id: causationId, aggregate_id: aggregateId, message: "Commande VNext acceptée et auditée en mode control-plane.", payload: result, created_at_utc: acceptedAt };
}

function commandAuditDocument({ auditId, commandId, commandType, correlationId, causationId, aggregateId, acceptedAt, actorView, reason }) {
  return { schema_version: "front_control_plane_audit_v1", audit_id: auditId, action: commandType, document_type: "front_control_plane_command", document_id: commandId, performed_by: actorView.email || actorView.uid || actorView.kind, reason, command_id: commandId, revision: 1, correlation_id: correlationId, causation_id: causationId, aggregate_id: aggregateId, broker_execution: false, created_at_utc: acceptedAt };
}

function controlPlaneCommandRequestHash({ body, commandType, environment }) {
  return hash(JSON.stringify({ commandType, environment, payload: body.payload || {}, reason: text(body.reason, ""), expectedVersion: body.expectedVersion || null }));
}

function commandAggregateId(commandType, body = {}) {
  const payload = body.payload || {};
  if (commandType.startsWith("execution.order_intent.")) {
    return text(payload.portfolioOrderIntentId || payload.portfolio_order_intent_id, "portfolio_order_intent:UNKNOWN");
  }
  if (commandType.startsWith("research.")) return text(payload.missionId || payload.mission_id || payload.dataset_key, "research:control-plane");
  return "front-control-plane";
}
