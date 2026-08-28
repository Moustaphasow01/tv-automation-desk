export type ChartViewport = {
  start: number;
  end: number;
  followLatest: boolean;
  autoScaleY: boolean;
  yZoom: number;
  yOffset: number;
};

export type ViewportAction =
  | { type: "PAN_X"; delta: number; length: number }
  | { type: "ZOOM_X"; factor: number; anchor: number; length: number }
  | { type: "SET_RANGE"; size: number; length: number }
  | { type: "GO_LATEST"; length: number }
  | { type: "PAUSE_FOLLOW" }
  | { type: "GO_EARLIEST"; length: number }
  | { type: "RESET"; length: number; defaultSize?: number }
  | { type: "DATA_CHANGED"; previousLength: number; length: number }
  | { type: "RESTORE_WINDOW"; start: number; size: number; length: number }
  | { type: "ZOOM_Y"; factor: number }
  | { type: "PAN_Y"; deltaRatio: number }
  | { type: "AUTO_Y" };

const MIN_WINDOW = 12;

export type HorizontalDragAccumulation = {
  deltaCandles: number;
  remainderPixels: number;
};

export function accumulateHorizontalDrag(
  remainderPixels: number,
  deltaPixels: number,
  plotWidth: number,
  visibleLength: number,
): HorizontalDragAccumulation {
  if (!Number.isFinite(deltaPixels) || plotWidth <= 0 || visibleLength <= 0) {
    return { deltaCandles: 0, remainderPixels: 0 };
  }
  const pixelsPerCandle = plotWidth / visibleLength;
  const accumulatedPixels = remainderPixels + deltaPixels;
  // Math.trunc intentionally waits for a complete candle in either direction.
  // The remainder is carried to the next pointer event instead of being lost.
  const draggedCandles = Math.trunc(accumulatedPixels / pixelsPerCandle);
  return {
    deltaCandles: draggedCandles === 0 ? 0 : -draggedCandles,
    remainderPixels: accumulatedPixels - draggedCandles * pixelsPerCandle,
  };
}

export function createViewport(length: number, defaultSize = 96): ChartViewport {
  const size = Math.min(Math.max(0, length), defaultSize);
  return {
    start: Math.max(0, length - size),
    end: length,
    followLatest: true,
    autoScaleY: true,
    yZoom: 1,
    yOffset: 0,
  };
}

export function reduceViewport(current: ChartViewport, action: ViewportAction): ChartViewport {
  if (action.type === "RESET") return createViewport(action.length, action.defaultSize);
  if (action.type === "AUTO_Y") return { ...current, autoScaleY: true, yZoom: 1, yOffset: 0 };
  if (action.type === "PAUSE_FOLLOW") return { ...current, followLatest: false };
  if (action.type === "ZOOM_Y") {
    return { ...current, autoScaleY: false, yZoom: clamp(current.yZoom * action.factor, 0.25, 8) };
  }
  if (action.type === "PAN_Y") {
    return { ...current, autoScaleY: false, yOffset: clamp(current.yOffset + action.deltaRatio, -4, 4) };
  }
  if (action.type === "DATA_CHANGED") {
    if (current.followLatest) {
      const size = Math.min(action.length, Math.max(MIN_WINDOW, current.end - current.start));
      return { ...current, start: Math.max(0, action.length - size), end: action.length };
    }
    return normalize(current, action.length);
  }
  if (action.type === "RESTORE_WINDOW") {
    const size = clamp(Math.round(action.size), Math.min(MIN_WINDOW, action.length), action.length);
    const start = clamp(Math.round(action.start), 0, Math.max(0, action.length - size));
    return { ...current, start, end: start + size, followLatest: false };
  }
  if (action.type === "GO_LATEST") {
    const size = Math.min(action.length, Math.max(MIN_WINDOW, current.end - current.start));
    return { ...current, start: Math.max(0, action.length - size), end: action.length, followLatest: true };
  }
  if (action.type === "GO_EARLIEST") {
    const size = Math.min(action.length, Math.max(MIN_WINDOW, current.end - current.start));
    return { ...current, start: 0, end: size, followLatest: size === action.length };
  }
  if (action.type === "SET_RANGE") {
    const size = clamp(Math.round(action.size), Math.min(MIN_WINDOW, action.length), action.length);
    const end = current.followLatest ? action.length : clamp(current.end, size, action.length);
    return { ...current, start: Math.max(0, end - size), end, followLatest: end === action.length };
  }
  if (action.type === "PAN_X") {
    const size = current.end - current.start;
    const start = clamp(current.start + Math.round(action.delta), 0, Math.max(0, action.length - size));
    return { ...current, start, end: start + size, followLatest: start + size === action.length };
  }
  const size = current.end - current.start;
  const nextSize = clamp(Math.round(size * action.factor), Math.min(MIN_WINDOW, action.length), action.length);
  const anchor = clamp(action.anchor, 0, 1);
  const anchorIndex = current.start + size * anchor;
  const start = clamp(Math.round(anchorIndex - nextSize * anchor), 0, Math.max(0, action.length - nextSize));
  return { ...current, start, end: start + nextSize, followLatest: start + nextSize === action.length };
}

export function visibleWindow(viewport: ChartViewport, length: number): { start: number; end: number } {
  const normalized = normalize(viewport, length);
  return { start: normalized.start, end: normalized.end };
}

export function historicalWindowStart(
  viewport: ChartViewport,
  previousTimestamps: readonly string[],
  nextTimestamps: readonly string[],
): number {
  const anchor = previousTimestamps[viewport.start];
  if (!anchor) return viewport.start;
  const exactIndex = nextTimestamps.indexOf(anchor);
  if (exactIndex >= 0) return exactIndex;
  const anchorTime = Date.parse(anchor);
  if (!Number.isFinite(anchorTime)) return viewport.start;
  const nextIndex = nextTimestamps.findIndex((timestamp) => Date.parse(timestamp) >= anchorTime);
  return nextIndex >= 0 ? nextIndex : Math.max(0, nextTimestamps.length - (viewport.end - viewport.start));
}

function normalize(viewport: ChartViewport, length: number): ChartViewport {
  if (length <= 0) return { ...viewport, start: 0, end: 0, followLatest: true };
  const size = clamp(viewport.end - viewport.start, Math.min(MIN_WINDOW, length), length);
  const start = clamp(viewport.start, 0, Math.max(0, length - size));
  return { ...viewport, start, end: start + size, followLatest: start + size === length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
