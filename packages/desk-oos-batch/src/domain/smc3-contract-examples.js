// Synthetic syntax fixtures only. Never submit these as a real OOS session plan.
const header = "PLAN|SMC3|CONTRACT_SYNTAX_ONLY|DEMO|CME_MINI:MES1!|2026-07-30|09:00|09:15";
const branch = (sid, rank) => [`SCN|${sid}|Synthetic syntax only|LONG|${rank}|09:15|20:00|44|4|LIMIT|FIXED|100|-|FIXED|90|2|101|102`,
  `STEP|${sid}|CLOSE_GTE|15|100|-|-|1|1|0`, `INV|${sid}|CLOSE_LT|15|90|-|-|1|1|0`];

export function smc3ContractExamples() {
  const basis = [header, "GROUP|G1|OCO_FILL", ...branch("S1", 1), ...branch("S2", 2)];
  const records = {
    PLAN: header, SCN: basis[2], STEP: basis[3], INV: basis[4],
    GUARD: "GUARD|S1|CLOSE_GTE|60|90|-|-|1|1|0", NOTICE: "NOTICE|CLOSE_GTE|240|100|-|-|1|1|0",
    GROUP: basis[1], MEMBER: "MEMBER|S1|G1", REARM: "REARM|S1|2|90|100|2|2|0",
    ENTRY_ZONE: "ENTRY_ZONE|S1|99|100", STOP_ZONE: "STOP_ZONE|S1|88|89", FILTER: "FILTER|S1|0|0|0|0|0|-",
    EXIT: "EXIT|S1|0.5|BE", LEVEL: "LEVEL|S1|MANAGE|100.25|BE", DEP: "DEP|S2|S1|INVALIDATED",
    CANCEL: "CANCEL|S1|S2|FILLED", OBS: "OBS|S1|100.5", GAP: "GAP|2026-07-30|09:00|2026-07-30|09:15|SYNTHETIC_ONLY",
  };
  return Object.entries(records).map(([record_type, record_text]) => ({ record_type, record_text,
    purpose: "SYNTHETIC_SYNTAX_ONLY_NOT_MARKET_DATA", date: "2026-07-30", symbol: "CME_MINI:MES1!",
    plan_text: [...basis, ...(basis.includes(record_text) ? [] : [record_text])].join(";\r\n") + ";" }));
}
