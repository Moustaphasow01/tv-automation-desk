import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collectUsdaGrainsCalendar,
  fetchUsdaCalendarText,
} from "../src/adapters/usda-grains-calendar-collector.js";

const source = {
  sourceId: "usda_nass_2026_ics",
  sourceKind: "ICS",
  timezone: "America/New_York",
  url: "https://www.nass.usda.gov/Publications/Calendar/2026/NassReleases2026.ics",
};
const retrievedAtUtc = new Date().toISOString();
const result = await collectUsdaGrainsCalendar({
  sources: [source],
  retrievedAtUtc,
  fetchText: fetchUsdaCalendarText,
});
const output = path.resolve(
  process.cwd(),
  "output/research/grains-week-20260905/usda-nass-calendar-current.json",
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    output,
    events: result.agriEvents.length,
    coverage: result.agriCalendarCoverage[0].status,
  }),
);
