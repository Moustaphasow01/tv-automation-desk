const adapterModuleUrl = process.env.DESK_CODEX_ADAPTER_URL
  || new URL("../src/codex-exec-adapter.js", import.meta.url).href;
const { CodexExecAdapter } = await import(adapterModuleUrl);

const adapter = new CodexExecAdapter({
  codexBin: process.env.DESK_CODEX_BIN,
  codexHome: process.env.CODEX_HOME,
  cwd: process.cwd(),
});
const preflight = await adapter.preflight();
const result = await adapter.analyze({
  prompt: [
    "This is an isolated service canary. Do not perform any action.",
    "Return the required structured output with exactly these values:",
    "- schema_version: desk_ai_analysis_output_v1",
    '- save_payload_json: {"canary":"CANARY_OK"}',
    "- supplementary_writes_json: []",
    "- decision_summary: CANARY_OK",
    "- data_quality_status: ready",
    "- warnings: []",
  ].join("\n"),
});

if (
  result.output.decision_summary !== "CANARY_OK"
  || result.output.save_payload?.canary !== "CANARY_OK"
) {
  throw new Error("Codex inference canary returned an unexpected structured output.");
}

process.stdout.write(`${JSON.stringify({
  schema: "desk_codex_inference_canary_v1",
  checked_at_utc: new Date().toISOString(),
  ok: true,
  status: "CANARY_OK",
  codex_version: preflight.version,
  telemetry: {
    provider: result.telemetry.provider,
    input_tokens: result.telemetry.input_tokens,
    cached_input_tokens: result.telemetry.cached_input_tokens,
    output_tokens: result.telemetry.output_tokens,
    reasoning_output_tokens: result.telemetry.reasoning_output_tokens,
    event_count: result.telemetry.event_count,
  },
})}\n`);
