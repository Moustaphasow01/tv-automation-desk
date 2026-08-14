import { randomUUID } from "node:crypto";
import { SystemClock } from "@tv-automation/desk-time";
import {
  buildExecutionProviderCommandV1,
  normalizeBrokerProviderEventV1,
} from "@tv-automation/desk-domain";
import {
  createPortfolioOrderIntentExecutionRepository,
  normalizeLineage,
} from "./portfolio-order-intent-execution-repository.js";

const DEFAULT_SERVICE_NOW_UTC = "1970-01-01T00:00:00.000Z";

export class PortfolioOrderIntentExecutionService {
  constructor({ repository, persistence = null, clock } = {}) {
    this.repository = repository || createPortfolioOrderIntentExecutionRepository(persistence);
    this.clock = clock || new SystemClock();
  }

  async materializeReadyCommands(input = {}) {
    if (!this.repository?.available || !this.repository?.listSubmittablePortfolioOrderIntents) {
      return skipped("EXECUTION_PROVIDER_REPOSITORY_UNAVAILABLE");
    }
    const nowUtc = this.#asOf(input);
    const executionPolicy = normalizeExecutionPolicy(input);
    if (executionPolicy.executionMode === "SHADOW") return skipped("SHADOW_NO_PHYSICAL_DISPATCH", { executionMode: executionPolicy.executionMode });
    if (executionPolicy.executionMode === "LIVE" && executionPolicy.liveAuthorization !== "EXPLICIT_HUMAN_AUTHORIZATION") {
      return blockedBatch("LIVE_IMPLICIT_DISPATCH_FORBIDDEN", { executionMode: executionPolicy.executionMode });
    }
    const providerProfile = input.provider_profile || input.providerProfile || {};
    const providerId = input.provider_id || providerProfile.provider_id || providerProfile.broker_provider_code || null;
    const lineages = await this.repository.listSubmittablePortfolioOrderIntents({
      limit: input.limit,
      providerId,
      accountId: input.account_id || input.accountId || null,
    });
    if (!lineages.length) return { ok: true, status: "NO_PORTFOLIO_ORDER_INTENTS", count: 0, items: [] };
    const items = [];
    for (const rawLineage of lineages) items.push(await this.#materializeOne(rawLineage, { ...input, nowUtc, providerProfile, executionPolicy }));
    return {
      ok: true,
      status: batchStatus(items),
      count: items.filter((item) => item.status === "COMMAND_PERSISTED").length,
      blocked: items.filter((item) => item.status === "BLOCKED").length,
      duplicates: items.filter((item) => item.status === "DUPLICATE_PROTECTED").length,
      items,
    };
  }

  async #materializeOne(rawLineage, context) {
    const lineage = normalizeLineage(rawLineage);
    const runtimeIssues = executionPolicyIssues(lineage, context.executionPolicy);
    if (runtimeIssues.length) return blockedItem(lineage, runtimeIssues[0].code, runtimeIssues);
    const gateIssues = humanGateIssues(lineage, context);
    if (gateIssues.length) return blockedItem(lineage, gateIssues[0].code, gateIssues);
    const issues = lineageIssues(lineage);
    if (issues.length) return blockedItem(lineage, "PORTFOLIO_RISK_LINEAGE_INCOMPLETE", issues);
    const active = await this.repository.listActiveProviderCommands({
      portfolioOrderIntentId: lineage.portfolio_order_intent_id,
      tradeOrderIntentId: lineage.trade_order_intent_id,
    });
    const plan = buildExecutionProviderCommandV1({
      as_of_utc: context.nowUtc,
      command_type: "SUBMIT_ORDER",
      provider_profile: context.providerProfile,
      order_intent: lineage.order_intent_payload,
      active_provider_commands: active,
      execution_halt: context.execution_halt === true,
    });
    if (plan.status !== "COMMAND_READY") return planItem(lineage, plan);
    const stored = await this.repository.persistProviderCommand({ lineage, plan, nowUtc: context.nowUtc });
    if (stored.status === "IDEMPOTENT") return { ...planItem(lineage, { ...plan, status: "DUPLICATE_PROTECTED" }), provider_command: stored.provider_command };
    if (stored.status !== "PERSISTED") return { ...blockedItem(lineage, stored.reason || "PROVIDER_COMMAND_NOT_PERSISTED", []), persistence: stored };
    return {
      status: "COMMAND_PERSISTED",
      portfolio_order_intent_id: lineage.portfolio_order_intent_id,
      target_position_id: lineage.target_position_id,
      execution_provider_command_id: stored.provider_command.execution_provider_command_id,
      idempotency_key: stored.provider_command.idempotency_key,
      provider_id: plan.provider_command.provider_id,
      command_hash: plan.provider_command.command_hash,
      provider_command: plan.provider_command,
    };
  }

  async ensureHumanGate(input = {}) {
    if (!this.repository?.available || !this.repository?.ensureHumanGate) return skipped("EXECUTION_PROVIDER_REPOSITORY_UNAVAILABLE");
    const nowUtc = this.#asOf(input);
    return this.repository.ensureHumanGate({
      portfolioOrderIntentId: input.portfolioOrderIntentId || input.portfolio_order_intent_id,
      expiresAtUtc: input.expiresAtUtc || input.expires_at_utc || null,
      nowUtc,
    });
  }

  async confirmHumanGate(input = {}) {
    if (!this.repository?.available || !this.repository?.confirmHumanGate) return skipped("EXECUTION_PROVIDER_REPOSITORY_UNAVAILABLE");
    return this.repository.confirmHumanGate({ ...input, nowUtc: this.#asOf(input) });
  }

  async rejectHumanGate(input = {}) {
    if (!this.repository?.available || !this.repository?.rejectHumanGate) return skipped("EXECUTION_PROVIDER_REPOSITORY_UNAVAILABLE");
    return this.repository.rejectHumanGate({ ...input, nowUtc: this.#asOf(input) });
  }

  async claimProviderCommand(input = {}) {
    if (!this.repository?.available || !this.repository?.claimProviderCommand) return { ok: true, status: "SKIPPED", reason: "EXECUTION_PROVIDER_REPOSITORY_UNAVAILABLE", work: null };
    const nowUtc = this.#asOf(input);
    const command = await this.repository.claimProviderCommand({
      providerId: input.providerId || input.provider_id || null,
      accountId: input.accountId || input.account_id || null,
      dispatcherId: input.dispatcherId || input.dispatcher_id || "provider-dispatcher",
      leaseToken: input.leaseToken || input.lease_token || cryptoToken(),
      leaseSeconds: input.leaseSeconds || input.lease_seconds || 30,
      nowUtc,
    });
    return command ? { ok: true, status: "CLAIMED", work: { ...command, lease_token: command.lease_token } } : { ok: true, status: "NO_WORK", work: null };
  }

  async completeProviderDispatch(input = {}) {
    if (!this.repository?.available || !this.repository?.completeProviderDispatch) return skipped("EXECUTION_PROVIDER_REPOSITORY_UNAVAILABLE");
    return this.repository.completeProviderDispatch({
      commandId: input.commandId || input.execution_provider_command_id || input.command_id,
      leaseToken: input.leaseToken || input.lease_token || null,
      dispatcherId: input.dispatcherId || input.dispatcher_id || null,
      status: input.status,
      providerOrderRef: input.providerOrderRef || input.provider_order_ref || null,
      error: input.error || null,
      nowUtc: this.#asOf(input),
    });
  }

  async recordBrokerProviderEvent(input = {}) {
    if (!this.repository?.available || !this.repository?.recordBrokerProviderEvent) return skipped("EXECUTION_PROVIDER_REPOSITORY_UNAVAILABLE");
    const event = normalizeBrokerProviderEventV1(input.event || input);
    return this.repository.recordBrokerProviderEvent({ event, nowUtc: this.#asOf(input) });
  }

  #asOf(input) {
    const value = input.as_of_utc || input.asOfUtc || this.clock.now();
    if (typeof value === "string") return new Date(value).toISOString();
    if (value?.utc) return new Date(value.utc).toISOString();
    return new Date(value).toISOString();
  }
}

function lineageIssues(lineage) {
  const intent = lineage.order_intent_payload || {};
  const source = intent.source || {};
  const audit = intent.audit || {};
  const issues = [];
  pushIssue(issues, !lineage.portfolio_order_intent_id, "PORTFOLIO_ORDER_INTENT_ID_REQUIRED");
  pushIssue(issues, intent.schema_version !== "portfolio_order_intent_v1", "PORTFOLIO_ORDER_INTENT_SCHEMA_REQUIRED");
  pushIssue(issues, lineage.broker_submission_allowed !== true, "BROKER_SUBMISSION_NOT_ALLOWED");
  pushIssue(issues, intent.broker_submission_allowed !== true, "BROKER_SUBMISSION_NOT_ALLOWED");
  pushIssue(issues, !lineage.target_position_id, "TARGET_POSITION_LINEAGE_MISMATCH");
  pushIssue(issues, intent.target_position_id !== lineage.target_position_id, "TARGET_POSITION_LINEAGE_MISMATCH");
  pushIssue(issues, source.kind !== "TARGET_POSITION", "TARGET_POSITION_SOURCE_REQUIRED");
  pushIssue(issues, !lineage.candidate_allocation_ids.length, "PORTFOLIO_ARBITRATION_LINEAGE_REQUIRED");
  pushIssue(issues, !lineage.risk_decision_ids.length, "GLOBAL_RISK_DECISION_REQUIRED");
  pushIssue(issues, audit.direct_llm_order === true, "DIRECT_LLM_ORDER_FORBIDDEN");
  pushIssue(issues, audit.derived_from_netting_engine !== true, "NETTING_ENGINE_AUDIT_REQUIRED");
  return uniqueIssues(issues);
}

function planItem(lineage, plan) {
  return {
    status: plan.status,
    portfolio_order_intent_id: lineage.portfolio_order_intent_id,
    target_position_id: lineage.target_position_id,
    duplicate_provider_command_id: plan.duplicate_provider_command_id || null,
    issues: plan.issues || [],
  };
}

function blockedItem(lineage, reason, issues) {
  return {
    status: "BLOCKED",
    reason,
    portfolio_order_intent_id: lineage.portfolio_order_intent_id || null,
    target_position_id: lineage.target_position_id || null,
    issues,
  };
}

function batchStatus(items) {
  if (items.some((item) => item.status === "COMMAND_PERSISTED")) return "PROVIDER_COMMANDS_READY";
  if (items.every((item) => item.status === "DUPLICATE_PROTECTED")) return "DUPLICATE_PROTECTED";
  if (items.every((item) => item.status === "BLOCKED")) return "BLOCKED";
  return "NO_PROVIDER_COMMAND_CREATED";
}

function humanGateIssues(lineage, context) {
  if (context.executionPolicy?.paperCertification === true) return [];
  if (!lineage.human_execution_gate_id) return [issue("HUMAN_CONFIRMATION_REQUIRED")];
  if (isExpired(lineage.human_gate_expires_at_utc || lineage.expires_at_utc, context.nowUtc)) return [issue("HUMAN_GATE_EXPIRED")];
  const status = String(lineage.human_gate_status || "").toUpperCase();
  if (["CONFIRMED", "CERTIFICATION_AUTO_APPROVED"].includes(status)) return [];
  return [issue(status === "AWAITING_MANUAL_CONFIRMATION" ? "HUMAN_CONFIRMATION_REQUIRED" : `HUMAN_GATE_${status || "MISSING"}`)];
}

function executionPolicyIssues(lineage, policy) {
  const issues = [];
  if (policy.executionMode === "PAPER" && policy.allowedPaperAccounts.length && !policy.allowedPaperAccounts.includes(lineage.target_account_id)) {
    issues.push(issue("PAPER_ACCOUNT_NOT_ALLOWED"));
  }
  if (policy.executionMode === "LIVE" && policy.liveAuthorization !== "EXPLICIT_HUMAN_AUTHORIZATION") {
    issues.push(issue("LIVE_IMPLICIT_DISPATCH_FORBIDDEN"));
  }
  return issues;
}

function normalizeExecutionPolicy(input = {}) {
  const executionMode = String(input.execution_mode || input.executionMode || "SEMI_MANUAL").trim().toUpperCase() || "SEMI_MANUAL";
  return {
    executionMode: ["SHADOW", "SEMI_MANUAL", "PAPER", "LIVE"].includes(executionMode) ? executionMode : "SEMI_MANUAL",
    autoExecutionEnabled: input.auto_execution_enabled === true || input.autoExecutionEnabled === true,
    paperCertification: input.paper_certification === true || input.paperCertification === true,
    liveAuthorization: input.live_authorization || input.liveAuthorization || null,
    allowedPaperAccounts: array(input.allowed_paper_accounts || input.allowedPaperAccounts || ["ninjatrader_paper_local"]),
  };
}

function isExpired(value, nowUtc) {
  if (!value) return false;
  const expiry = Date.parse(value);
  const now = Date.parse(nowUtc || DEFAULT_SERVICE_NOW_UTC);
  return Number.isFinite(expiry) && Number.isFinite(now) && expiry <= now;
}

function blockedBatch(reason, extra = {}) { return { ok: true, status: "BLOCKED", reason, count: 0, items: [], ...extra }; }
function skipped(reason, extra = {}) { return { ok: true, status: "SKIPPED", reason, count: 0, items: [], ...extra }; }
function issue(code) { return { code }; }
function pushIssue(issues, condition, code) { if (condition) issues.push(issue(code)); }
function uniqueIssues(issues) { return [...new Map(issues.map((item) => [item.code, item])).values()]; }
function array(value) { return Array.isArray(value) ? value : []; }
function cryptoToken() { return randomUUID(); }
