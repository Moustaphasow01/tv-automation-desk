import { materializeTradeOutcome } from "./broker-trade-outcome-repository.js";
import { firstNumber, isConnectedAddonSnapshot, positionKey, validTimestamp } from "./broker-execution-normalizers.js";
import { evaluateBrokerProtectionSnapshot } from "./broker-protection-snapshot.js";
import {
  latestClosedCandleForIntent as latestTheoreticalClosedCandleForIntent,
  latestClosedCandleForTrade as latestTheoreticalClosedCandleForTrade,
  listTheoreticalEntryCandidates as listTheoreticalEntryCandidatesRepository,
  listTheoreticalOpenTrades as listTheoreticalOpenTradesRepository,
  recordManualExecutionEvent as recordManualExecutionEventRepository,
  recordTheoreticalEntryExpired as recordTheoreticalEntryExpiredRepository,
  recordTheoreticalEntryFill as recordTheoreticalEntryFillRepository,
  recordTheoreticalExitFill as recordTheoreticalExitFillRepository,
  recordTheoreticalReviewRequired as recordTheoreticalReviewRequiredRepository,
} from "./broker-theoretical-execution-repository.js";

export { evaluateBrokerProtectionSnapshot } from "./broker-protection-snapshot.js";

export class PostgresBrokerExecutionRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) throw repositoryError("BROKER_REPOSITORY_UNAVAILABLE", "PostgreSQL broker repository is unavailable.");
    await this.persistence.initialized;
  }

  async overview({ limit = 100 } = {}) {
    await this.ready();
    const bounded = Math.max(1, Math.min(Number(limit) || 100, 500));
    const [providers, accounts, accountSnapshots, contracts, policies, policyAudits, bridges, locks, decisions, intents, orders, trades, reconciliations, managementIntents, managementApprovals, managementOutbox, addonSnapshots, addonEvents, adapterParityRuns, theoreticalEvents, manualExecutionEvents, portfolioOrderIntents, humanExecutionGates, portfolioExecutionStates, providerCommands, providerEvents] = await Promise.all([
      rows(this.pool, "SELECT * FROM broker_providers ORDER BY broker_provider_code"),
      rows(this.pool, "SELECT * FROM broker_accounts ORDER BY broker_account_id"),
      rows(this.pool, "SELECT DISTINCT ON (broker_account_id) * FROM broker_account_snapshots ORDER BY broker_account_id, captured_at DESC"),
      rows(this.pool, "SELECT * FROM broker_contracts ORDER BY instrument_code, expiry_date"),
      rows(this.pool, "SELECT * FROM trade_policy_profiles ORDER BY policy_profile_id"),
      rows(this.pool, "SELECT * FROM broker_policy_audit_events ORDER BY created_at DESC LIMIT 100"),
      rows(this.pool, "SELECT * FROM broker_bridge_heartbeats ORDER BY last_seen_at DESC"),
      rows(this.pool, "SELECT * FROM broker_execution_locks WHERE locked = true AND (expires_at IS NULL OR expires_at > now()) ORDER BY scope_type, scope_value"),
      rows(this.pool, "SELECT * FROM trade_decisions ORDER BY created_at DESC LIMIT $1", [bounded]),
      rows(this.pool, `SELECT i.*, d.instrument_code, d.strategy_id, d.trading_date, d.session,
          c.broker_symbol, a.account_label
        FROM trade_order_intents i
        JOIN trade_decisions d ON d.trade_decision_id = i.trade_decision_id
        JOIN broker_contracts c ON c.broker_contract_id = i.broker_contract_id
        LEFT JOIN broker_accounts a ON a.broker_account_id = i.broker_account_id
        ORDER BY i.created_at DESC LIMIT $1`, [bounded]),
      rows(this.pool, "SELECT * FROM broker_orders ORDER BY created_at DESC LIMIT $1", [bounded]),
      rows(this.pool, `SELECT t.*, o.schema_version AS canonical_outcome_schema_version,
          o.engine_version AS canonical_outcome_engine_version, o.status AS canonical_outcome_status
        FROM trades t
        LEFT JOIN LATERAL (
          SELECT * FROM trade_outcomes candidate
          WHERE candidate.trade_id = t.trade_id
          ORDER BY candidate.revision DESC LIMIT 1
        ) o ON true
        ORDER BY t.created_at DESC LIMIT $1`, [bounded]),
      rows(this.pool, "SELECT * FROM broker_reconciliation_runs ORDER BY started_at DESC LIMIT $1", [bounded]),
      rows(this.pool, `SELECT m.*, t.status AS trade_status, t.side AS trade_side, t.quantity_open,
          t.avg_entry_price, t.current_stop_price, t.atm_strategy_id, t.revision AS trade_revision,
          c.instrument_code, c.broker_symbol, a.account_label
        FROM trade_management_intents m
        JOIN trades t ON t.trade_id = m.trade_id
        JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
        LEFT JOIN broker_accounts a ON a.broker_account_id = t.broker_account_id
        ORDER BY m.created_at DESC LIMIT $1`, [bounded]),
      rows(this.pool, "SELECT * FROM trade_management_approvals ORDER BY created_at DESC LIMIT $1", [bounded]),
      rows(this.pool, "SELECT * FROM broker_management_outbox ORDER BY created_at DESC LIMIT $1", [bounded]),
      rows(this.pool, "SELECT * FROM broker_addon_snapshots ORDER BY captured_at DESC LIMIT $1", [bounded]),
      rows(this.pool, "SELECT * FROM broker_addon_events ORDER BY occurred_at DESC LIMIT $1", [bounded]),
      rows(this.pool, "SELECT * FROM broker_adapter_parity_runs ORDER BY compared_at DESC LIMIT $1", [bounded]),
      optionalRows(this.pool, "SELECT * FROM trade_theoretical_execution_events ORDER BY event_at_utc DESC, created_at_utc DESC LIMIT $1", [bounded]),
      optionalRows(this.pool, "SELECT * FROM trade_manual_execution_events ORDER BY occurred_at_utc DESC, created_at_utc DESC LIMIT $1", [bounded]),
      optionalRows(this.pool, `SELECT l.*, l.payload AS order_intent_payload,
          t.account_id AS target_account_id, t.instrument AS target_instrument,
          t.net_target_size, t.delta_size, t.risk_approved_net_size, t.payload AS target_position_payload,
          array_remove(array_agg(DISTINCT a.candidate_allocation_id), NULL) AS candidate_allocation_ids,
          array_remove(array_agg(DISTINCT r.risk_decision_id), NULL) AS risk_decision_ids,
          COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
            'risk_decision_id', rd.risk_decision_id,
            'decision', rd.decision,
            'status', rd.status,
            'reason_codes', rd.reason_codes,
            'risk_rule_set_version', rd.risk_rule_set_version,
            'approved_size', rd.approved_size,
            'account_capital_reference', rd.account_capital_reference,
            'requested', rd.requested,
            'authorized', rd.authorized,
            'trade_risk', rd.trade_risk,
            'portfolio_before', rd.portfolio_before,
            'portfolio_after', rd.portfolio_after,
            'limits', rd.limits,
            'nearest_limit', rd.nearest_limit,
            'breaches', rd.breaches,
            'risk_economics', rd.risk_economics
          )) FILTER (WHERE rd.risk_decision_id IS NOT NULL), '[]'::jsonb) AS risk_decisions
        FROM portfolio_order_intent_lineage l
        JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
        LEFT JOIN portfolio_target_position_allocations a ON a.target_position_id = t.target_position_id
        LEFT JOIN portfolio_target_position_risk_decisions r ON r.target_position_id = t.target_position_id
        LEFT JOIN portfolio_risk_decisions rd ON rd.risk_decision_id = r.risk_decision_id
        GROUP BY l.portfolio_order_intent_id, t.target_position_id
        ORDER BY l.created_at_utc DESC LIMIT $1`, [bounded]),
      optionalRows(this.pool, "SELECT * FROM human_execution_gates ORDER BY updated_at_utc DESC LIMIT $1", [bounded]),
      optionalRows(this.pool, "SELECT * FROM portfolio_order_intent_execution_states ORDER BY updated_at_utc DESC LIMIT $1", [bounded]),
      optionalRows(this.pool, "SELECT * FROM broker_provider_commands ORDER BY updated_at DESC LIMIT $1", [bounded]),
      optionalRows(this.pool, "SELECT * FROM broker_provider_events ORDER BY created_at DESC LIMIT $1", [bounded]),
    ]);
    return { providers, accounts, accountSnapshots, contracts, policies, policyAudits, bridges, locks, decisions, intents, orders, trades, reconciliations, managementIntents, managementApprovals, managementOutbox, addonSnapshots, addonEvents, adapterParityRuns, theoreticalEvents, manualExecutionEvents, portfolioOrderIntents, humanExecutionGates, portfolioExecutionStates, providerCommands, providerEvents };
  }

  async configureSizingPolicy({ policyProfileId, expectedRevision, riskPercent, maxRoundingExcessPercent = 0.25, maxDecisionAgeSeconds = 120, fallbackCapitalEnabled, fallbackCapital, idempotencyKey, actor, reason, now }) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingAudit = await one(client, "SELECT * FROM broker_policy_audit_events WHERE idempotency_key = $1", [idempotencyKey]);
      if (existingAudit) {
        const currentPolicy = await one(client, "SELECT * FROM trade_policy_profiles WHERE policy_profile_id = $1", [existingAudit.policy_profile_id]);
        await client.query("COMMIT");
        return { policy: currentPolicy, audit: existingAudit, idempotent: true };
      }
      const current = await one(client, "SELECT * FROM trade_policy_profiles WHERE policy_profile_id = $1 FOR UPDATE", [policyProfileId]);
      if (!current) throw repositoryError("TRADE_POLICY_NOT_FOUND", `Trade policy not found: ${policyProfileId}.`);
      if (Number(current.revision || 0) !== Number(expectedRevision)) {
        throw repositoryError("REVISION_CONFLICT", `Sizing policy revision changed from ${expectedRevision} to ${current.revision}.`);
      }
      const nextRevision = Number(current.revision || 0) + 1;
      const previousValues = sizingPolicyValues(current);
      const updatedResult = await client.query(
        `UPDATE trade_policy_profiles
         SET risk_per_trade_pct = $2,
             max_rounding_excess_pct = $3,
             max_decision_age_seconds = $4,
             fallback_capital_enabled = $5,
             fallback_capital = $6,
             revision = $7,
             updated_at = $8
         WHERE policy_profile_id = $1
         RETURNING *`,
        [policyProfileId, riskPercent, maxRoundingExcessPercent, maxDecisionAgeSeconds, fallbackCapitalEnabled, fallbackCapital, nextRevision, now],
      );
      const updated = updatedResult.rows[0];
      const auditResult = await client.query(
        `INSERT INTO broker_policy_audit_events (
          broker_policy_audit_event_id, policy_profile_id, action, expected_revision, applied_revision,
          actor, reason, idempotency_key, previous_values, next_values, created_at
        ) VALUES ($1,$2,'configure_sizing',$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
        RETURNING *`,
        [`broker_policy_audit_${cryptoId()}`, policyProfileId, expectedRevision, nextRevision, actor, reason,
          idempotencyKey, json(previousValues), json(sizingPolicyValues(updated)), now],
      );
      await client.query("COMMIT");
      return { policy: updated, audit: auditResult.rows[0], idempotent: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async configureExecutionAuthority({ policyProfileId, expectedRevision, mode, idempotencyKey, actor, reason, now }) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingAudit = await one(client, "SELECT * FROM broker_policy_audit_events WHERE idempotency_key = $1", [idempotencyKey]);
      if (existingAudit) {
        const currentPolicy = await one(client, "SELECT * FROM trade_policy_profiles WHERE policy_profile_id = $1", [existingAudit.policy_profile_id]);
        await client.query("COMMIT");
        return { policy: currentPolicy, audit: existingAudit, idempotent: true };
      }
      const current = await one(client, "SELECT * FROM trade_policy_profiles WHERE policy_profile_id = $1 FOR UPDATE", [policyProfileId]);
      if (!current) throw repositoryError("TRADE_POLICY_NOT_FOUND", `Trade policy not found: ${policyProfileId}.`);
      if (Number(current.revision || 0) !== Number(expectedRevision)) {
        throw repositoryError("REVISION_CONFLICT", `Execution policy revision changed from ${expectedRevision} to ${current.revision}.`);
      }
      if (!["semi_auto", "auto"].includes(mode)) throw repositoryError("EXECUTION_AUTHORITY_MODE_INVALID", `Unsupported execution authority mode: ${mode}.`);
      const nextRevision = Number(current.revision || 0) + 1;
      const previousValues = executionAuthorityValues(current);
      const updated = (await client.query(
        `UPDATE trade_policy_profiles
         SET execution_authority_mode = $2::broker_execution_authority_mode,
             require_operator_approval = ($2 = 'semi_auto'),
             revision = $3,
             updated_at = $4
         WHERE policy_profile_id = $1
         RETURNING *`,
        [policyProfileId, mode, nextRevision, now],
      )).rows[0];
      const audit = (await client.query(
        `INSERT INTO broker_policy_audit_events (
          broker_policy_audit_event_id, policy_profile_id, action, expected_revision, applied_revision,
          actor, reason, idempotency_key, previous_values, next_values, created_at
        ) VALUES ($1,$2,'configure_execution_authority',$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
        RETURNING *`,
        [`broker_policy_audit_${cryptoId()}`, policyProfileId, expectedRevision, nextRevision, actor, reason,
          idempotencyKey, json(previousValues), json(executionAuthorityValues(updated)), now],
      )).rows[0];
      await client.query("COMMIT");
      return { policy: updated, audit, idempotent: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async recordAccountSnapshot({ accountId, snapshot = {}, now }) {
    await this.ready();
    const capturedAt = validTimestamp(snapshot.captured_at || snapshot.capturedAt || snapshot.timestamp) || now;
    const cashValue = firstNumber(
      snapshot.cash_value,
      snapshot.cashValue,
      snapshot.CashValue,
      snapshot.net_liquidation_value,
      snapshot.net_liquidation,
      snapshot.NetLiquidation,
    );
    const result = await this.pool.query(
      `INSERT INTO broker_account_snapshots (
        broker_account_snapshot_id, broker_account_id, cash_value, buying_power, realized_pnl,
        unrealized_pnl, margin_used, open_position_count, captured_at, payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      RETURNING *`,
      [
        `broker_account_snapshot_${cryptoId()}`, accountId, cashValue,
        firstNumber(snapshot.buying_power, snapshot.buyingPower, snapshot.BuyingPower),
        firstNumber(snapshot.realized_pnl, snapshot.realizedPnl, snapshot.RealizedProfitLoss),
        firstNumber(snapshot.unrealized_pnl, snapshot.unrealizedPnl, snapshot.UnrealizedProfitLoss),
        firstNumber(snapshot.margin_used, snapshot.marginUsed),
        firstInteger(snapshot.open_position_count, snapshot.openPositionCount),
        capturedAt, json(snapshot),
      ],
    );
    return result.rows[0];
  }

  async insertDecision(decision) {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO trade_decisions (
        trade_decision_id, materialization_key, source_collection, source_document_id, mode, status,
        instrument_code, symbol_id, side, strategy_id, trading_date, session, decided_at, valid_until,
        entry_plan, risk_plan, thesis_ref, confidence, rationale, raw
      ) VALUES (
        $1,$2,$3,$4,$5::execution_mode,$6::decision_status,$7,$8,$9::trade_side,$10,$11,$12,$13,$14,
        $15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20::jsonb
      )
      ON CONFLICT (materialization_key) WHERE materialization_key IS NOT NULL
      DO UPDATE SET updated_at = now()
      RETURNING *`,
      [
        decision.trade_decision_id, decision.materialization_key, decision.source_collection, decision.source_document_id,
        decision.mode, decision.status, decision.instrument_code, decision.symbol_id, decision.side, decision.strategy_id,
        decision.trading_date, decision.session, decision.decided_at, decision.valid_until, json(decision.entry_plan),
        json(decision.risk_plan), json(decision.thesis_ref), decision.confidence, decision.rationale, json(decision.raw),
      ],
    );
    return result.rows[0];
  }

  async decisionContext({ decisionId, accountId = "ninjatrader_paper_local", policyProfileId = "ninjatrader_sim101_local" }) {
    await this.ready();
    const decision = await one(this.pool, "SELECT * FROM trade_decisions WHERE trade_decision_id = $1", [decisionId]);
    if (!decision) throw repositoryError("TRADE_DECISION_NOT_FOUND", `Trade decision not found: ${decisionId}.`);
    const [provider, account, contract, policy, bridge, locks, existingTrades, accountSnapshot] = await Promise.all([
      one(this.pool, "SELECT * FROM broker_providers WHERE broker_provider_code = 'ninjatrader'"),
      one(this.pool, "SELECT * FROM broker_accounts WHERE broker_account_id = $1", [accountId]),
      one(this.pool, `SELECT * FROM broker_contracts
        WHERE broker_provider_code = 'ninjatrader' AND instrument_code = $1
        ORDER BY active DESC, expiry_date ASC NULLS LAST LIMIT 1`, [decision.instrument_code]),
      one(this.pool, "SELECT * FROM trade_policy_profiles WHERE policy_profile_id = $1", [policyProfileId]),
      one(this.pool, "SELECT * FROM broker_bridge_heartbeats WHERE broker_account_id = $1 ORDER BY last_seen_at DESC LIMIT 1", [accountId]),
      rows(this.pool, "SELECT * FROM broker_execution_locks WHERE locked = true AND (expires_at IS NULL OR expires_at > now())"),
      rows(this.pool, `SELECT t.*, c.instrument_code
        FROM trades t LEFT JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
        WHERE t.broker_account_id = $1 AND t.status NOT IN ('closed','cancelled','rejected','expired')`, [accountId]),
      one(this.pool, "SELECT * FROM broker_account_snapshots WHERE broker_account_id = $1 ORDER BY captured_at DESC LIMIT 1", [accountId]),
    ]);
    return { decision, provider, account, contract, policy, bridge, locks, existingTrades, accountSnapshot };
  }

  async insertRiskResult({ riskCheck, intent = null }) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO trade_risk_checks (
          risk_check_id, trade_decision_id, status, checked_at, checked_by, policy_profile_id,
          rules, violations, metrics, raw
        ) VALUES ($1,$2,$3::risk_check_status,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)`,
        [riskCheck.risk_check_id, riskCheck.trade_decision_id, riskCheck.status, riskCheck.checked_at, riskCheck.checked_by,
          riskCheck.policy_profile_id, json(riskCheck.rules), json(riskCheck.violations), json(riskCheck.metrics), json(riskCheck.raw)],
      );
      await client.query("UPDATE trade_decisions SET status = $2::decision_status, updated_at = now() WHERE trade_decision_id = $1", [riskCheck.trade_decision_id, riskCheck.status === "pass" ? "validated" : "rejected"]);
      let storedIntent = null;
      if (intent) {
        const result = await client.query(
          `INSERT INTO trade_order_intents (
            order_intent_id, trade_decision_id, risk_check_id, broker_account_id, broker_contract_id,
            status, approval_status, side, order_type, quantity, limit_price, stop_price, time_in_force,
            bracket, idempotency_key, requested_at, expires_at, payload, raw
          ) VALUES ($1,$2,$3,$4,$5,$6::order_intent_status,$7::approval_status,$8::order_side,$9::order_type,
            $10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18::jsonb,$19::jsonb)
          ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
          RETURNING *`,
          [intent.order_intent_id, intent.trade_decision_id, intent.risk_check_id, intent.broker_account_id,
            intent.broker_contract_id, intent.status, intent.approval_status, intent.side, intent.order_type, intent.quantity,
            intent.limit_price, intent.stop_price, intent.time_in_force, json(intent.bracket), intent.idempotency_key,
            intent.requested_at, intent.expires_at, json(intent.payload), json(intent.raw)],
        );
        storedIntent = result.rows[0];
      }
      await client.query("COMMIT");
      return { riskCheck, intent: storedIntent };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async intentDetail(intentId) {
    await this.ready();
    const intent = await one(this.pool, "SELECT * FROM trade_order_intents WHERE order_intent_id = $1", [intentId]);
    if (!intent) throw repositoryError("ORDER_INTENT_NOT_FOUND", `Order intent not found: ${intentId}.`);
    const [decision, riskCheck, approvals, outbox, orders] = await Promise.all([
      one(this.pool, "SELECT * FROM trade_decisions WHERE trade_decision_id = $1", [intent.trade_decision_id]),
      one(this.pool, "SELECT * FROM trade_risk_checks WHERE risk_check_id = $1", [intent.risk_check_id]),
      rows(this.pool, "SELECT * FROM trade_approvals WHERE order_intent_id = $1 ORDER BY created_at DESC", [intentId]),
      one(this.pool, "SELECT * FROM broker_execution_outbox WHERE order_intent_id = $1", [intentId]),
      rows(this.pool, "SELECT * FROM broker_orders WHERE order_intent_id = $1 ORDER BY created_at DESC", [intentId]),
    ]);
    return { intent, decision, riskCheck, approvals, outbox, orders };
  }

  async listTheoreticalEntryCandidates({ limit = 100 } = {}) { return listTheoreticalEntryCandidatesRepository(this, { limit }); }
  async latestClosedCandleForIntent(intent) { return latestTheoreticalClosedCandleForIntent(this, intent); }
  async recordTheoreticalEntryFill({ result, now }) { return recordTheoreticalEntryFillRepository(this, { result, now }); }
  async recordTheoreticalEntryExpired({ result, now }) { return recordTheoreticalEntryExpiredRepository(this, { result, now }); }
  async listTheoreticalOpenTrades({ limit = 100 } = {}) { return listTheoreticalOpenTradesRepository(this, { limit }); }
  async latestClosedCandleForTrade(trade) { return latestTheoreticalClosedCandleForTrade(this, trade); }
  async recordTheoreticalExitFill({ result, now }) { return recordTheoreticalExitFillRepository(this, { result, now }); }
  async recordTheoreticalReviewRequired({ result, now }) { return recordTheoreticalReviewRequiredRepository(this, { result, now }); }
  async recordManualExecutionEvent({ event }) { return recordManualExecutionEventRepository(this, { event }); }

  async findOpenTradeForMonitor({ tradeId = null, sourcePositionId = null, instrument = null, strategyId = null, tradingDate = null, session = null } = {}) {
    await this.ready();
    return one(this.pool, `SELECT t.*, c.instrument_code, c.broker_symbol,
        d.source_document_id AS position_id
      FROM trades t
      JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
      LEFT JOIN trade_decisions d ON d.trade_decision_id = t.trade_decision_id
      WHERE t.status IN ('open','scaling','protected')
        AND ($1::text IS NULL OR t.trade_id = $1)
        AND ($2::text IS NULL OR d.source_document_id = $2)
        AND ($3::text IS NULL OR upper(c.instrument_code) = upper($3))
        AND ($4::text IS NULL OR t.strategy_id = $4)
        AND ($5::text IS NULL OR t.trading_date = $5)
        AND ($6::text IS NULL OR t.session = $6)
      ORDER BY t.updated_at DESC LIMIT 1`, [tradeId, sourcePositionId, instrument, strategyId, tradingDate, session]);
  }

  async managementContext({ managementIntentId = null, tradeId = null, policyProfileId = "ninjatrader_sim101_local" } = {}) {
    await this.ready();
    const intent = managementIntentId
      ? await one(this.pool, "SELECT * FROM trade_management_intents WHERE management_intent_id = $1", [managementIntentId])
      : null;
    if (managementIntentId && !intent) throw repositoryError("MANAGEMENT_INTENT_NOT_FOUND", `Management intent not found: ${managementIntentId}.`);
    const resolvedTradeId = intent?.trade_id || tradeId;
    const trade = await one(this.pool, "SELECT * FROM trades WHERE trade_id = $1", [resolvedTradeId]);
    if (!trade) throw repositoryError("TRADE_NOT_FOUND", `Trade not found: ${resolvedTradeId}.`);
    const [provider, account, contract, policy, bridge, locks] = await Promise.all([
      one(this.pool, "SELECT * FROM broker_providers WHERE broker_provider_code = 'ninjatrader'"),
      one(this.pool, "SELECT * FROM broker_accounts WHERE broker_account_id = $1", [trade.broker_account_id]),
      one(this.pool, "SELECT * FROM broker_contracts WHERE broker_contract_id = $1", [trade.broker_contract_id]),
      one(this.pool, "SELECT * FROM trade_policy_profiles WHERE policy_profile_id = $1", [policyProfileId]),
      one(this.pool, "SELECT * FROM broker_bridge_heartbeats WHERE broker_account_id = $1 ORDER BY last_seen_at DESC LIMIT 1", [trade.broker_account_id]),
      rows(this.pool, "SELECT * FROM broker_execution_locks WHERE locked = true AND (expires_at IS NULL OR expires_at > now())"),
    ]);
    return { intent, trade, provider, account, contract, policy, bridge, locks };
  }

  async insertManagementIntent({ intent, evaluation }) {
    await this.ready();
    const status = evaluation.pass ? "pending_approval" : "blocked";
    const result = await this.pool.query(
      `INSERT INTO trade_management_intents (
        management_intent_id, trade_id, source_collection, source_document_id, source_action, action,
        status, approval_status, expected_trade_revision, requested_quantity, requested_stop_price,
        reason, risk_reducing, guard_evidence, command_payload, idempotency_key, requested_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6::trade_management_action,$7::trade_management_status,'required',$8,$9,$10,$11,true,$12::jsonb,$13::jsonb,$14,$15,$16)
      ON CONFLICT (idempotency_key) DO UPDATE SET
        guard_evidence = CASE WHEN trade_management_intents.status IN ('draft','blocked') THEN EXCLUDED.guard_evidence ELSE trade_management_intents.guard_evidence END,
        status = CASE WHEN trade_management_intents.status IN ('draft','blocked') THEN EXCLUDED.status ELSE trade_management_intents.status END,
        updated_at = now()
      RETURNING *`,
      [intent.management_intent_id, intent.trade_id, intent.source_collection, intent.source_document_id,
        intent.source_action, intent.action, status, intent.expected_trade_revision, intent.requested_quantity,
        intent.requested_stop_price, intent.reason, json(evaluation), json(intent.command_payload), intent.idempotency_key,
        intent.requested_at, intent.expires_at],
    );
    return result.rows[0];
  }

  async managementIntentDetail(managementIntentId) {
    await this.ready();
    const intent = await one(this.pool, "SELECT * FROM trade_management_intents WHERE management_intent_id = $1", [managementIntentId]);
    if (!intent) throw repositoryError("MANAGEMENT_INTENT_NOT_FOUND", `Management intent not found: ${managementIntentId}.`);
    const [trade, approvals, outbox, orders] = await Promise.all([
      one(this.pool, `SELECT t.*, d.source_document_id AS position_id\n        FROM trades t\n        LEFT JOIN trade_decisions d ON d.trade_decision_id = t.trade_decision_id\n        WHERE t.trade_id = $1`, [intent.trade_id]),
      rows(this.pool, "SELECT * FROM trade_management_approvals WHERE management_intent_id = $1 ORDER BY created_at DESC", [managementIntentId]),
      one(this.pool, "SELECT * FROM broker_management_outbox WHERE management_intent_id = $1", [managementIntentId]),
      rows(this.pool, "SELECT * FROM broker_orders WHERE management_intent_id = $1 ORDER BY created_at DESC", [managementIntentId]),
    ]);
    return { intent, trade, approvals, outbox, orders };
  }

  async approveManagementIntent({ managementIntentId, approvalId, idempotencyKey, actor, reason, commandPayload, automatic = false, now }) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await one(client, "SELECT * FROM trade_management_approvals WHERE idempotency_key = $1", [idempotencyKey]);
      if (existing) { await client.query("COMMIT"); return { approval: existing, idempotent: true }; }
      const intent = await one(client, "SELECT * FROM trade_management_intents WHERE management_intent_id = $1 FOR UPDATE", [managementIntentId]);
      if (!intent) throw repositoryError("MANAGEMENT_INTENT_NOT_FOUND", `Management intent not found: ${managementIntentId}.`);
      const trade = await one(client, "SELECT * FROM trades WHERE trade_id = $1 FOR UPDATE", [intent.trade_id]);
      if (Date.parse(intent.expires_at || "") <= Date.parse(now)) throw repositoryError("MANAGEMENT_INTENT_EXPIRED", "The management intent has expired.");
      if (!['pending_approval', 'approved'].includes(intent.status)) throw repositoryError("MANAGEMENT_INTENT_NOT_APPROVABLE", `Management state ${intent.status} cannot be approved.`);
      if (Number(trade?.revision || 0) !== Number(intent.expected_trade_revision)) throw repositoryError("TRADE_REVISION_CONFLICT", "The trade changed after the management intent was created.");
      const approval = (await client.query(
        `INSERT INTO trade_management_approvals (management_approval_id, management_intent_id, status, actor, reason, idempotency_key, metadata)
         VALUES ($1,$2,'approved',$3,$4,$5,$6::jsonb) RETURNING *`,
        [approvalId, managementIntentId, actor, reason, idempotencyKey, json({ automatic_authorization: automatic === true })],
      )).rows[0];
      await client.query("UPDATE trade_management_intents SET status = 'queued', approval_status = 'approved', command_payload = $2::jsonb, updated_at = now() WHERE management_intent_id = $1", [managementIntentId, json(commandPayload)]);
      await client.query(
        `INSERT INTO broker_management_outbox (management_outbox_id, management_intent_id, status, command_payload)
         VALUES ($1,$2,'pending',$3::jsonb) ON CONFLICT (management_intent_id) DO NOTHING`,
        [`management_outbox_${intent.idempotency_key.slice(0, 24)}`, managementIntentId, json(commandPayload)],
      );
      await client.query("COMMIT");
      return { approval, idempotent: false };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async rejectManagementIntent({ managementIntentId, approvalId, idempotencyKey, actor, reason, now }) {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO trade_management_approvals (management_approval_id, management_intent_id, status, actor, reason, idempotency_key, created_at)
       VALUES ($1,$2,'rejected',$3,$4,$5,$6)
       ON CONFLICT (idempotency_key) DO UPDATE SET reason = trade_management_approvals.reason RETURNING *`,
      [approvalId, managementIntentId, actor, reason, idempotencyKey, now],
    );
    await this.pool.query("UPDATE trade_management_intents SET status = 'rejected', approval_status = 'rejected', updated_at = now() WHERE management_intent_id = $1 AND status IN ('pending_approval','approved','queued')", [managementIntentId]);
    await this.pool.query("UPDATE broker_management_outbox SET status = 'cancelled', updated_at = now() WHERE management_intent_id = $1 AND status IN ('pending','leased','rendered')", [managementIntentId]);
    return result.rows[0];
  }

  async approveIntent({ intentId, approvalId, idempotencyKey, actor, reason, automatic = false, now }) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await one(client, "SELECT * FROM trade_approvals WHERE idempotency_key = $1", [idempotencyKey]);
      if (existing) {
        await client.query("COMMIT");
        return { approval: existing, idempotent: true };
      }
      const intent = await one(client, "SELECT * FROM trade_order_intents WHERE order_intent_id = $1 FOR UPDATE", [intentId]);
      if (!intent) throw repositoryError("ORDER_INTENT_NOT_FOUND", `Order intent not found: ${intentId}.`);
      if (Date.parse(intent.expires_at || "") <= Date.parse(now)) throw repositoryError("ORDER_INTENT_EXPIRED", "The order intent has expired.");
      if (!['pending_approval', 'approved'].includes(intent.status)) throw repositoryError("ORDER_INTENT_NOT_APPROVABLE", `Intent state ${intent.status} cannot be approved.`);
      const approvalResult = await client.query(
        `INSERT INTO trade_approvals (
          trade_approval_id, order_intent_id, status, approved_by, approved_at, expires_at, reason, idempotency_key, metadata
        ) VALUES ($1,$2,'approved',$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
        [approvalId, intentId, actor, now, intent.expires_at, reason, idempotencyKey, json({
          explicit_operator_approval: automatic !== true,
          automatic_authorization: automatic === true,
        })],
      );
      await client.query("UPDATE trade_order_intents SET status = 'queued', approval_status = 'approved', updated_at = now() WHERE order_intent_id = $1", [intentId]);
      await client.query(
        `INSERT INTO broker_execution_outbox (execution_outbox_id, order_intent_id, status, command_payload)
         VALUES ($1,$2,'pending',$3::jsonb)
         ON CONFLICT (order_intent_id) DO NOTHING`,
        [`outbox_${intent.idempotency_key.slice(0, 24)}`, intentId, json(intent.payload)],
      );
      await client.query("COMMIT");
      return { approval: approvalResult.rows[0], idempotent: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async rejectIntent({ intentId, approvalId, idempotencyKey, actor, reason, now }) {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO trade_approvals (trade_approval_id, order_intent_id, status, approved_by, approved_at, reason, idempotency_key, metadata)
       VALUES ($1,$2,'rejected',$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET reason = trade_approvals.reason
       RETURNING *`,
      [approvalId, intentId, actor, now, reason, idempotencyKey, json({ explicit_operator_rejection: true })],
    );
    await this.pool.query("UPDATE trade_order_intents SET status = 'rejected', approval_status = 'rejected', updated_at = now() WHERE order_intent_id = $1 AND status IN ('pending_approval','approved','queued')", [intentId]);
    await this.pool.query("UPDATE broker_execution_outbox SET status = 'cancelled', updated_at = now() WHERE order_intent_id = $1 AND status IN ('pending','leased','rendered')", [intentId]);
    return result.rows[0];
  }

  async setExecutionLock({ locked, reason, actor, now }) {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO broker_execution_locks (execution_lock_id, scope_type, scope_value, locked, reason, set_by, set_at, metadata)
       VALUES ('global_default_kill_switch','global','*',$1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (execution_lock_id) DO UPDATE SET locked = EXCLUDED.locked, reason = EXCLUDED.reason,
         set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at, metadata = EXCLUDED.metadata
       RETURNING *`,
      [locked, reason, actor, now, json({ operator_action: true })],
    );
    return result.rows[0];
  }

  async upsertHeartbeat(heartbeat) {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO broker_bridge_heartbeats (
        bridge_id, broker_provider_code, broker_account_id, mode, status, host_name, process_id,
        ninja_connected, ati_enabled, account_name, last_seen_at, metadata,
        adapter_kind, protocol_version, capabilities, command_enabled
      ) VALUES ($1,'ninjatrader',$2,$3::broker_bridge_mode,$4::broker_bridge_status,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15)
      ON CONFLICT (bridge_id) DO UPDATE SET broker_account_id = EXCLUDED.broker_account_id, mode = EXCLUDED.mode,
        status = EXCLUDED.status, host_name = EXCLUDED.host_name, process_id = EXCLUDED.process_id,
        ninja_connected = EXCLUDED.ninja_connected, ati_enabled = EXCLUDED.ati_enabled,
        account_name = EXCLUDED.account_name, last_seen_at = EXCLUDED.last_seen_at,
        metadata = EXCLUDED.metadata, adapter_kind = EXCLUDED.adapter_kind,
        protocol_version = EXCLUDED.protocol_version, capabilities = EXCLUDED.capabilities,
        command_enabled = EXCLUDED.command_enabled, updated_at = now()
      RETURNING *`,
      [heartbeat.bridge_id, heartbeat.broker_account_id, heartbeat.mode, heartbeat.status, heartbeat.host_name,
        heartbeat.process_id, heartbeat.ninja_connected, heartbeat.ati_enabled, heartbeat.account_name,
        heartbeat.last_seen_at, json(heartbeat.metadata), heartbeat.adapter_kind || "unknown",
        heartbeat.protocol_version || null, json(heartbeat.capabilities), heartbeat.command_enabled === true],
    );
    return result.rows[0];
  }

  async bridgeHeartbeat({ bridgeId, accountId = null }) {
    await this.ready();
    return one(this.pool, `SELECT * FROM broker_bridge_heartbeats
      WHERE bridge_id = $1 AND ($2::text IS NULL OR broker_account_id = $2)
      LIMIT 1`, [bridgeId, accountId]);
  }

  async storeAddonSnapshot({ snapshotId, bridgeId, accountId, accountName, capturedAt, snapshot, contentHash, metadata = {} }) {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO broker_addon_snapshots (
        addon_snapshot_id, bridge_id, broker_account_id, account_name, captured_at,
        connection, account, orders, positions, content_hash, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb)
      ON CONFLICT (addon_snapshot_id) DO UPDATE SET received_at = broker_addon_snapshots.received_at
      RETURNING *`,
      [snapshotId, bridgeId, accountId, accountName, capturedAt, json(snapshot.connection), json(snapshot.account),
        json(snapshot.orders || []), json(snapshot.positions || []), contentHash, json(metadata)],
    );
    return result.rows[0];
  }

  async latestAddonSnapshot({ accountId, bridgeId = null }) {
    await this.ready();
    return one(this.pool, `SELECT * FROM broker_addon_snapshots
      WHERE broker_account_id = $1 AND ($2::text IS NULL OR bridge_id = $2)
      ORDER BY captured_at DESC LIMIT 1`, [accountId, bridgeId]);
  }

  async latestAtiSnapshot({ accountId }) {
    await this.ready();
    const result = await one(this.pool, `SELECT broker_snapshot, started_at, bridge_id
      FROM broker_reconciliation_runs
      WHERE broker_account_id = $1
        AND COALESCE(metadata->>'source', 'ninja_bridge') IN ('ninja_bridge', 'ati')
      ORDER BY started_at DESC LIMIT 1`, [accountId]);
    return result || null;
  }

  async storeAddonEvent({ addonEventId, bridgeId, accountId, accountName, externalEventKey, event }) {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO broker_addon_events (
        addon_event_id, bridge_id, broker_account_id, account_name, external_event_key,
        event_type, intent_id, management_intent_id, command_id, occurred_at, payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      ON CONFLICT (external_event_key) DO UPDATE SET external_event_key = broker_addon_events.external_event_key
      RETURNING *`,
      [addonEventId, bridgeId, accountId, accountName, externalEventKey, event.event_type,
        event.intent_id || null, event.management_intent_id || null, event.command_id || null,
        event.occurred_at, json(event.payload)],
    );
    return result.rows[0];
  }

  async attachAddonProtection({ intentId, payload = {} }) {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE trades SET raw = raw || jsonb_strip_nulls(jsonb_build_object(
          'protective_stop_order_ref', $2::text,
          'profit_target_order_ref', $3::text,
          'execution_adapter', 'addon'
        )), updated_at = now()
       WHERE order_intent_id = $1 RETURNING *`,
      [intentId, payload.protective_stop_order_ref || null, payload.profit_target_order_ref || null],
    );
    return result.rows[0] || null;
  }

  async storeAdapterParity({ run }) {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO broker_adapter_parity_runs (
        adapter_parity_run_id, broker_account_id, left_adapter, right_adapter, status,
        mismatch_count, mismatches, left_snapshot, right_snapshot, compared_at, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb)
      RETURNING *`,
      [run.adapter_parity_run_id, run.broker_account_id, run.left_adapter, run.right_adapter,
        run.status, run.mismatch_count, json(run.mismatches), json(run.left_snapshot),
        json(run.right_snapshot), run.compared_at, json(run.metadata)],
    );
    return result.rows[0];
  }

  async peekOutbox() {
    await this.ready();
    return one(this.pool, `SELECT o.*, i.trade_decision_id, i.broker_account_id,
        i.payload AS intent_payload, i.raw AS intent_raw
      FROM broker_execution_outbox o
      JOIN trade_order_intents i ON i.order_intent_id = o.order_intent_id
      WHERE (o.status = 'pending' OR (o.status = 'leased' AND o.lease_expires_at < now()))
        AND o.available_at <= now() AND i.status = 'queued' AND i.approval_status = 'approved'
        AND (i.expires_at IS NULL OR i.expires_at > now())
      ORDER BY o.created_at ASC LIMIT 1`);
  }

  async leaseOutbox({ outboxId, bridgeId, leaseToken, leaseSeconds = 30 }) {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE broker_execution_outbox SET status = 'leased', bridge_id = $2, lease_token = $3,
        lease_expires_at = now() + make_interval(secs => $4), attempt_count = attempt_count + 1, updated_at = now()
       WHERE execution_outbox_id = $1
         AND (status = 'pending' OR (status = 'leased' AND lease_expires_at < now()))
       RETURNING *`,
      [outboxId, bridgeId, leaseToken, Math.max(5, Math.min(Number(leaseSeconds) || 30, 120))],
    );
    return result.rows[0] || null;
  }

  async completeOutbox({ outboxId, bridgeId, leaseToken, status, renderedCommand = null, error = null, now }) {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE broker_execution_outbox SET status = $4::execution_outbox_status, rendered_command = COALESCE($5, rendered_command),
        delivered_at = CASE WHEN $4 = 'delivered' THEN $6 ELSE delivered_at END,
        acknowledged_at = CASE WHEN $4 = 'acknowledged' THEN $6 ELSE acknowledged_at END,
        last_error = $7, lease_expires_at = NULL, updated_at = now()
       WHERE execution_outbox_id = $1 AND bridge_id = $2 AND lease_token = $3 RETURNING *`,
      [outboxId, bridgeId, leaseToken, status, renderedCommand, now, error],
    );
    if (!result.rows[0]) throw repositoryError("OUTBOX_LEASE_CONFLICT", "The execution outbox lease is no longer valid.");
    if (["delivered", "acknowledged"].includes(status)) {
      await this.pool.query("UPDATE trade_order_intents SET status = $2::order_intent_status, updated_at = now() WHERE order_intent_id = $1", [result.rows[0].order_intent_id, status === "delivered" ? "sent" : "acknowledged"]);
    }
    return result.rows[0];
  }

  async peekManagementOutbox() {
    await this.ready();
    return one(this.pool, `SELECT o.*, m.trade_id, m.action, m.expected_trade_revision
      FROM broker_management_outbox o
      JOIN trade_management_intents m ON m.management_intent_id = o.management_intent_id
      WHERE (o.status = 'pending' OR (o.status = 'leased' AND o.lease_expires_at < now()))
        AND o.available_at <= now() AND m.status IN ('queued','leased') AND m.approval_status = 'approved'
        AND m.expires_at > now()
      ORDER BY o.created_at ASC LIMIT 1`);
  }

  async leaseManagementOutbox({ outboxId, bridgeId, leaseToken, leaseSeconds = 30 }) {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE broker_management_outbox SET status = 'leased', bridge_id = $2, lease_token = $3,
        lease_expires_at = now() + make_interval(secs => $4), attempt_count = attempt_count + 1, updated_at = now()
       WHERE management_outbox_id = $1
         AND (status = 'pending' OR (status = 'leased' AND lease_expires_at < now()))
       RETURNING *`,
      [outboxId, bridgeId, leaseToken, Math.max(5, Math.min(Number(leaseSeconds) || 30, 120))],
    );
    if (result.rows[0]) await this.pool.query("UPDATE trade_management_intents SET status = 'leased', updated_at = now() WHERE management_intent_id = $1 AND status = 'queued'", [result.rows[0].management_intent_id]);
    return result.rows[0] || null;
  }

  async completeManagementOutbox({ outboxId, bridgeId, leaseToken, status, renderedCommand = null, error = null, now }) {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE broker_management_outbox SET status = $4::execution_outbox_status,
        rendered_command = COALESCE($5, rendered_command),
        delivered_at = CASE WHEN $4 = 'delivered' THEN $6 ELSE delivered_at END,
        acknowledged_at = CASE WHEN $4 = 'acknowledged' THEN $6 ELSE acknowledged_at END,
        last_error = $7, lease_expires_at = NULL, updated_at = now()
       WHERE management_outbox_id = $1 AND bridge_id = $2 AND lease_token = $3 RETURNING *`,
      [outboxId, bridgeId, leaseToken, status, renderedCommand, now, error],
    );
    if (!result.rows[0]) throw repositoryError("MANAGEMENT_OUTBOX_LEASE_CONFLICT", "The management outbox lease is no longer valid.");
    const intentStatus = ({ rendered: "rendered", delivered: "delivered", acknowledged: "acknowledged", failed: "failed" })[status];
    if (intentStatus) await this.pool.query("UPDATE trade_management_intents SET status = $2::trade_management_status, updated_at = now() WHERE management_intent_id = $1", [result.rows[0].management_intent_id, intentStatus]);
    return result.rows[0];
  }

  async recordManagementBrokerUpdate({ brokerOrderId, brokerOrderRef, managementIntentId, externalEventKey = null, update, now }) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (externalEventKey) {
        const duplicate = await one(client, `SELECT o.* FROM broker_order_events e JOIN broker_orders o ON o.broker_order_id = e.broker_order_id WHERE e.external_event_key = $1`, [externalEventKey]);
        if (duplicate) {
          const duplicateIntent = await one(client, "SELECT * FROM trade_management_intents WHERE management_intent_id = $1", [managementIntentId]);
          const duplicateTrade = duplicateIntent ? await one(client, "SELECT * FROM trades WHERE trade_id = $1 FOR UPDATE", [duplicateIntent.trade_id]) : null;
          if (duplicateIntent && duplicateTrade && ["reduce_position", "close_position"].includes(duplicateIntent.action)) {
            await persistManagementFill(client, { intent: duplicateIntent, trade: duplicateTrade, order: duplicate, update, externalEventKey, now });
          }
          await client.query("COMMIT");
          return duplicate;
        }
      }
      const intent = await one(client, "SELECT * FROM trade_management_intents WHERE management_intent_id = $1", [managementIntentId]);
      if (!intent) throw repositoryError("MANAGEMENT_INTENT_NOT_FOUND", `Management intent not found: ${managementIntentId}.`);
      const trade = await one(client, "SELECT * FROM trades WHERE trade_id = $1 FOR UPDATE", [intent.trade_id]);
      const side = trade.side === "long" ? "sell" : "buy";
      const orderType = intent.action === "move_stop" ? "stop_market" : "market";
      const orderQuantity = Math.max(1, Number(intent.requested_quantity || trade.quantity_open || update.raw?.quantity || 1));
      const order = (await client.query(
        `INSERT INTO broker_orders (
          broker_order_id, management_intent_id, broker_provider_code, broker_account_id, broker_contract_id,
          broker_order_ref, status, side, order_type, quantity, stop_price, submitted_at, last_broker_update_at, raw
        ) VALUES ($1,$2,'ninjatrader',$3,$4,$5,$6::broker_order_status,$7::order_side,$8::order_type,$9,$10,$11,$12,$13::jsonb)
        ON CONFLICT (broker_provider_code, broker_order_ref) WHERE broker_order_ref IS NOT NULL
        DO UPDATE SET status = CASE
            WHEN broker_orders.status IN ('filled','cancelled','rejected','expired') THEN broker_orders.status
            ELSE EXCLUDED.status
          END,
          last_broker_update_at = GREATEST(broker_orders.last_broker_update_at, EXCLUDED.last_broker_update_at),
          management_intent_id = COALESCE(broker_orders.management_intent_id, EXCLUDED.management_intent_id),
          stop_price = COALESCE(EXCLUDED.stop_price, broker_orders.stop_price),
          raw = CASE
            WHEN broker_orders.status IN ('filled','cancelled','rejected','expired') THEN broker_orders.raw
            ELSE broker_orders.raw || EXCLUDED.raw
          END,
          updated_at = now() RETURNING *`,
        [brokerOrderId, managementIntentId, trade.broker_account_id, trade.broker_contract_id, brokerOrderRef,
          update.status, side, orderType, orderQuantity, intent.requested_stop_price,
          now, update.occurred_at, json(update.raw)],
      )).rows[0];
      const insertedEvent = (await client.query(
        `INSERT INTO broker_order_events (broker_order_event_id, broker_order_id, event_type, status, occurred_at, payload, raw, external_event_key)
         VALUES ($1,$2,$3::lifecycle_event_type,$4::broker_order_status,$5,$6::jsonb,$7::jsonb,$8)
         ON CONFLICT (external_event_key) WHERE external_event_key IS NOT NULL DO NOTHING RETURNING *`,
        [`broker_event_${cryptoId()}`, order.broker_order_id, eventType(update.status), update.status, update.occurred_at, json(update), json(update.raw), externalEventKey],
      )).rows[0];
      if (insertedEvent && ["reduce_position", "close_position"].includes(intent.action)) await persistManagementFill(client, { intent, trade, order, update, externalEventKey, now });
      if (insertedEvent && intent.action === "move_stop" && ["accepted", "working", "filled"].includes(update.status)) {
        const moved = await client.query("UPDATE trades SET current_stop_price = $2, revision = revision + 1, updated_at = now() WHERE trade_id = $1 AND revision = $3 RETURNING trade_id", [trade.trade_id, intent.requested_stop_price, intent.expected_trade_revision]);
        if (moved.rowCount > 0) {
          await client.query(
            `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
             VALUES ($1,$2,'stop_moved',$3::trade_status,$4,$5::jsonb,$6::jsonb)`,
            [`trade_event_${cryptoId()}`, trade.trade_id, trade.status, update.occurred_at || now,
              json({ management_intent_id: intent.management_intent_id, stop_price: intent.requested_stop_price }), json(update.raw)],
          );
        }
      }
      const acknowledged = ["submitted", "accepted", "working", "partially_filled", "filled"].includes(update.status);
      const terminalFailure = ["rejected", "cancelled", "expired", "error"].includes(update.status);
      if (acknowledged || terminalFailure) {
        await client.query("UPDATE trade_management_intents SET status = $2::trade_management_status, updated_at = now() WHERE management_intent_id = $1", [managementIntentId, terminalFailure ? "failed" : "acknowledged"]);
      }
      if (acknowledged) await client.query("UPDATE broker_management_outbox SET status = 'acknowledged', acknowledged_at = COALESCE(acknowledged_at, $2), updated_at = now() WHERE management_intent_id = $1 AND status IN ('pending','leased','rendered','delivered')", [managementIntentId, update.occurred_at]);
      if (terminalFailure) await client.query("UPDATE broker_management_outbox SET status = 'failed', last_error = $2, lease_expires_at = NULL, updated_at = now() WHERE management_intent_id = $1 AND status IN ('pending','leased','rendered','delivered')", [managementIntentId, update.raw?.error_message || update.raw?.error_code || update.status]);
      await client.query("COMMIT");
      return order;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async findManagementIntentByOrderRef(brokerOrderRef) {
    await this.ready();
    return one(this.pool, `SELECT m.management_intent_id
      FROM trade_management_intents m JOIN trades t ON t.trade_id = m.trade_id
      WHERE m.action = 'move_stop' AND m.status IN ('queued','leased','rendered','delivered','acknowledged')
        AND t.raw->>'protective_stop_order_ref' = $1
      ORDER BY m.requested_at DESC LIMIT 1`, [brokerOrderRef]);
  }

  async settleManagementFromSnapshot({ accountId, brokerSnapshot = {}, now }) {
    await this.ready();
    const brokerPositions = new Map((brokerSnapshot.positions || []).map((item) => [positionKey(item.instrument || item.broker_symbol), Math.max(0, Number(item.quantity || 0))]));
    const candidates = await rows(this.pool, `SELECT m.*, t.quantity_open, t.status AS trade_status, t.revision AS trade_revision, c.broker_symbol
      FROM trade_management_intents m JOIN trades t ON t.trade_id = m.trade_id
      JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
      WHERE t.broker_account_id = $1 AND m.status IN ('delivered','acknowledged')
        AND m.action IN ('reduce_position','close_position') AND t.status IN ('open','scaling','protected')`, [accountId]);
    const settled = [];
    for (const intent of candidates) {
      const brokerQuantity = brokerPositions.get(positionKey(intent.broker_symbol));
      if (brokerQuantity === undefined || brokerQuantity >= Number(intent.quantity_open || 0)) continue;
      const closedDelta = Number(intent.quantity_open) - brokerQuantity;
      const nextStatus = brokerQuantity === 0 ? "closed" : "protected";
      await this.pool.query(
        `UPDATE trades SET quantity_open = $2, quantity_closed = quantity_closed + $3, status = $4::trade_status,
          closed_at = CASE WHEN $2 = 0 THEN $5 ELSE closed_at END, revision = revision + 1,
          raw = raw || jsonb_build_object('outcome_pending_reason', 'snapshot_missing_fill_price'),
          updated_at = now()
         WHERE trade_id = $1 AND revision = $6`,
        [intent.trade_id, brokerQuantity, closedDelta, nextStatus, now, intent.trade_revision],
      );
      await this.pool.query("UPDATE trade_management_intents SET status = 'acknowledged', updated_at = now() WHERE management_intent_id = $1", [intent.management_intent_id]);
      await this.pool.query("UPDATE broker_management_outbox SET status = 'acknowledged', acknowledged_at = COALESCE(acknowledged_at, $2), updated_at = now() WHERE management_intent_id = $1", [intent.management_intent_id, now]);
      await this.pool.query(
        `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
         VALUES ($1,$2,$3::lifecycle_event_type,$4::trade_status,$5,$6::jsonb,$7::jsonb)`,
        [`trade_event_${cryptoId()}`, intent.trade_id, brokerQuantity === 0 ? "trade_closed" : "partial_fill", nextStatus, now,
          json({ management_intent_id: intent.management_intent_id, quantity_closed: closedDelta, broker_quantity: brokerQuantity }), json({ source: "ninjatrader_reconciliation" })],
      );
      settled.push({ management_intent_id: intent.management_intent_id, trade_id: intent.trade_id, quantity_open: brokerQuantity, status: nextStatus });
    }
    return settled;
  }

  async settleProtectiveExitsFromAddonSnapshot({ accountId, brokerSnapshot = {}, snapshotId = null, capturedAt = null, now }) {
    await this.ready();
    if (!isConnectedAddonSnapshot(brokerSnapshot) || !Array.isArray(brokerSnapshot.positions) || !Array.isArray(brokerSnapshot.orders)) return [];
    const brokerPositions = new Map((brokerSnapshot.positions || []).map((item) => [positionKey(item.instrument || item.broker_symbol), {
      quantity: Math.max(0, Number(item.quantity || 0)),
      side: String(item.market_position || item.side || "").toUpperCase(),
    }]));
    const candidates = await rows(this.pool, `SELECT t.*, c.broker_symbol
      FROM trades t JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
      WHERE t.broker_account_id = $1 AND t.status IN ('open','scaling','protected') AND t.quantity_open > 0`, [accountId]);
    const settled = [];
    for (const trade of candidates) {
      const brokerPosition = brokerPositions.get(positionKey(trade.broker_symbol));
      const brokerQuantity = brokerPosition?.quantity ?? 0;
      const expectedSide = trade.side === "short" ? "SHORT" : "LONG";
      if (brokerQuantity > 0 && brokerPosition?.side && brokerPosition.side !== expectedSide) continue;
      const quantityDelta = Number(trade.quantity_open || 0) - brokerQuantity;
      if (!(quantityDelta > 0)) continue;
      const protectiveRefs = new Map([
        [String(trade.raw?.protective_stop_order_ref || ""), "protective_stop"],
        [String(trade.raw?.profit_target_order_ref || ""), "profit_target"],
      ].filter(([ref]) => ref));
      const filledProtection = (brokerSnapshot.orders || [])
        .filter((order) => protectiveRefs.has(String(order.broker_order_ref || order.order_id || "")))
        .filter((order) => String(order.status || order.order_state || "").toLowerCase() === "filled")
        .sort((left, right) => Date.parse(right.occurred_at || "") - Date.parse(left.occurred_at || ""));
      let remaining = quantityDelta;
      for (const protectiveOrder of filledProtection) {
        if (!(remaining > 0)) break;
        const brokerOrderRef = String(protectiveOrder.broker_order_ref || protectiveOrder.order_id || "");
        const filledQuantity = Math.max(0, Number(protectiveOrder.filled_quantity || protectiveOrder.quantity || 0));
        const fillPrice = Number(protectiveOrder.average_fill_price || protectiveOrder.stop_price || protectiveOrder.limit_price || 0);
        if (!brokerOrderRef || !(filledQuantity > 0) || !(fillPrice > 0)) continue;
        const applied = await this.#persistProtectiveSnapshotFill({
          trade,
          protectiveOrder,
          brokerOrderRef,
          role: protectiveRefs.get(brokerOrderRef),
          maxQuantity: remaining,
          filledQuantity,
          fillPrice,
          snapshotId,
          occurredAt: validTimestamp(protectiveOrder.occurred_at) || capturedAt || now,
          now,
        });
        if (!applied) continue;
        remaining -= Number(applied.quantity_closed || 0);
        settled.push(applied);
      }
    }
    return settled;
  }

  async confirmProtectionFromAddonSnapshot({ accountId, brokerSnapshot = {}, snapshotId = null, capturedAt = null, now, graceSeconds = 30 }) {
    await this.ready();
    const candidates = await rows(this.pool, `SELECT t.*, c.broker_symbol, c.tick_size
      FROM trades t JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
      WHERE t.broker_account_id = $1 AND t.status IN ('open','scaling','protected') AND t.quantity_open > 0`, [accountId]);
    const results = [];
    for (const trade of candidates) {
      const evaluation = evaluateBrokerProtectionSnapshot({ trade, brokerSnapshot, snapshotId, capturedAt, now, graceSeconds });
      if (trade.raw?.broker_protection_state === evaluation.status && evaluation.status !== "failed") {
        results.push({ trade_id: trade.trade_id, changed: false, ...evaluation });
        continue;
      }
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const currentTrade = await one(client, "SELECT * FROM trades WHERE trade_id = $1 FOR UPDATE", [trade.trade_id]);
        if (!currentTrade || !["open", "scaling", "protected"].includes(currentTrade.status) || Number(currentTrade.quantity_open || 0) <= 0) {
          await client.query("COMMIT");
          results.push({ trade_id: trade.trade_id, changed: false, skipped: true, ...evaluation });
          continue;
        }
        await client.query(
          `UPDATE trades SET
             status = CASE WHEN $2 = 'confirmed' THEN 'protected'::trade_status ELSE status END,
             raw = raw || jsonb_build_object(
               'broker_protection_state', $2::text,
               'broker_protection_reason', $3::text,
               'broker_protection_checked_at', $4::text,
               'broker_protection_snapshot_id', $5::text,
               'broker_protection_evidence', $6::jsonb
             ) || CASE WHEN $2 = 'confirmed'
               THEN jsonb_build_object('broker_protection_confirmed_at', $4::text)
               ELSE '{}'::jsonb
             END,
             revision = CASE WHEN $2 = 'confirmed' AND status <> 'protected' THEN revision + 1 ELSE revision END,
             updated_at = now()
           WHERE trade_id = $1`,
          [currentTrade.trade_id, evaluation.status, evaluation.reason, now, snapshotId, json(evaluation.evidence)],
        );
        if (trade.raw?.broker_protection_state !== evaluation.status || evaluation.status === "failed") {
          await client.query(
            `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
             VALUES ($1,$2,$3::lifecycle_event_type,$4::trade_status,$5,$6::jsonb,$7::jsonb)`,
            [`trade_event_${cryptoId()}`, currentTrade.trade_id,
              evaluation.status === "confirmed" ? "sync_reconciled" : "manual_intervention",
              evaluation.status === "confirmed" ? "protected" : currentTrade.status,
              now,
              json({ protection_status: evaluation.status, reason: evaluation.reason, snapshot_id: snapshotId }),
              json({ source: "ninjatrader_addon_snapshot", evidence: evaluation.evidence })],
          );
        }
        if (evaluation.status === "failed") {
          await client.query(
            `INSERT INTO broker_execution_locks (execution_lock_id, scope_type, scope_value, locked, reason, set_by, metadata)
             VALUES ($1,'account',$2,true,$3,'broker_protection_guard',$4::jsonb)
             ON CONFLICT (scope_type, scope_value) DO UPDATE SET
               locked = true,
               reason = EXCLUDED.reason,
               set_by = EXCLUDED.set_by,
               set_at = now(),
               metadata = broker_execution_locks.metadata || EXCLUDED.metadata`,
            [`protection_lock_${accountId}`, accountId,
              `Broker protection not confirmed for ${currentTrade.trade_id}: ${evaluation.reason}`,
              json({ trade_id: currentTrade.trade_id, snapshot_id: snapshotId, protection_status: evaluation.status, evidence: evaluation.evidence })],
          );
        }
        await client.query("COMMIT");
        results.push({ trade_id: currentTrade.trade_id, changed: true, ...evaluation });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return results;
  }

  async #persistProtectiveSnapshotFill({ trade, protectiveOrder, brokerOrderRef, role, maxQuantity, filledQuantity, fillPrice, snapshotId, occurredAt, now }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentTrade = await one(client, "SELECT * FROM trades WHERE trade_id = $1 FOR UPDATE", [trade.trade_id]);
      if (!currentTrade || !["open", "scaling", "protected"].includes(currentTrade.status) || Number(currentTrade.quantity_open || 0) <= 0) {
        await client.query("COMMIT");
        return null;
      }
      const orderType = role === "protective_stop" ? "stop_market" : "limit";
      const order = (await client.query(
        `INSERT INTO broker_orders (
          broker_order_id, order_intent_id, broker_provider_code, broker_account_id, broker_contract_id,
          broker_order_ref, status, side, order_type, quantity, limit_price, stop_price,
          submitted_at, last_broker_update_at, raw
        ) VALUES ($1,$2,'ninjatrader',$3,$4,$5,'filled',$6::order_side,$7::order_type,$8,$9,$10,$11,$11,$12::jsonb)
        ON CONFLICT (broker_provider_code, broker_order_ref) WHERE broker_order_ref IS NOT NULL
        DO UPDATE SET status = 'filled', last_broker_update_at = EXCLUDED.last_broker_update_at,
          raw = broker_orders.raw || EXCLUDED.raw, updated_at = now() RETURNING *`,
        [`broker_order_${cryptoId()}`, currentTrade.order_intent_id, currentTrade.broker_account_id,
          currentTrade.broker_contract_id, brokerOrderRef, currentTrade.side === "long" ? "sell" : "buy",
          orderType, filledQuantity, orderType === "limit" ? fillPrice : null,
          orderType === "stop_market" ? fillPrice : null, occurredAt,
          json({ ...protectiveOrder, order_role: role, source: "ninjatrader_addon_snapshot" })],
      )).rows[0];
      const recorded = await one(client, "SELECT COALESCE(sum(quantity),0)::numeric AS quantity FROM trade_fills WHERE trade_id = $1 AND broker_order_id = $2", [currentTrade.trade_id, order.broker_order_id]);
      const unrecorded = Math.max(0, filledQuantity - Number(recorded?.quantity || 0));
      const delta = Math.min(Number(currentTrade.quantity_open || 0), Number(maxQuantity || 0), unrecorded);
      if (!(delta > 0)) {
        await client.query("COMMIT");
        return null;
      }
      const nextQuantity = Number(currentTrade.quantity_open || 0) - delta;
      const nextStatus = nextQuantity === 0 ? "closed" : "protected";
      await client.query(
        `UPDATE trades SET quantity_open = $2::numeric, quantity_closed = quantity_closed + $3::numeric,
          status = $4::trade_status,
          avg_exit_price = CASE WHEN quantity_closed + $3::numeric > 0
            THEN ((COALESCE(avg_exit_price,0) * quantity_closed) + ($5::numeric * $3::numeric)) / (quantity_closed + $3::numeric)
            ELSE avg_exit_price END,
          closed_at = CASE WHEN $2::numeric = 0 THEN $6::timestamptz ELSE closed_at END,
          revision = revision + 1, updated_at = now()
         WHERE trade_id = $1`,
        [currentTrade.trade_id, nextQuantity, delta, nextStatus, fillPrice, occurredAt],
      );
      const fillRef = `${brokerOrderRef}:protective:${filledQuantity}:${fillPrice}`;
      await client.query(
        `INSERT INTO trade_fills (trade_fill_id, trade_id, broker_order_id, broker_fill_ref, side, quantity, price, filled_at, liquidity, raw)
         VALUES ($1,$2,$3,$4,$5::order_side,$6,$7,$8,'unknown',$9::jsonb)
         ON CONFLICT (broker_order_id, broker_fill_ref) WHERE broker_fill_ref IS NOT NULL DO NOTHING`,
        [`trade_fill_${cryptoId()}`, currentTrade.trade_id, order.broker_order_id, fillRef,
          currentTrade.side === "long" ? "sell" : "buy", delta, fillPrice, occurredAt,
          json({ source: "ninjatrader_addon_snapshot", snapshot_id: snapshotId, order_role: role })],
      );
      await client.query(
        `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
         VALUES ($1,$2,$3::lifecycle_event_type,$4::trade_status,$5,$6::jsonb,$7::jsonb)`,
        [`trade_event_${cryptoId()}`, currentTrade.trade_id, role === "profit_target" ? "target_hit" : (nextQuantity === 0 ? "trade_closed" : "partial_fill"),
          nextStatus, occurredAt,
          json({ quantity: delta, quantity_open: nextQuantity, price: fillPrice, exit_reason: role, broker_order_ref: brokerOrderRef }),
          json({ source: "ninjatrader_addon_snapshot", snapshot_id: snapshotId })],
      );
      await materializeTradeOutcome(client, currentTrade.trade_id, occurredAt);
      await client.query("COMMIT");
      return { trade_id: currentTrade.trade_id, broker_order_ref: brokerOrderRef, exit_reason: role, quantity_closed: delta, quantity_open: nextQuantity, status: nextStatus, price: fillPrice };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordBrokerUpdate({ brokerOrderId, brokerOrderRef, intentId, externalEventKey = null, update, now }) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (externalEventKey) {
        const duplicate = await one(client, `SELECT o.* FROM broker_order_events e
          JOIN broker_orders o ON o.broker_order_id = e.broker_order_id
          WHERE e.external_event_key = $1`, [externalEventKey]);
        if (duplicate) {
          await client.query("COMMIT");
          return duplicate;
        }
      }
      const intent = await one(client, "SELECT * FROM trade_order_intents WHERE order_intent_id = $1", [intentId]);
      if (!intent) throw repositoryError("ORDER_INTENT_NOT_FOUND", `Order intent not found: ${intentId}.`);
      const previousOrder = await one(client, "SELECT * FROM broker_orders WHERE broker_provider_code = 'ninjatrader' AND broker_order_ref = $1", [brokerOrderRef]);
      const orderResult = await client.query(
        `INSERT INTO broker_orders (
          broker_order_id, order_intent_id, broker_provider_code, broker_account_id, broker_contract_id,
          broker_order_ref, status, side, order_type, quantity, limit_price, stop_price, submitted_at, last_broker_update_at, raw
        ) VALUES ($1,$2,'ninjatrader',$3,$4,$5,$6::broker_order_status,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
        ON CONFLICT (broker_provider_code, broker_order_ref) WHERE broker_order_ref IS NOT NULL
        DO UPDATE SET status = CASE
            WHEN broker_orders.status IN ('filled','cancelled','rejected','expired') THEN broker_orders.status
            ELSE EXCLUDED.status
          END,
          last_broker_update_at = GREATEST(broker_orders.last_broker_update_at, EXCLUDED.last_broker_update_at),
          raw = CASE
            WHEN broker_orders.status IN ('filled','cancelled','rejected','expired') THEN broker_orders.raw
            ELSE broker_orders.raw || EXCLUDED.raw
          END,
          updated_at = now()
        RETURNING *`,
        [brokerOrderId, intentId, intent.broker_account_id, intent.broker_contract_id, brokerOrderRef, update.status,
          intent.side, intent.order_type, intent.quantity, intent.limit_price, intent.stop_price, now, update.occurred_at, json(update.raw)],
      );
      const order = orderResult.rows[0];
      const eventResult = await client.query(
        `INSERT INTO broker_order_events (broker_order_event_id, broker_order_id, event_type, status, occurred_at, payload, raw, external_event_key)
         VALUES ($1,$2,$3::lifecycle_event_type,$4::broker_order_status,$5,$6::jsonb,$7::jsonb,$8)
         ON CONFLICT (external_event_key) WHERE external_event_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [`broker_event_${cryptoId()}`, order.broker_order_id, eventType(update.status), update.status, update.occurred_at, json(update), json(update.raw), externalEventKey],
      );
      if (eventResult.rows[0]) await persistEntryFillAndTrade(client, { intent, order, previousOrder, update, externalEventKey, now });
      const intentStatus = ({ rejected: "rejected", cancelled: "cancelled", expired: "expired" })[update.status]
        || (["submitted", "accepted", "working", "partially_filled", "filled"].includes(update.status) ? "acknowledged" : null);
      if (intentStatus) await client.query("UPDATE trade_order_intents SET status = $2::order_intent_status, updated_at = now() WHERE order_intent_id = $1", [intentId, intentStatus]);
      if (["submitted", "accepted", "working", "partially_filled", "filled"].includes(update.status)) {
        await client.query("UPDATE broker_execution_outbox SET status = 'acknowledged', acknowledged_at = COALESCE(acknowledged_at, $2), updated_at = now() WHERE order_intent_id = $1 AND status IN ('pending','leased','rendered','delivered')", [intentId, update.occurred_at]);
      }
      await client.query("COMMIT");
      return order;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async reconciliationSnapshot(accountId) {
    await this.ready();
    const [orders, trades] = await Promise.all([
      rows(this.pool, `SELECT o.*, c.broker_symbol FROM broker_orders o
        LEFT JOIN broker_contracts c ON c.broker_contract_id = o.broker_contract_id
        WHERE o.broker_account_id = $1 AND o.status NOT IN ('filled','cancelled','rejected','expired')`, [accountId]),
      rows(this.pool, `SELECT t.*, c.broker_symbol, c.instrument_code FROM trades t
        LEFT JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
        WHERE t.broker_account_id = $1 AND t.status NOT IN ('closed','cancelled','rejected','expired')`, [accountId]),
    ]);
    return { orders, trades };
  }

  async storeReconciliation({ run, lockOnDivergence = true }) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO broker_reconciliation_runs (
          reconciliation_run_id, bridge_id, broker_account_id, status, started_at, completed_at,
          mismatch_count, mismatches, broker_snapshot, desk_snapshot, metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)`,
        [run.reconciliation_run_id, run.bridge_id, run.broker_account_id, run.status, run.started_at, run.completed_at,
          run.mismatch_count, json(run.mismatches), json(run.broker_snapshot), json(run.desk_snapshot), json(run.metadata)],
      );
      if (run.status === "diverged" && lockOnDivergence) {
        await client.query("UPDATE broker_accounts SET read_only = true, order_submission_enabled = false, updated_at = now() WHERE broker_account_id = $1", [run.broker_account_id]);
        await client.query(
          `INSERT INTO broker_execution_locks (execution_lock_id, scope_type, scope_value, locked, reason, set_by, metadata)
           VALUES ($1,'account',$2,true,$3,'reconciliation_worker',$4::jsonb)
           ON CONFLICT (scope_type, scope_value) DO UPDATE SET locked = true, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = now(), metadata = EXCLUDED.metadata`,
          [`reconciliation_lock_${run.broker_account_id}`, run.broker_account_id, `Broker/PostgreSQL divergence: ${run.mismatch_count} mismatch(es).`, json({ reconciliation_run_id: run.reconciliation_run_id })],
        );
        if (run.bridge_id) await client.query("UPDATE broker_bridge_heartbeats SET status = 'read_only', updated_at = now() WHERE bridge_id = $1", [run.bridge_id]);
      }
      await client.query("COMMIT");
      return run;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

async function persistEntryFillAndTrade(client, { intent, order, previousOrder, update, externalEventKey, now }) {
  const filled = Number(update.filled_quantity || 0);
  const previousFilled = Number(previousOrder?.raw?.filled_quantity ?? previousOrder?.raw?.filled ?? 0);
  const delta = filled - previousFilled;
  const averagePrice = Number(update.average_fill_price);
  if (!(delta > 0) || !Number.isFinite(averagePrice) || averagePrice <= 0) return;
  const previousAverage = Number(previousOrder?.raw?.average_fill_price ?? previousOrder?.raw?.avg_fill_price ?? 0);
  const incrementalPrice = previousFilled > 0 && Number.isFinite(previousAverage)
    ? ((averagePrice * filled) - (previousAverage * previousFilled)) / delta
    : averagePrice;
  const decision = await one(client, "SELECT * FROM trade_decisions WHERE trade_decision_id = $1", [intent.trade_decision_id]);
  const tradeId = `trade_${intent.order_intent_id}`;
  const side = intent.side === "buy" ? "long" : "short";
  await client.query(
    `INSERT INTO trades (
      trade_id, trade_decision_id, order_intent_id, broker_account_id, broker_contract_id, status, side,
      quantity_planned, quantity_open, avg_entry_price, initial_stop_price, current_stop_price, current_target_price, atm_strategy_id,
      opened_at, trading_date, session, strategy_id, raw
    ) VALUES ($1,$2,$3,$4,$5,'open',$6::trade_side,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
    ON CONFLICT (trade_id) DO UPDATE SET status = 'open', quantity_open = EXCLUDED.quantity_open,
      avg_entry_price = EXCLUDED.avg_entry_price,
      initial_stop_price = COALESCE(trades.initial_stop_price, EXCLUDED.initial_stop_price),
      current_stop_price = COALESCE(trades.current_stop_price, EXCLUDED.current_stop_price),
      current_target_price = COALESCE(trades.current_target_price, EXCLUDED.current_target_price),
      atm_strategy_id = COALESCE(trades.atm_strategy_id, EXCLUDED.atm_strategy_id), updated_at = now(), raw = trades.raw || EXCLUDED.raw`,
    [tradeId, intent.trade_decision_id, intent.order_intent_id, intent.broker_account_id, intent.broker_contract_id,
      side, intent.quantity, filled, averagePrice, intent.bracket?.stop_price || null, intent.bracket?.target_price || null,
      intent.payload?.atm_strategy_id || null, update.occurred_at || now, decision?.trading_date || null,
      decision?.session || null, decision?.strategy_id || null,
      json({
        source: update.raw?.execution_adapter === "addon" ? "ninjatrader_addon" : "ninjatrader_ati",
        entry_order_ref: order.broker_order_ref,
        atm_strategy_id: intent.payload?.atm_strategy_id || null,
        protective_stop_order_ref: update.raw?.protective_stop_order_ref || null,
        profit_target_order_ref: update.raw?.profit_target_order_ref || null,
        broker_protection_state: "pending",
        broker_protection_reason: "AWAITING_PROTECTION_SNAPSHOT",
        broker_protection_checked_at: update.occurred_at || now,
      })],
  );
  const fillRef = externalEventKey || `${order.broker_order_ref}:${filled}:${averagePrice}`;
  await client.query(
    `INSERT INTO trade_fills (trade_fill_id, trade_id, broker_order_id, broker_fill_ref, side, quantity, price, filled_at, liquidity, raw)
     VALUES ($1,$2,$3,$4,$5::order_side,$6,$7,$8,'unknown',$9::jsonb)
     ON CONFLICT (broker_order_id, broker_fill_ref) WHERE broker_fill_ref IS NOT NULL DO NOTHING`,
    [`trade_fill_${cryptoId()}`, tradeId, order.broker_order_id, fillRef, intent.side, delta, incrementalPrice,
      update.occurred_at || now, json(update.raw)],
  );
  await client.query(
    `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
     VALUES ($1,$2,$3::lifecycle_event_type,'open',$4,$5::jsonb,$6::jsonb)`,
    [`trade_event_${cryptoId()}`, tradeId, update.status === "partially_filled" ? "partial_fill" : "order_filled",
      update.occurred_at || now, json({ quantity: delta, cumulative_quantity: filled, price: incrementalPrice }), json(update.raw)],
  );
}

async function persistManagementFill(client, { intent, trade, order, update, externalEventKey, now }) {
  const filled = Number(update.filled_quantity || 0);
  const recorded = await one(client, "SELECT COALESCE(sum(quantity),0)::numeric AS quantity FROM trade_fills WHERE trade_id = $1 AND broker_order_id = $2", [trade.trade_id, order.broker_order_id]);
  const delta = Math.min(Number(trade.quantity_open || 0), filled - Number(recorded?.quantity || 0));
  const price = Number(update.average_fill_price);
  if (!(delta > 0) || !Number.isFinite(price) || price <= 0) return;
  const nextQuantity = Math.max(0, Number(trade.quantity_open || 0) - delta);
  const nextStatus = nextQuantity === 0 ? "closed" : "protected";
  await client.query(
    `UPDATE trades SET quantity_open = $2::numeric, quantity_closed = quantity_closed + $3::numeric, status = $4::trade_status,
      avg_exit_price = CASE WHEN quantity_closed + $3::numeric > 0 THEN ((COALESCE(avg_exit_price,0) * quantity_closed) + ($5::numeric * $3::numeric)) / (quantity_closed + $3::numeric) ELSE avg_exit_price END,
      closed_at = CASE WHEN $2::numeric = 0 THEN $6::timestamptz ELSE closed_at END, revision = revision + 1, updated_at = now()
     WHERE trade_id = $1`,
    [trade.trade_id, nextQuantity, delta, nextStatus, price, update.occurred_at || now],
  );
  await client.query(
    `INSERT INTO trade_fills (trade_fill_id, trade_id, broker_order_id, broker_fill_ref, side, quantity, price, filled_at, liquidity, raw)
     VALUES ($1,$2,$3,$4,$5::order_side,$6,$7,$8,'unknown',$9::jsonb)
     ON CONFLICT (broker_order_id, broker_fill_ref) WHERE broker_fill_ref IS NOT NULL DO NOTHING`,
    [`trade_fill_${cryptoId()}`, trade.trade_id, order.broker_order_id,
      externalEventKey || `${order.broker_order_ref}:${filled}:${price}`, trade.side === "long" ? "sell" : "buy",
      delta, price, update.occurred_at || now, json(update.raw)],
  );
  await client.query(
    `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
     VALUES ($1,$2,$3::lifecycle_event_type,$4::trade_status,$5,$6::jsonb,$7::jsonb)`,
    [`trade_event_${cryptoId()}`, trade.trade_id, nextQuantity === 0 ? "trade_closed" : "partial_fill", nextStatus,
      update.occurred_at || now, json({ management_intent_id: intent.management_intent_id, quantity: delta, quantity_open: nextQuantity, price }), json(update.raw)],
  );
  await materializeTradeOutcome(client, trade.trade_id, update.occurred_at || now);
}

export class DisabledBrokerExecutionRepository {
  get available() { return false; }
  async overview() { return { providers: [], accounts: [], accountSnapshots: [], contracts: [], policies: [], policyAudits: [], bridges: [], locks: [], decisions: [], intents: [], orders: [], trades: [], reconciliations: [], managementIntents: [], managementApprovals: [], managementOutbox: [], addonSnapshots: [], addonEvents: [], adapterParityRuns: [], portfolioOrderIntents: [], humanExecutionGates: [], portfolioExecutionStates: [], providerCommands: [], providerEvents: [] }; }
}

export function createBrokerExecutionRepository(persistence) {
  return persistence?.pool ? new PostgresBrokerExecutionRepository(persistence) : new DisabledBrokerExecutionRepository();
}

async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows; }
async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
async function optionalRows(client, sql, params = []) {
  try {
    return await rows(client, sql, params);
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}
function json(value) { return JSON.stringify(value ?? {}); }
function cryptoId() { return globalThis.crypto.randomUUID().replaceAll("-", ""); }
function firstInteger(...values) { const parsed = firstNumber(...values); return Number.isInteger(parsed) && parsed >= 0 ? parsed : null; }
function sizingPolicyValues(policy) {
  return {
    risk_per_trade_pct: Number(policy?.risk_per_trade_pct ?? 0.25),
    max_rounding_excess_pct: Number(policy?.max_rounding_excess_pct ?? 0.25),
    max_decision_age_seconds: Number(policy?.max_decision_age_seconds ?? 120),
    fallback_capital_enabled: policy?.fallback_capital_enabled === true,
    fallback_capital: policy?.fallback_capital === null || policy?.fallback_capital === undefined ? null : Number(policy.fallback_capital),
    revision: Number(policy?.revision || 0),
  };
}
function executionAuthorityValues(policy) {
  const mode = String(policy?.execution_authority_mode || (policy?.require_operator_approval === false ? "auto" : "semi_auto"));
  return {
    execution_authority_mode: mode,
    require_operator_approval: mode === "semi_auto",
    automatic_management: true,
    revision: Number(policy?.revision || 0),
  };
}
function eventType(status) {
  return ({ accepted: "broker_ack", submitted: "broker_ack", working: "order_working", partially_filled: "partial_fill", filled: "order_filled", rejected: "broker_reject", cancelled: "trade_cancelled", expired: "trade_cancelled", error: "error" })[status] || "manual_intervention";
}
function repositoryError(code, message) { const error = new Error(message); error.code = code; error.statusCode = code.endsWith("NOT_FOUND") ? 404 : 409; return error; }
