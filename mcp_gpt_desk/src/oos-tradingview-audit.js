import { oosTvError } from "./oos-tradingview-engine.js";

const VALUE = "(N/D|-?[0-9]+(?:[.,][0-9]+)?)";
const METRICS = ["fills", "wins", "losses", "net_r", "net_usd", "mfe_p", "mfe_n", "mae", "duration",
  "time_to_mfe", "mfe_to_exit", "giveback", "cf_be_0_5", "cf_be_1", "cf_be_1_5", "p1_at_1r",
  "rearm", "fallback_1m", "fallback_15m", "event_count", "dropped_events"];

/** Decode ENGINE-published numbers only. No counting events, trade arithmetic or substitute simulation. */
export function extractOosPublishedAudit(published) {
  if (!Array.isArray(published.tables) || !published.tables.length) throw oosTvError("TV_PUBLISHED_AUDIT_REQUIRED");
  const cells = published.tables.flatMap(t => t.cells), text = cells.map(c => c.text).join("\n");
  const metrics = Object.fromEntries(METRICS.map(key => [key, null])), provenance = {};
  const read = (keys, pattern) => {
    const match = new RegExp(pattern, "m").exec(text);
    if (!match) return;
    keys.forEach((key, index) => {
      metrics[key] = match[index + 1] === "N/D" ? null : Number(match[index + 1].replace(",", "."));
      provenance[key] = { source: "SMC398 dashboard", published_text: match[0] };
    });
  };
  read(["fills"], `^Fills ${VALUE}$`);
  read(["wins", "losses"], `^W/L ${VALUE}/${VALUE}$`);
  read(["net_usd", "net_r"], `^Net ${VALUE}\\$ \\| ${VALUE}R$`);
  read(["mfe_p", "mfe_n"], `^MFEp/n ${VALUE}/${VALUE}$`);
  read(["mae"], `^MAEp ${VALUE}$`);
  read(["duration", "time_to_mfe"], `^Dur/TTM ${VALUE}/${VALUE}m$`);
  read(["giveback"], `^GBn ${VALUE}$`);
  read(["cf_be_0_5"], `^BE\\.5 ${VALUE}$`);
  read(["cf_be_1"], `^BE1 ${VALUE}$`);
  read(["cf_be_1_5"], `^BE1\\.5 ${VALUE}$`);
  read(["p1_at_1r"], `^P1@1R ${VALUE}$`);
  read(["fallback_1m", "fallback_15m"], `^1m/15 ${VALUE}/${VALUE}(?: FB .*)?$`);
  read(["event_count", "dropped_events"], `^evt/drop ${VALUE}/${VALUE}$`);
  read(["rearm"], `^(?:Rearm|rearm|REARM) ${VALUE}$`);
  const shadow = readShadow(text);
  return { schema_version: "oos-published-audit/1", ...metrics, shadow,
    refusal_rows: cells.filter(c => /Ref |RR_GROSS|RR_NET|TARGET_BEFORE_ORDER|LIMIT_PASSED|BODY_DIRECTION|GEOMETRY|STOP_TOO_SMALL|ORDER_EXPIRED/.test(c.text)),
    fallback_rows: cells.filter(c => /1m\/15|fallback|FB |first|last/i.test(c.text)),
    rearm_rows: cells.filter(c => /rearm|rearmement/i.test(c.text)),
    metric_provenance: provenance, missing_metrics: METRICS.filter(key => metrics[key] === null),
    published_tables: published.tables, published_logs: published.logs,
    source: "ENGINE_PUBLISHED_ONLY", recalculated: false };
}

function readShadow(text) {
  const shadow = Object.fromEntries(["created", "resolved", "open", "win", "loss", "nofill", "unknown"].map(k => [k, null]));
  const patterns = [["^SH C/R/O ([0-9]+)/([0-9]+)/([0-9]+)$", ["created", "resolved", "open"]],
    ["^SH W/L/NF/N ([0-9]+)/([0-9]+)/([0-9]+)/([0-9]+)$", ["win", "loss", "nofill", "unknown"]]];
  for (const [pattern, keys] of patterns) {
    const match = new RegExp(pattern, "m").exec(text);
    if (match) keys.forEach((key, index) => { shadow[key] = Number(match[index + 1]); });
  }
  return shadow;
}
