import { Worker } from "node:worker_threads";
import { zonedUtc } from "./usda-grains-calendar-document-parser.js";

const MAX_PDF_BYTES = 2 * 1024 * 1024;
const PDF_PARSE_TIMEOUT_MS = 5000;
const MAX_POSITIONED_ITEMS = 5000;
const WEEKDAY_COLUMNS = Object.freeze([
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
]);
const MONTH_NAMES = Object.freeze([
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
]);

export async function parseDormanCalendarPdf({
  bytes,
  source,
  retrievedAtUtc,
  hash,
}) {
  const input = byteCopy(bytes);
  const items = await extractPositionedItems(input);
  return parseDormanCalendarItems({ items, source, retrievedAtUtc, hash });
}

export function parseDormanCalendarItems({ items, source, retrievedAtUtc, hash }) {
  requiredTimestamp(retrievedAtUtc, "CALENDAR_DORMAN_RECEIPT_TIME_INVALID");
  if (!Array.isArray(items) || !items.length)
    throw new Error("CALENDAR_DORMAN_PDF_TEXT_MISSING");
  validateSourceScope(source);
  const normalized = items.map(positionedItem).filter((item) => item.text);
  validateDocumentText(normalized, source);
  validateWeekdayColumns(normalized);
  const dateItems = normalized.filter((item) => /^\d{1,2}$/.test(item.text)
    && item.height >= 9 && item.height <= 11);
  const columns = clusterColumns(dateItems.map((item) => item.x));
  if (columns.length !== 6) throw new Error("CALENDAR_DORMAN_DATE_COLUMNS_INVALID");
  const dates = validatedDateCells({ dateItems, columns, source });
  const exports = validatedExportItems(normalized);
  const events = exports.map((item) => eventFromCell({
    item, dates, columns, source, retrievedAtUtc, hash,
  }));
  if (new Set(events.map((event) => event.event_timestamp_utc)).size !== events.length)
    throw new Error("CALENDAR_DORMAN_EXPORT_SALES_DUPLICATE");
  return {
    events,
    coverage: monthCoverage(source.expectedYear, source.monthIndex, source.timezone),
    documentYears: [source.expectedYear],
    dateCellCount: dates.length,
    eventCount: events.length,
  };
}

function validateSourceScope(source) {
  if (!Number.isInteger(source?.expectedYear) || !Number.isInteger(source?.monthIndex)
    || source.monthIndex < 0 || source.monthIndex > 11)
    throw new Error("CALENDAR_DORMAN_SOURCE_SCOPE_INVALID");
}

function validateWeekdayColumns(items) {
  const headings = WEEKDAY_COLUMNS.map((name) => uniqueTextItem(items, name));
  if (!headings.every((item, index) => index === 0 || item.x > headings[index - 1].x))
    throw new Error("CALENDAR_DORMAN_WEEKDAY_ORDER_INVALID");
}

function validatedExportItems(items) {
  const exports = items.filter((item) => /Export Sales/i.test(item.text));
  if (!exports.length) throw new Error("CALENDAR_DORMAN_EXPORT_SALES_MISSING");
  if (!exports.every((item) => item.text === "Export Sales 7:30"))
    throw new Error("CALENDAR_DORMAN_EXPORT_SALES_FORM_AMBIGUOUS");
  return exports;
}

async function extractPositionedItems(bytes) {
  const worker = new Worker(
    new URL("./dorman-grains-calendar-pdf-worker.js", import.meta.url),
    {
      workerData: { bytes },
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    },
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error("CALENDAR_DORMAN_PDF_PARSE_TIMEOUT"));
    }, PDF_PARSE_TIMEOUT_MS);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate().catch(() => {});
      if (error) reject(error); else resolve(value);
    };
    worker.once("message", (message) => {
      if (!message || message.ok !== true || !Array.isArray(message.items)
        || message.items.length > MAX_POSITIONED_ITEMS) {
        const code = /^[A-Z][A-Z0-9_]{3,120}$/.test(message?.reasonCode || "")
          ? message.reasonCode : "CALENDAR_DORMAN_PDF_PARSE_FAILED";
        finish(new Error(code));
      } else finish(null, message.items);
    });
    worker.once("error", () => finish(new Error("CALENDAR_DORMAN_PDF_PARSE_FAILED")));
    worker.once("exit", (code) => {
      if (!settled) finish(new Error(code === 0
        ? "CALENDAR_DORMAN_PDF_WORKER_NO_RESULT"
        : "CALENDAR_DORMAN_PDF_WORKER_FAILED"));
    });
  });
}

function validateDocumentText(items, source) {
  const text = items.map((item) => item.text).join(" ").replace(/\s+/g, " ");
  const heading = `${MONTH_NAMES[source.monthIndex]} ${source.expectedYear}`;
  if (items.filter((item) => item.text === heading).length !== 1)
    throw new Error("CALENDAR_DORMAN_PDF_HEADING_INVALID");
  if (!/ALL REPORT TIMES ARE CENTRAL/i.test(text))
    throw new Error("CALENDAR_DORMAN_TIMEZONE_LEGEND_MISSING");
  if (!/Sou(?:r)?ce:\s*USDA\./i.test(text))
    throw new Error("CALENDAR_DORMAN_UPSTREAM_CLAIM_MISSING");
  if (!/Report and exchange dates can change without notice; please verify\./i.test(text))
    throw new Error("CALENDAR_DORMAN_CHANGE_WARNING_MISSING");
}

function validatedDateCells({ dateItems, columns, source }) {
  const expected = expectedNonSundayDates(source.expectedYear, source.monthIndex);
  const dates = expected.map((day) => {
    const expectedColumn = mondayColumn(source.expectedYear, source.monthIndex, day);
    const candidates = dateItems.filter((item) => +item.text === day
      && columnForX(item.x, columns) === expectedColumn);
    if (candidates.length !== 1)
      throw new Error("CALENDAR_DORMAN_DATE_CELL_AMBIGUOUS");
    return { ...candidates[0], day, column: expectedColumn };
  });
  const unexpected = dateItems.filter((item) => !dates.some((date) =>
    date.day === +item.text && close(date.x, item.x) && close(date.y, item.y)));
  if (unexpected.length) throw new Error("CALENDAR_DORMAN_UNEXPECTED_DATE_LABELS");
  return dates;
}

function eventFromCell({ item, dates, columns, source, retrievedAtUtc, hash }) {
  const column = columnForX(item.x, columns);
  if (column < 0) throw new Error("CALENDAR_DORMAN_EXPORT_SALES_COLUMN_AMBIGUOUS");
  const above = dates.filter((date) => date.column === column && date.y > item.y)
    .sort((left, right) => left.y - right.y);
  const below = dates.filter((date) => date.column === column && date.y < item.y)
    .sort((left, right) => right.y - left.y);
  if (above.length < 1 || (below[0] && item.y <= below[0].y))
    throw new Error("CALENDAR_DORMAN_EXPORT_SALES_ROW_AMBIGUOUS");
  const date = above[0];
  if (date.y - item.y <= 0 || date.y - item.y > 130)
    throw new Error("CALENDAR_DORMAN_EXPORT_SALES_DISTANCE_AMBIGUOUS");
  const timestamp = zonedUtc(
    source.expectedYear, source.monthIndex + 1, date.day,
    7, 30, 0, source.timezone,
  );
  if (!timestamp) throw new Error("CALENDAR_DORMAN_EVENT_TIME_INVALID");
  const dateKey = `${source.expectedYear}-${pad(source.monthIndex + 1)}-${pad(date.day)}`;
  return {
    market_agri_event_id: `dorman-export-sales-${dateKey}`,
    universe_key: "US_GRAINS_CBOT",
    event_kind: "EXPORT_SALES",
    title: "Weekly Export Sales",
    commodity_codes: [...(source.scope?.instruments || ["ZC", "ZW"])],
    event_timestamp_utc: timestamp,
    provider: "DORMAN_TRADING",
    source_url: source.url,
    importance: "HIGH",
    source_published_at_utc: retrievedAtUtc,
    point_in_time_payload: {
      commodity_codes: [...(source.scope?.instruments || ["ZC", "ZW"])],
      source_manifest_sha256: `sha256:${hash}`,
      source_timezone: source.timezone,
      authority_class: "SECONDARY_PUBLISHER",
      upstream_claim: "USDA",
      knowledge_status: "PROVEN_CURRENT",
      historical_knowledge_status: "EXTERNAL_HISTORICAL_GAP",
      knowledge_timestamp_basis: "DOCUMENT_RECEIPT_AT_RUNTIME",
      received_at_utc: retrievedAtUtc,
      provider_publication_time_status: "UNKNOWN",
      source_time_notation: "7:30 interpreted as 07:30 by versioned source policy",
    },
  };
}

function positionedItem(item) {
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : Number.NaN;
  const normalized = {
    text: typeof item?.str === "string" ? item.str.trim()
      : typeof item?.text === "string" ? item.text.trim() : "",
    x: number(item?.x), y: number(item?.y), width: number(item?.width),
    height: number(item?.height),
  };
  if (normalized.text && ![normalized.x, normalized.y, normalized.width, normalized.height]
    .every(Number.isFinite)) throw new Error("CALENDAR_DORMAN_PDF_POSITION_INVALID");
  return normalized;
}

function uniqueTextItem(items, text) {
  const matches = items.filter((item) => item.text === text);
  if (matches.length !== 1) throw new Error("CALENDAR_DORMAN_WEEKDAY_HEADER_INVALID");
  return matches[0];
}

function clusterColumns(values) {
  const clusters = [];
  for (const value of [...values].sort((left, right) => left - right)) {
    const cluster = clusters.find((item) => Math.abs(item.average - value) <= 5);
    if (!cluster) {
      clusters.push({ average: value, values: [value] });
      continue;
    }
    cluster.values.push(value);
    cluster.average = cluster.values.reduce((sum, item) => sum + item, 0)
      / cluster.values.length;
  }
  return clusters.map((item) => item.average);
}

function columnForX(x, columns) {
  const distances = columns.map((anchor) => Math.abs(x - anchor));
  const minimum = Math.min(...distances);
  return minimum <= 5 ? distances.indexOf(minimum) : -1;
}

function expectedNonSundayDates(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => index + 1)
    .filter((day) => new Date(Date.UTC(year, monthIndex, day)).getUTCDay() !== 0);
}

function mondayColumn(year, monthIndex, day) {
  const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
  return weekday === 0 ? -1 : weekday - 1;
}

function monthCoverage(year, monthIndex, timezone) {
  const start = zonedUtc(year, monthIndex + 1, 1, 0, 0, 0, timezone);
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonth = monthIndex === 11 ? 1 : monthIndex + 2;
  const next = Date.parse(zonedUtc(nextYear, nextMonth, 1, 0, 0, 0, timezone));
  return {
    start_utc: start,
    end_utc: new Date(next - 1).toISOString(),
    instruments: ["ZC", "ZW"],
  };
}

function byteCopy(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PDF_BYTES)
    throw new Error("CALENDAR_DORMAN_PDF_BYTES_INVALID");
  return Uint8Array.from(bytes);
}

function requiredTimestamp(value, code) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
}

function close(left, right) { return Math.abs(left - right) < 0.25; }
function pad(value) { return String(value).padStart(2, "0"); }
