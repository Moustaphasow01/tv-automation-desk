import { requireFact } from "./batch-contract.js";

export const absentEvidence = (field = undefined) => ({ available: false, reason: "NOT_PERSISTED", ...(field ? { field } : {}) });
export const publishedNumber = value => value !== "" && value !== "-" && value !== "N/D" && /^-?\d+(?:[.,]\d+)?$/.test(String(value)) ? Number(String(value).replace(",", ".")) : null;
export const publishedTime = value => Number.isFinite(Number(value)) && Number(value) > 1e12 ? new Date(Number(value)).toISOString() : null;

export function evidenceProvenance({ identity, path, hash, offset = 0, classification, fingerprint, eventHash }) {
  return { provenance_ref: fingerprint(`${path}|${hash}|${offset}`), source_type: classification,
    source_path: path, source_sha256: hash, record_offset: offset,
    ...(eventHash ? { source_event_hash: eventHash } : {}), ...identity, classification };
}

/** Cursor binds both immutable index generation and exact query; changing either fails explicitly. */
export function forensicPage({ items, query, indexHash, fingerprint }) {
  const limit = query.limit ?? 50;
  requireFact(Number.isInteger(limit) && limit >= 1 && limit <= 200, "FORENSIC_PAGE_LIMIT_INVALID");
  const signature = fingerprint(JSON.stringify({ ...query, cursor: undefined, limit: undefined }));
  let offset = 0;
  if (query.cursor) {
    const cursor = JSON.parse(query.cursor);
    requireFact(cursor.index === indexHash && cursor.query === signature && Number.isInteger(cursor.offset)
      && cursor.offset >= 0 && cursor.offset <= items.length, "FORENSIC_CURSOR_CONFLICT");
    offset = cursor.offset;
  }
  return { available: true, items: items.slice(offset, offset + limit), total: items.length,
    next_cursor: offset + limit < items.length ? JSON.stringify({ index: indexHash, query: signature, offset: offset + limit }) : null };
}

export function eventMatches(event, query) {
  return (!query.scenario_id || event.scenario_id === query.scenario_id)
    && (query.attempt === undefined || event.attempt === query.attempt)
    && (!query.event_types || query.event_types.includes(event.event))
    && (!query.event || event.event === query.event)
    && (!query.reason_code || event.reason_codes.includes(query.reason_code))
    && (!query.start_time || event.timestamp >= new Date(query.start_time).toISOString())
    && (!query.end_time || event.timestamp <= new Date(query.end_time).toISOString());
}
