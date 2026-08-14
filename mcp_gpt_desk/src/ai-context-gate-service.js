import { evaluateAiContextGateV1 } from "@tv-automation/desk-domain";
import { createAiContextGateRepository } from "./ai-context-gate-repository.js";

export class AiContextGateService {
  constructor({ repository, persistence } = {}) {
    this.repository = repository || createAiContextGateRepository(persistence);
  }

  async evaluateAndPersist(input = {}) {
    if (!this.repository?.recordDecision) throw serviceError("AI_CONTEXT_GATE_REPOSITORY_UNAVAILABLE", "AI Context Gate repository is required.");
    const result = evaluateAiContextGateV1(input);
    const persistence = await this.recordEvaluatedResult({ ...input, result });
    return { status: result.status, result, persistence };
  }

  async recordEvaluatedResult(input = {}) {
    if (!this.repository?.recordDecision) throw serviceError("AI_CONTEXT_GATE_REPOSITORY_UNAVAILABLE", "AI Context Gate repository is required.");
    return this.repository.recordDecision({
      result: input.result || input.decision || input,
      idempotency_key: input.idempotency_key || input.idempotencyKey,
      agent_task_id: input.agent_task_id || input.agentTaskId,
      signal_id: input.signal_id || input.signalId,
      candidate_allocation_id: input.candidate_allocation_id || input.candidateAllocationId,
      position_id: input.position_id || input.positionId,
    });
  }
}

function serviceError(code, message) { const error = new Error(message || code); error.code = code; error.statusCode = 503; return error; }
