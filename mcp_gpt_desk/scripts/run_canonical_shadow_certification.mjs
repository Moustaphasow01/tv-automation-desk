#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";
import { CanonicalShadowCertificationService } from "../src/canonical-shadow-certification-service.js";

const store = createDeskStoreFromEnv();
try {
  await store.persistence.initialized;
  const service = new CanonicalShadowCertificationService({ store });
  const result = await service.run({
    certification_run_id: process.env.DESK_CERTIFICATION_RUN_ID || undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await store.persistence.close?.();
}
