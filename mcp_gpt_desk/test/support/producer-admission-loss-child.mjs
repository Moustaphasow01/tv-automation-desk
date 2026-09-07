import pg from "pg";
import {
  createDeploymentProducerClient,
  runWithDeploymentProducerAdmission,
} from "../../src/persistence/postgres-deployment-producer-admission.js";

const admissionClient = createDeploymentProducerClient({
  connectionString: process.env.DATABASE_URL,
  applicationName: "producer-admission-loss-test",
});
const workPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: "desk-grains-calendar-refresh",
});

await runWithDeploymentProducerAdmission(admissionClient, async () => {
  await workPool.query(
    `UPDATE desk_documents SET data = jsonb_build_object('changed', true)
     WHERE collection = 'producer_admission_test' AND document_id = 'blocked_write'`,
  );
});
await workPool.end();
