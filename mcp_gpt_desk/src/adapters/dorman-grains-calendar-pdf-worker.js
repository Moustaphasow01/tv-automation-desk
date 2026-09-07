import { parentPort, workerData } from "node:worker_threads";
import { extractTextItems, getDocumentProxy } from "unpdf";

const MAX_POSITIONED_ITEMS = 5000;

let pdf = null;
try {
  pdf = await getDocumentProxy(Uint8Array.from(workerData.bytes), {
    isEvalSupported: false,
    maxImageSize: 16_777_216,
  });
  if (pdf.numPages !== 1) throw new Error("CALENDAR_DORMAN_PDF_PAGE_COUNT_INVALID");
  const extracted = await extractTextItems(pdf);
  if (extracted.totalPages !== 1 || extracted.items.length !== 1)
    throw new Error("CALENDAR_DORMAN_PDF_PAGE_COUNT_INVALID");
  if (extracted.items[0].length > MAX_POSITIONED_ITEMS)
    throw new Error("CALENDAR_DORMAN_PDF_ITEMS_LIMIT");
  parentPort.postMessage({ ok: true, items: extracted.items[0] });
} catch (error) {
  const reasonCode = /^[A-Z][A-Z0-9_]{3,120}$/.test(error?.message || "")
    ? error.message : "CALENDAR_DORMAN_PDF_PARSE_FAILED";
  parentPort.postMessage({ ok: false, reasonCode });
} finally {
  await pdf?.destroy().catch(() => {});
}
