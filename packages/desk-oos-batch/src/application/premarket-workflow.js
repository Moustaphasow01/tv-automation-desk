import { VIEWS, requireFact } from "../domain/batch-contract.js";
import { validateCapture, validateManifest } from "../domain/evidence-contract.js";
import { sessionCalendarEvidence } from "../domain/session-calendar-evidence.js";

export class PremarketWorkflow {
  constructor({ archive, tradingView, fingerprint, encodeJson, decodeImage, sessionCalendar }) {
    Object.assign(this, { archive, tradingView, fingerprint, encodeJson, decodeImage, sessionCalendar });
  }

  async capture(day, onCapture = async () => {}) {
    if (await this.archive.optionalJson(day, "premarket/manifest.json")) return this.verify(day);
    const calendar = sessionCalendarEvidence(this.sessionCalendar?.[day.date], day, this.fingerprint);
    await this.tradingView.preparePremarket(day);
    const captures = [];
    for (const view of VIEWS) {
      captures.push(await this.captureView(day, view));
      await onCapture(captures.length);
    }
    const manifest = premarketManifest(day, captures, this.fingerprint, calendar);
    validateManifest(manifest, day);
    await this.archive.putJson(day, "premarket/manifest.json", manifest);
    return this.verify(day);
  }

  async captureView(day, view) {
    const proofName = `evidence/${view.name}.json`;
    let proof = await this.archive.optionalJson(day, proofName);
    if (!proof) {
      proof = await this.tradingView.capturePremarket({ ...day, ...view });
      validateCapture(proof, { ...day, ...view });
      this.decodeImage(proof.image_base64);
      await this.archive.putJson(day, proofName, proof);
    }
    validateCapture(proof, { ...day, ...view });
    const bytes = this.decodeImage(proof.image_base64);
    const artifact = await this.archive.put(day, `premarket/${view.name}`, bytes);
    return premarketCaptureRecord(proof, view, artifact.sha256);
  }

  async verify(day) {
    const bytes = await this.archive.read(day, "premarket/manifest.json");
    const manifest = JSON.parse(bytes.toString("utf8"));
    validateManifest(manifest, day);
    if (manifest.schema_version === "oos-premarket/2") {
      const { manifest_sha256, ...content } = manifest;
      requireFact(manifest_sha256 === this.fingerprint(JSON.stringify(content, null, 2) + "\n"), "MANIFEST_HASH_MISMATCH");
    }
    const images = [];
    for (const capture of manifest.captures) {
      const png = await this.archive.read(day, `premarket/${capture.path}`);
      requireFact(this.fingerprint(png) === capture.sha256, "PREMARKET_HASH_MISMATCH");
      this.decodeImage(png.toString("base64"));
      images.push({ name: capture.path, mime_type: "image/png", sha256: capture.sha256, data: png.toString("base64") });
    }
    return { manifest, manifest_sha256: manifest.manifest_sha256 || this.fingerprint(bytes),
      manifest_file_sha256: this.fingerprint(bytes), images };
  }
}

export function premarketCaptureRecord(proof, view, sha256) {
  return { timeframe: view.timeframe, view: view.view, path: view.name, sha256,
    captured_at: proof.captured_at, visible_as_of: proof.visible_as_of, source: proof.source,
    bar_policy: proof.bar_policy ?? null, capture_cutoff: proof.capture_cutoff ?? null,
    last_bar_open: proof.last_bar_open ?? null, last_bar_close: proof.last_bar_close ?? null,
    indicator_fingerprint: proof.indicator_fingerprint ?? null };
}

export function premarketManifest(day, captures, fingerprint, calendar = {}) {
  const content = { schema_version: "oos-premarket/2", date: day.date, symbol: day.symbol,
    timezone: day.timezone, cutoff: day.cutoff, engine_version: day.engine_version,
    book_mode: day.book_mode, hash_format: "sha256-json-utf8-lf-excluding-manifest_sha256",
    captures, status: "PREMARKET_READY", ...calendar };
  return { ...content, manifest_sha256: fingerprint(JSON.stringify(content, null, 2) + "\n") };
}
