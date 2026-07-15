import { parseInstant } from "./instant.js";
import { resultFromIssues } from "./result.js";
import {
  computeRewardRisk,
  numberOrNull,
  setupDirection,
} from "./setup-shape.js";

export function replayOutcome({ setup = {}, candles = [], cutoff } = {}) {
  const rejectReasons = [];
  const reviewReasons = [];
  const flags = [];
  const geometry = computeRewardRisk(setup);
  const risk = numberOrNull(geometry.riskPoints);
  const evidence = {
    normalized_price_geometry: geometry,
    candle_count: Array.isArray(candles) ? candles.length : 0,
    outcome: null,
    r_multiple: null,
  };

  const replayLookahead = replayLookaheadCandles(candles, cutoff);
  if (replayLookahead.length > 0) {
    rejectReasons.push("replay_lookahead");
    flags.push("OUTCOME_REPLAY_LOOKAHEAD");
    evidence.replay_lookahead = replayLookahead;
  }

  if (!["long", "short"].includes(setupDirection(setup)) || risk === null || risk <= 0) {
    rejectReasons.push("invalid_r_distance");
    flags.push("OUTCOME_INVALID_R_DISTANCE");
  }

  if (rejectReasons.length > 0) {
    return resultFromIssues({ rejectReasons, flags, evidence });
  }

  const orderedCandles = normalizedCandles(candles);
  for (const candle of orderedCandles) {
    const touch = candleTouch(candle, geometry);
    if (touch.stop && touch.target) {
      reviewReasons.push("ambiguous_candle_path");
      flags.push("OUTCOME_AMBIGUOUS_CANDLE_PATH");
      evidence.ambiguous_candle = candle;
      return resultFromIssues({ reviewReasons, flags, evidence });
    }
    if (touch.stop) {
      return resultFromIssues({
        flags: ["OUTCOME_STOP_TOUCHED"],
        evidence: {
          ...evidence,
          outcome: "SL",
          exit_price: geometry.stop,
          exit_timestamp: candle.timestamp,
          r_multiple: -1,
        },
      });
    }
    if (touch.target) {
      return resultFromIssues({
        flags: ["OUTCOME_TARGET_TOUCHED"],
        evidence: {
          ...evidence,
          outcome: "TP1",
          exit_price: geometry.target,
          exit_timestamp: candle.timestamp,
          r_multiple: round(Math.abs(geometry.target - geometry.entry) / risk, 4),
        },
      });
    }
  }

  const last = orderedCandles[orderedCandles.length - 1] || null;
  const exitPrice = last?.close ?? geometry.entry;
  return resultFromIssues({
    evidence: {
      ...evidence,
      outcome: "OPEN",
      exit_price: exitPrice,
      exit_timestamp: last?.timestamp || null,
      r_multiple: round(pnlPoints(setupDirection(setup), geometry.entry, exitPrice) / risk, 4),
    },
  });
}

function replayLookaheadCandles(candles, cutoff) {
  const cutoffMs = parseInstant(cutoff);
  if (cutoffMs === null) return [];
  return normalizedCandles(candles)
    .filter((candle) => {
      const timestampMs = parseInstant(candle.timestamp);
      return timestampMs !== null && timestampMs > cutoffMs;
    })
    .map((candle) => candle.timestamp);
}

function normalizedCandles(candles) {
  if (!Array.isArray(candles)) return [];
  return candles
    .map((candle) => ({
      timestamp: String(candle.timestamp || candle.timestamp_paris || candle.timestamp_utc || candle.time || ""),
      high: numberOrNull(candle.high),
      low: numberOrNull(candle.low),
      close: numberOrNull(candle.close),
    }))
    .filter((candle) => candle.high !== null && candle.low !== null)
    .sort((left, right) => (parseInstant(left.timestamp) ?? 0) - (parseInstant(right.timestamp) ?? 0));
}

function candleTouch(candle, geometry) {
  if (geometry.direction === "long") {
    return {
      stop: candle.low <= geometry.stop,
      target: candle.high >= geometry.target,
    };
  }
  return {
    stop: candle.high >= geometry.stop,
    target: candle.low <= geometry.target,
  };
}

function pnlPoints(direction, entry, exitPrice) {
  return direction === "short" ? entry - exitPrice : exitPrice - entry;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
