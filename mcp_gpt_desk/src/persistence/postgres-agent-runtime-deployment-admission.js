import {
  DEPLOYMENT_PRODUCER_LOCK_KEYS,
  validateDeploymentProducerHold,
} from "./postgres-deployment-producer-admission.js";

export async function acquireAgentRuntimeClaimDeploymentAdmission(client) {
  await client.query(
    "SELECT pg_advisory_xact_lock_shared($1, $2)",
    DEPLOYMENT_PRODUCER_LOCK_KEYS,
  );
  const result = await client.query(
    `SELECT data FROM desk_documents
     WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
     LIMIT 1
     FOR SHARE`,
  );
  if (result.rows.length !== 1) throw admissionError("DEPLOYMENT_PRODUCER_HOLD_MISSING");
  const control = validateDeploymentProducerHold(result.rows[0]?.data);
  return {
    allowed: control.state === "OPEN",
    control_state: control.state,
    deployment_id: control.deployment_id,
  };
}

function admissionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
