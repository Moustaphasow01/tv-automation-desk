import { describeSmc3Records } from "./smc3-record-contract.js";
import { publishedNumber } from "./forensic-evidence.js";

/** Read-only projection of frozen records. Never runs validation, fills defaults or rewrites text. */
export function forensicPlanRecords({ text, provenance }) {
  const definitions = describeSmc3Records(), records = [];
  let offset = 0;
  for (const raw of text.split(";")) {
    const values = raw.split("|").map(x => x.trim()), type = values[0], definition = definitions[type];
    if (raw.trim()) records.push({ record_type: type, raw, fields: values,
      decoded: definition ? Object.fromEntries(definition.fields.map(field => [field.name,
        ["price", "integer", "number"].includes(field.type) ? publishedNumber(values[field.index]) : values[field.index]])) : {},
      ...provenance(offset) });
    offset += Buffer.byteLength(raw, "utf8") + 1;
  }
  return records;
}

export function forensicScenarioDefinitions(records) {
  return records.filter(r => r.record_type === "SCN").map(scn => {
    const d = scn.decoded, related = records.filter(r => r.decoded.scenario_id === d.scenario_id);
    const one = type => related.find(r => r.record_type === type)?.decoded ?? null;
    const many = type => related.filter(r => r.record_type === type);
    const group = one("MEMBER");
    return { ...d, direction: d.side, entry_fixed: d.entry, stop_fixed: d.stop,
      entry_zone: one("ENTRY_ZONE"), stop_zone: one("STOP_ZONE"), rearm: one("REARM"),
      group: group ? records.find(r => r.record_type === "GROUP" && r.decoded.group_id === group.group_id)?.decoded : null,
      steps_count: many("STEP").length, invalidations_count: many("INV").length, guards_count: many("GUARD").length,
      dependencies: many("DEP"), cancels: many("CANCEL"), levels: many("LEVEL"), filters: many("FILTER"),
      exit_policy: one("EXIT"), records: related, global_records: records.filter(r => ["PLAN", "NOTICE", "GAP"].includes(r.record_type)
        || r.record_type === "GROUP" && r.decoded.group_id === group?.group_id), provenance: scn };
  });
}
