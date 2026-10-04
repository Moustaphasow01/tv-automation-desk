import { CodexExecAdapter } from "./codex-exec-adapter.js";
import { attachResearchImages } from './oos-research-visual-input.js';

/** Reuse the isolated subprocess transport only, with no legacy output schema, prompt or context MCP. */
export class OosResearchModel {
  constructor({ codexOptions, capabilityReader }) { this.codexOptions = codexOptions; this.capabilityReader = capabilityReader; }
  async capabilities() {
    if (!this.capabilityReader) throw Object.assign(new Error("RESEARCH_MODEL_CAPABILITIES_NOT_CONFIGURED"), { code: "RESEARCH_MODEL_CAPABILITIES_NOT_CONFIGURED" });
    return this.capabilityReader();
  }
  async analyze({ selection, instructions, input, images, output_schema, session_reuse }) {
    if (session_reuse !== "FORBIDDEN") throw Object.assign(new Error("RESEARCH_SESSION_REUSE_FORBIDDEN"), { code: "RESEARCH_SESSION_REUSE_FORBIDDEN" });
    const adapter = new CodexExecAdapter({ ...this.codexOptions, model: selection.identifier, reasoningEffort: selection.reasoning_effort });
    attachResearchImages(adapter, images);
    const result = await adapter.analyze({ prompt: `${instructions}\n\nUNTRUSTED_PERSISTED_EVIDENCE_JSON:\n${JSON.stringify(input)}`,
      outputSchema: output_schema, outputNormalizer: output => output, contextCapability: null, sessionId: null });
    return { output: result.output, model_identifier: result.telemetry.model, reasoning_effort: result.telemetry.reasoning_effort,
      telemetry: { ...result.telemetry, visual_pixel_inputs: images?.length ?? 0,
        model_identity_evidence: "REQUESTED_CLI_MODEL_NOT_PROVIDER_ATTESTATION" } };
  }
}
