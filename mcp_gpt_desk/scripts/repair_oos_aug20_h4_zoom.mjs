import { readFile } from "node:fs/promises";
import pg from "pg";
import { createOosRuntime } from "@tv-automation/desk-oos-batch";
import { OosMcpConnection } from "../src/oos-mcp-connection.js";
import { OosTradingViewCapture, OOS_TV_TOOLS } from "../src/oos-tradingview-capture.js";

// Explicit one-day, one-capture operation. No builder, parser, replay bridge or broker is assembled.
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
if (config.batch_id !== "OOS" || config.tradingview.adapter !== "tradingview-jackson") throw new Error("REPAIR_CONFIGURATION_REJECTED");
const tv = new OosMcpConnection({ ...config.tradingview, tools: OOS_TV_TOOLS });
const capture = new OosTradingViewCapture({ connection: tv, chartId: config.tradingview.chart_id, screenshotRoot: config.tradingview.screenshot_root });
const pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL, max: 4 });
const deny = () => { throw new Error("REPAIR_NON_CAPTURE_OPERATION_REJECTED"); };
const runtime = createOosRuntime({ pool, root: config.archive_root, tradingViewCall: capture.call.bind(capture), builderCall: deny, validatorCall: deny });
const command = { day: { batch_id: "OOS", date: "2026-08-20", symbol: "CME_MINI:MES1!", timezone: "Europe/Paris",
  cutoff: "2026-08-20T09:00:00+02:00", schema: "SMC3", engine_version: "V3.9.8", book_mode: "PORTEFEUILLE_REALISTE" },
  capture: "4h_zoom.png", expected_manifest_sha256: "8a2e2aa5611e117efbf5963275775301b94694fcee68477b6cf3158649f4d046" };
try {
  const first = await runtime.captureRepair.execute(command), second = await runtime.captureRepair.execute(command);
  if (first.manifest_sha256 !== second.manifest_sha256) throw new Error("REPAIR_IDEMPOTENCE_FAILED");
  console.log(JSON.stringify({ ...first, idempotence: "PASS" }));
} finally { await tv.close(); await pool.end(); }
