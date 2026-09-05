import { randomUUID } from "node:crypto";
import { telegramTradingDeliverySuppressionReason } from "./telegram-trading-message.js";
import { telegramRetryDelaySeconds } from "./telegram-alert-utilities.js";
import { loadCanonicalTelegramOrder } from "./telegram-canonical-execution-source.js";

/** Notification application boundary: a claimed delivery is never retried after an ambiguous send. */
export async function deliverTelegramCandidate({ pool, config, environment, clients, chatIds, nowMs, minIntervalMs }) {
  if (!environment.workerEnabled) return { status: "disabled_by_environment" };
  if (!config.enabled) return { status: "disabled" };
  if (config.mutedUntil && Date.parse(config.mutedUntil) > nowMs) return { status: "muted" };
  const claim = await claimDelivery({ pool, config, environment, nowMs, minIntervalMs });
  if (!claim.delivery) return claim.result;
  const delivery = claim.delivery;
  let response;
  try {
    response = await clients[delivery.profile].sendMessage({
      chatId: chatIds[delivery.profile], text: delivery.message, silent: delivery.silent,
    });
    if (!Number.isSafeInteger(response?.message_id) || response.message_id <= 0) {
      throw Object.assign(new Error("Telegram returned no verifiable message ID."), {
        code: "TELEGRAM_MESSAGE_ID_UNVERIFIED", deliveryUncertain: true,
      });
    }
  } catch (error) {
    return recordSendFailure({ pool, delivery, error });
  }
  try {
    await recordSent({ pool, delivery, messageId: response.message_id });
    return { status: "sent", deliveryId: delivery.delivery_id, profile: delivery.profile };
  } catch {
    // Telegram accepted the message. A DB failure must NEVER return it to pending.
    return recordSendFailure({ pool, delivery, error: Object.assign(
      new Error("Telegram accepted the message but its receipt could not be committed."),
      { code: "TELEGRAM_RECEIPT_COMMIT_UNCERTAIN", deliveryUncertain: true },
    ) });
  }
}

async function transaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimDelivery({ pool, config, environment, nowMs, minIntervalMs }) {
  return transaction(pool, async (client) => {
    const result = await client.query(
      `SELECT delivery_id, profile, source_key, source_kind, status, payload, message, silent, attempt_count
       FROM telegram_delivery_outbox
       WHERE status = 'pending' AND available_at_utc <= now()
         AND NOT EXISTS (
           SELECT 1 FROM telegram_delivery_outbox recent
           WHERE recent.profile = telegram_delivery_outbox.profile AND recent.status = 'sent'
             AND recent.sent_at_utc > now() - ($1 * interval '1 millisecond')
         )
       ORDER BY priority DESC, created_at_utc
       FOR UPDATE SKIP LOCKED LIMIT 1`, [minIntervalMs],
    );
    const delivery = result.rows[0];
    if (!delivery) return { result: { status: "idle" } };
    const reason = suppressionReason({ delivery, config, environment, nowMs })
      || await currentOrderSuppressionReason(client, delivery, nowMs);
    if (reason) {
      await client.query(
        `UPDATE telegram_delivery_outbox SET status = 'suppressed', last_error = $2,
           lease_token = NULL, lease_expires_at_utc = NULL, updated_at_utc = now()
         WHERE delivery_id = $1`, [delivery.delivery_id, reason],
      );
      return { result: { status: "suppressed", deliveryId: delivery.delivery_id, reason } };
    }
    return { delivery: await persistClaim(client, delivery) };
  });
}

async function currentOrderSuppressionReason(client, delivery, nowMs) {
  if (delivery.source_kind !== "order_intent") return null;
  const current = await loadCanonicalTelegramOrder(client, delivery.payload.order_intent_id);
  if (!current) return "ORDER_INTENT_NO_LONGER_AVAILABLE";
  const reason = telegramTradingDeliverySuppressionReason({
    sourceKind: "order_intent", state: current.source_state, payload: current.payload,
  }, { now: nowMs });
  if (reason) return reason;
  const fields = ["target_position_id", "human_execution_gate_id", "side", "instrument", "quantity",
    "order_type", "entry_price", "protective_stop", "profit_target", "expires_at"];
  return fields.some(key => JSON.stringify(current.payload[key]) !== JSON.stringify(delivery.payload[key]))
    ? "ORDER_INTENT_CHANGED_AFTER_NOTIFICATION_QUEUED" : null;
}

function suppressionReason({ delivery, config, environment, nowMs }) {
  const tradingReason = telegramTradingDeliverySuppressionReason(delivery, { now: nowMs });
  if (tradingReason) return tradingReason;
  if (!["admin", "trading"].includes(delivery.profile)) return "profile_unknown";
  const enabled = delivery.profile === "admin" ? config.adminEnabled : config.tradingEnabled;
  const configured = delivery.profile === "admin" ? environment.adminConfigured : environment.tradingConfigured;
  if (!enabled) return "profile_disabled";
  if (!configured) return "profile_not_configured";
  return null;
}

async function persistClaim(client, delivery) {
  const leaseToken = randomUUID();
  const attempt = Number(delivery.attempt_count || 0) + 1;
  await client.query(
    `UPDATE telegram_delivery_outbox SET status = 'sending', attempt_count = $2, lease_token = $3,
       lease_expires_at_utc = now() + interval '30 seconds', updated_at_utc = now()
     WHERE delivery_id = $1`, [delivery.delivery_id, attempt, leaseToken],
  );
  await client.query(
    `INSERT INTO telegram_delivery_attempts (attempt_id, delivery_id, attempt_number, status, metadata)
     VALUES ($1, $2, $3, 'sending', $4::jsonb)`,
    [`telegram_attempt_${randomUUID()}`, delivery.delivery_id, attempt, JSON.stringify({ lease_token: leaseToken })],
  );
  return { ...delivery, attempt_count: attempt, lease_token: leaseToken };
}

async function recordSent({ pool, delivery, messageId }) {
  await transaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE telegram_delivery_outbox SET status = 'sent', telegram_message_id = $2, sent_at_utc = now(),
         lease_token = NULL, lease_expires_at_utc = NULL, last_error = NULL, updated_at_utc = now()
       WHERE delivery_id = $1 AND lease_token = $3 AND status = 'sending'`,
      [delivery.delivery_id, messageId, delivery.lease_token],
    );
    if (updated.rowCount !== 1) throw new Error("TELEGRAM_DELIVERY_LEASE_LOST");
    await client.query(
      `UPDATE telegram_delivery_attempts SET status = 'sent', telegram_message_id = $2, completed_at_utc = now()
       WHERE delivery_id = $1 AND attempt_number = $3`,
      [delivery.delivery_id, messageId, delivery.attempt_count],
    );
    await client.query("UPDATE telegram_source_state SET last_sent_at_utc = now() WHERE source_key = $1", [delivery.source_key]);
  });
}

async function recordSendFailure({ pool, delivery, error }) {
  // Only an explicit, authoritative API rejection can be retried, never a lost HTTP response.
  const uncertain = error?.deliveryUncertain !== false;
  const retryable = !uncertain && error?.retryable === true && delivery.attempt_count < 3;
  const status = uncertain ? "uncertain" : retryable ? "pending" : "failed";
  const code = error?.code || "TELEGRAM_SEND_UNCERTAIN";
  const message = sanitizedDeliveryError(error);
  await transaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE telegram_delivery_outbox SET status = $2::telegram_delivery_status,
         available_at_utc = CASE WHEN $2 = 'pending' THEN now() + ($3 * interval '1 second') ELSE available_at_utc END,
         lease_token = NULL, lease_expires_at_utc = NULL, last_error = $4, updated_at_utc = now()
       WHERE delivery_id = $1 AND lease_token = $5 AND status = 'sending'`,
      [delivery.delivery_id, status, telegramRetryDelaySeconds(error, delivery.attempt_count), message, delivery.lease_token],
    );
    if (updated.rowCount !== 1) throw new Error("TELEGRAM_DELIVERY_LEASE_LOST");
    await client.query(
      `UPDATE telegram_delivery_attempts SET status = $2::telegram_delivery_status,
         error_code = $3, error_message = $4, completed_at_utc = now()
       WHERE delivery_id = $1 AND attempt_number = $5`,
      [delivery.delivery_id, status === "pending" ? "failed" : status, code, message, delivery.attempt_count],
    );
  });
  return { status, deliveryId: delivery.delivery_id, profile: delivery.profile, error: code };
}

function sanitizedDeliveryError(error) {
  return String(error?.message || "Unknown delivery error")
    .replace(/bot[0-9]+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .slice(0, 500);
}
