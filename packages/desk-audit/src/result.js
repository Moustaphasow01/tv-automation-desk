export const DOMAIN_STATUSES = Object.freeze({
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  REVIEW_REQUIRED: "review_required",
});

export function accepted(options = {}) {
  return domainResult({ ...options, status: DOMAIN_STATUSES.ACCEPTED });
}

export function rejected(reason, options = {}) {
  return domainResult({
    ...options,
    status: DOMAIN_STATUSES.REJECTED,
    reasons: [reason, ...(options.reasons || [])],
  });
}

export function reviewRequired(reason, options = {}) {
  return domainResult({
    ...options,
    status: DOMAIN_STATUSES.REVIEW_REQUIRED,
    reasons: [reason, ...(options.reasons || [])],
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

export function domainResult({
  status = DOMAIN_STATUSES.ACCEPTED,
  reasons = [],
  flags = [],
  evidence = {},
} = {}) {
  return {
    ok: status === DOMAIN_STATUSES.ACCEPTED,
    status,
    reasons,
    flags,
    evidence,
  };
}
