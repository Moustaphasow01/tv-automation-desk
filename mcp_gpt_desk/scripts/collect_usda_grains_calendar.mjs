import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collectUsdaGrainsCalendar,
  fetchUsdaCalendarText,
  fetchUsdaSourceText,
} from "../src/adapters/usda-grains-calendar-collector.js";

const sources = [
  {
    sourceId: "usda_nass_release_calendar",
    sourceKind: "ICS",
    timezone: "America/New_York",
    url: "https://www.nass.usda.gov/Publications/Calendar/2026/NassReleases2026.ics",
  },
  {
    sourceId: "usda_wasde_release_schedule",
    sourceKind: "SCHEDULE_EVIDENCE",
    calendarEvidenceStatus: "INSUFFICIENT",
    url: "https://esmis.nal.usda.gov/publication/world-agricultural-supply-and-demand-estimates/2026-08-12",
  },
  {
    sourceId: "usda_fas_export_sales_schedule",
    sourceKind: "SCHEDULE_EVIDENCE",
    calendarEvidenceStatus: "INSUFFICIENT",
    url: "https://www.fas.usda.gov/data/scheduled-reports",
  },
];
const retrievedAtUtc = new Date().toISOString();
const result = await collectUsdaGrainsCalendar({
  sources,
  retrievedAtUtc,
  fetchText: (url, source) =>
    source.sourceKind === "ICS"
      ? fetchUsdaCalendarText(url)
      : fetchUsdaSourceText(url),
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
    sources: result.manifests.length,
  }),
);
