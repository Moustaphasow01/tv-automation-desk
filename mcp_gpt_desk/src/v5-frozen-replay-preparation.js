const REPAIRABLE_PREPARATION_ERROR_CODES = new Set([
  "LOCAL_PACK_CORE_DATASET_MISSING",
]);

export async function resumeV5FrozenPreparationAfterRepair(store, job, {
  actor = { kind: "release", uid: "v5-frozen-release" },
} = {}) {
  if (job?.status !== "FAILED") return job;

  const errorCode = String(job.error?.code || "");
  if (!REPAIRABLE_PREPARATION_ERROR_CODES.has(errorCode)) {
    throw new Error(`V5_REPLAY_PREPARATION_FAILED:${errorCode || "unknown"}`);
  }

  const retried = await store.executeReplayPreparationAction({
    preparation_id: job.preparation_id,
    action: "retry",
    expected_error_code: errorCode,
    reason: "frozen_release_retry_after_local_dataset_repair",
    actor,
  });
  if (retried.status !== "QUEUED") {
    throw new Error(`V5_REPLAY_PREPARATION_RETRY_FAILED:${retried.status || "unknown"}`);
  }
  return retried.job;
}
