import { describe, expect, it } from "vitest";
import { accumulateHorizontalDrag, createViewport, historicalWindowStart, reduceViewport, visibleWindow } from "./viewport";

describe("live chart viewport", () => {
  it("keeps an inspected historical window stable when new candles arrive", () => {
    const initial = createViewport(120, 48);
    const inspected = reduceViewport(initial, { type: "PAN_X", delta: -20, length: 120 });
    const updated = reduceViewport(inspected, { type: "DATA_CHANGED", previousLength: 120, length: 121 });

    expect(inspected.followLatest).toBe(false);
    expect(updated.start).toBe(inspected.start);
    expect(updated.end).toBe(inspected.end);
  });

  it("follows the latest candle only while follow-latest is active", () => {
    const initial = createViewport(120, 48);
    const updated = reduceViewport(initial, { type: "DATA_CHANGED", previousLength: 120, length: 123 });

    expect(updated).toMatchObject({ start: 75, end: 123, followLatest: true });
  });

  it("can pause follow-latest without moving the inspected window", () => {
    const initial = createViewport(120, 48);
    const paused = reduceViewport(initial, { type: "PAUSE_FOLLOW" });
    const updated = reduceViewport(paused, { type: "DATA_CHANGED", previousLength: 120, length: 121 });

    expect(paused).toMatchObject({ start: 72, end: 120, followLatest: false });
    expect(updated).toMatchObject({ start: 72, end: 120, followLatest: false });
  });

  it("anchors horizontal zoom around the requested cursor ratio", () => {
    const initial = { ...createViewport(200, 100), followLatest: false };
    const zoomed = reduceViewport(initial, { type: "ZOOM_X", factor: 0.5, anchor: 0.25, length: 200 });

    expect(zoomed.end - zoomed.start).toBe(50);
    expect(zoomed.start).toBe(113);
  });

  it("separates manual price navigation from automatic price fitting", () => {
    const manual = reduceViewport(createViewport(100), { type: "ZOOM_Y", factor: 2 });
    const panned = reduceViewport(manual, { type: "PAN_Y", deltaRatio: 0.25 });
    const automatic = reduceViewport(panned, { type: "AUTO_Y" });

    expect(panned).toMatchObject({ autoScaleY: false, yZoom: 2, yOffset: 0.25 });
    expect(automatic).toMatchObject({ autoScaleY: true, yZoom: 1, yOffset: 0 });
  });

  it("clamps every visible range inside the loaded dataset", () => {
    const invalid = { ...createViewport(20), start: -50, end: 900 };
    expect(visibleWindow(invalid, 20)).toEqual({ start: 0, end: 20 });
  });

  it("keeps the same timestamp anchored when a fixed-size rolling series advances", () => {
    const timestamps = Array.from({ length: 120 }, (_, index) => `2026-08-28T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`);
    const nextTimestamps = [...timestamps.slice(1), "2026-08-28T02:00:00Z"];
    const inspected = reduceViewport(createViewport(120, 48), { type: "PAN_X", delta: -20, length: 120 });
    const restoredStart = historicalWindowStart(inspected, timestamps, nextTimestamps);
    const restored = reduceViewport(inspected, { type: "RESTORE_WINDOW", start: restoredStart, size: inspected.end - inspected.start, length: nextTimestamps.length });

    expect(restoredStart).toBe(inspected.start - 1);
    expect(nextTimestamps[restored.start]).toBe(timestamps[inspected.start]);
    expect(restored).toMatchObject({ followLatest: false });
  });

  it("accumulates slow pointer sub-deltas until a complete candle is crossed", () => {
    let remainder = 0;
    let totalCandles = 0;
    for (const delta of [2, 2, 2, 2, 2]) {
      const step = accumulateHorizontalDrag(remainder, delta, 1_000, 100);
      totalCandles += step.deltaCandles;
      remainder = step.remainderPixels;
    }

    expect(totalCandles).toBe(-1);
    expect(remainder).toBeCloseTo(0);
  });

  it("preserves signed drag remainder when direction changes", () => {
    const forward = accumulateHorizontalDrag(0, 7, 1_000, 100);
    const backward = accumulateHorizontalDrag(forward.remainderPixels, -3, 1_000, 100);

    expect(forward).toEqual({ deltaCandles: 0, remainderPixels: 7 });
    expect(backward).toEqual({ deltaCandles: 0, remainderPixels: 4 });
  });
});
