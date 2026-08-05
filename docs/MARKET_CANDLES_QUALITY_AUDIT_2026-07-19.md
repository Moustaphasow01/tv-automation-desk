# Audit qualité candles locales Postgres — 2026-07-19

Fenêtre auditée : `2026-06-30T22:00:00.000Z` → `2026-07-17T21:00:00.000Z`.

## Résumé

- Feeds marché total : `50`
- Feeds avec candles dans la fenêtre : `30`
- Hot scope attendu : `30` feeds
- Hot scope alimenté : `30` feeds
- Candles locales dans la fenêtre : `63229`
- Quarantine : `0`
- Feeds hot scope stale côté source : `6`
- Feeds hot scope avec gaps à revoir : `8`
- Feeds avec OHLC invalide : `0`

## Complétude hot scope

| Instrument | Timeframe | Status | Candles | Dernière candle | Feed |
|---|---|---|---:|---|---|
| MNQ | 1 | OK | 16258 | 2026-07-17T20:59:00.000Z | `prod__tradingview__MNQ1!__1` |
| MNQ | 5 | REVIEW | 3533 | 2026-07-17T20:55:00.000Z | `prod__tradingview__MNQ1!__5` |
| MNQ | 15 | SOURCE_STALE | 260 | 2026-07-03T16:45:00.000Z | `prod__tradingview__MNQ1!__15` |
| MNQ | 1H | SOURCE_STALE | 65 | 2026-07-03T16:00:00.000Z | `prod__tradingview__MNQ1!__1H` |
| MNQ | 4H | OK | 77 | 2026-07-17T18:00:00.000Z | `prod__tradingview__MNQ1!__4H` |
| MES | 1 | OK | 16256 | 2026-07-17T20:59:00.000Z | `prod__tradingview__MES1!__1` |
| MES | 5 | REVIEW | 3533 | 2026-07-17T20:55:00.000Z | `prod__tradingview__MES1!__5` |
| MES | 15 | SOURCE_STALE | 260 | 2026-07-03T16:45:00.000Z | `prod__tradingview__MES1!__15` |
| MES | 1H | SOURCE_STALE | 65 | 2026-07-03T16:00:00.000Z | `prod__tradingview__MES1!__1H` |
| MES | 4H | OK | 77 | 2026-07-17T18:00:00.000Z | `prod__tradingview__MES1!__4H` |
| NQ | 5 | SOURCE_STALE | 780 | 2026-07-03T16:55:00.000Z | `prod__tradingview__NQ1!__5` |
| NQ | 15 | OK | 1180 | 2026-07-17T20:45:00.000Z | `prod__tradingview__NQ1!__15` |
| NQ | 1H | OK | 295 | 2026-07-17T20:00:00.000Z | `prod__tradingview__NQ1!__1H` |
| NQ | 4H | OK | 77 | 2026-07-17T18:00:00.000Z | `prod__tradingview__NQ1!__4H` |
| ES | 5 | SOURCE_STALE | 780 | 2026-07-03T16:55:00.000Z | `prod__tradingview__ES1!__5` |
| ES | 15 | OK | 1180 | 2026-07-17T20:45:00.000Z | `prod__tradingview__ES1!__15` |
| ES | 1H | OK | 295 | 2026-07-17T20:00:00.000Z | `prod__tradingview__ES1!__1H` |
| ES | 4H | OK | 77 | 2026-07-17T18:00:00.000Z | `prod__tradingview__ES1!__4H` |
| DXY | 5 | REVIEW | 3328 | 2026-07-17T20:55:00.000Z | `prod__tradingview__DXY__5` |
| DXY | 4H | OK | 75 | 2026-07-17T19:00:00.000Z | `prod__tradingview__DXY__4H` |
| VIX | 5 | REVIEW | 1866 | 2026-07-17T20:15:00.000Z | `prod__tradingview__VIX__5` |
| VIX | 4H | OK | 38 | 2026-07-17T17:30:00.000Z | `prod__tradingview__VIX__4H` |
| US10Y | 5 | REVIEW | 2846 | 2026-07-17T20:55:00.000Z | `prod__tradingview__US10Y__5` |
| US10Y | 4H | OK | 71 | 2026-07-17T19:00:00.000Z | `prod__tradingview__US10Y__4H` |
| US02Y | 5 | REVIEW | 2665 | 2026-07-17T20:55:00.000Z | `prod__tradingview__US02Y__5` |
| US02Y | 4H | OK | 72 | 2026-07-17T19:00:00.000Z | `prod__tradingview__US02Y__4H` |
| GC | 5 | REVIEW | 3533 | 2026-07-17T20:55:00.000Z | `prod__tradingview__GC1!__5` |
| GC | 4H | OK | 77 | 2026-07-17T18:00:00.000Z | `prod__tradingview__GC1!__4H` |
| CL | 5 | REVIEW | 3533 | 2026-07-17T20:55:00.000Z | `prod__tradingview__CL1!__5` |
| CL | 4H | OK | 77 | 2026-07-17T18:00:00.000Z | `prod__tradingview__CL1!__4H` |

## Feeds stale / incomplets côté source

| Feed | Candles | Dernière candle locale | Dernière candle déclarée feed | Flags |
|---|---:|---|---|---|
| `prod__tradingview__ES1!__5` | 780 | 2026-07-03T16:55:00.000Z | 2026-07-03T16:55:00.000Z | SOURCE_STALE_VS_WINDOW |
| `prod__tradingview__MES1!__15` | 260 | 2026-07-03T16:45:00.000Z | 2026-07-03T16:45:00.000Z | SOURCE_STALE_VS_WINDOW |
| `prod__tradingview__MES1!__1H` | 65 | 2026-07-03T16:00:00.000Z | 2026-07-03T16:00:00.000Z | SOURCE_STALE_VS_WINDOW |
| `prod__tradingview__MNQ1!__15` | 260 | 2026-07-03T16:45:00.000Z | 2026-07-03T16:45:00.000Z | SOURCE_STALE_VS_WINDOW |
| `prod__tradingview__MNQ1!__1H` | 65 | 2026-07-03T16:00:00.000Z | 2026-07-03T16:00:00.000Z | SOURCE_STALE_VS_WINDOW |
| `prod__tradingview__NQ1!__5` | 780 | 2026-07-03T16:55:00.000Z | 2026-07-03T16:55:00.000Z | SOURCE_STALE_VS_WINDOW |

## Gaps à revoir

| Feed | Review gaps | Max gap | Samples |
|---|---:|---:|---|
| `prod__tradingview__CL1!__5` | 2 | 35m | 2026-07-16T08:00:00.000Z→2026-07-16T08:35:00.000Z (2100s); 2026-07-16T09:45:00.000Z→2026-07-16T09:55:00.000Z (600s) |
| `prod__tradingview__DXY__5` | 5 | 35m | 2026-07-16T08:00:00.000Z→2026-07-16T08:35:00.000Z (2100s); 2026-07-02T23:30:00.000Z→2026-07-02T23:45:00.000Z (900s); 2026-07-14T23:30:00.000Z→2026-07-14T23:45:00.000Z (900s); 2026-07-15T23:30:00.000Z→2026-07-15T23:45:00.000Z (900s); 2026-07-16T09:45:00.000Z→2026-07-16T09:55:00.000Z (600s) |
| `prod__tradingview__GC1!__5` | 2 | 35m | 2026-07-16T08:00:00.000Z→2026-07-16T08:35:00.000Z (2100s); 2026-07-16T09:45:00.000Z→2026-07-16T09:55:00.000Z (600s) |
| `prod__tradingview__MES1!__5` | 2 | 35m | 2026-07-16T08:00:00.000Z→2026-07-16T08:35:00.000Z (2100s); 2026-07-16T09:45:00.000Z→2026-07-16T09:55:00.000Z (600s) |
| `prod__tradingview__MNQ1!__5` | 2 | 35m | 2026-07-16T08:00:00.000Z→2026-07-16T08:35:00.000Z (2100s); 2026-07-16T09:45:00.000Z→2026-07-16T09:55:00.000Z (600s) |
| `prod__tradingview__US02Y__5` | 244 | 35m | 2026-07-02T04:35:00.000Z→2026-07-02T05:10:00.000Z (2100s); 2026-07-16T08:00:00.000Z→2026-07-16T08:35:00.000Z (2100s); 2026-07-06T17:50:00.000Z→2026-07-06T18:20:00.000Z (1800s); 2026-07-06T20:55:00.000Z→2026-07-06T21:25:00.000Z (1800s); 2026-07-10T02:20:00.000Z→2026-07-10T02:45:00.000Z (1500s); 2026-07-10T05:05:00.000Z→2026-07-10T05:30:00.000Z (1500s); 2026-07-10T07:00:00.000Z→2026-07-10T07:25:00.000Z (1500s); 2026-07-16T02:30:00.000Z→2026-07-16T02:55:00.000Z (1500s) |
| `prod__tradingview__US10Y__5` | 118 | 40m | 2026-07-06T20:25:00.000Z→2026-07-06T21:05:00.000Z (2400s); 2026-07-16T08:00:00.000Z→2026-07-16T08:35:00.000Z (2100s); 2026-07-08T02:40:00.000Z→2026-07-08T03:05:00.000Z (1500s); 2026-07-09T20:55:00.000Z→2026-07-09T21:20:00.000Z (1500s); 2026-07-10T20:55:00.000Z→2026-07-10T21:20:00.000Z (1500s); 2026-07-13T20:55:00.000Z→2026-07-13T21:20:00.000Z (1500s); 2026-07-14T20:55:00.000Z→2026-07-14T21:20:00.000Z (1500s); 2026-07-15T20:55:00.000Z→2026-07-15T21:20:00.000Z (1500s) |
| `prod__tradingview__VIX__5` | 9 | 35m | 2026-07-16T08:00:00.000Z→2026-07-16T08:35:00.000Z (2100s); 2026-07-01T09:10:00.000Z→2026-07-01T09:20:00.000Z (600s); 2026-07-01T10:40:00.000Z→2026-07-01T10:50:00.000Z (600s); 2026-07-06T13:20:00.000Z→2026-07-06T13:30:00.000Z (600s); 2026-07-07T08:40:00.000Z→2026-07-07T08:50:00.000Z (600s); 2026-07-10T13:20:00.000Z→2026-07-10T13:30:00.000Z (600s); 2026-07-15T13:20:00.000Z→2026-07-15T13:30:00.000Z (600s); 2026-07-16T09:45:00.000Z→2026-07-16T09:55:00.000Z (600s) |

## Feeds hors scope chaud non importés

Ces feeds existent en metadata mais n’ont pas été alimentés en candles locales dans ce palier :

- `prod__tradingview__AAPL__5`
- `prod__tradingview__AAPL__4H`
- `prod__tradingview__DAX__5`
- `prod__tradingview__DAX__4H`
- `prod__tradingview__HSI__5`
- `prod__tradingview__HSI__4H`
- `prod__tradingview__MSFT__5`
- `prod__tradingview__MSFT__4H`
- `prod__tradingview__NI225__5`
- `prod__tradingview__NI225__4H`
- `prod__tradingview__NVDA__5`
- `prod__tradingview__NVDA__4H`
- `prod__tradingview__SMH__5`
- `prod__tradingview__SMH__4H`
- `prod__tradingview__SOXX__5`
- `prod__tradingview__SOXX__4H`
- `prod__tradingview__SX5E__5`
- `prod__tradingview__SX5E__4H`
- `prod__tradingview__TSLA__5`
- `prod__tradingview__TSLA__4H`

## Notes de lecture

- `SOURCE_STALE` signifie que la dernière candle locale colle à la dernière candle déclarée par le feed, mais que cette source est ancienne par rapport à la fin de fenêtre.
- `calendar_missing_slots` dans le JSON est volontairement calendaire : il inclut les pauses normales de session et les week-ends.
- Les gaps classés `daily_maintenance_or_short_session_break` ou `session_or_weekend_break` ne sont pas considérés comme anomalies bloquantes.
