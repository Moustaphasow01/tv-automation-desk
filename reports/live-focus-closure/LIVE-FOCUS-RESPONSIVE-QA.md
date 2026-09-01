# Live Focus responsive QA

Target viewports: `1440x900`, `1366x768`, `1024x768`, `768x1024`, `390x844`.

The layout uses `minmax()` grids and staged stacking. At narrower widths the fixed dossier stack becomes an in-flow region, the operator sections stack, drawers become full width, and the mobile footer becomes static so it cannot cover content. The chart uses the existing interactive market panel and remains scoped to the selected instrument/timeframe.

Final screenshot, overflow and Axe evidence is recorded after the release is served by the VPS.
