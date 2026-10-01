import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { sha256 } from "./artifact-archive.js";
import { requireFact } from "../domain/batch-contract.js";

const root = new URL("../../", import.meta.url);
const syntaxFiles = ["smc3-syntax.js", "smc3-syntax-values.js", "smc3-syntax-records.js"];
export async function readRuntimeContractSource() {
  const snapshot = JSON.parse(await readFile(new URL("contracts/engine-v3.9.8.source.json", root), "utf8"));
  const source = gunzipSync(Buffer.from(snapshot.source_gzip_base64, "base64")).toString("utf8");
  requireFact(sha256(source) === snapshot.source_sha256, "ENGINE_SOURCE_HASH_MISMATCH");
  const syntax = await Promise.all(syntaxFiles.map(async name => {
    const text = await readFile(new URL(`src/domain/${name}`, root), "utf8");
    return { path: `packages/desk-oos-batch/src/domain/${name}`, sha256: sha256(text), text };
  }));
  return { snapshot, source, syntax };
}

export function pineSourceFacts({ source, snapshot }) {
  const constant = name => {
    const match = source.match(new RegExp(`^const (?:string|int) ${name} = ("[^"]*"|[0-9]+)`, "m"));
    requireFact(match, "ENGINE_SOURCE_CONSTANT_MISSING", { name }); return JSON.parse(match[1]);
  };
  const inputs = Object.fromEntries([...source.matchAll(/^(?:string|bool|int|float) (\w+) = input\.\w+\((.*?), "([^"]+)"/gm)]
    .filter(([, name]) => name !== "planText").map(([, name, literal, title]) => {
      const info = snapshot.installed.inputs.find(input => input.name === title);
      const current = snapshot.installed.values.find(input => input.id === info?.id);
      requireFact(current, "ENGINE_RUNTIME_INPUT_MISSING", { name });
      return [name, { id: info.id, title, default: JSON.parse(literal), value: current.value }];
    }));
  const readNumber = expression => {
    const match = source.match(expression); requireFact(match, "ENGINE_SOURCE_RULE_MISSING"); return Number(match[1]);
  };
  return { version: constant("VERSION"), timezone: constant("PLAN_TZ"), bar_ms: constant("PLAN_BAR_MS"),
    max_text: constant("PLAN_TEXT_MAX"), store_limit: constant("STORE_LIMIT"), inputs,
    rr_gross: readNumber(/s\.rrGross < ([0-9.]+) - 1e-8/), rr_net: readNumber(/s\.rr < ([0-9.]+) - 1e-8/),
    stop_atr_buffer: readNumber(/nz\(previousAtr, 0\) \* ([0-9.]+)/),
    entry_start: source.match(/p\.entryStart := f_cclock\(p, p\.session, "([^"]+)"\)/)?.[1],
    entry_end: source.match(/p\.entryEnd := f_cclock\(p, p\.session, "([^"]+)"\)/)?.[1],
    execution_period: source.match(/timeframe\.period != "([^"]+)"/)?.[1],
    intrabar_period: source.match(/request\.security_lower_tf\(syminfo\.tickerid, "([^"]+)"/)?.[1] };
}

export function pineFunctionSource(source, name) {
  const lines = source.split(/\r?\n/), start = lines.findIndex(line => line.startsWith(`${name}(`));
  requireFact(start >= 0, "ENGINE_SOURCE_FUNCTION_MISSING", { name });
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(" ") || !lines[end].trim() || lines[end].startsWith("//"))) end++;
  return { file: "ENGINE V3.9.8 / TradingView Pine 19.0", function: name, line: start + 1, source: lines.slice(start, end).join("\n").trimEnd() };
}
