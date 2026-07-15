export const DOMAIN_STATUSES = Object.freeze({
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  REVIEW_REQUIRED: "review_required",
});

export function domainResult({ status, reasons = [], flags = [], evidence = {} } = {}) {
  if (!Object.values(DOMAIN_STATUSES).includes(status)) {
    throw new TypeError(`unknown_domain_status:${status}`);
  }
  return {
    ok: status === DOMAIN_STATUSES.ACCEPTED,
    status,
    reasons: uniqueStrings(reasons),
    flags: uniqueStrings(flags),
    evidence: evidence && typeof evidence === "object" ? evidence : {},
  };
}

export function accepted(options = {}) {
  return domainResult({
    status: DOMAIN_STATUSES.ACCEPTED,
    reasons: options.reasons,
    flags: options.flags,
    evidence: options.evidence,
  });
}

export function rejected(reason, options = {}) {
  return domainResult({
    status: DOMAIN_STATUSES.REJECTED,
    reasons: [reason, ...(options.reasons || [])],
    flags: options.flags,
    evidence: options.evidence,
  });
}

export function reviewRequired(reason, options = {}) {
  return domainResult({
    status: DOMAIN_STATUSES.REVIEW_REQUIRED,
    reasons: [reason, ...(options.reasons || [])],
    flags: options.flags,
    evidence: options.evidence,
  });
}

export function resultFromIssues({ rejectReasons = [], reviewReasons = [], flags = [], evidence = {} } = {}) {
  if (rejectReasons.length > 0) {
    return domainResult({
      status: DOMAIN_STATUSES.REJECTED,
      reasons: rejectReasons,
      flags,
      evidence,
    });
  }
  if (reviewReasons.length > 0) {
    return domainResult({
      status: DOMAIN_STATUSES.REVIEW_REQUIRED,
      reasons: reviewReasons,
      flags,
      evidence,
    });
  }
  return accepted({ flags, evidence });
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
