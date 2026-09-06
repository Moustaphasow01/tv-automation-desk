# USDA grains calendar coverage — TD2-426

> État historique du 5 septembre, conservé sans réécriture des preuves. Suite actuelle : [qualification et comparaison du 6 septembre](USDA_GRAINS_CALENDAR_QUALIFICATION_20260906.md). La reconstruction officielle est désormais qualifiable avec ses réserves ; elle ne devient pas une réception locale historique prouvée.

The local collector now stores three official-source manifests in
`output/research/grains-week-20260905/usda-nass-calendar-current.json`: the
[NASS 2026 iCalendar](https://www.nass.usda.gov/Publications/Calendar/2026/NassReleases2026.ics),
the [WASDE August 12 release page](https://esmis.nal.usda.gov/publication/world-agricultural-supply-and-demand-estimates/2026-08-12),
and the [FAS scheduled-reports page](https://www.fas.usda.gov/data/scheduled-reports).
Each has its retrieval instant, byte count, URL and SHA-256 in the manifest.

The current NASS document contains the Crop Progress release at 2026-08-31
20:00:00Z. This establishes what the freshly retrieved document says, not what
was known before the 31 August–4 September replay cutoffs. The WASDE page is a
dated publication record and the FAS page is a current schedule page; neither
is a source-version archive proving the complete schedule at an earlier
instant. ICS `CREATED` and `DTSTAMP` metadata are retained but are never used
as historical `known_at`.

Consequently the current aggregate remains `UNKNOWN_COVERAGE` with
`CALENDAR_SOURCE_SET_INCOMPLETE` and `EXTERNAL_HISTORICAL_GAP`. No historical
cutoff receives a calendar certificate and the existing context policy must
continue to return `WAIT`. A future local collection can be appended as a new
immutable version, but cannot amend the knowledge time of an existing version.

## Final external-proof review for 31 August–4 September 2026

This review used only USDA/NASS/FAS public sources and did not alter a source
manifest, event row, ledger version, or replay input. It separates a document
that describes a schedule from an immutable local record proving when the
document was available to this system.

- **NASS:** The official [2026 Agricultural Statistics Board calendar](https://data.nass.usda.gov/Publications/Calendar/2026/2026ReleaseCalendar_12Months_11x17_Color.pdf)
  lays out the whole week: 31 August lists Agricultural Prices, Egg Products,
  and Crop Progress; 1 September lists Cotton System, Fats & Oils, Grain
  Crushings and its annual summary; 2 September lists Broiler Hatchery; 3
  September lists Slaughter Weekly and Dairy Products; and 4 September lists
  Peanut Prices. Its legend assigns Crop Progress the 4:00 p.m. release marker.
  The institutional [Crop Progress release record](https://esmis.nal.usda.gov/publication/crop-progress/2026-08-31)
  independently records the 31 August release date. Search discovery metadata
  for the calendar reports it as published months before this week, but the
  document text and our repository contain no immutable retrieval receipt from
  before a particular replay cutoff. It is therefore a strong source candidate,
  not a ledger `knownAtUtc` proof.

- **WASDE:** The official February report
  [`wasde0226.pdf`](https://www.usda.gov/oce/commodity/wasde/wasde0226.pdf)
  records the 2026 schedule, including 12 August and the next release on 11
  September. That bounds the WASDE component for 31 August–4 September: the
  document announces no WASDE release in this interval. It does not cover NASS
  or FAS events, and it cannot by itself certify aggregate calendar coverage.

- **FAS Export Sales:** The official [Export Sales Reporting Program](https://www.fas.usda.gov/programs/export-sales-reporting-program)
  states the normal weekly-publication rule (Thursday 8:30 a.m. ET) and a
  special rule when the preceding Friday or Monday is a national holiday. Labor
  Day was Monday 7 September, outside the replay interval; however, that fact
  is not evidence that no FAS event occurred during 31 August–4 September.
  The page is not an archived 2026 schedule/version with a publication receipt
  before the cutoffs (and the official endpoint returned HTTP 403 to this
  research reader). We must not infer a complete FAS calendar from its general
  cadence or from absence of a presently found announcement.

Result: these sources improve the documented provenance of individual schedule
claims, especially NASS and WASDE, but do **not** produce the required
versioned, complete NASS+WASDE+FAS snapshot with an attested historical
availability time. The aggregate remains `UNKNOWN_COVERAGE`; `WAIT` remains
the only safe replay outcome.

Proof commands executed locally:

```text
node.exe mcp_gpt_desk/scripts/collect_usda_grains_calendar.mjs
node.exe --test mcp_gpt_desk/test/usda_grains_calendar_collector.test.js mcp_gpt_desk/test/grains_calendar_coverage.test.js
node.exe --input-type=module -e "process.env.RUN_POSTGRES_TESTS='1'; await import('./mcp_gpt_desk/test/grains_calendar_version_ledger_postgres.test.js');"
node.exe --input-type=module -e "process.env.RUN_POSTGRES_TESTS='1'; await import('./mcp_gpt_desk/test/grains_runtime_inputs_postgres.test.js');"
```
