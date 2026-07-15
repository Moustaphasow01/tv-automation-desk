import { toUtcIso, toParisIso } from "./paris.js";

/**
 * @typedef {{ epochMs: number, utc: string, paris: string }} Tick
 */

export class ClockPort {
  /** @returns {Tick} */
  now() { throw new Error("not implemented"); }
}

export class SystemClock extends ClockPort {
  now() {
    const epochMs = Date.now();
    return { epochMs, utc: toUtcIso(epochMs), paris: toParisIso(epochMs) };
  }
}

export class FixedClock extends ClockPort {
  #epochMs;
  constructor(epochMs) {
    super();
    if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) {
      throw new TypeError(`FixedClock: epochMs must be a finite number, got ${epochMs}`);
    }
    this.#epochMs = epochMs;
  }
  now() {
    return {
      epochMs: this.#epochMs,
      utc: toUtcIso(this.#epochMs),
      paris: toParisIso(this.#epochMs),
    };
  }
}
