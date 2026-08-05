#!/usr/bin/env node
import process from "node:process";

import { createDeskStoreFromEnv } from "../src/store.js";
import { verifyV5June11R2Import } from "../src/v5-june11-r2-evidence.js";

const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const evidence = await verifyV5June11R2Import(store.persistence.pool);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: "V5_JUNE11_R2_IMPORT_VERIFIED",
    trading_date: evidence.trading_date,
    import_id: evidence.import_id,
    manifest_sha256: evidence.manifest_sha256,
    capture_proof_sha256: evidence.capture_proof_sha256,
    capture_policy_version: evidence.capture_policy_version,
    evidence_sha256: evidence.evidence_sha256,
    total_m1_rows: evidence.total_m1_rows,
    expected_complete_m5_buckets: evidence.expected_complete_m5_buckets,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    status: "V5_JUNE11_R2_IMPORT_NOT_VERIFIED",
    error: {
      code: error?.code || "V5_JUNE11_R2_VERIFY_FAILED",
      message: error?.message || String(error),
      details: error?.details || {},
    },
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await store.persistence.close?.();
}
