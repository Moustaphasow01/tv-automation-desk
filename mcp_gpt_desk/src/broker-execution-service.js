import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  BROKER_DEFAULT_MAX_DECISION_AGE_SECONDS,
  BROKER_RISK_PERCENT,
  brokerExecutionAuthorityMode,
  brokerExecutionEnvironment,
  canonicalSha256,
  compareNinjaAdapterSnapshots,
  createBrokerManagementIntent,
  createNinjaAddonCommand,
  createOrderIntent,
  deriveBrokerManagementRequest,
  evaluateBrokerManagementPolicy,
  evaluateBrokerPolicy,
  materializeTradeDecision,
  normalizeNinjaUpdate,
  normalizeNinjaAddonEvent,
  renderNinjaOifCommand,
  renderBrokerManagementCommand,
} from "@tv-automation/desk-domain";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  processTheoreticalExecution as processTheoreticalExecutionService,
  recordManualExecutionEvent as recordManualExecutionEventService,
} from "./broker-theoretical-execution-service.js";
import { buildBrokerExecutionOverview } from "./broker-execution-overview-projection.js";
import { assertBrokerOrderIntentAuthority, assertLegacyPositionExecutionRollbackEnabled } from "./broker-order-intent-authority.js";
import { maybeExecutePortfolioExecutionAction } from "./broker-portfolio-execution-actions.js";
import { PortfolioOrderIntentExecutionService } from "./portfolio-order-intent-execution-service.js";

const C = DESK_COLLECTIONS;
const OPEN_POSITION_STATES = new Set(["OPEN", "PROTECTED", "SCALING", "ARMED"]);
const MIN_CONFIGURABLE_RISK_PERCENT = 0.01;
const MAX_CONFIGURABLE_RISK_PERCENT = 0.25;
const MAX_CONFIGURABLE_ROUNDING_EXCESS_PERCENT = 0.25;
const MIN_CONFIGURABLE_DECISION_AGE_SECONDS = 5;
const MAX_CONFIGURABLE_DECISION_AGE_SECONDS = 3_600;
export const BROKER_RECONCILIATION_MODES = Object.freeze(["disabled", "alert_only", "blocking"]);
export const BROKER_RECONCILIATION_BLOCKING_CONFIRMATION = "PROMOTE_RECONCILIATION_BLOCKING";

export class BrokerExecutionService {
  constructor({ repository, persistence, clock, environment = brokerExecutionEnvironment(process.env), addonAtmStrategyName = process.env.DESK_NINJA_ATM_STRATEGY_NAME || "", startupControl = null, portfolioOrderIntentExecutionService = null }) {
    this.repository = repository;
    this.persistence = persistence;
    this.clock = clock;
    this.environment = environment;
    this.addonAtmStrategyName = String(addonAtmStrategyName || "").trim();
    this.startupControl = startupControl;
    this.portfolioOrderIntentExecutionService = portfolioOrderIntentExecutionService || new PortfolioOrderIntentExecutionService({ persistence, clock });
  }

  async overview(filters = {}) {
    const data = await this.repository.overview({ limit: filters.limit });
    const startupStatus = this.startupControl
      ? await this.startupControl.status()
      : { available: false, enabled: false, revision: 0, autoConnectRequired: true, simulationOnly: true, state: "unavailable" };
    return buildBrokerExecutionOverview({
      data,
      startupStatus,
      environment: this.environment,
      generatedAt: this.#now(),
    });
  }

  async materializeEligiblePositions(scope = {}) {
    if (!this.environment.legacyPositionExecutionEnabled) {
      return {
        ok: true,
        status: "SKIPPED",
        reason: "LEGACY_POSITION_EXECUTION_DISABLED",
        count: 0,
        items: [],
      };
    }
    if (!this.repository.available) return { ok: true, status: "SKIPPED", reason: "BROKER_REPOSITORY_UNAVAILABLE", count: 0, items: [] };
    const positions = typeof this.persistence.queryCollectionDocuments === "function"
      ? await this.persistence.queryCollectionDocuments({
          collection: C.deskPositions,
          filters: [{ field: "status", operator: "in", value: [...OPEN_POSITION_STATES] }],
          orderBy: [{ field: "updated_at_utc", direction: "desc" }],
          limit: 2_000,
        }).catch(() => this.persistence.listDocuments(C.deskPositions, 2_000).catch(() => []))
      : await this.persistence.listDocuments(C.deskPositions, 2_000).catch(() => []);
    const eligible = positions.filter((position) => OPEN_POSITION_STATES.has(String(position.status || "").toUpperCase()))
      .filter((position) => position.execution_mode === "paper" || position.paper_simulated === true)
      .filter((position) => position.broker_execution !== true)
      .filter((position) => !scope.run_id || position.run_id === scope.run_id)
      .filter((position) => !scope.trading_date || (position.trading_date || position.date) === scope.trading_date)
      .filter((position) => !scope.session || position.session === scope.session);
    const items = [];
    for (const position of eligible) {
      try {
        items.push(await this.repository.insertDecision(materializeTradeDecision({ position, now: this.#now() })));
      } catch (error) {
        items.push({ source_document_id: position.position_id, status: "rejected", error: error.code || error.message });
      }
    }
    return { ok: true, status: items.length ? "MATERIALIZED" : "NO_ELIGIBLE_POSITION", count: items.length, items };
  }

  async evaluateDecision({ decisionId, accountId, policyProfileId, actor = "backend" }) {
    assertLegacyPositionExecutionRollbackEnabled(this.environment);
    const context = await this.repository.decisionContext({ decisionId, accountId, policyProfileId });
    const executionAuthorityMode = brokerExecutionAuthorityMode(context.policy);
    const evaluated = evaluateBrokerPolicy({ ...context, environment: this.environment, now: this.#now() });
    const riskCheck = {
      ...evaluated,
      risk_check_id: `risk_${randomUUID().replaceAll("-", "")}`,
      trade_decision_id: decisionId,
      checked_at: this.#now(),
      checked_by: actor,
      policy_profile_id: context.policy?.policy_profile_id || policyProfileId || "ninjatrader_sim101_local",
      raw: { environment: safeEnvironment(this.environment) },
    };
    const intent = evaluated.pass
      ? createOrderIntent({
          decision: context.decision,
          riskCheck,
          account: context.account,
          contract: context.contract,
          now: this.#now(),
          ttlSeconds: Math.min(this.environment.orderTtlSeconds, Number(context.policy?.order_ttl_seconds || this.environment.orderTtlSeconds)),
        })
      : null;
    const stored = await this.repository.insertRiskResult({ riskCheck, intent });
    if (this.environment.manualTelegramExecutionEnabled === true) {
      return {
        ...stored,
        executionAuthorityMode,
        automaticAuthorization: null,
        manualTelegramExecution: {
          status: "ALERT_ONLY",
          brokerSubmissionSkipped: true,
          reason: "DESK_MANUAL_TELEGRAM_EXECUTION_ENABLED",
        },
      };
    }
    if (!stored.intent || executionAuthorityMode !== "auto") {
      return { ...stored, executionAuthorityMode, automaticAuthorization: null };
    }
    const automaticAuthorization = await this.repository.approveIntent({
      intentId: stored.intent.order_intent_id,
      approvalId: `approval_${randomUUID().replaceAll("-", "")}`,
      idempotencyKey: `auto_entry_${canonicalSha256({ intent_id: stored.intent.order_intent_id, mode: executionAuthorityMode }).slice(0, 48)}`,
      actor: "desk:auto-entry",
      reason: "AUTO mode: deterministic risk gates passed; Sim101 entry authorized by policy.",
      automatic: true,
      now: this.#now(),
    });
    return { ...stored, executionAuthorityMode, automaticAuthorization };
  }

  async processEligiblePositions(scope = {}) {
    const materialization = await this.materializeEligiblePositions(scope);
    const evaluations = [];
    for (const decision of materialization.items || []) {
      if (!decision?.trade_decision_id || decision.status !== "candidate") continue;
      try {
        evaluations.push(await this.evaluateDecision({
          decisionId: decision.trade_decision_id,
          accountId: this.environment.defaultAccount,
          policyProfileId: "ninjatrader_sim101_local",
          actor: "live-runtime-scheduler",
        }));
      } catch (error) {
        evaluations.push({
          decisionId: decision.trade_decision_id,
          status: "ERROR",
          error: error.code || error.message || String(error),
        });
      }
    }
    return {
      ...materialization,
      status: evaluations.length ? "EVALUATED" : materialization.status,
      evaluations,
      autoQueued: evaluations.filter((item) => item.automaticAuthorization).length,
      pendingOperatorApproval: evaluations.filter((item) => item.intent?.status === "pending_approval" && !item.automaticAuthorization).length,
    };
  }

  async materializePortfolioOrderIntents(scope = {}) {
    if (!this.portfolioOrderIntentExecutionService) return skippedPortfolioExecution("PORTFOLIO_ORDER_INTENT_EXECUTION_SERVICE_UNAVAILABLE");
    if (!this.environment.executionEnabled || this.environment.killSwitch) return skippedPortfolioExecution("ENVIRONMENT_NOT_ARMED");
    return this.portfolioOrderIntentExecutionService.materializeReadyCommands({ ...scope, execution_halt: this.environment.killSwitch === true });
  }

  async processTheoreticalExecution({ entryLimit = 100, exitLimit = 100 } = {}) {
    return processTheoreticalExecutionService(this, { entryLimit, exitLimit });
  }

  async recordManualExecutionEvent(input = {}, actor = {}) {
    return recordManualExecutionEventService(this, input, actor);
  }

  now() { return this.#now(); }

  async intentDetail(intentId) { return contract("DeskExecutionIntentDetail", await this.repository.intentDetail(intentId)); }

  async materializeManagementFromMonitor(monitor) {
    if (!this.repository.available) return { ok: true, status: "SKIPPED", reason: "BROKER_REPOSITORY_UNAVAILABLE" };
    if ((!this.environment.executionEnabled && this.environment.manualTelegramExecutionEnabled !== true) || (this.environment.killSwitch && this.environment.manualTelegramExecutionEnabled !== true)) {
      return { ok: true, status: "SKIPPED", reason: "ENVIRONMENT_NOT_ARMED" };
    }
    const trade = await this.repository.findOpenTradeForMonitor({
      tradeId: monitor.trade_id || monitor.position_check?.trade_id || null,
      sourcePositionId: monitorSourcePositionId(monitor),
      instrument: monitor.position_check?.instrument || monitor.monitor_decision?.instrument || monitor.instrument || null,
      strategyId: monitor.strategy_id || null,
      tradingDate: monitor.trading_date || monitor.date || null,
      session: monitor.session || null,
    });
    if (!trade) return { ok: true, status: "SKIPPED", reason: "NO_OPEN_BROKER_TRADE" };
    const context = await this.repository.managementContext({ tradeId: trade.trade_id });
    const now = this.#now();
    const mark = await this.#latestReconciledManagementMark({ trade, context });
    const request = deriveBrokerManagementRequest({
      monitor,
      trade,
      mark,
      now,
      maxMarkAgeSeconds: this.environment.bridgeStaleSeconds,
    });
    if (!request.actionable) return { ok: true, status: "SKIPPED", reason: request.reason, trade_id: trade.trade_id, managementEligibility: request };
    const intent = createBrokerManagementIntent({ monitor, trade, request, now, ttlSeconds: 900 });
    const evaluation = evaluateBrokerManagementPolicy({ ...context, intent, environment: this.environment, now: this.#now() });
    const storedIntent = await this.repository.insertManagementIntent({ intent, evaluation });
    if (!evaluation.pass) return { ok: true, status: "BLOCKED", intent: storedIntent, evaluation };
    if (this.environment.manualTelegramExecutionEnabled === true) {
      return {
        ok: true,
        status: "ALERT_ONLY",
        intent: storedIntent,
        evaluation,
        manualTelegramExecution: {
          status: "ALERT_ONLY",
          brokerSubmissionSkipped: true,
          reason: "DESK_MANUAL_TELEGRAM_EXECUTION_ENABLED",
        },
      };
    }
    if (storedIntent.status !== "pending_approval") {
      return { ok: true, status: "EXISTING", intent: storedIntent, evaluation, automaticAuthorization: null };
    }
    const approvalContext = await this.repository.managementContext({ managementIntentId: storedIntent.management_intent_id });
    approvalContext.intent ||= storedIntent;
    const renderedCommand = renderBrokerManagementCommand({ ...approvalContext, accountName: approvalContext.bridge?.account_name || "Sim101" });
    const automaticAuthorization = await this.repository.approveManagementIntent({
      managementIntentId: storedIntent.management_intent_id,
      approvalId: `management_approval_${randomUUID().replaceAll("-", "")}`,
      idempotencyKey: `auto_management_${canonicalSha256({ management_intent_id: storedIntent.management_intent_id }).slice(0, 48)}`,
      actor: "desk:auto-management",
      reason: "Risk-reducing management is automatic in AUTO and SEMI_AUTO modes.",
      commandPayload: { schema_version: "broker_management_v1", action: storedIntent.action, rendered_command: renderedCommand },
      automatic: true,
      now: this.#now(),
    });
    return { ok: true, status: "QUEUED_AUTOMATIC", intent: { ...storedIntent, status: "queued", approval_status: "approved" }, evaluation, automaticAuthorization };
  }

  async materializeRecentManagement({ monitorId = null, scope = {}, limit = 100 } = {}) {
    if (!this.repository.available || (!this.environment.executionEnabled && this.environment.manualTelegramExecutionEnabled !== true) || (this.environment.killSwitch && this.environment.manualTelegramExecutionEnabled !== true)) {
      return { ok: true, status: "SKIPPED", reason: !this.repository.available ? "BROKER_REPOSITORY_UNAVAILABLE" : "ENVIRONMENT_NOT_ARMED", count: 0, items: [] };
    }
    const monitors = monitorId
      ? [await this.persistence.getDocument(C.deskManualMonitors, monitorId).catch(() => null)].filter(Boolean)
      : await this.persistence.listDocuments(C.deskManualMonitors, Math.max(1, Math.min(Number(limit) || 100, 500))).catch(() => []);
    const eligible = monitors.filter((monitor) => !monitorId || monitor.monitor_id === monitorId)
      .filter((monitor) => !scope.strategy_id || monitor.strategy_id === scope.strategy_id)
      .filter((monitor) => !scope.trading_date || (monitor.trading_date || monitor.date) === scope.trading_date)
      .filter((monitor) => !scope.session || monitor.session === scope.session)
      .sort((a, b) => Date.parse(a.timestamp_utc || a.created_at || "") - Date.parse(b.timestamp_utc || b.created_at || ""));
    const items = [];
    for (const monitor of eligible) items.push(await this.materializeManagementFromMonitor(monitor));
    return { ok: true, status: items.some((item) => ["PENDING_APPROVAL", "QUEUED_AUTOMATIC"].includes(item.status)) ? "MATERIALIZED" : "NO_ACTIONABLE_MONITOR", count: items.filter((item) => item.intent).length, items };
  }

  async managementIntentDetail(managementIntentId) { return contract("DeskExecutionManagementIntentDetail", await this.repository.managementIntentDetail(managementIntentId)); }

  async executeAction(input, actor = {}) {
    const who = actor.email || actor.uid || actor.kind || "front-operator";
    const now = this.#now();
    if (input.action === "materialize") return this.materializeEligiblePositions(input.scope || {});
    if (input.action === "materialize_portfolio_order_intents") return this.materializePortfolioOrderIntents(input.scope || input);
    const portfolioExecutionAction = await maybeExecutePortfolioExecutionAction({ input, actorName: who, service: this.portfolioOrderIntentExecutionService, requirePhrase });
    if (portfolioExecutionAction.handled) return portfolioExecutionAction.result;
    if (input.action === "materialize_management") return this.materializeRecentManagement({ monitorId: input.monitorId || null, scope: input.scope || {}, limit: input.limit });
    if (input.action === "process_theoretical_execution") return this.processTheoreticalExecution({ entryLimit: input.entryLimit, exitLimit: input.exitLimit });
    if (input.action === "record_manual_execution_event") return this.recordManualExecutionEvent(input, actor);
    if (input.action === "evaluate") return this.evaluateDecision({ decisionId: input.decisionId, accountId: input.accountId, policyProfileId: input.policyProfileId, actor: who });
    if (input.action === "configure_sizing") {
      requirePhrase(input.confirmationPhrase, "CONFIRM_SIM101_SIZING_POLICY");
      if (!Number.isFinite(input.riskPercent)
        || input.riskPercent < MIN_CONFIGURABLE_RISK_PERCENT
        || input.riskPercent > MAX_CONFIGURABLE_RISK_PERCENT) {
        throw serviceError(
          "INVALID_SIZING_RISK_PERCENT",
          "V5 sizing risk must be between 0.01% and 0.25% of net equity.",
          { minimum: MIN_CONFIGURABLE_RISK_PERCENT, maximum: MAX_CONFIGURABLE_RISK_PERCENT },
        );
      }
      const maxRoundingExcessPercent = Number(input.maxRoundingExcessPercent ?? MAX_CONFIGURABLE_ROUNDING_EXCESS_PERCENT);
      if (!Number.isFinite(maxRoundingExcessPercent) || maxRoundingExcessPercent < 0 || maxRoundingExcessPercent > MAX_CONFIGURABLE_ROUNDING_EXCESS_PERCENT) {
        throw serviceError(
          "INVALID_ROUNDING_EXCESS_PERCENT",
          "V5 rounding excess must be between 0% and 0.25% of net equity.",
          { minimum: 0, maximum: MAX_CONFIGURABLE_ROUNDING_EXCESS_PERCENT },
        );
      }
      const maxDecisionAgeSeconds = Number(input.maxDecisionAgeSeconds ?? BROKER_DEFAULT_MAX_DECISION_AGE_SECONDS);
      if (!Number.isInteger(maxDecisionAgeSeconds)
        || maxDecisionAgeSeconds < MIN_CONFIGURABLE_DECISION_AGE_SECONDS
        || maxDecisionAgeSeconds > MAX_CONFIGURABLE_DECISION_AGE_SECONDS) {
        throw serviceError(
          "INVALID_DECISION_MAX_AGE_SECONDS",
          "Broker decision freshness must be an integer between 5 and 3600 seconds.",
          { minimum: MIN_CONFIGURABLE_DECISION_AGE_SECONDS, maximum: MAX_CONFIGURABLE_DECISION_AGE_SECONDS },
        );
      }
      return this.repository.configureSizingPolicy({
        policyProfileId: input.policyProfileId || "ninjatrader_sim101_local",
        expectedRevision: input.expectedRevision,
        riskPercent: input.riskPercent,
        maxRoundingExcessPercent,
        maxDecisionAgeSeconds,
        fallbackCapitalEnabled: input.fallbackCapitalEnabled,
        fallbackCapital: input.fallbackCapitalEnabled ? input.fallbackCapital : null,
        idempotencyKey: input.idempotencyKey,
        actor: who,
        reason: input.reason,
        now,
      });
    }
    if (input.action === "configure_execution_mode") {
      requirePhrase(input.confirmationPhrase, "CONFIRM_SIM101_EXECUTION_MODE");
      return this.repository.configureExecutionAuthority({
        policyProfileId: input.policyProfileId || "ninjatrader_sim101_local",
        expectedRevision: input.expectedRevision,
        mode: input.mode,
        idempotencyKey: input.idempotencyKey,
        actor: who,
        reason: input.reason,
        now,
      });
    }
    if (input.action === "configure_ninjatrader_startup") {
      requirePhrase(input.confirmationPhrase, "CONFIRM_NINJATRADER_AUTOSTART");
      if (!this.startupControl) throw serviceError("NINJATRADER_STARTUP_CONTROL_UNAVAILABLE", "Le superviseur Windows NinjaTrader n’est pas configuré.");
      return this.startupControl.configure({
        enabled: input.enabled,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        actor: who,
        reason: input.reason,
        now,
      });
    }
    if (input.action === "approve") {
      requirePhrase(input.confirmationPhrase, "CONFIRM_SIM101_ORDER");
      const detail = await this.repository.intentDetail(input.intentId);
      assertBrokerOrderIntentAuthority({ intent: detail.intent, environment: this.environment, action: "approve" });
      const context = await this.repository.decisionContext({ decisionId: detail.decision.trade_decision_id, accountId: detail.intent.broker_account_id, policyProfileId: detail.riskCheck?.policy_profile_id });
      const currentRisk = evaluateBrokerPolicy({ ...context, environment: this.environment, now });
      if (!currentRisk.pass) throw serviceError("APPROVAL_RISK_RECHECK_FAILED", "Approval refused because current broker guards do not pass.", { violations: currentRisk.violations });
      return this.repository.approveIntent({ intentId: input.intentId, approvalId: `approval_${randomUUID().replaceAll("-", "")}`, idempotencyKey: input.idempotencyKey, actor: who, reason: input.reason, automatic: false, now });
    }
    if (input.action === "reject") {
      requirePhrase(input.confirmationPhrase, "CONFIRM_REJECT");
      return this.repository.rejectIntent({ intentId: input.intentId, approvalId: `approval_${randomUUID().replaceAll("-", "")}`, idempotencyKey: input.idempotencyKey, actor: who, reason: input.reason, now });
    }
    if (input.action === "approve_management") {
      requirePhrase(input.confirmationPhrase, "CONFIRM_SIM101_MANAGEMENT");
      const context = await this.repository.managementContext({ managementIntentId: input.managementIntentId });
      const currentRisk = evaluateBrokerManagementPolicy({ ...context, environment: this.environment, now });
      if (!currentRisk.pass) throw serviceError("MANAGEMENT_APPROVAL_RECHECK_FAILED", "Approval refused because current management guards do not pass.", { violations: currentRisk.violations });
      const renderedCommand = renderBrokerManagementCommand({ ...context, accountName: context.bridge?.account_name || "Sim101" });
      return this.repository.approveManagementIntent({
        managementIntentId: input.managementIntentId,
        approvalId: `management_approval_${randomUUID().replaceAll("-", "")}`,
        idempotencyKey: input.idempotencyKey,
        actor: who,
        reason: input.reason,
        commandPayload: { schema_version: "broker_management_v1", action: context.intent.action, rendered_command: renderedCommand },
        automatic: false,
        now,
      });
    }
    if (input.action === "reject_management") {
      requirePhrase(input.confirmationPhrase, "CONFIRM_REJECT");
      return this.repository.rejectManagementIntent({ managementIntentId: input.managementIntentId, approvalId: `management_approval_${randomUUID().replaceAll("-", "")}`, idempotencyKey: input.idempotencyKey, actor: who, reason: input.reason, now });
    }
    if (input.action === "kill_switch") {
      const locked = input.locked !== false;
      requirePhrase(input.confirmationPhrase, locked ? "ENGAGE_KILL_SWITCH" : "RELEASE_SIM101_KILL_SWITCH");
      if (!locked && this.environment.allowLiveAccount) throw serviceError("LIVE_RELEASE_FORBIDDEN", "The local console cannot release the kill switch while live accounts are allowed.");
      return this.repository.setExecutionLock({ locked, reason: input.reason, actor: who, now });
    }
    throw serviceError("EXECUTION_ACTION_UNKNOWN", `Unknown execution action: ${input.action}.`);
  }

  async heartbeat(input = {}) {
    const requestedMode = String(input.mode || "disabled");
    const simAccount = /^Sim\d*$/i.test(String(input.accountName || ""));
    const environmentAllowsArm = this.environment.executionEnabled === true
      && this.environment.killSwitch === false
      && requestedMode === this.environment.bridgeMode
      && simAccount;
    const heartbeat = {
      bridge_id: input.bridgeId,
      broker_account_id: input.brokerAccountId || this.environment.defaultAccount,
      mode: requestedMode === this.environment.bridgeMode ? requestedMode : "disabled",
      status: environmentAllowsArm && input.ninjaConnected === true && input.atiEnabled === true ? "armed" : "read_only",
      host_name: input.hostName || hostname(),
      process_id: Number(input.processId) || null,
      ninja_connected: input.ninjaConnected === true,
      ati_enabled: input.atiEnabled === true,
      account_name: input.accountName || null,
      last_seen_at: this.#now(),
      metadata: { version: input.version || null, requested_status: input.status || null, sim_account: simAccount },
      adapter_kind: "ati",
      protocol_version: input.protocolVersion || "ninja_ati_file_v1",
      capabilities: input.capabilities || { order_events: true, position_events: true },
      command_enabled: environmentAllowsArm && input.atiEnabled === true,
    };
    return contract("DeskBrokerBridgeHeartbeat", { heartbeat: await this.repository.upsertHeartbeat(heartbeat) });
  }

  async claimBridgeWork(input = {}) {
    if (!this.environment.executionEnabled || this.environment.killSwitch || !["sim101_ati_manual_arm", "sim101_ati_approved_only"].includes(this.environment.bridgeMode)) {
      return contract("DeskBrokerBridgeClaim", { status: "BLOCKED", reason: "ENVIRONMENT_NOT_ARMED", work: null });
    }
    const managementCandidate = typeof this.repository.peekManagementOutbox === "function" ? await this.repository.peekManagementOutbox() : null;
    if (managementCandidate) {
      const context = await this.repository.managementContext({ managementIntentId: managementCandidate.management_intent_id });
      const risk = evaluateBrokerManagementPolicy({ ...context, environment: this.environment, now: this.#now() });
      if (!risk.pass) return contract("DeskBrokerBridgeClaim", { status: "BLOCKED", reason: "MANAGEMENT_RISK_RECHECK_FAILED", violations: risk.violations, work: null });
      const leaseToken = randomUUID();
      const leased = await this.repository.leaseManagementOutbox({ outboxId: managementCandidate.management_outbox_id, bridgeId: input.bridgeId, leaseToken, leaseSeconds: input.leaseSeconds });
      if (!leased) return contract("DeskBrokerBridgeClaim", { status: "BUSY", work: null });
      return contract("DeskBrokerBridgeClaim", { status: "CLAIMED", work: { ...leased, work_type: "management", lease_token: leaseToken, rendered_command: renderBrokerManagementCommand({ ...context, accountName: input.accountName || "Sim101" }) } });
    }
    const candidate = await this.repository.peekOutbox();
    if (!candidate) return contract("DeskBrokerBridgeClaim", { status: "NO_WORK", work: null });
    assertBrokerOrderIntentAuthority({ candidate, environment: this.environment, action: "claim_bridge" });
    const context = await this.repository.decisionContext({ decisionId: candidate.trade_decision_id, accountId: candidate.broker_account_id });
    const risk = evaluateBrokerPolicy({ ...context, environment: this.environment, now: this.#now() });
    if (!risk.pass) return contract("DeskBrokerBridgeClaim", { status: "BLOCKED", reason: "RISK_RECHECK_FAILED", violations: risk.violations, work: null });
    const leaseToken = randomUUID();
    const leased = await this.repository.leaseOutbox({ outboxId: candidate.execution_outbox_id, bridgeId: input.bridgeId, leaseToken, leaseSeconds: input.leaseSeconds });
    if (!leased) return contract("DeskBrokerBridgeClaim", { status: "BUSY", work: null });
    return contract("DeskBrokerBridgeClaim", {
      status: "CLAIMED",
      work: {
        ...leased,
        work_type: "entry",
        lease_token: leaseToken,
        rendered_command: renderNinjaOifCommand({ ...leased.command_payload, order_intent_id: leased.order_intent_id }, { accountName: input.accountName || "Sim101" }),
      },
    });
  }

  async completeBridgeWork(input = {}) {
    if (!/^(rendered|delivered|acknowledged|failed)$/.test(input.status || "")) throw serviceError("INVALID_OUTBOX_STATUS", "Invalid bridge completion status.");
    const complete = input.workType === "management" ? this.repository.completeManagementOutbox.bind(this.repository) : this.repository.completeOutbox.bind(this.repository);
    return contract("DeskBrokerBridgeCompletion", {
      outbox: await complete({
        outboxId: input.outboxId,
        bridgeId: input.bridgeId,
        leaseToken: input.leaseToken,
        status: input.status,
        renderedCommand: input.renderedCommand || null,
        error: input.error || null,
        now: this.#now(),
      }),
    });
  }

  async heartbeatAddon(input = {}) {
    const accountName = String(input.accountName || "");
    const simAccount = /^Sim\d*$/i.test(accountName);
    const requestedMode = String(input.mode || "sim101_addon_approved_only");
    const commandRequested = input.commandEnabled === true;
    const commandAllowed = this.environment.executionEnabled === true
      && this.environment.killSwitch === false
      && this.environment.bridgeMode === "sim101_addon_approved_only"
      && requestedMode === this.environment.bridgeMode
      && simAccount
      && commandRequested;
    const heartbeat = {
      bridge_id: input.bridgeId,
      broker_account_id: input.brokerAccountId || this.environment.defaultAccount,
      mode: requestedMode === this.environment.bridgeMode ? requestedMode : "disabled",
      status: input.ninjaConnected === true ? (commandAllowed ? "armed" : "read_only") : "degraded",
      host_name: input.hostName || hostname(),
      process_id: Number(input.processId) || null,
      ninja_connected: input.ninjaConnected === true,
      ati_enabled: false,
      account_name: accountName || null,
      last_seen_at: this.#now(),
      metadata: { requested_status: input.status || null, sim_account: simAccount, shadow_mode: !commandAllowed },
      adapter_kind: "addon",
      protocol_version: input.protocolVersion || "desk_ninja_addon_v1",
      capabilities: input.capabilities || {},
      command_enabled: commandAllowed,
    };
    return contract("DeskNinjaAddonHeartbeat", { heartbeat: await this.repository.upsertHeartbeat(heartbeat) });
  }

  async claimAddonWork(input = {}) {
    if (!this.environment.executionEnabled || this.environment.killSwitch || this.environment.bridgeMode !== "sim101_addon_approved_only") {
      return contract("DeskNinjaAddonClaim", { status: "BLOCKED", reason: "ENVIRONMENT_NOT_ARMED", work: null });
    }
    const bridge = await this.#requireAddonBridge(input, { commands: true });
    const accountName = bridge.account_name;
    const managementCandidate = typeof this.repository.peekManagementOutbox === "function" ? await this.repository.peekManagementOutbox() : null;
    if (managementCandidate) {
      const context = await this.repository.managementContext({ managementIntentId: managementCandidate.management_intent_id });
      context.bridge = bridge;
      const snapshotParity = await this.#addonSnapshotParity({ context, bridgeId: input.bridgeId, workType: "management" });
      if (!snapshotParity.pass) return contract("DeskNinjaAddonClaim", { status: "BLOCKED", reason: snapshotParity.reason, violations: snapshotParity.violations, work: null });
      const risk = evaluateBrokerManagementPolicy({ ...context, environment: this.environment, now: this.#now() });
      if (!risk.pass) return contract("DeskNinjaAddonClaim", { status: "BLOCKED", reason: "MANAGEMENT_RISK_RECHECK_FAILED", violations: risk.violations, work: null });
      createNinjaAddonCommand({ workType: "management", leased: managementCandidate, context, accountName, now: this.#now() });
      const leaseToken = randomUUID();
      const leased = await this.repository.leaseManagementOutbox({ outboxId: managementCandidate.management_outbox_id, bridgeId: input.bridgeId, leaseToken, leaseSeconds: input.leaseSeconds });
      if (!leased) return contract("DeskNinjaAddonClaim", { status: "BUSY", work: null });
      const command = createNinjaAddonCommand({ workType: "management", leased, context, accountName, now: this.#now() });
      return contract("DeskNinjaAddonClaim", { status: "CLAIMED", work: { outbox_id: leased.management_outbox_id, work_type: "management", lease_token: leaseToken, command } });
    }
    const candidate = await this.repository.peekOutbox();
    if (!candidate) return contract("DeskNinjaAddonClaim", { status: "NO_WORK", work: null });
    assertBrokerOrderIntentAuthority({ candidate, environment: this.environment, action: "claim_addon" });
    const context = await this.repository.decisionContext({ decisionId: candidate.trade_decision_id, accountId: candidate.broker_account_id });
    context.bridge = bridge;
    const snapshotParity = await this.#addonSnapshotParity({ context, bridgeId: input.bridgeId, workType: "entry" });
    if (!snapshotParity.pass) return contract("DeskNinjaAddonClaim", { status: "BLOCKED", reason: snapshotParity.reason, violations: snapshotParity.violations, work: null });
    const risk = evaluateBrokerPolicy({ ...context, environment: this.environment, now: this.#now() });
    if (!risk.pass) return contract("DeskNinjaAddonClaim", { status: "BLOCKED", reason: "RISK_RECHECK_FAILED", violations: risk.violations, work: null });
    createNinjaAddonCommand({ workType: "entry", leased: candidate, context, accountName, atmStrategyName: this.addonAtmStrategyName, now: this.#now() });
    const leaseToken = randomUUID();
    const leased = await this.repository.leaseOutbox({ outboxId: candidate.execution_outbox_id, bridgeId: input.bridgeId, leaseToken, leaseSeconds: input.leaseSeconds });
    if (!leased) return contract("DeskNinjaAddonClaim", { status: "BUSY", work: null });
    const command = createNinjaAddonCommand({ workType: "entry", leased, context, accountName, atmStrategyName: this.addonAtmStrategyName, now: this.#now() });
    return contract("DeskNinjaAddonClaim", { status: "CLAIMED", work: { outbox_id: leased.execution_outbox_id, work_type: "entry", lease_token: leaseToken, command } });
  }

  async completeAddonWork(input = {}) {
    await this.#requireAddonBridge(input, { commands: false });
    return this.completeBridgeWork(input);
  }

  async recordAddonEvents(input = {}) {
    const bridge = await this.#requireAddonBridge(input, { commands: false });
    const accountId = input.brokerAccountId || bridge.broker_account_id || this.environment.defaultAccount;
    const results = [];
    for (const rawEvent of input.events || []) {
      const event = normalizeNinjaAddonEvent(rawEvent, this.#now());
      const externalEventKey = String(rawEvent.external_event_key || rawEvent.externalEventKey || event.event_id);
      const stored = await this.repository.storeAddonEvent({
        addonEventId: event.event_id,
        bridgeId: input.bridgeId,
        accountId,
        accountName: bridge.account_name,
        externalEventKey,
        event,
      });
      let lifecycle = null;
      let protection = null;
      if (event.intent_id && (event.payload?.protective_stop_order_ref || event.payload?.profit_target_order_ref) && typeof this.repository.attachAddonProtection === "function") {
        protection = await this.repository.attachAddonProtection({ intentId: event.intent_id, payload: event.payload });
      }
      if (event.event_type === "order" && event.payload?.desk_lifecycle === true && (event.intent_id || event.management_intent_id)) {
        lifecycle = await this.recordBrokerEvent({
          intentId: event.intent_id || undefined,
          managementIntentId: event.management_intent_id || undefined,
          externalEventKey,
          update: { ...event.payload, execution_adapter: "addon", command_id: event.command_id },
        });
      }
      if (!protection && event.intent_id && (event.payload?.protective_stop_order_ref || event.payload?.profit_target_order_ref) && typeof this.repository.attachAddonProtection === "function") {
        protection = await this.repository.attachAddonProtection({ intentId: event.intent_id, payload: event.payload });
      }
      results.push({ event: stored, lifecycle, protection });
    }
    return contract("DeskNinjaAddonEventBatch", { count: results.length, items: results });
  }

  async recordAddonSnapshot(input = {}) {
    const bridge = await this.#requireAddonBridge(input, { commands: false });
    const accountId = input.brokerAccountId || bridge.broker_account_id || this.environment.defaultAccount;
    const snapshot = input.snapshot || {};
    const capturedAt = new Date(Date.parse(snapshot.captured_at || snapshot.capturedAt || this.#now())).toISOString();
    const contentHash = canonicalSha256({ account: snapshot.account || {}, orders: snapshot.orders || [], positions: snapshot.positions || [], connection: snapshot.connection || {} });
    const stored = await this.repository.storeAddonSnapshot({
      snapshotId: input.snapshotId || `addon_snapshot_${contentHash.slice(0, 24)}_${Date.parse(capturedAt)}`,
      bridgeId: input.bridgeId,
      accountId,
      accountName: bridge.account_name,
      capturedAt,
      snapshot,
      contentHash,
      metadata: { source: "ninja_addon", protocol_version: bridge.protocol_version },
    });
    const accountSnapshot = snapshot.account && hasCapitalValue(snapshot.account)
      ? await this.repository.recordAccountSnapshot({ accountId, snapshot: { ...snapshot.account, captured_at: capturedAt }, now: this.#now() })
      : null;
    const protectiveSettlements = typeof this.repository.settleProtectiveExitsFromAddonSnapshot === "function"
      ? await this.repository.settleProtectiveExitsFromAddonSnapshot({
          accountId,
          brokerSnapshot: snapshot,
          snapshotId: stored.addon_snapshot_id,
          capturedAt,
          now: this.#now(),
        })
      : [];
    const protectionConfirmations = typeof this.repository.confirmProtectionFromAddonSnapshot === "function"
      ? await this.repository.confirmProtectionFromAddonSnapshot({
          accountId,
          brokerSnapshot: snapshot,
          snapshotId: stored.addon_snapshot_id,
          capturedAt,
          now: this.#now(),
        })
      : [];
    const ati = typeof this.repository.latestAtiSnapshot === "function" ? await this.repository.latestAtiSnapshot({ accountId }) : null;
    const comparison = ati?.broker_snapshot ? compareNinjaAdapterSnapshots(ati.broker_snapshot, snapshot) : null;
    const parity = await this.repository.storeAdapterParity({ run: {
      adapter_parity_run_id: `adapter_parity_${randomUUID().replaceAll("-", "")}`,
      broker_account_id: accountId,
      left_adapter: "ati",
      right_adapter: "addon",
      status: comparison?.status || "incomplete",
      mismatch_count: comparison?.mismatch_count || 0,
      mismatches: comparison?.mismatches || [],
      left_snapshot: ati?.broker_snapshot || {},
      right_snapshot: snapshot,
      compared_at: this.#now(),
      metadata: { addon_snapshot_id: stored.addon_snapshot_id, ati_reconciliation_started_at: ati?.started_at || null, shadow_only: bridge.command_enabled !== true },
    } });
    const reconciliation = input.reconcile === true
      ? await this.reconcile({
          bridgeId: input.bridgeId,
          brokerAccountId: accountId,
          brokerSnapshot: snapshot,
          source: "ninja_addon",
          lockOnDivergence: input.lockOnDivergence === true,
          reconciliationMode: input.reconciliationMode,
          triggeredBy: input.triggeredBy || input.triggered_by || "addon",
          operatorConfirmation: input.operatorConfirmation || input.operator_confirmation || "",
        })
      : null;
    return contract("DeskNinjaAddonSnapshot", { snapshot: stored, accountSnapshot, protectiveSettlements, protectionConfirmations, parity, reconciliation });
  }

  async recordBrokerEvent(input = {}) {
    const update = normalizeNinjaUpdate(input.update || input, this.#now());
    let managementIntentId = input.managementIntentId || null;
    if (!managementIntentId && input.managementOrderRef && typeof this.repository.findManagementIntentByOrderRef === "function") {
      managementIntentId = (await this.repository.findManagementIntentByOrderRef(update.broker_order_ref))?.management_intent_id || null;
      if (!managementIntentId) return contract("DeskBrokerOrderUpdate", { status: "IGNORED", reason: "UNMANAGED_BROKER_ORDER", update });
    }
    const record = managementIntentId ? this.repository.recordManagementBrokerUpdate.bind(this.repository) : this.repository.recordBrokerUpdate.bind(this.repository);
    const order = await record({
      brokerOrderId: input.brokerOrderId || `broker_order_${randomUUID().replaceAll("-", "")}`,
      brokerOrderRef: update.broker_order_ref,
      ...(managementIntentId ? { managementIntentId } : { intentId: input.intentId }),
      externalEventKey: input.externalEventKey || null,
      update,
      now: this.#now(),
    });
    const canonicalPositionProjection = managementIntentId
      ? await this.#projectAcknowledgedManagement({ managementIntentId, update, source: "broker_event" })
      : null;
    return contract("DeskBrokerOrderUpdate", { order, update, canonicalPositionProjection });
  }

  async reconcile(input = {}) {
    const accountId = input.brokerAccountId || this.environment.defaultAccount;
    const now = this.#now();
    const policy = resolveBrokerReconciliationPolicy(input, { environment: this.environment, now, defaultMode: "blocking" });
    if (policy.mode === "disabled") {
      return contract("DeskBrokerReconciliation", {
        reconciliation: {
          reconciliation_run_id: `reconciliation_skipped_${randomUUID().replaceAll("-", "")}`,
          broker_account_id: accountId,
          status: "skipped",
          started_at: now,
          completed_at: now,
          mismatch_count: 0,
          mismatches: [],
          metadata: { reconciliation_policy: policy, reason: "RECONCILIATION_DISABLED" },
        },
        accountSnapshot: null,
        settledManagement: [],
        managementProjections: [],
      });
    }
    const brokerAccount = input.brokerSnapshot?.account || null;
    const accountSnapshot = brokerAccount && hasCapitalValue(brokerAccount) && typeof this.repository.recordAccountSnapshot === "function"
      ? await this.repository.recordAccountSnapshot({ accountId, snapshot: brokerAccount, now })
      : null;
    const settledManagement = typeof this.repository.settleManagementFromSnapshot === "function"
      ? await this.repository.settleManagementFromSnapshot({ accountId, brokerSnapshot: input.brokerSnapshot || {}, now })
      : [];
    const managementProjections = [];
    for (const settlement of settledManagement) {
      managementProjections.push(await this.#projectAcknowledgedManagement({
        managementIntentId: settlement.management_intent_id,
        update: { status: "filled", occurred_at: now },
        source: "broker_reconciliation",
      }));
    }
    const desk = await this.repository.reconciliationSnapshot(accountId);
    const mismatches = compareSnapshots(desk, input.brokerSnapshot || {}, { accountId });
    const run = {
      reconciliation_run_id: `reconciliation_${randomUUID().replaceAll("-", "")}`,
      bridge_id: input.bridgeId || null,
      broker_account_id: accountId,
      status: mismatches.length ? "diverged" : "matched",
      started_at: now,
      completed_at: now,
      mismatch_count: mismatches.length,
      mismatches,
      broker_snapshot: input.brokerSnapshot || {},
      desk_snapshot: desk,
      metadata: {
        source: input.source || "ninja_bridge",
        triggered_by: policy.triggeredBy,
        reconciliation_policy: policy,
        alert_only: policy.mode === "alert_only",
        fail_closed: policy.lockOnDivergence,
        blocking_enabled: policy.lockOnDivergence,
        rollback_mode: "alert_only",
        account_snapshot_id: accountSnapshot?.broker_account_snapshot_id || null,
        sizing_risk_percent: BROKER_RISK_PERCENT,
      },
    };
    return contract("DeskBrokerReconciliation", {
      reconciliation: await this.repository.storeReconciliation({ run, lockOnDivergence: policy.lockOnDivergence }),
      accountSnapshot,
      settledManagement,
      managementProjections,
    });
  }

  async runScheduledReconciliation(input = {}) {
    const accountId = input.brokerAccountId || this.environment.defaultAccount;
    const brokerSnapshot = input.brokerSnapshot || (typeof this.repository.latestAddonSnapshot === "function"
      ? await this.repository.latestAddonSnapshot({ accountId, bridgeId: input.bridgeId || null })
      : null);
    if (!brokerSnapshot) {
      const now = this.#now();
      return contract("DeskBrokerReconciliation", {
        reconciliation: {
          reconciliation_run_id: `reconciliation_skipped_${randomUUID().replaceAll("-", "")}`,
          broker_account_id: accountId,
          status: "skipped",
          started_at: now,
          completed_at: now,
          mismatch_count: 0,
          mismatches: [],
          metadata: {
            reason: "BROKER_SNAPSHOT_UNAVAILABLE",
            reconciliation_policy: resolveBrokerReconciliationPolicy({ ...input, triggeredBy: "scheduled", reconciliationMode: input.reconciliationMode || "alert_only" }, {
              environment: this.environment,
              now,
              defaultMode: "alert_only",
            }),
          },
        },
        accountSnapshot: null,
        settledManagement: [],
        managementProjections: [],
      });
    }
    return this.reconcile({
      ...input,
      brokerAccountId: accountId,
      brokerSnapshot,
      source: input.source || "scheduled_reconciliation",
      triggeredBy: input.triggeredBy || input.triggered_by || "scheduled",
      reconciliationMode: input.reconciliationMode || input.mode || "alert_only",
    });
  }

  async #projectAcknowledgedManagement({ managementIntentId, update = {}, source }) {
    if (typeof this.repository.managementIntentDetail !== "function"
      || typeof this.persistence?.commitBrokerPositionProjection !== "function") {
      return { applied: false, replayed: false, reason: "BROKER_POSITION_PROJECTION_UNAVAILABLE" };
    }
    const detail = await this.repository.managementIntentDetail(managementIntentId);
    const intent = detail?.intent || {};
    const trade = detail?.trade || {};
    const status = String(update.status || "").toLowerCase();
    const acknowledged = intent.action === "move_stop"
      ? ["accepted", "working", "filled"].includes(status)
      : ["partially_filled", "filled"].includes(status);
    if (!acknowledged) {
      return { applied: false, replayed: false, reason: "BROKER_ACK_REQUIRED", management_intent_id: managementIntentId };
    }
    const positionId = trade.position_id || null;
    if (!positionId) {
      return { applied: false, replayed: false, reason: "CANONICAL_POSITION_REFERENCE_MISSING", management_intent_id: managementIntentId };
    }
    const brokerRevision = Number(trade.revision || 0);
    const tradeStatus = String(trade.status || "").toLowerCase();
    const tradeSide = String(trade.side || "").toLowerCase();
    const requiredProjectionFields = {
      revision: Number.isInteger(brokerRevision) && brokerRevision >= 0,
      side: ["long", "short"].includes(tradeSide),
      quantity_planned: finiteOrNull(trade.quantity_planned) !== null && finiteOrNull(trade.quantity_planned) > 0,
      quantity_open: finiteOrNull(trade.quantity_open) !== null && finiteOrNull(trade.quantity_open) >= 0,
      quantity_closed: finiteOrNull(trade.quantity_closed) !== null && finiteOrNull(trade.quantity_closed) >= 0,
      avg_entry_price: finiteOrNull(trade.avg_entry_price) !== null,
      initial_stop_price: finiteOrNull(trade.initial_stop_price) !== null,
      current_stop_price: intent.action !== "move_stop" || finiteOrNull(trade.current_stop_price) !== null,
      avg_exit_price: tradeStatus !== "closed" || finiteOrNull(trade.avg_exit_price) !== null,
    };
    const missingProjectionFields = Object.entries(requiredProjectionFields)
      .filter(([, valid]) => !valid)
      .map(([field]) => field);
    if (missingProjectionFields.length > 0) {
      return {
        applied: false,
        replayed: false,
        reason: "BROKER_PROJECTION_DATA_INCOMPLETE",
        management_intent_id: managementIntentId,
        missing_fields: missingProjectionFields,
      };
    }
    const canonicalStatus = ({
      open: "OPEN",
      protected: "PROTECTED",
      scaling: "PARTIAL_TAKEN",
      closed: "CLOSED",
      cancelled: "CANCELLED",
      rejected: "REVIEW_REQUIRED",
      expired: "EXPIRED",
    })[tradeStatus] || "REVIEW_REQUIRED";
    const occurredAt = update.occurred_at || this.#now();
    const auditId = `broker_position_projection__${managementIntentId}__r${brokerRevision}`;
    return this.persistence.commitBrokerPositionProjection({
      positionCollection: C.deskPositions,
      positionId,
      brokerRevision,
      positionPatch: {
        broker_execution: true,
        paper_simulated: false,
        execution_mode: "broker_paper",
        broker_authority: "NINJATRADER_ACK",
        broker_trade_id: trade.trade_id || null,
        broker_management_intent_id: managementIntentId,
        status: canonicalStatus,
        direction: tradeSide,
        entry_price: finiteOrNull(trade.avg_entry_price),
        initial_quantity: finiteOrNull(trade.quantity_planned),
        remaining_quantity: finiteOrNull(trade.quantity_open),
        exited_quantity: finiteOrNull(trade.quantity_closed),
        initial_stop_loss: finiteOrNull(trade.initial_stop_price),
        stop_loss: finiteOrNull(trade.current_stop_price),
        stop: finiteOrNull(trade.current_stop_price),
        exit_price: tradeStatus === "closed" ? finiteOrNull(trade.avg_exit_price) : null,
        result_r: finiteOrNull(trade.result_r),
        result_R: finiteOrNull(trade.result_r),
        realized_R: finiteOrNull(trade.result_r),
        closed_at_utc: tradeStatus === "closed" ? trade.closed_at || occurredAt : null,
        broker_projection_source: source,
        broker_projection_ack_status: status,
        broker_projection_applied_at_utc: this.#now(),
        updated_at: this.#now(),
        updated_at_utc: this.#now(),
      },
      auditWrite: {
        collection: C.deskDecisionJournal,
        documentId: auditId,
        data: {
          event_id: auditId,
          event_type: "BROKER_POSITION_ACK_PROJECTED",
          source,
          position_id: positionId,
          trade_id: trade.trade_id || null,
          management_intent_id: managementIntentId,
          broker_revision: brokerRevision,
          broker_status: tradeStatus,
          canonical_status: canonicalStatus,
          broker_ack_status: status,
          occurred_at_utc: occurredAt,
          created_at_utc: this.#now(),
        },
      },
    });
  }

  #now() { return this.clock?.now?.().utc || new Date().toISOString(); }

  async #requireAddonBridge(input, { commands }) {
    const bridge = typeof this.repository.bridgeHeartbeat === "function"
      ? await this.repository.bridgeHeartbeat({ bridgeId: input.bridgeId, accountId: input.brokerAccountId || null })
      : null;
    if (!bridge || bridge.adapter_kind !== "addon") throw serviceError("ADDON_BRIDGE_NOT_REGISTERED", "The signed AddOn must publish a heartbeat before using this endpoint.");
    if (!/^Sim\d*$/i.test(String(bridge.account_name || ""))) throw serviceError("ADDON_SIM_ACCOUNT_REQUIRED", "Only a NinjaTrader Sim* account is accepted.");
    const ageMs = Date.parse(this.#now()) - Date.parse(bridge.last_seen_at || "");
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > this.environment.bridgeStaleSeconds * 1000) throw serviceError("ADDON_BRIDGE_STALE", "The AddOn heartbeat is stale.");
    if (commands && (bridge.command_enabled !== true || bridge.status !== "armed")) throw serviceError("ADDON_COMMANDS_NOT_ARMED", "The AddOn is connected in read-only shadow mode.");
    return bridge;
  }

  async #latestReconciledManagementMark({ trade, context }) {
    const accountId = context?.account?.broker_account_id || trade?.broker_account_id || this.environment.defaultAccount;
    const reads = [];
    if (typeof this.repository.latestAddonSnapshot === "function") {
      reads.push(this.repository.latestAddonSnapshot({ accountId }).then((snapshot) => ({ snapshot, source: "ninja_addon_reconciled" })).catch(() => null));
    }
    if (typeof this.repository.latestAtiSnapshot === "function") {
      reads.push(this.repository.latestAtiSnapshot({ accountId }).then((row) => row?.broker_snapshot ? ({ snapshot: { ...row.broker_snapshot, captured_at: row.started_at }, source: "ninja_ati_reconciled" }) : null).catch(() => null));
    }
    const candidates = (await Promise.all(reads)).filter(Boolean);
    const expectedInstrument = positionKey(context?.contract?.broker_symbol || context?.contract?.instrument_code || trade?.broker_symbol || trade?.instrument_code);
    const expectedAccount = accountKey(context?.account?.broker_account_id || trade?.broker_account_id || accountId);
    const expectedQuantity = Math.max(0, Number(trade?.quantity_open || 0));
    const expectedSide = String(trade?.side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
    return candidates
      .map(({ snapshot, source }) => {
        const actual = aggregateBrokerPositions(snapshot?.positions || [], { defaultAccountId: expectedAccount }).get(positionMapKey(expectedAccount, expectedInstrument)) || null;
        const actualQuantity = Math.abs(actual?.signedQuantity || 0);
        const actualSide = actual?.side || "";
        const reconciled = actual !== null && actualQuantity === expectedQuantity && (!actualSide || actualSide === expectedSide);
        return {
          price: firstFinite(actual?.mark_price, actual?.last_price, actual?.market_price, actual?.current_price, actual?.last),
          timestamp: actual?.mark_time || actual?.mark_timestamp || actual?.timestamp_utc || snapshot?.captured_at || snapshot?.received_at || null,
          reconciled,
          immutable: false,
          source,
        };
      })
      .filter((candidate) => candidate.reconciled)
      .sort((left, right) => Date.parse(right.timestamp || "") - Date.parse(left.timestamp || ""))[0] || null;
  }
  async #addonSnapshotParity({ context, bridgeId, workType }) {
    if (typeof this.repository.latestAddonSnapshot !== "function") {
      return { pass: false, reason: "ADDON_SNAPSHOT_UNAVAILABLE", violations: [{ code: "ADDON_SNAPSHOT_UNAVAILABLE" }] };
    }
    const accountId = context.account?.broker_account_id || context.trade?.broker_account_id || this.environment.defaultAccount;
    const snapshot = await this.repository.latestAddonSnapshot({ accountId, bridgeId });
    if (!snapshot) return { pass: false, reason: "ADDON_SNAPSHOT_UNAVAILABLE", violations: [{ code: "ADDON_SNAPSHOT_UNAVAILABLE" }] };
    const ageMs = Date.parse(this.#now()) - Date.parse(snapshot.captured_at || snapshot.received_at || "");
    if (!Number.isFinite(ageMs) || ageMs < -5_000 || ageMs > this.environment.bridgeStaleSeconds * 1000) {
      return { pass: false, reason: "ADDON_SNAPSHOT_STALE", violations: [{ code: "ADDON_SNAPSHOT_STALE", age_ms: ageMs }] };
    }
    if (String(snapshot.connection?.status || "").toLowerCase() !== "connected") {
      return { pass: false, reason: "ADDON_SNAPSHOT_DISCONNECTED", violations: [{ code: "ADDON_SNAPSHOT_DISCONNECTED" }] };
    }
    const expectedInstrument = positionKey(context.contract?.broker_symbol || context.contract?.instrument_code);
    const expectedAccount = accountKey(context.account?.broker_account_id || context.trade?.broker_account_id || accountId);
    const actual = aggregateBrokerPositions(snapshot.positions || [], { defaultAccountId: expectedAccount }).get(positionMapKey(expectedAccount, expectedInstrument)) || null;
    const actualQuantity = Math.abs(actual?.signedQuantity || 0);
    if (workType === "entry") {
      return actualQuantity === 0
        ? { pass: true, snapshot }
        : { pass: false, reason: "ADDON_POSITION_MISMATCH", violations: [{ code: "ADDON_POSITION_NOT_FLAT", instrument: expectedInstrument, broker_quantity: actualQuantity }] };
    }
    const deskQuantity = Math.max(0, Number(context.trade?.quantity_open || 0));
    const deskSide = context.trade?.side === "short" ? "SHORT" : "LONG";
    const actualSide = actual?.side || (actualQuantity === 0 ? "FLAT" : "");
    const quantityMatches = actualQuantity === deskQuantity;
    const sideMatches = actualQuantity === 0 || !actualSide || actualSide === deskSide;
    return quantityMatches && sideMatches
      ? { pass: true, snapshot }
      : {
          pass: false,
          reason: "ADDON_POSITION_MISMATCH",
          violations: [{ code: "ADDON_POSITION_MISMATCH", account_id: expectedAccount, instrument: expectedInstrument, desk_quantity: deskQuantity, broker_quantity: actualQuantity, desk_side: deskSide, broker_side: actualSide }],
        };
  }
}

function compareSnapshots(desk, broker, { accountId = null } = {}) {
  const mismatches = [];
  const deskOrders = new Set((desk.orders || []).map((item) => item.broker_order_ref).filter(Boolean));
  const brokerOrders = new Set((broker.orders || []).map((item) => item.order_id || item.broker_order_ref).filter(Boolean));
  for (const order of deskOrders) if (!brokerOrders.has(order)) mismatches.push({ type: "ORDER_MISSING_AT_BROKER", broker_order_ref: order });
  for (const order of brokerOrders) if (!deskOrders.has(order)) mismatches.push({ type: "ORDER_UNKNOWN_TO_DESK", broker_order_ref: order });
  const defaultAccountId = accountKey(accountId);
  const deskPositions = aggregateDeskPositions(desk.trades || [], { defaultAccountId });
  const brokerPositions = aggregateBrokerPositions(broker.positions || [], { defaultAccountId });
  for (const [key, position] of deskPositions) {
    const brokerPosition = brokerPositions.get(key) || zeroPosition(position);
    if (sameSignedQuantity(position.signedQuantity, brokerPosition.signedQuantity)) continue;
    if (sameSignedQuantity(Math.abs(position.signedQuantity), Math.abs(brokerPosition.signedQuantity)) && position.signedQuantity !== 0 && brokerPosition.signedQuantity !== 0) {
      mismatches.push({
        type: "POSITION_SIDE_MISMATCH",
        account_id: position.accountId,
        instrument: position.instrument,
        desk_side: sideFromSigned(position.signedQuantity),
        broker_side: sideFromSigned(brokerPosition.signedQuantity),
        desk_signed_quantity: position.signedQuantity,
        broker_signed_quantity: brokerPosition.signedQuantity,
      });
      continue;
    }
    mismatches.push({
      type: "POSITION_QUANTITY_MISMATCH",
      account_id: position.accountId,
      instrument: position.instrument,
      desk_quantity: Math.abs(position.signedQuantity),
      broker_quantity: Math.abs(brokerPosition.signedQuantity),
      desk_signed_quantity: position.signedQuantity,
      broker_signed_quantity: brokerPosition.signedQuantity,
    });
  }
  for (const [key, position] of brokerPositions) {
    if (!deskPositions.has(key) && !sameSignedQuantity(position.signedQuantity, 0)) {
      mismatches.push({
        type: "POSITION_UNKNOWN_TO_DESK",
        account_id: position.accountId,
        instrument: position.instrument,
        broker_quantity: Math.abs(position.signedQuantity),
        broker_side: sideFromSigned(position.signedQuantity),
        broker_signed_quantity: position.signedQuantity,
      });
    }
  }
  return mismatches;
}

export function resolveBrokerReconciliationPolicy(input = {}, { environment = {}, now = null, defaultMode = "alert_only" } = {}) {
  const hasExplicitMode = input.reconciliationMode !== undefined || input.reconciliation_mode !== undefined || input.mode !== undefined || environment.reconciliationMode !== undefined;
  const rawMode = hasExplicitMode
    ? input.reconciliationMode ?? input.reconciliation_mode ?? input.mode ?? environment.reconciliationMode
    : input.lockOnDivergence === true
      ? "blocking"
      : input.lockOnDivergence === false
        ? "alert_only"
        : defaultMode;
  const mode = String(rawMode || "alert_only").trim().toLowerCase();
  if (!BROKER_RECONCILIATION_MODES.includes(mode)) {
    throw serviceError("RECONCILIATION_MODE_INVALID", `Unsupported broker reconciliation mode: ${rawMode}.`, { supported_modes: BROKER_RECONCILIATION_MODES });
  }
  const triggeredBy = String(input.triggeredBy || input.triggered_by || "manual").trim().toLowerCase() || "manual";
  const promotionConfirmation = String(input.operatorConfirmation || input.operator_confirmation || "").trim();
  const blockingConfirmed = promotionConfirmation === BROKER_RECONCILIATION_BLOCKING_CONFIRMATION
    || input.blockingPromotionConfirmed === true
    || input.blocking_promotion_confirmed === true;
  if (mode === "blocking" && triggeredBy === "scheduled" && !blockingConfirmed) {
    throw serviceError(
      "RECONCILIATION_BLOCKING_CONFIRMATION_REQUIRED",
      `Scheduled blocking reconciliation requires confirmation phrase ${BROKER_RECONCILIATION_BLOCKING_CONFIRMATION}.`,
      { confirmation_phrase: BROKER_RECONCILIATION_BLOCKING_CONFIRMATION },
    );
  }
  return Object.freeze({
    schema_version: "broker_reconciliation_policy_v1",
    mode,
    triggeredBy,
    evaluated_at: now,
    lockOnDivergence: mode === "blocking",
    alertOnly: mode === "alert_only",
    blockingPromotionConfirmed: mode === "blocking" ? blockingConfirmed : false,
    requiredConfirmationForBlocking: BROKER_RECONCILIATION_BLOCKING_CONFIRMATION,
    rollbackMode: mode === "blocking" ? "alert_only" : mode,
  });
}

function aggregateDeskPositions(items = [], { defaultAccountId = "*" } = {}) {
  return aggregateSignedPositions(items, {
    defaultAccountId,
    instrumentOf: (item) => positionKey(item.broker_symbol || item.instrument_code || item.instrument || item.symbol),
    accountOf: (item) => item.broker_account_id || item.account_id || item.account_name || item.accountName,
    quantityOf: (item) => firstFinite(item.quantity_open, item.open_quantity, item.quantity, item.qty),
    sideOf: (item) => item.side || item.direction || item.market_position,
  });
}

function aggregateBrokerPositions(items = [], { defaultAccountId = "*" } = {}) {
  return aggregateSignedPositions(items, {
    defaultAccountId,
    instrumentOf: (item) => positionKey(item.instrument || item.broker_symbol || item.instrument_code || item.symbol),
    accountOf: (item) => item.broker_account_id || item.account_id || item.account_name || item.accountName,
    quantityOf: (item) => firstFinite(item.quantity, item.quantity_open, item.net_quantity, item.qty),
    sideOf: (item) => item.market_position || item.side || item.direction,
  });
}

function aggregateSignedPositions(items = [], { defaultAccountId = "*", accountOf, instrumentOf, quantityOf, sideOf } = {}) {
  const aggregated = new Map();
  for (const item of items || []) {
    const instrument = instrumentOf(item);
    if (!instrument) continue;
    const accountId = accountKey(accountOf(item) || defaultAccountId);
    const signedQuantity = signedPositionQuantity({ quantity: quantityOf(item), side: sideOf(item) });
    const key = positionMapKey(accountId, instrument);
    const current = aggregated.get(key) || {
      accountId,
      instrument,
      signedQuantity: 0,
      rawCount: 0,
      raw: [],
      side: "FLAT",
    };
    current.signedQuantity = normalizeSignedQuantity(current.signedQuantity + signedQuantity);
    current.rawCount += 1;
    current.raw.push(item);
    current.side = sideFromSigned(current.signedQuantity);
    for (const field of ["mark_price", "last_price", "market_price", "current_price", "last", "mark_time", "mark_timestamp", "timestamp_utc"]) {
      if (current[field] === undefined && item?.[field] !== undefined) current[field] = item[field];
    }
    aggregated.set(key, current);
  }
  return aggregated;
}

function signedPositionQuantity({ quantity, side }) {
  const qty = Math.max(0, Number(quantity || 0));
  if (!Number.isFinite(qty) || qty === 0) return 0;
  const normalizedSide = normalizePositionSide(side);
  if (normalizedSide === "SHORT") return normalizeSignedQuantity(-qty);
  if (normalizedSide === "FLAT") return 0;
  return normalizeSignedQuantity(qty);
}

function normalizePositionSide(side) {
  const normalized = String(side || "").trim().toUpperCase();
  if (["SHORT", "SELL"].includes(normalized)) return "SHORT";
  if (["LONG", "BUY"].includes(normalized)) return "LONG";
  if (["FLAT", "NONE", "0"].includes(normalized)) return "FLAT";
  return normalized || "LONG";
}

function sideFromSigned(value) {
  if (value > 0) return "LONG";
  if (value < 0) return "SHORT";
  return "FLAT";
}

function sameSignedQuantity(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) < 1e-9;
}

function normalizeSignedQuantity(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || Math.abs(parsed) < 1e-9) return 0;
  return Number(parsed.toFixed(8));
}

function zeroPosition(position) { return { accountId: position.accountId, instrument: position.instrument, signedQuantity: 0, side: "FLAT" }; }

function positionMapKey(accountId, instrument) {
  return `${accountKey(accountId)}::${positionKey(instrument)}`;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function hasCapitalValue(account) { return [account.cash_value, account.cashValue, account.CashValue, account.net_liquidation_value, account.net_liquidation, account.NetLiquidation].some((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) > 0); }
function monitorSourcePositionId(monitor = {}) {
  return monitor.deterministic_monitor_command?.position_request?.position_id
    || monitor.position_request?.position_id
    || monitor.linked_position_id
    || null;
}
function positionKey(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const named = normalized.match(/^([A-Z0-9]+)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})$/);
  const numeric = normalized.match(/^([A-Z0-9]+)\s+(\d{1,2})-(\d{2}|\d{4})$/);
  if (!named && !numeric) return normalized;
  const months = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const root = (named || numeric)[1];
  const month = named ? months[named[2]] : Number(numeric[2]);
  const rawYear = named ? named[3] : numeric[3];
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  return `${root}:${year}-${String(month).padStart(2, "0")}`;
}
function accountKey(value) {
  return String(value || "*").trim() || "*";
}
function requirePhrase(actual, expected) { if (actual !== expected) throw serviceError("CONFIRMATION_REQUIRED", `Confirmation phrase must be ${expected}.`); }
function safeEnvironment(environment) { return { executionEnabled: environment.executionEnabled, manualTelegramExecutionEnabled: environment.manualTelegramExecutionEnabled, legacyPositionExecutionEnabled: environment.legacyPositionExecutionEnabled, bridgeMode: environment.bridgeMode, killSwitch: environment.killSwitch, maxContracts: environment.maxContracts, allowedInstruments: environment.allowedInstruments, allowLiveAccount: environment.allowLiveAccount }; }
function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function validIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function contract(name, payload) { return { contract: name, schemaVersion: "1.0.0", ...payload }; }
function serviceError(code, message, details = {}) { const error = new Error(message); error.code = code; error.details = details; error.statusCode = 409; return error; }
function skippedPortfolioExecution(reason) { return { ok: true, status: "SKIPPED", reason, count: 0, items: [] }; }
