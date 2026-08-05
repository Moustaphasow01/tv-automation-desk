#!/usr/bin/env node
import process from "node:process";

import { createDeskStoreFromEnv } from "../src/store.js";

const serviceId = String(process.argv[2] || "").trim();
if (!serviceId) {
  console.error("Usage: node inspect_service_heartbeat.mjs <service_id>");
  process.exitCode = 2;
} else {
  const store = createDeskStoreFromEnv();
  try {
    await store.persistence.initialized;
    const result = await store.persistence.pool.query(
      `SELECT service_id, instance_id, status, details, release_version,
              started_at_utc, heartbeat_at_utc, updated_at_utc
       FROM desk_service_heartbeats
       WHERE service_id = $1
       LIMIT 1`,
      [serviceId],
    );
    console.log(JSON.stringify(result.rows[0] || null, null, 2));
  } finally {
    await store.persistence.close?.();
  }
}
