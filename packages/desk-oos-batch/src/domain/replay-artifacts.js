import { requireFact } from "./batch-contract.js";

export const REPLAY_IMAGES = Object.freeze(["dashboard_final.png", "5m_final.png", "15m_final.png"]);
export function requiredReplayArtifacts(meta) {
  return [...REPLAY_IMAGES.map(name => `replay/${name}`), "replay/audit.json", "replay/run_meta.json",
    ...(meta.positions_distinct === true ? ["replay/positions_final.png"] : []),
    ...(meta.logs_accessible === true ? ["replay/logs.txt"] : [])];
}

export function validatePublishedResult(result, expected) {
  for (const key of ["plan_sha256", "symbol", "at", "engine_version", "book_mode"]) {
    requireFact(result[key] === expected[key], "RESULT_SCOPE_MISMATCH");
  }
  requireFact(result.audit && typeof result.audit === "object" && !Array.isArray(result.audit), "AUDIT_REQUIRED");
  requireFact(typeof result.positions_distinct === "boolean" && typeof result.logs_accessible === "boolean", "RESULT_CAPABILITIES_REQUIRED");
  requireFact(!result.logs_accessible || typeof result.logs === "string", "PINE_LOGS_REQUIRED");
  validateAuditPresentation(result.capture_provenance?.["dashboard_final.png"]?.presentation);
  validateResultCaptures(result, expected);
}

function validateResultCaptures(result, expected) {
  const names = [...REPLAY_IMAGES, ...(result.positions_distinct ? ["positions_final.png"] : [])];
  for (const name of names) {
    const capture = result.capture_provenance?.[name];
    requireFact(capture?.at === expected.at && capture.symbol === expected.symbol && capture.plan_sha256 === expected.plan_sha256
      && Number.isFinite(Date.parse(capture.captured_at)) && typeof capture.source === "string", "RESULT_PROVENANCE_REQUIRED");
    if (name === "5m_final.png" || name === "15m_final.png") requireFact(capture.timeframe === name.split("_")[0], "RESULT_TIMEFRAME_MISMATCH");
  }
}

export function validateAuditPresentation(panel) {
  requireFact(panel?.dedicated_panel === true && panel.maximized === true && panel.complete_table === true
    && panel.view === "AUTO" && panel.title === "AUDIT FIN SESSION" && panel.pane_index > 0
    && panel.bounds?.height >= 900 && panel.minimum_font_size >= 12, "DEDICATED_AUDIT_REQUIRED");
}

export function validateArtifactList(artifacts, meta) {
  requireFact(Array.isArray(artifacts) && artifacts.length > 0, "RESULT_ARTIFACTS_REQUIRED");
  const paths = new Set();
  for (const file of artifacts) {
    requireFact(/^replay\/[A-Za-z0-9_.-]+$/.test(file.path) && !paths.has(file.path)
      && /^[a-f0-9]{64}$/.test(file.sha256), "RESULT_ARTIFACT_INVALID");
    paths.add(file.path);
  }
  for (const name of requiredReplayArtifacts(meta)) requireFact(paths.has(name), "RESULT_ARTIFACT_MISSING", { name });
}
