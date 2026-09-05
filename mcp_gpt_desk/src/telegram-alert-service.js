import { createHash, randomUUID } from "node:crypto";
import { TelegramClient } from "./telegram-client.js";
import { SystemClock } from "@tv-automation/desk-time";
import { deliverTelegramCandidate } from "./telegram-delivery-runtime.js";
import { loadTelegramTradingRows } from "./telegram-trading-source.js";
import { buildTelegramTradingCandidate, isTelegramTradingAlertSourceAllowed, telegramTradingDeliverySuppressionReason } from "./telegram-trading-message.js";
import { boundedNumber, countBy, formatCounts, inferScope, iso, telegramSourceKindsToBaseline } from "./telegram-alert-utilities.js";
const CONFIG_ID = "desk_telegram";
const ACTIVE_NOTIFICATION_STATES = new Set(["pending", "active", "watching", "action_required", "open"]);
export { isTelegramTradingAlertSourceAllowed };

export class TelegramAlertService {
  constructor({ persistence, clock, env = process.env, fetchImpl = globalThis.fetch } = {}) {
    if (!persistence?.pool) throw new Error("telegram_postgres_persistence_required");
    this.persistence = persistence;
    this.clock = clock || new SystemClock();
    this.env = env;
    this.pollMs = boundedNumber(env.DESK_TELEGRAM_POLL_MS, 5000, 1000, 60000);
    this.deliveryMinIntervalMs = boundedNumber(env.DESK_TELEGRAM_DELIVERY_MIN_INTERVAL_MS, 1200, 1000, 60000);
    this.adminChatId = String(env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
    this.tradingChatId = String(env.TELEGRAM_ALERT_CHAT_ID || "").trim();
    this.clients = {
      admin: new TelegramClient({ token: env.TELEGRAM_ADMIN_BOT_TOKEN, profile: "admin", fetchImpl }),
      trading: new TelegramClient({ token: env.TELEGRAM_ALERT_BOT_TOKEN, profile: "trading", fetchImpl }),
    };
  }

  envStatus() {
    return {
      workerEnabled: String(this.env.DESK_TELEGRAM_ENABLED || "false").toLowerCase() === "true",
      adminConfigured: this.clients.admin.configured && Boolean(this.adminChatId),
      tradingConfigured: this.clients.trading.configured && Boolean(this.tradingChatId),
      commandsRequested: String(this.env.DESK_TELEGRAM_COMMANDS_ENABLED || "true").toLowerCase() !== "false",
      pollMs: this.pollMs,
      deliveryMinIntervalMs: this.deliveryMinIntervalMs,
    };
  }

  async getStatus() {
    await this.persistence.initialized;
    const [configResult, heartbeatResult, countsResult, deliveriesResult, identityResult] = await Promise.all([
      this.persistence.pool.query("SELECT * FROM telegram_runtime_config WHERE config_id = $1", [CONFIG_ID]),
      this.persistence.pool.query(
        `SELECT status, details, heartbeat_at_utc, release_version
         FROM desk_service_heartbeats WHERE service_id = 'telegram_alert_worker' LIMIT 1`,
      ),
      this.persistence.pool.query(
        `SELECT status::text, count(*)::integer AS count
         FROM telegram_delivery_outbox GROUP BY status`,
      ),
      this.persistence.pool.query(
        `SELECT delivery_id, profile::text, source_kind, status::text, message, attempt_count,
                telegram_message_id, sent_at_utc, last_error, created_at_utc, updated_at_utc
         FROM telegram_delivery_outbox
         ORDER BY created_at_utc DESC LIMIT 30`,
      ),
      this.persistence.pool.query(
        `SELECT state_key, state_value FROM telegram_runtime_state
         WHERE state_key IN ('bot_identity:admin', 'bot_identity:trading')`,
      ),
    ]);
    const config = normalizeConfig(configResult.rows[0]);
    const counts = Object.fromEntries(countsResult.rows.map((row) => [row.status, row.count]));
    const identities = Object.fromEntries(identityResult.rows.map((row) => [row.state_key.split(":")[1], row.state_value]));
    const envStatus = this.envStatus();
    const nowMs = telegramNowEpochMs(this.clock);
    const muted = Boolean(config.mutedUntil && Date.parse(config.mutedUntil) > nowMs);
    return {
      ok: true,
      contract: "DeskTelegramStatus",
      schemaVersion: "1.0.0",
      generatedAt: new Date(nowMs).toISOString(),
      config,
      effective: {
        enabled: envStatus.workerEnabled && config.enabled && !muted,
        muted,
        adminReady: envStatus.adminConfigured && config.adminEnabled,
        tradingReady: envStatus.tradingConfigured && config.tradingEnabled,
        commandsReady: envStatus.adminConfigured && envStatus.commandsRequested && config.commandsEnabled,
      },
      environment: envStatus,
      bots: {
        admin: publicIdentity(identities.admin, envStatus.adminConfigured),
        trading: publicIdentity(identities.trading, envStatus.tradingConfigured),
      },
      worker: heartbeatResult.rows[0] ? {
        status: heartbeatResult.rows[0].status,
        details: heartbeatResult.rows[0].details || {},
        heartbeatAt: iso(heartbeatResult.rows[0].heartbeat_at_utc),
        releaseVersion: heartbeatResult.rows[0].release_version || null,
      } : null,
      outbox: { counts, recent: deliveriesResult.rows.map(normalizeDelivery) },
    };
  }

  async executeAction(input = {}, actor = {}) {
    await this.persistence.initialized;
    const action = String(input.action || "");
    if (action === "test") {
      const profile = assertProfile(input.profile);
      const delivery = await this.queueDelivery({
        profile,
        sourceKey: `manual_test:${profile}`,
        sourceKind: "manual_test",
        fingerprint: hash({ profile, nonce: input.idempotencyKey }),
        priority: 90,
        silent: false,
        message: profile === "admin"
          ? "✅ Test Desk Futures — canal administration opérationnel."
          : "✅ Test Desk Futures — canal trading opérationnel (aucun ordre exécuté).",
        payload: { requested_by: actorName(actor), reason: input.reason || "Test opérateur" },
      });
      return { ok: true, action, delivery };
    }
    const client = await this.persistence.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query(
        "SELECT * FROM telegram_runtime_config WHERE config_id = $1 FOR UPDATE",
        [CONFIG_ID],
      );
      const current = currentResult.rows[0];
      if (!current) throw apiError("TELEGRAM_CONFIG_MISSING", "Configuration Telegram introuvable.", 500);
      if (Number(input.expectedRevision) !== Number(current.revision)) {
        throw apiError("REVISION_CONFLICT", "La configuration Telegram a changé.", 409);
      }
      let patch;
      if (action === "configure") {
        patch = {
          enabled: Boolean(input.enabled),
          adminEnabled: Boolean(input.adminEnabled),
          tradingEnabled: Boolean(input.tradingEnabled),
          commandsEnabled: Boolean(input.commandsEnabled),
          mutedUntil: current.muted_until_utc,
        };
      } else if (action === "mute") {
        const minutes = boundedNumber(input.minutes, 60, 1, 10080);
        patch = {
          enabled: current.enabled,
          adminEnabled: current.admin_enabled,
          tradingEnabled: current.trading_enabled,
          commandsEnabled: current.commands_enabled,
          mutedUntil: new Date(telegramNowEpochMs(this.clock) + minutes * 60000).toISOString(),
        };
      } else if (action === "resume") {
        patch = {
          enabled: current.enabled,
          adminEnabled: current.admin_enabled,
          tradingEnabled: current.trading_enabled,
          commandsEnabled: current.commands_enabled,
          mutedUntil: null,
        };
      } else {
        throw apiError("INVALID_TELEGRAM_ACTION", "Action Telegram invalide.", 400);
      }
      const result = await client.query(
        `UPDATE telegram_runtime_config
         SET enabled = $2,
             admin_enabled = $3,
             trading_enabled = $4,
             commands_enabled = $5,
             muted_until_utc = $6,
             revision = revision + 1,
             updated_by = $7,
             updated_at_utc = now()
         WHERE config_id = $1
         RETURNING *`,
        [CONFIG_ID, patch.enabled, patch.adminEnabled, patch.tradingEnabled, patch.commandsEnabled, patch.mutedUntil, actorName(actor)],
      );
      await client.query("COMMIT");
      return { ok: true, action, config: normalizeConfig(result.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async identifyBots() {
    const status = this.envStatus();
    for (const profile of ["admin", "trading"]) {
      const configured = profile === "admin" ? status.adminConfigured : status.tradingConfigured;
      if (!configured) continue;
      const identity = await this.clients[profile].getMe();
      await this.#setRuntimeState(`bot_identity:${profile}`, {
        id: identity.id,
        username: identity.username || null,
        displayName: [identity.first_name, identity.last_name].filter(Boolean).join(" ") || null,
        verifiedAt: new Date(telegramNowEpochMs(this.clock)).toISOString(),
      });
    }
  }

  async recoverInterruptedDeliveries() {
    await this.persistence.initialized;
    const result = await this.persistence.pool.query(
      `UPDATE telegram_delivery_outbox
       SET status = 'uncertain',
           lease_token = NULL,
           lease_expires_at_utc = NULL,
           last_error = COALESCE(last_error, 'Worker stopped during an ambiguous Telegram API request; automatic resend disabled.'),
           updated_at_utc = now()
       WHERE status = 'sending' AND lease_expires_at_utc < now()
       RETURNING delivery_id`,
    );
    return result.rowCount;
  }

  async syncSources() {
    await this.persistence.initialized;
    const configResult = await this.persistence.pool.query(
      "SELECT * FROM telegram_runtime_config WHERE config_id = $1",
      [CONFIG_ID],
    );
    const config = normalizeConfig(configResult.rows[0]);
    const baseline = !config.baselineCompletedAt;
    const [notifications, trading, aiWorkers] = await Promise.all([
      this.#notificationCandidates(),
      this.#tradingCandidates(),
      this.#aiWorkerCandidates(),
    ]);
    const candidates = [...notifications, ...trading, ...aiWorkers];
    const sourceKindsResult = await this.persistence.pool.query("SELECT DISTINCT source_kind FROM telegram_source_state");
    const sourceKindsToBaseline = telegramSourceKindsToBaseline({
      candidates,
      existingSourceKinds: sourceKindsResult.rows.map((row) => row.source_kind),
      globalBaseline: baseline,
    });
    let queued = 0;
    for (const candidate of candidates) {
      queued += await this.#observeCandidate(candidate, {
        config,
        baseline: baseline || sourceKindsToBaseline.has(candidate.sourceKind),
      });
    }
    if (baseline) {
      await this.persistence.pool.query(
        `UPDATE telegram_runtime_config
         SET baseline_completed_at_utc = now(), updated_at_utc = now()
         WHERE config_id = $1 AND baseline_completed_at_utc IS NULL`,
        [CONFIG_ID],
      );
    }
    return {
      baseline,
      baselinedSourceKinds: [...sourceKindsToBaseline].sort(),
      observed: candidates.length,
      queued,
    };
  }

  async deliverNext() {
    await this.persistence.initialized;
    const configResult = await this.persistence.pool.query(
      "SELECT * FROM telegram_runtime_config WHERE config_id = $1", [CONFIG_ID],
    );
    return deliverTelegramCandidate({
      pool: this.persistence.pool, config: normalizeConfig(configResult.rows[0]),
      environment: this.envStatus(), clients: this.clients,
      chatIds: { admin: this.adminChatId, trading: this.tradingChatId },
      nowMs: telegramNowEpochMs(this.clock), minIntervalMs: this.deliveryMinIntervalMs,
    });
  }

  async pollAdminCommands() {
    const envStatus = this.envStatus();
    if (!envStatus.workerEnabled || !envStatus.adminConfigured || !envStatus.commandsRequested) return { status: "disabled" };
    const configResult = await this.persistence.pool.query(
      "SELECT * FROM telegram_runtime_config WHERE config_id = $1",
      [CONFIG_ID],
    );
    const config = normalizeConfig(configResult.rows[0]);
    if (!config.enabled || !config.commandsEnabled) return { status: "disabled" };
    const stateResult = await this.persistence.pool.query(
      "SELECT state_value FROM telegram_runtime_state WHERE state_key = 'admin_update_offset'",
    );
    const offset = Number(stateResult.rows[0]?.state_value?.offset || 0);
    const updates = await this.clients.admin.getUpdates({ offset, limit: 20 });
    let nextOffset = offset;
    let processed = 0;
    for (const update of updates) {
      nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
      const message = update.message;
      if (!message?.text) continue;
      await this.#handleAdminCommand(update);
      processed += 1;
    }
    if (nextOffset !== offset) await this.#setRuntimeState("admin_update_offset", { offset: nextOffset });
    return { status: "ok", processed };
  }

  async queueDelivery(candidate) {
    if (telegramTradingDeliverySuppressionReason(candidate, { now: telegramNowEpochMs(this.clock) })) return null;
    const deliveryId = `telegram_delivery_${randomUUID()}`;
    const dedupeKey = `${candidate.sourceKey}:${candidate.fingerprint}`;
    const result = await this.persistence.pool.query(
      `INSERT INTO telegram_delivery_outbox (
         delivery_id, profile, source_key, source_kind, dedupe_key,
         priority, silent, status, message, payload
       ) VALUES ($1, $2::telegram_profile, $3, $4, $5, $6, $7, 'pending', $8, $9::jsonb)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING *`,
      [
        deliveryId,
        candidate.profile,
        candidate.sourceKey,
        candidate.sourceKind,
        dedupeKey,
        Number(candidate.priority || 50),
        Boolean(candidate.silent),
        String(candidate.message || "").slice(0, 4000),
        JSON.stringify(candidate.payload || {}),
      ],
    );
    return result.rows[0] ? normalizeDelivery(result.rows[0]) : null;
  }

  async #observeCandidate(candidate, { config, baseline }) {
    const currentResult = await this.persistence.pool.query(
      "SELECT * FROM telegram_source_state WHERE source_key = $1",
      [candidate.sourceKey],
    );
    const current = currentResult.rows[0];
    const changed = !current || current.fingerprint !== candidate.fingerprint;
    await this.persistence.pool.query(
      `INSERT INTO telegram_source_state (
         source_key, profile, source_kind, fingerprint, source_state, payload,
         first_seen_at_utc, last_seen_at_utc
       ) VALUES ($1, $2::telegram_profile, $3, $4, $5, $6::jsonb, now(), now())
       ON CONFLICT (source_key) DO UPDATE
         SET profile = EXCLUDED.profile,
             source_kind = EXCLUDED.source_kind,
             fingerprint = EXCLUDED.fingerprint,
             source_state = EXCLUDED.source_state,
             payload = EXCLUDED.payload,
             last_seen_at_utc = now()`,
      [candidate.sourceKey, candidate.profile, candidate.sourceKind, candidate.fingerprint, candidate.state, JSON.stringify(candidate.payload || {})],
    );
    if (!changed || baseline) return 0;
    const enabled = config.enabled
      && (!config.mutedUntil || Date.parse(config.mutedUntil) <= telegramNowEpochMs(this.clock))
      && (candidate.profile === "admin" ? config.adminEnabled : config.tradingEnabled);
    if (!enabled) return 0;
    const delivery = await this.queueDelivery(candidate);
    if (!delivery) return 0;
    await this.persistence.pool.query(
      "UPDATE telegram_source_state SET last_queued_at_utc = now() WHERE source_key = $1",
      [candidate.sourceKey],
    );
    return 1;
  }

  async #notificationCandidates() {
    const documents = await this.persistence.listDocuments("desk_notification_outbox");
    const queueGroups = new Map();
    const candidates = [];
    for (const item of documents) {
      const reasonText = [
        ...(Array.isArray(item.reason_codes) ? item.reason_codes : []),
        ...(Array.isArray(item.reasonCodes) ? item.reasonCodes : []),
        item.guardrail_type,
        item.guardrailType,
        item.title,
        item.message,
      ].filter(Boolean).join(" ").toUpperCase();
      const queueSla = reasonText.includes("QUEUE_SLA_BREACH")
        || (reasonText.includes("QUEUE") && reasonText.includes("SLA") && reasonText.includes("ATTENTE"));
      if (queueSla) {
        const scope = inferScope(item);
        const key = `notification:queue_sla:${scope}`;
        const group = queueGroups.get(key) || { key, scope, active: [], all: [] };
        group.all.push(item);
        if (ACTIVE_NOTIFICATION_STATES.has(String(item.status || "").toLowerCase())) group.active.push(item);
        queueGroups.set(key, group);
        continue;
      }
      candidates.push(notificationCandidate(item));
    }
    for (const group of queueGroups.values()) {
      const active = group.active;
      const state = active.length ? "active" : "cleared";
      const maxPriority = Math.max(0, ...active.map((item) => Number(item.priority || 50)));
      // Queue membership and incident revisions are noisy operational details.
      // Alert only when the aggregate crosses active <-> cleared; the current
      // count remains available in the message and in the front.
      const fingerprint = hash({ state });
      candidates.push({
        profile: "admin",
        sourceKey: group.key,
        sourceKind: "queue_sla_aggregate",
        state,
        fingerprint,
        priority: state === "active" ? Math.max(70, maxPriority) : 40,
        silent: state !== "active",
        message: state === "active"
          ? `⚠️ File GPT ${group.scope.toUpperCase()} hors SLA\n${active.length} tâche(s) actives concernées. Ouvrir Incidents et alertes pour le détail.`
          : `✅ File GPT ${group.scope.toUpperCase()} revenue dans le SLA.`,
        payload: { scope: group.scope, notification_count: active.length },
      });
    }
    return candidates.filter(Boolean);
  }

  async #aiWorkerCandidates() {
    const result = await this.persistence.pool.query(
      `SELECT service_id, instance_id, status, details, heartbeat_at_utc,
              extract(epoch FROM (now() - heartbeat_at_utc))::integer AS age_seconds
       FROM desk_service_heartbeats
       WHERE service_kind = 'codex_ai_worker'
       ORDER BY service_id`,
    ).catch(() => ({ rows: [] }));
    return result.rows.map((row) => {
      const ageSeconds = Number(row.age_seconds || 0);
      const mode = String(row.details?.mode || "unknown");
      const workerStatus = String(row.status || "unknown").toLowerCase();
      const lastResult = row.details?.last_result || {};
      const failed = lastResult.ok === false || lastResult.status === "FAILED";
      const stale = ageSeconds > 120;
      const degraded = workerStatus === "degraded" || stale || failed;
      const state = degraded ? "degraded" : mode === "active" ? "active" : "standby";
      const errorCode = lastResult.error?.code || row.details?.error?.code || null;
      return {
        profile: "admin",
        sourceKey: `codex_ai_worker:${row.service_id}`,
        sourceKind: "codex_ai_worker",
        state,
        fingerprint: hash({ state, errorCode }),
        priority: degraded ? 85 : 35,
        silent: !degraded,
        message: degraded
          ? `🚨 Worker IA ${row.instance_id} dégradé\nMode: ${mode.toUpperCase()} · heartbeat: ${ageSeconds}s · erreur: ${errorCode || "non précisée"}`
          : `✅ Worker IA ${row.instance_id} opérationnel\nMode: ${mode.toUpperCase()} · état: ${workerStatus.toUpperCase()}.`,
        payload: {
          service_id: row.service_id,
          worker_id: row.instance_id,
          mode,
          worker_status: workerStatus,
          age_seconds: ageSeconds,
          error_code: errorCode,
        },
      };
    });
  }

  async #tradingCandidates() {
    const rows = await loadTelegramTradingRows(this.persistence.pool);
    const manualTelegramExecution = String(this.env.DESK_MANUAL_TELEGRAM_EXECUTION_ENABLED || "false").toLowerCase() === "true";
    return rows.map((row) => buildTelegramTradingCandidate(row, {
      manualTelegramExecution, hash, now: telegramNowEpochMs(this.clock),
    })).filter(Boolean);
  }

  async #handleAdminCommand(update) {
    const message = update.message;
    const chatId = String(message.chat?.id || "");
    const raw = String(message.text || "").trim();
    const [commandToken, ...args] = raw.split(/\s+/);
    const command = commandToken.toLowerCase().split("@")[0];
    const authorized = chatId === this.adminChatId;
    let outcome = authorized ? "handled" : "rejected";
    let response = "⛔ Commande non autorisée.";
    if (authorized) {
      try {
        response = await this.#commandResponse(command, args);
      } catch (error) {
        outcome = "failed";
        response = `⚠️ Commande impossible : ${safeError(error)}`;
      }
    }
    await this.persistence.pool.query(
      `INSERT INTO telegram_command_requests (
         command_id, telegram_update_id, chat_id, command, arguments, authorized,
         outcome, requested_at_utc, completed_at_utc, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8::jsonb)
       ON CONFLICT (telegram_update_id) DO NOTHING`,
      [
        `telegram_command_${randomUUID()}`,
        update.update_id,
        chatId,
        command,
        args.join(" "),
        authorized,
        outcome,
        JSON.stringify({ username: message.from?.username || null }),
      ],
    );
    await this.clients.admin.sendMessage({ chatId, text: response, silent: false });
  }

  async #commandResponse(command, args) {
    if (command === "/start" || command === "/help") {
      return [
        "Desk Futures — commandes lecture seule",
        "/status /live /feed /gpt /ninja /positions /risk /replay /incidents /last_errors",
        "/mute <minutes> /resume",
        "Aucune commande Telegram ne peut ouvrir, modifier ou clôturer un ordre.",
      ].join("\n");
    }
    if (command === "/status") {
      const status = await this.getStatus();
      return `Desk Telegram: ${status.effective.enabled ? "ACTIF" : "INACTIF"}\nWorker: ${status.worker?.status || "absent"}\nPending: ${status.outbox.counts.pending || 0}\nÉchecs: ${status.outbox.counts.failed || 0}`;
    }
    if (command === "/live" || command === "/gpt" || command === "/replay") {
      const collection = command === "/replay" ? "desk_backtests" : "desk_work_items";
      const docs = await this.persistence.listDocuments(collection);
      const scope = command === "/replay" ? docs : docs.filter((item) => inferScope(item) === "live");
      const counts = countBy(scope, (item) => String(item.status || "UNKNOWN").toUpperCase());
      return `${command.slice(1).toUpperCase()}\nTotal: ${scope.length}\n${formatCounts(counts)}`;
    }
    if (command === "/feed") {
      const result = await this.persistence.pool.query(
        `SELECT mf.instrument_code, mf.timeframe, max(mc.timestamp_utc) AS latest
         FROM market_feeds mf LEFT JOIN market_candles mc ON mc.feed_id = mf.feed_id
         WHERE mf.enabled = true AND mf.instrument_code IN ('MNQ', 'MES')
         GROUP BY mf.instrument_code, mf.timeframe ORDER BY mf.instrument_code, mf.timeframe`,
      );
      return `FEEDS\n${result.rows.map((row) => `${row.instrument_code} ${row.timeframe}: ${iso(row.latest) || "N/D"}`).join("\n") || "Aucun feed"}`;
    }
    if (command === "/ninja") {
      const result = await this.persistence.pool.query(
        `SELECT bridge_id, status::text, ninja_connected, command_enabled, account_name, last_seen_at
         FROM broker_bridge_heartbeats ORDER BY last_seen_at DESC LIMIT 3`,
      );
      return `NINJATRADER\n${result.rows.map((row) => `${row.bridge_id}: ${row.status}, connecté=${row.ninja_connected}, commandes=${row.command_enabled}, ${row.account_name || "N/D"}`).join("\n") || "Aucun heartbeat"}`;
    }
    if (command === "/positions") {
      const result = await this.persistence.pool.query(
        `SELECT t.trade_id, bc.instrument_code, t.side::text, t.quantity_open, t.avg_entry_price, t.current_stop_price
         FROM trades t LEFT JOIN broker_contracts bc ON bc.broker_contract_id = t.broker_contract_id
         WHERE t.status IN ('open', 'scaling', 'protected', 'closing')
         ORDER BY t.updated_at DESC LIMIT 20`,
      );
      return `POSITIONS (${result.rowCount})\n${result.rows.map((row) => `${row.instrument_code || "?"} ${row.side} x${row.quantity_open} @ ${row.avg_entry_price || "?"}, stop ${row.current_stop_price || "?"}`).join("\n") || "Aucune position ouverte"}`;
    }
    if (command === "/risk") {
      const result = await this.persistence.pool.query(
        `SELECT policy_profile_id, enabled, risk_per_trade_pct, fallback_capital_enabled, fallback_capital,
                execution_authority_mode::text, max_contracts
         FROM trade_policy_profiles ORDER BY updated_at DESC LIMIT 3`,
      );
      return `RISK\n${result.rows.map((row) => `${row.policy_profile_id}: ${row.enabled ? "ON" : "OFF"}, ${row.risk_per_trade_pct || "?"}%, ${row.execution_authority_mode}, max ${row.max_contracts}`).join("\n") || "Aucune policy"}`;
    }
    if (command === "/incidents") {
      const docs = await this.persistence.listDocuments("desk_notification_outbox");
      const active = docs.filter((item) => ACTIVE_NOTIFICATION_STATES.has(String(item.status || "").toLowerCase()));
      return `INCIDENTS ACTIFS: ${active.length}\n${active.slice(0, 8).map((item) => `• ${item.title || item.notification_id || item.id}`).join("\n") || "Aucun"}`;
    }
    if (command === "/last_errors") {
      const result = await this.persistence.pool.query(
        `SELECT profile::text, source_kind, last_error, updated_at_utc
         FROM telegram_delivery_outbox WHERE status IN ('failed', 'uncertain')
         ORDER BY updated_at_utc DESC LIMIT 8`,
      );
      return `DERNIÈRES ERREURS\n${result.rows.map((row) => `• ${row.profile}/${row.source_kind}: ${row.last_error || "inconnue"}`).join("\n") || "Aucune"}`;
    }
    if (command === "/mute") {
      const current = await this.getStatus();
      const minutes = boundedNumber(args[0], 60, 1, 10080);
      await this.executeAction({ action: "mute", expectedRevision: current.config.revision, minutes }, { id: "telegram_admin" });
      return `🔕 Alertes mises en sourdine pendant ${minutes} minute(s).`;
    }
    if (command === "/resume") {
      const current = await this.getStatus();
      await this.executeAction({ action: "resume", expectedRevision: current.config.revision }, { id: "telegram_admin" });
      return "🔔 Alertes Telegram réactivées.";
    }
    return "Commande inconnue. Utilise /help.";
  }

  async #setRuntimeState(key, value) {
    await this.persistence.pool.query(
      `INSERT INTO telegram_runtime_state (state_key, state_value, updated_at_utc)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (state_key) DO UPDATE
         SET state_value = EXCLUDED.state_value, updated_at_utc = now()`,
      [key, JSON.stringify(value || {})],
    );
  }
}

function notificationCandidate(item = {}) {
  const id = item.notification_id || item.id;
  if (!id) return null;
  const status = String(item.status || "pending").toLowerCase();
  const active = ACTIVE_NOTIFICATION_STATES.has(status);
  const severity = String(item.severity || item.escalation_level || item.escalationLevel || "warning").toUpperCase();
  const icon = active ? severity === "CRITICAL" ? "🚨" : "⚠️" : "✅";
  return {
    profile: "admin",
    sourceKey: `notification:${id}`,
    sourceKind: "operations_notification",
    state: active ? "active" : "cleared",
    fingerprint: hash({
      status: active ? "active" : "cleared",
      title: item.title,
      message: item.message,
      severity,
    }),
    priority: severity === "CRITICAL" ? 95 : active ? 70 : 40,
    silent: !active,
    message: `${icon} ${item.title || "Incident Desk"}\n${item.message || "Consulter le centre d’incidents."}\nÉtat: ${active ? "actif" : "rétabli"}`,
    payload: { notification_id: id, severity, status },
  };
}

function normalizeConfig(row = {}) {
  return {
    enabled: Boolean(row.enabled),
    adminEnabled: row.admin_enabled !== false,
    tradingEnabled: row.trading_enabled !== false,
    commandsEnabled: row.commands_enabled !== false,
    mutedUntil: iso(row.muted_until_utc),
    baselineCompletedAt: iso(row.baseline_completed_at_utc),
    revision: Number(row.revision || 0),
    updatedBy: row.updated_by || null,
    updatedAt: iso(row.updated_at_utc),
  };
}

function normalizeDelivery(row = {}) {
  return {
    deliveryId: row.delivery_id,
    profile: row.profile,
    sourceKind: row.source_kind,
    status: row.status,
    message: row.message,
    attemptCount: Number(row.attempt_count || 0),
    telegramMessageId: row.telegram_message_id ? String(row.telegram_message_id) : null,
    sentAt: iso(row.sent_at_utc),
    lastError: row.last_error || null,
    createdAt: iso(row.created_at_utc),
    updatedAt: iso(row.updated_at_utc),
  };
}

function publicIdentity(identity, configured) {
  return {
    configured,
    username: identity?.username || null,
    displayName: identity?.displayName || null,
    verifiedAt: identity?.verifiedAt || null,
  };
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeError(error) {
  return String(error?.message || error || "unknown error")
    .replace(/bot[0-9]+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .slice(0, 500);
}

function actorName(actor = {}) {
  return String(actor.id || actor.sub || actor.email || actor.name || "operator").slice(0, 200);
}

function assertProfile(value) {
  if (!["admin", "trading"].includes(value)) throw apiError("INVALID_TELEGRAM_PROFILE", "Profil Telegram invalide.", 400);
  return value;
}

function apiError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function telegramNowEpochMs(clock) {
  const tick = clock?.now?.();
  if (typeof tick?.epochMs === "number" && Number.isFinite(tick.epochMs)) return tick.epochMs;
  const parsed = Date.parse(String(tick?.utc || ""));
  if (!Number.isFinite(parsed)) throw new Error("TELEGRAM_CLOCK_INVALID");
  return parsed;
}
