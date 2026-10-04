import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../src/adapter/artifact-archive.js";
import { normalizeForensicEvents } from "../src/domain/forensic-events.js";
import { forensicPlanRecords, forensicScenarioDefinitions } from "../src/domain/forensic-plan.js";
import { forensicEpisodes, conditionTimeline, ticketSnapshot } from "../src/domain/forensic-episodes.js";
import { publishedTradeAudit, forensicTrades } from "../src/domain/forensic-trades.js";
import { forensicPage } from "../src/domain/forensic-evidence.js";
import { attachPublishedPositionFacts } from "../src/domain/forensic-panel-facts.js";

const identity = { date: "2026-07-02", plan_sha256: "a".repeat(64) };
const audit = "A395/T1/Rn/Rp=1.5/2/USD=75/C/O/F/M/X=1782982800000/1782983700000/1782984600000/1782985500000/1782986400000/E/S/T1/T2=7500/7495/7510/7515/MFEp/n=2.5/2.1/MAEp/n=0.3/0.4/TTM/MX=15/15/GBp/n=0.5/0.6/BE=0.4/0.6/0.8/P1=1.2";
function line(event, detail, attempt = 1) {
  const fields = ["SMC_AUDIT", "3.9.8", "TEST", "123", "456", "REPLAY", "PORTEFEUILLE_REALISTE",
    "1782986400000", "1782984600000", "1782986400000", "MES", "S1", attempt, event, event, "", 7500, 7495,
    7510, 7515, 1, 2, 1, 10, 2, 1.5, 5, 5, 7495, 7490, 7510, 7498, 7502, "NATIVE", detail];
  return JSON.stringify({ barTime: 1782985500000, message: fields.join("|") });
}
function normalized(lines) {
  return normalizeForensicEvents({ text: lines.join("\n"), identity, fingerprint: sha256,
    provenance: (offset, hash) => ({ ...identity, record_offset: offset, source_event_hash: hash, provenance_ref: sha256(String(offset)) }) });
}

test("duplicate publications preserve raw offsets but not extra attempts/fills", () => {
  const raw = line("FILLED", "trade=T1 prix=7500 q=1 risqueUSD=25 O/H/L/C=7499/7502/7498/7501");
  const events = normalized([raw, raw, line("REARMED", "fresh", 2)]);
  assert.equal(events.length, 2); assert.equal(events[0].duplicate_count, 1);
  assert.equal(events[0].source_offsets.length, 2); assert.equal(events[0].OHLC.C, 7501);
  assert.notEqual(events[0].episode_id, events[1].episode_id);
  assert.equal(events[0].source_event_hash, sha256(raw));
});
test("A395 values come from ENGINE labels, no computed financial result", () => {
  const parsed = publishedTradeAudit(audit);
  assert.equal(parsed.native_trade_id, "T1"); assert.equal(parsed.real_R, 1.5); assert.equal(parsed.real_USD, 75);
  assert.equal(parsed.mfe_rp, 2.5); assert.equal(parsed.cf_BE_1_5, 0.8); assert.equal(parsed.cf_P1_at_1R, 1.2);
  const events = normalized([line("FILLED", "trade=T1 prix=7500 q=1 risqueUSD=25"), line("TRADE_EXIT", audit)]);
  const trades = forensicTrades({ events, identity, scenarios: [{ scenario_id: "S1", direction: "LONG" }], fingerprint: sha256 });
  assert.equal(trades.length, 1); assert.equal(trades[0].recalculated, false); assert.equal(trades[0].real_USD, 75);
  assert.equal(trades[0].missing_fields.find(f => f.field === "mfe_price").reason, "NOT_PERSISTED");
});
test("frozen record order/text preserved and no default/analytical rule added", () => {
  const raw = "PLAN|SMC3|TEST|SESSION|CME_MINI:MES1!|2026-07-02|09:00|09:00;";
  const scenarios = Array.from({ length: 8 }, (_, i) => `SCN|S${i + 1}|NAME|LONG|${i + 1}|09:00|20:00|44|4|LIMIT|FIXED|7500|-|FIXED|7495|2|7510|7515;`).join("");
  const records = forensicPlanRecords({ text: raw + scenarios, provenance: offset => ({ record_offset: offset, provenance_ref: sha256(String(offset)) }) });
  assert.equal(forensicScenarioDefinitions(records).length, 8); assert.equal(records[0].raw + ";", raw);
  assert.equal(records[1].decoded.entry, 7500); assert.equal(records.at(-1).decoded.scenario_id, "S8");
});
test("native trade IDs contain plan names, spaces and slash separators; N/D does not shift CF values", () => {
  const native = "Plan avec espaces/S1/1";
  const detail = audit.replace("A395/T1/", `A395/${native}/`).replace("BE=0.4/0.6/0.8", "BE=N/D/0.6/0.8")
    + " O/H/L/C=7500/7515/7495/7510";
  const events = normalized([line("FILLED", `trade=${native} prix=7500 q=1 risqueUSD=25`), line("TRADE_EXIT", detail)]);
  const trade = forensicTrades({ events, identity, scenarios: [], fingerprint: sha256 })[0];
  assert.equal(trade.native_trade_id, native); assert.equal(trade.real_R, 1.5);
  assert.equal(trade.cf_BE_0_5, null); assert.equal(trade.cf_BE_1, 0.6); assert.equal(trade.cf_BE_1_5, 0.8);
  assert.equal(trade.cf_P1_at_1R, 1.2); assert.ok(trade.exit_event_id);
  const damaged = normalized([line("FILLED", `t ade=${native} p ix=7500 q=1  isqueUSD=25`), line("TRADE_EXIT", detail)]);
  const observed = forensicTrades({ events: damaged, identity, scenarios: [], fingerprint: sha256 })[0];
  assert.equal(observed.real_R, 1.5); assert.equal(observed.risk_usd, 25); assert.equal(observed.native_trade_id, native);
  assert.match(damaged[0].detail, /t ade=/); // No repair of the ENGINE publication.
});
test("condition timeline distinguishes published hits from unknown evaluations", () => {
  const events = normalized([line("STEP_1", "15m TOUCH_ZONE"), line("CONFIRMED", "confirmed")]);
  const episodes = forensicEpisodes({ events, scenarios: [{ scenario_id: "S1" }] });
  const scenario = { records: [{ record_type: "STEP", decoded: { operator: "TOUCH_ZONE" }, raw: "STEP|S1|...", provenance_ref: "step" }] };
  const timeline = conditionTimeline({ scenario, episode: episodes[0], events });
  assert.equal(timeline[0].hits.length, 1); assert.equal(timeline[0].first_evaluated_at.reason, "NOT_PERSISTED");
  assert.equal(ticketSnapshot(events).admitted, null); assert.equal(ticketSnapshot([]).available, false);
});
test("bounded cursors bind immutable generation and exact filter; no oversized pages", () => {
  const args = { items: [1,2,3], query: { limit: 1 }, indexHash: "A", fingerprint: sha256 };
  const first = forensicPage(args); assert.equal(first.total, 3);
  assert.deepEqual(forensicPage({ ...args, query: { limit: 1, cursor: first.next_cursor } }).items, [2]);
  assert.throws(() => forensicPage({ ...args, indexHash: "B", query: { cursor: first.next_cursor } }), /FORENSIC_CURSOR_CONFLICT/);
  assert.throws(() => forensicPage({ ...args, query: { limit: 100000 } }), /FORENSIC_PAGE_LIMIT_INVALID/);
});
test("duration comes from its native POSITION cell, never sum/difference of time markers", () => {
  const trades = [{ scenario_id: "S1", attempt: 1, missing_fields: [{ field: "duration" }] }];
  const tables = [{ id: 7, cells: [{ row: 3, column: 0, text: "S1#1" },
    { row: 3, column: 5, text: "D 69m MFEp/n 3/2" }] }];
  const result = attachPublishedPositionFacts({ trades, tables, source: { source_path: "replay/audit.json", source_sha256: "a" }, fingerprint: sha256 });
  assert.equal(result[0].duration, 69); assert.equal(result[0].missing_fields.length, 0);
  assert.equal(result[0].duration_provenance.source_json_pointer, "/published_position_tables/0/cells/1");
});
