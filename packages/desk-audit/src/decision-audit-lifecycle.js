import { evaluateAntiLookahead } from "./anti-lookahead-guard.js";
import { DOMAIN_STATUSES, accepted, domainResult, rejected } from "./result.js";

const FINAL_AUDIT_STATUSES = new Set(["valid", "failed", "manual_review"]);
const LIFECYCLE_FIELDS = new Set([
  "audit_validation",
  "content_hash",
  "correction_required_for_changes",
  "finalized",
  "finalized_at_utc",
  "finalized_by",
  "immutable",
  "lifecycle_status",
  "mutation_policy",
  "status",
]);

export function finalizeDecisionAudit(decisionAudit = {}, options = {}) {
  if (!isRecord(decisionAudit)) {
    return withAudit(rejected("missing_decision_audit", { flags: ["DECISION_AUDIT_MISSING"] }), null);
  }

  const validation = evaluateAntiLookahead({ decisionAudit });
  const auditStatus = auditStatusFromDomainStatus(validation.status);
  const finalized = cleanRecord({
    ...decisionAudit,
    contract_name: decisionAudit.contract_name || "DeskDecisionAuditContract",
    schema_version: decisionAudit.schema_version || "decision_audit_v2",
    audit_id: stringValue(decisionAudit.audit_id || options.audit_id) || null,
    status: auditStatus,
    lifecycle_status: auditStatus,
    finalized: true,
    immutable: true,
    mutation_policy: "immutable_after_validation",
    correction_required_for_changes: true,
    finalized_at_utc: stringValue(options.finalized_at_utc || decisionAudit.finalized_at_utc) || null,
    finalized_by: stringValue(options.finalized_by || decisionAudit.finalized_by) || null,
    audit_validation: {
      status: validation.status,
      ok: validation.ok,
      reasons: validation.reasons,
      flags: validation.flags,
      evidence: validation.evidence,
    },
  });
  finalized.content_hash = decisionAudit.content_hash || decisionAuditContentHash(finalized);

  return withAudit(
    domainResult({
      status: validation.status,
      reasons: validation.reasons,
      flags: validation.flags,
      evidence: {
        ...validation.evidence,
        audit_id: finalized.audit_id,
        audit_status: finalized.status,
        content_hash: finalized.content_hash,
        immutable: true,
      },
    }),
    finalized
  );
}

export function assertDecisionAuditWritable(existingAudit, candidateAudit = {}, options = {}) {
  if (!isRecord(existingAudit)) {
    return accepted({ evidence: { writable: true, reason: "new_audit" } });
  }

  if (!isDecisionAuditFinalized(existingAudit)) {
    return accepted({ evidence: { writable: true, reason: "audit_not_finalized" } });
  }

  if (sameAuditContent(existingAudit, candidateAudit)) {
    return accepted({
      flags: ["DECISION_AUDIT_IDEMPOTENT_WRITE"],
      evidence: { writable: true, reason: "idempotent_write", audit_id: auditId(existingAudit) },
    });
  }

  if (options.allowDocumentedMigration === true || options.allow_documented_migration === true) {
    const migrationId = stringValue(options.migration_id);
    const approvedBy = stringValue(options.approved_by);
    const reason = stringValue(options.reason);
    if (migrationId && approvedBy && reason) {
      return accepted({
        flags: ["DECISION_AUDIT_DOCUMENTED_MIGRATION"],
        evidence: { writable: true, reason, migration_id: migrationId, approved_by: approvedBy },
      });
    }
    return rejected("decision_audit_migration_documentation_required", {
      flags: ["DECISION_AUDIT_IMMUTABLE"],
      evidence: { audit_id: auditId(existingAudit), immutable: true },
    });
  }

  return rejected("decision_audit_immutable", {
    flags: ["DECISION_AUDIT_IMMUTABLE"],
    evidence: {
      audit_id: auditId(existingAudit),
      immutable: true,
      existing_content_hash: existingAudit.content_hash || decisionAuditContentHash(existingAudit),
      attempted_content_hash: decisionAuditContentHash(mergedAudit(existingAudit, candidateAudit)),
    },
  });
}

export function createDecisionAuditCorrection(existingAudit = {}, correction = {}, options = {}) {
  if (!isRecord(existingAudit)) {
    return withCorrection(rejected("original_decision_audit_required"), null);
  }
  if (!isDecisionAuditFinalized(existingAudit)) {
    return withCorrection(rejected("original_decision_audit_not_finalized"), null);
  }

  const patch = correctionPatch(correction);
  const correctionReason = stringValue(correction.correction_reason || options.correction_reason || patch.correction_reason);
  const correctedBy = stringValue(correction.corrected_by || options.corrected_by || patch.corrected_by);
  const correctedAtUtc = stringValue(correction.corrected_at_utc || options.corrected_at_utc || patch.corrected_at_utc);
  const correctionAuditId = stringValue(correction.correction_audit_id || options.correction_audit_id || patch.audit_id);
  const correctionId = stringValue(correction.correction_id || options.correction_id || correctionAuditId);
  const missing = [];
  if (!correctionReason) missing.push("correction_reason_required");
  if (!correctedBy) missing.push("corrected_by_required");
  if (!correctedAtUtc) missing.push("corrected_at_utc_required");
  if (!correctionAuditId) missing.push("correction_audit_id_required");
  if (!correctionId) missing.push("correction_id_required");
  if (missing.length > 0) {
    return withCorrection(domainResult({
      status: DOMAIN_STATUSES.REJECTED,
      reasons: missing,
      flags: ["DECISION_AUDIT_CORRECTION_INCOMPLETE"],
      evidence: { original_audit_id: auditId(existingAudit) },
    }), null);
  }

  const originalAuditId = auditId(existingAudit);
  const correctedAuditInput = cleanRecord({
    ...auditPayload(existingAudit),
    ...patch,
    audit_id: correctionAuditId,
    original_audit_id: originalAuditId,
    correction_of_audit_id: originalAuditId,
    correction_reason: correctionReason,
    corrected_by: correctedBy,
    corrected_at_utc: correctedAtUtc,
  });
  const finalized = finalizeDecisionAudit(correctedAuditInput, {
    audit_id: correctionAuditId,
    finalized_at_utc: correctedAtUtc,
    finalized_by: correctedBy,
  });
  if (!finalized.ok) {
    return withCorrection(domainResult({
      status: DOMAIN_STATUSES.REJECTED,
      reasons: ["decision_audit_correction_invalid", ...finalized.reasons],
      flags: finalized.flags,
      evidence: finalized.evidence,
    }), null);
  }

  const correctionRecord = {
    schema_version: "decision_audit_correction_v1",
    correction_id: correctionId,
    correction_audit_id: correctionAuditId,
    original_audit_id: originalAuditId,
    original_content_hash: existingAudit.content_hash || decisionAuditContentHash(existingAudit),
    corrected_content_hash: finalized.audit.content_hash,
    correction_reason: correctionReason,
    corrected_by: correctedBy,
    corrected_at_utc: correctedAtUtc,
    status: "valid",
    finalized: true,
    immutable: true,
    mutation_policy: "append_only_correction",
    original_audit_snapshot: clonePlain(existingAudit),
    corrected_decision_audit: finalized.audit,
    changed_fields: changedFields(auditPayload(existingAudit), patch),
  };

  return withCorrection(accepted({
    flags: ["DECISION_AUDIT_CORRECTION_RECORDED"],
    evidence: {
      correction_id: correctionId,
      correction_audit_id: correctionAuditId,
      original_audit_id: originalAuditId,
      corrected_content_hash: finalized.audit.content_hash,
      changed_fields: correctionRecord.changed_fields,
    },
  }), correctionRecord);
}

export function isDecisionAuditFinalized(audit = {}) {
  if (!isRecord(audit)) return false;
  return audit.finalized === true
    || audit.immutable === true
    || FINAL_AUDIT_STATUSES.has(String(audit.status || audit.lifecycle_status || "").toLowerCase());
}

export function decisionAuditContentHash(audit = {}) {
  return `audit_${fnv1a(stableSerialize(withoutContentHash(audit)))}`;
}

function withAudit(result, audit) {
  return { ...result, audit, record: audit };
}

function withCorrection(result, correction) {
  return { ...result, correction, record: correction };
}

function auditStatusFromDomainStatus(status) {
  if (status === DOMAIN_STATUSES.ACCEPTED) return "valid";
  if (status === DOMAIN_STATUSES.REVIEW_REQUIRED) return "manual_review";
  return "failed";
}

function sameAuditContent(existingAudit, candidateAudit) {
  return decisionAuditContentHash(auditPayload(existingAudit)) === decisionAuditContentHash(auditPayload(mergedAudit(existingAudit, candidateAudit)));
}

function mergedAudit(existingAudit, candidateAudit) {
  if (!isRecord(candidateAudit)) return existingAudit;
  return { ...existingAudit, ...candidateAudit };
}

function auditPayload(audit) {
  const payload = {};
  if (!isRecord(audit)) return payload;
  for (const [key, value] of Object.entries(audit)) {
    if (!LIFECYCLE_FIELDS.has(key)) payload[key] = value;
  }
  return cleanRecord(payload);
}

function correctionPatch(correction) {
  if (!isRecord(correction)) return {};
  if (isRecord(correction.patch)) return correction.patch;
  if (isRecord(correction.corrected_audit)) return correction.corrected_audit;
  return correction;
}

function changedFields(base, patch) {
  return Object.keys(patch)
    .filter((key) => !["correction_id", "correction_audit_id", "correction_reason", "corrected_by", "corrected_at_utc"].includes(key))
    .filter((key) => stableSerialize(base[key]) !== stableSerialize(patch[key]))
    .sort();
}

function withoutContentHash(value) {
  if (Array.isArray(value)) return value.map(withoutContentHash);
  if (!isRecord(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "content_hash") out[key] = withoutContentHash(item);
  }
  return out;
}

function cleanRecord(value) {
  if (Array.isArray(value)) return value.map(cleanRecord);
  if (!isRecord(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = cleanRecord(item);
  }
  return out;
}

function stableSerialize(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  if (typeof value === "string" && value.trim() !== "") return value;
  return null;
}

function auditId(audit) {
  return stringValue(audit.audit_id || audit.decision_audit_id || audit.id);
}
