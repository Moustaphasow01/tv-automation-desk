import { grainChicagoDate } from "./us-grains-data-quality.js";
import {
  chicagoMinuteAtUtc,
  chicagoPartsAtUtc,
} from "./us-grains-chicago-time.js";

export function chicagoMinuteOfUtc(timestampUtc) {
  return chicagoMinuteAtUtc(timestampUtc);
}

export function closeM5BarUtc(openUtc) {
  return new Date(Date.parse(openUtc) + 5 * 60_000).toISOString();
}

export function usGrainsSessionCloseUtc(timestampUtc) {
  const [year, month, day] = grainChicagoDate(timestampUtc)
    .split("-")
    .map(Number);
  const target = Date.UTC(year, month - 1, day, 13, 20);
  let candidate = target;
  for (let index = 0; index < 3; index += 1) {
    const parts = chicagoPartsAtUtc(new Date(candidate).toISOString());
    candidate +=
      target -
      Date.UTC(
        +parts.year,
        +parts.month - 1,
        +parts.day,
        +parts.hour,
        +parts.minute,
      );
  }
  return new Date(candidate).toISOString();
}
