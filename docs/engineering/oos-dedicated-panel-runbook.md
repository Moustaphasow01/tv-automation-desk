# Dedicated native SMC398 panel capture recovery

Owner: simulation/desk-oos-batch. Branch: feature/oos-batch-mcp-v1.

Incident on 2026-07-28: replay completion already persisted at 20:00 Paris, 44 M15 steps.
The distinct maximized ENGINE pane existed and its AUTO table was 28 rows x 7 columns.
Native cell row 4 / column 5 needed 1561.32 CSS pixels but had 1161.49; one cell was clipped.
The old combined use case reported this result-capture failure at REPLAYING.

## Boundaries and recovery

- The durable command is QUEUED before the day enters REPLAYING.
- Keep the exclusive TradingView lock through replay and capture, but save CAPTURING_RESULTS
  immediately after immutable evidence/replay-completed.json is proved, before any capture.
- A historical failed REPLAYING day with that proof recovers directly to CAPTURING_RESULTS.
- Capture resumption verifies installed frozen bytes, configuration, paused replay and exact end.
  It never starts/steps/seeks replay or imports a plan. A display timeframe may be restored to M15.
- A lost or different session fails explicitly; it is never reset to the premarket cutoff.

The TradingView adapter reads the actual study pane and native renderer. Published table IDs,
rows and columns must match renderer geometry. Every table must fit within the distinct pane;
no expected text cell may be clipped. AUTO requires AUDIT FIN SESSION; POSITIONS requires
the actual POSITIONS input. No fixed pane-height criterion or guessed ENGINE dimensions.

Recovery focuses only the owned chart, closes transient UI, resets browser zoom, maximizes
the study pane and waits for two matching non-loading layouts. The viewport grows from
measured cell-width ratios and table height. Three attempts maximum, dimensions bounded
by technical resource budgets. The measured zoom is used for CDP clipping.

Failure details contain replay/end state, pane/table geometry, exact reasons and recovery
history. Debug PNGs are hashed in evidence/panel-failure-<image-hash>.png, never replay/.
They do not constitute a completed result. Metrics still come only from the installed ENGINE.

## Compatibility and validation

New presentation receipts use oos-native-panel/2. Old immutable receipts remain readable.
Both dashboard and distinct positions receipts are checked; completion still requires all hashes.
No migration, OAuth/MCP tool change, Pine/parser/trading-input change or new service.

Tests cover clipping, layout instability, native identity vs completeness, view checks, precise
diagnostics, separate debug storage, capture-only retries and historical checkpoint recovery.
Use the existing Update-OosReplay.ps1 for a staged release and health-gated rollback.
No other date may be queued during the single-day incident recipe.

Debt reduction: the provider proof is a separately testable read-only geometry adapter;
fixed presentation sleeps and the 900px gate are removed; stage ownership is now explicit.
