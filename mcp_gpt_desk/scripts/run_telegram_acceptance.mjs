#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createDeskStoreFromEnv } from "../src/store.js";

const store = createDeskStoreFromEnv();
try {
  const before = await store.telegram.getStatus();
  if (!before.environment.workerEnabled) throw new Error("TELEGRAM_ENVIRONMENT_DISABLED");
  if (!before.environment.adminConfigured || !before.environment.tradingConfigured) {
    throw new Error("TELEGRAM_BOT_SECRETS_INCOMPLETE");
  }
  if (!before.config.baselineCompletedAt) throw new Error("TELEGRAM_BASELINE_NOT_COMPLETED");
  if (!before.bots.admin.username || !before.bots.trading.username) throw new Error("TELEGRAM_BOT_IDENTITY_NOT_VERIFIED");

  const configured = await store.telegram.executeAction({
    action: "configure",
    expectedRevision: before.config.revision,
    enabled: true,
    adminEnabled: true,
    tradingEnabled: true,
    commandsEnabled: true,
  }, { id: "deployment_acceptance" });

  const nonce = `${Date.now()}-${randomUUID()}`;
  const admin = await store.telegram.executeAction({
    action: "test",
    profile: "admin",
    idempotencyKey: `telegram-admin-${nonce}`,
    reason: "Validation post-déploiement",
  }, { id: "deployment_acceptance" });
  const trading = await store.telegram.executeAction({
    action: "test",
    profile: "trading",
    idempotencyKey: `telegram-trading-${nonce}`,
    reason: "Validation post-déploiement",
  }, { id: "deployment_acceptance" });
  const ids = [admin.delivery?.deliveryId, trading.delivery?.deliveryId].filter(Boolean);
  if (ids.length !== 2) throw new Error("TELEGRAM_TEST_DELIVERIES_NOT_QUEUED");

  const deadline = Date.now() + 45_000;
  let rows = [];
  while (Date.now() < deadline) {
    const result = await store.persistence.pool.query(
      `SELECT delivery_id, profile::text, status::text, telegram_message_id, last_error
       FROM telegram_delivery_outbox
       WHERE delivery_id = ANY($1::text[])
       ORDER BY profile`,
      [ids],
    );
    rows = result.rows;
    if (rows.length === 2 && rows.every((row) => row.status === "sent")) break;
    if (rows.some((row) => ["failed", "uncertain"].includes(row.status))) break;
    await delay(1000);
  }
  if (rows.length !== 2 || rows.some((row) => row.status !== "sent")) {
    throw new Error(`TELEGRAM_ACCEPTANCE_NOT_SENT:${rows.map((row) => `${row.profile}:${row.status}`).join(",")}`);
  }
  console.log(JSON.stringify({
    ok: true,
    configRevision: configured.config.revision,
    adminBot: `@${before.bots.admin.username}`,
    tradingBot: `@${before.bots.trading.username}`,
    deliveries: rows.map((row) => ({
      profile: row.profile,
      status: row.status,
      telegramMessageId: String(row.telegram_message_id),
    })),
  }));
} finally {
  await store.persistence.close?.();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
