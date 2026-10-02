import test from "node:test";
import assert from "node:assert/strict";
import { OosTradingViewPanels } from "../src/oos-tradingview-panels.js";
import { validateAuditPresentation } from "../../packages/desk-oos-batch/src/domain/replay-artifacts.js";

function fixture({ stuck = false } = {}) {
  let now = 0, width = 3600, view = "AUTO";
  const writes = [], keys = [], screenshots = [];
  const end = "2026-07-28T20:00:00+02:00", at = Date.parse(end) / 1000;
  const client = { Runtime: { evaluate: async () => ({ result: { value: "/chart/TEST_ONLY/" } }) },
    Input: { dispatchKeyEvent: async key => keys.push(key) },
    Emulation: { setDeviceMetricsOverride: async size => { width = size.width; } },
    Page: { bringToFront: async () => {}, getLayoutMetrics: async () => ({
      layoutViewport: { clientWidth: width }, cssLayoutViewport: { clientWidth: width }, cssVisualViewport: { zoom: 1 } }),
    captureScreenshot: async request => { screenshots.push(request); return { data: "SYNTHETIC_DEBUG_PIXELS" }; } } };
  const engine = { ids: { view: "view" }, evaluate: async () => false,
    setInput: async (key, value) => { writes.push(key); if (key === "view") view = value; },
    capture: { chartId: "TEST_ONLY", assertChart: async () => {}, observation: async () => ({
      at: at - 1, last_bar_time: at - 900, resolution: "15", replay: true, autoplay: false }) } };
  const panel = new OosTradingViewPanels({ engine, provider: { getClient: async () => client },
    now: () => now, wait: async ms => { now += ms; }, settings: { layout_ms: 10, poll_ms: 1, max_attempts: 2 } });
  panel.proof = async () => {
    const clipped = stuck || width < 5000;
    return { dedicated_panel: true, maximized: true, pane_index: 1, pane_count: 3, smc398_found: true,
      view, title: view === "AUTO" ? "AUDIT FIN SESSION" : null, rows: [28], columns: [7],
      native_table: true, complete_table: !clipped, table_contained_in_pane: true, clipped_cells: +clipped,
      minimum_font_size: 14, bounds: { x: 0, y: 0, width, height: 1200 }, loading: false, engine_error: false,
      expected_tables: [{ id: 1, rows: 28, columns: 7 }], rendered_tables: [{ id: 1, rows: 28, columns: 7,
        complete: !clipped, contained_in_pane: true, clipped_cells: +clipped, height: 700,
        clipped_cell_details: clipped ? [{ row: 4, column: 5, required_width: 1600, allocated_width: 1000 }] : [],
        content_bounds: { x: 10, y: 10, width: width - 20, height: 700 } }] };
  };
  return { panel, writes, keys, screenshots, end };
}

test("native cell geometry drives bounded resize; AUTO and POSITIONS stay complete without trading writes", async () => {
  const f = fixture(); await f.panel.open("AUDIT", { replay_end: f.end });
  const audit = await f.panel.screenshot("dashboard_final.png");
  assert.equal(audit.presentation.clipped_cells, 0); assert.equal(audit.presentation.complete_table, true);
  assert.equal(audit.presentation.recovery_history[0].panel.clipped_cells, 1);
  assert.equal(audit.presentation.recovery_history.length, 2);
  assert.doesNotThrow(() => validateAuditPresentation(audit.presentation));
  await f.panel.open("POSITIONS", { replay_end: f.end });
  const positions = await f.panel.screenshot("positions_final.png");
  assert.equal(positions.presentation.view, "POSITIONS"); assert.equal(positions.presentation.clipped_cells, 0);
  assert.ok(f.keys.some(k => k.key === "Escape")); assert.ok(f.keys.some(k => k.modifiers === 2));
  assert.ok(f.writes.every(key => ["view", "text", "width"].includes(key)));
});

test("unrecoverable clipping has complete replay/pane/geometry evidence and debug pixels, not details={}", async () => {
  const f = fixture({ stuck: true });
  await assert.rejects(f.panel.open("AUDIT", { replay_end: f.end }), error => {
    assert.equal(error.code, "TV_DEDICATED_PANEL_UNPROVEN");
    assert.equal(error.details.replay_complete, true); assert.equal(error.details.stage, "CAPTURING_RESULTS");
    for (const key of ["tradingview_current_time", "replay_state", "pane_count", "pane_index", "smc398_found", "view",
      "title", "native_table", "rows", "columns", "clipped_cells", "bounds", "rendered_tables", "maximized",
      "table_contained_in_pane", "browser_zoom", "capture_scale", "reason", "recovery_history", "debug_artifact"]) {
      assert.ok(Object.hasOwn(error.details, key), key);
    }
    assert.equal(error.details.recovery_history.length, 2);
    assert.ok(error.details.reasons.includes("CLIPPED_CELLS"));
    assert.equal(error.diagnostic_image_base64, "SYNTHETIC_DEBUG_PIXELS"); return true;
  });
  assert.equal(f.screenshots.length, 1); assert.equal(f.screenshots[0].clip, undefined);
});

test("layout instability reaches a bounded diagnostic failure instead of a fixed-delay capture", async () => {
  const f = fixture(), proof = f.panel.proof.bind(f.panel); let offset = 0;
  f.panel.context = { replay_end: f.end };
  f.panel.proof = async () => ({ ...await proof(), bounds: { x: offset++, y: 0, width: 5000, height: 1200 } });
  await assert.rejects(f.panel.awaitLayout(), error => error.details.reasons.includes("LAYOUT_NOT_STABLE"));
});

test("technical receipt accepts a fully contained smaller pane, not a hardcoded 900px requirement", () => {
  const panel = { dedicated_panel: true, maximized: true, complete_table: true, native_table: true,
    view: "AUTO", title: "AUDIT FIN SESSION", pane_index: 1, bounds: { height: 400 }, minimum_font_size: 14 };
  assert.doesNotThrow(() => validateAuditPresentation(panel));
});
