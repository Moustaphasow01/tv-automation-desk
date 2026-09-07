export const GRAINS_CALENDAR_POLICY_V1 = "GRAINS_CALENDAR_SOURCE_POLICY_V1_USDA_DIRECT";
export const GRAINS_CALENDAR_POLICY_V2 = "GRAINS_CALENDAR_SOURCE_POLICY_V2_DORMAN_FAS403";

export const NASS_CALENDAR_SOURCE_ID = "usda_nass_release_calendar";
export const WASDE_CALENDAR_SOURCE_ID = "usda_wasde_release_schedule";
export const FAS_CALENDAR_SOURCE_ID = "usda_fas_export_sales_schedule";
export const DORMAN_CALENDAR_SOURCE_ID = "dorman_export_sales_schedule";

const POLICIES = Object.freeze({
  [GRAINS_CALENDAR_POLICY_V1]: Object.freeze({
    policyId: GRAINS_CALENDAR_POLICY_V1,
    exportSalesSourceIds: Object.freeze([FAS_CALENDAR_SOURCE_ID]),
    allowsDormanFas403Fallback: false,
  }),
  [GRAINS_CALENDAR_POLICY_V2]: Object.freeze({
    policyId: GRAINS_CALENDAR_POLICY_V2,
    exportSalesSourceIds: Object.freeze([
      FAS_CALENDAR_SOURCE_ID,
      DORMAN_CALENDAR_SOURCE_ID,
    ]),
    allowsDormanFas403Fallback: true,
  }),
});

export function grainsCalendarSourcePolicy(policyId = GRAINS_CALENDAR_POLICY_V1) {
  return POLICIES[policyId] || null;
}

export function requireGrainsCalendarSourcePolicy(policyId = GRAINS_CALENDAR_POLICY_V1) {
  const policy = grainsCalendarSourcePolicy(policyId);
  if (!policy) throw new Error("CALENDAR_SOURCE_POLICY_UNSUPPORTED");
  return policy;
}

export function requiredCalendarSourceGroups(policyId = GRAINS_CALENDAR_POLICY_V1) {
  const policy = grainsCalendarSourcePolicy(policyId);
  if (!policy) return [];
  return Object.freeze([
    Object.freeze({ role: "NASS_SCHEDULE", sourceIds: Object.freeze([NASS_CALENDAR_SOURCE_ID]) }),
    Object.freeze({ role: "WASDE_SCHEDULE", sourceIds: Object.freeze([WASDE_CALENDAR_SOURCE_ID]) }),
    Object.freeze({ role: "EXPORT_SALES_SCHEDULE", sourceIds: policy.exportSalesSourceIds }),
  ]);
}

export function isKnownCalendarSource(policyId, sourceId) {
  return requiredCalendarSourceGroups(policyId)
    .some((group) => group.sourceIds.includes(sourceId));
}
