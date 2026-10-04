import { publishedNumber } from "./forensic-evidence.js";

function positionDuration(cell) {
  const match = /^D\s+(\d+(?:\.\d+)?)m(?:\s|$)/.exec(cell ? cell.text : "");
  return match ? publishedNumber(match[1]) : null;
}

/** Native cell extraction only. No OCR, timestamp arithmetic or recomputed excursion/result. */
export function attachPublishedPositionFacts({ trades, tables, source, fingerprint }) {
  return trades.map(trade => {
    const id = `${trade.scenario_id}#${trade.attempt}`;
    const tableIndex = tables.findIndex(t => t.cells.some(c => c.column === 0 && c.row >= 3 && c.text === id));
    if (tableIndex < 0) return trade;
    const table = tables[tableIndex], row = table.cells.find(c => c.column === 0 && c.text === id).row;
    const cells = table.cells.map((cell, index) => ({ ...cell, index })).filter(c => c.row === row).map(cell => {
      const pointer = `/published_position_tables/${tableIndex}/cells/${cell.index}`;
      return { ...cell, provenance: { ...source, record_offset: pointer, record_offset_kind: "JSON_POINTER",
        source_json_pointer: pointer, provenance_ref: fingerprint(`${source.source_path}|${source.source_sha256}|${pointer}`) } };
    });
    const detail = cells.find(c => c.column === 5), duration = positionDuration(detail);
    return { ...trade, duration, duration_unit: "minutes", duration_provenance: detail ? detail.provenance : null,
      position_snapshot: { table_id: table.id, row, cells, classification: "FACT_ENGINE" },
      missing_fields: trade.missing_fields.filter(f => f.field !== "duration" || duration === null) };
  });
}
