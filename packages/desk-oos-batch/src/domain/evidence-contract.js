import { requireFact, VIEWS } from "./batch-contract.js";

export function validateCapture(capture, expected) {
  requireFact(capture?.symbol === expected.symbol && capture.timeframe === expected.timeframe
    && capture.view === expected.view && capture.date === expected.date, "CAPTURE_SCOPE_MISMATCH");
  requireFact(capture.replay === true && capture.cutoff === expected.cutoff, "CAPTURE_CUTOFF_MISMATCH");
  requireFact(Number.isFinite(Date.parse(capture.visible_as_of))
    && Date.parse(capture.visible_as_of) <= Date.parse(expected.cutoff), "CAPTURE_LOOKAHEAD");
  requireFact(Number.isFinite(Date.parse(capture.captured_at)), "CAPTURE_TIMESTAMP_INVALID");
  requireFact(typeof capture.source === "string" && capture.source.length > 0, "CAPTURE_SOURCE_REQUIRED");
  requireFact(typeof capture.image_base64 === "string", "CAPTURE_PIXELS_REQUIRED");
}

export function validateManifest(manifest, day) {
  requireFact(manifest.status === "PREMARKET_READY" && manifest.date === day.date
    && manifest.symbol === day.symbol && manifest.cutoff === day.cutoff
    && manifest.timezone === day.timezone, "MANIFEST_SCOPE_MISMATCH");
  requireFact(manifest.captures.length === 8, "CAPTURE_COUNT_INVALID");
  const names = new Set();
  for (const capture of manifest.captures) {
    const view = VIEWS.find(item => item.timeframe === capture.timeframe && item.view === capture.view);
    requireFact(view && capture.path === view.name && !names.has(capture.path), "CAPTURE_PATH_INVALID");
    requireFact(/^[a-f0-9]{64}$/.test(capture.sha256), "CAPTURE_HASH_INVALID");
    requireFact(Number.isFinite(Date.parse(capture.visible_as_of))
      && Date.parse(capture.visible_as_of) <= Date.parse(day.cutoff), "MANIFEST_LOOKAHEAD");
    names.add(capture.path);
  }
}

export function validateSyntaxReceipt(receipt, expected) {
  requireFact(receipt?.syntax_valid === true && receipt.validation_scope === "SYNTAX_ONLY", "PLAN_SYNTAX_INVALID");
  for (const field of ["date", "symbol", "schema", "engine_version", "plan_sha256"]) {
    requireFact(receipt[field] === expected[field], "PLAN_IDENTITY_MISMATCH", { field });
  }
}

export function verifyFrozen({ meta, planHash, manifestHash, day }) {
  requireFact(meta?.status === "FROZEN", "PLAN_NOT_FROZEN");
  requireFact(meta.plan_sha256 === planHash && meta.premarket_manifest_sha256 === manifestHash, "FROZEN_HASH_MISMATCH");
  for (const field of ["date", "symbol", "schema", "engine_version", "cutoff", "book_mode"]) {
    requireFact(meta[field] === day[field], "FROZEN_SCOPE_MISMATCH", { field });
  }
  requireFact(Number.isFinite(Date.parse(meta.frozen_at)), "FREEZE_TIMESTAMP_INVALID");
}
