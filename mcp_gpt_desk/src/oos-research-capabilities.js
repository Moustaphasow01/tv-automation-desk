import { spawn } from "node:child_process";
import { resolveCodexInvocation, sanitizedCodexEnv } from "./codex-exec-adapter.js";

const PREFERENCE = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol"];
const failure = code => Object.assign(new Error(code), { code });

/** model/list is a read-only capability query, not inference, and never launches a conversation. */
export function discoverResearchModels({ codex_bin, timeout_ms = 60000, priority = PREFERENCE, spawnProcess = spawn }) {
  return queryResearchMetadata({codex_bin,timeout_ms,spawnProcess,method:"model/list",
    params:{limit:100,includeHidden:false}}).then(result=>{
    if(!Array.isArray(result?.data) || result.nextCursor)throw failure("RESEARCH_MODEL_CATALOGUE_INCOMPLETE");
    return mapModels(result.data,priority);
  });
}

/** Read the service account's quota, never the desktop user's inferred quota or a credit reset. */
export async function discoverResearchQuota(options) {
  const result=await queryResearchMetadata({...options,method:"account/rateLimits/read",params:{}});
  const buckets=result.rateLimitsByLimitId ?? (result.rateLimits?{[result.rateLimits.limitId??"codex"]:result.rateLimits}:{});
  return {source:"CODEX_APP_SERVER_ACCOUNT_RATE_LIMITS",observed_at:new Date().toISOString(),
    windows:Object.entries(buckets).flatMap(([bucket,value])=>["primary","secondary"].flatMap(window=>{
      const row=value?.[window];
      return row && Number.isFinite(row.usedPercent)?[{bucket,window,used_percent:row.usedPercent,
        resets_at:Number.isFinite(row.resetsAt)?new Date(row.resetsAt*1000).toISOString():null}]:[];
    }))};
}

function queryResearchMetadata({codex_bin,timeout_ms=60000,spawnProcess=spawn,method,params}) {
  const invocation = resolveCodexInvocation(codex_bin, ["app-server"]);
  const child = spawnProcess(invocation.executable, invocation.args, { stdio: ["pipe", "pipe", "pipe"],
    env: sanitizedCodexEnv(process.env), windowsHide: true,
    ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) });
  return queryModels(child, timeout_ms,method,params);
}

function queryModels(child, timeout,method,params) {
  return new Promise((resolve, reject) => {
    let buffer = "", size = 0, finished = false;
    const finish = (error, rows) => {
      if (finished) return; finished = true; clearTimeout(timer);
      child.stdin.end(); child.kill(); child.stdout.destroy(); child.stderr.destroy();
      error ? reject(error) : resolve(rows);
    };
    const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
    const timer = setTimeout(() => finish(failure("RESEARCH_MODEL_DISCOVERY_TIMEOUT")), timeout);
    child.on("error", () => finish(failure("RESEARCH_MODEL_DISCOVERY_UNAVAILABLE")));
    child.stdin.on("error", () => finish(failure("RESEARCH_MODEL_DISCOVERY_UNAVAILABLE")));
    child.on("exit", () => { if (!finished) finish(failure("RESEARCH_MODEL_DISCOVERY_INTERRUPTED")); });
    child.stderr.on("data", () => {}); // Never publish CLI diagnostics or credentials in capability responses.
    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) return finish(failure("RESEARCH_MODEL_DISCOVERY_TOO_LARGE"));
      buffer += chunk.toString(); let pos;
      while (!finished && (pos = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
        let response; try { response = JSON.parse(line); } catch { continue; }
        if (response.error) return finish(failure("RESEARCH_MODEL_DISCOVERY_REJECTED"));
        if (response.id === 1) {
          send({ method: "initialized", params: {} });
          send({ method, id: 2, params });
        }
        if (response.id === 2) {
          finish(null, response.result);
        }
      }
    });
    send({ method: "initialize", id: 1, params: { clientInfo: {
      name: "desk-oos-research-capabilities", title: "Read-only model discovery", version: "1.0.0" } } });
  });
}

function mapModels(rows, priority) {
  const selected = rows.filter(row => priority.includes(row.model ?? row.id));
  if (!selected.length) throw failure("RESEARCH_MODEL_PREFERENCE_NOT_AVAILABLE");
  return selected.map(row => ({ identifier: row.model ?? row.id, available: true,
    reasoning: true, reasoning_efforts: (row.supportedReasoningEfforts ?? []).map(r => r.reasoningEffort),
    capability_rank: priority.length - priority.indexOf(row.model ?? row.id),
    rank_source: "EXPLICIT_RESEARCH_MODEL_PREFERENCE_NOT_PROVIDER_BENCHMARK",
    capability_source: "CODEX_APP_SERVER_MODEL_LIST", verified_at: new Date().toISOString() }));
}
