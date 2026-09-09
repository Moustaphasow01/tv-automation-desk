// Presentation-only duration of explicitly published chart units; never resample prices.
export function timeframeSeconds(value: string): number | null {
  const unit = value.trim().toUpperCase();
  const minutes = /^(?:M)?([1-9]\d*)$/.exec(unit);
  if (minutes) return Number(minutes[1]) * 60;
  const longer = /^([1-9]\d*)(H|D)$/.exec(unit);
  return longer ? Number(longer[1]) * (longer[2] === "H" ? 3_600 : 86_400) : null;
}
