export function validDecisionAudit(overrides = {}) {
  return {
    contract_name: "DeskDecisionAuditContract",
    schema_version: "1.0.0",
    timezone: "Europe/Paris",
    decision_timestamp_paris: "2026-07-02T10:15:00+02:00",
    data_cutoff_paris: "2026-07-02T10:15:00+02:00",
    available_data_until: "2026-07-02T10:15:00+02:00",
    future_data_used: false,
    entry_sl_tp_frozen: true,
    entry_sl_tp_frozen_at_paris: "2026-07-02T10:15:00+02:00",
    datasets_used: ["MNQ_M5", "macro_calendar"],
    macro_actuals_visible: [
      {
        event: "China Caixin Services PMI",
        importance: "medium",
        scheduled_at_paris: "2026-07-02T03:45:00+02:00",
        published_at_paris: "2026-07-02T03:45:02+02:00",
      },
    ],
    macro_actuals_blocked: [
      {
        event: "US ISM Services PMI",
        importance: "high",
        scheduled_at_paris: "2026-07-02T16:00:00+02:00",
      },
    ],
    source_pack_id: "2026-07-02_asia_open",
    simulation_id: null,
    mission_id: null,
    ...overrides,
  };
}
