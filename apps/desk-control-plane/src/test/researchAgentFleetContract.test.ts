import { describe, expect, it } from "vitest";
import { researchAgentFleetView, researchLabView } from "@/mocks/canonicalDataset";
import { prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { isResearchAgentFleetView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("research agent fleet front contract", () => {
  it("accepts the canonical Research Agent Fleet view envelope", () => {
    const envelope = assertViewEnvelope(researchAgentFleetView, isResearchAgentFleetView);

    expect(envelope.data.summary.totalAgents).toBe(4);
    expect(envelope.data.agents.length).toBe(envelope.data.summary.totalAgents);
    expect(envelope.data.queue.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(3);
  });

  it("uses the exact AI research agents already exposed by Research Lab", () => {
    const labAgents = new Set(researchLabView.data.agents.map((agent) => agent.agentId));
    const labMissions = new Set(researchLabView.data.experiments.map((experiment) => experiment.missionId));

    expect(researchAgentFleetView.data.agents.every((agent) => labAgents.has(agent.agentId))).toBe(true);
    expect(researchAgentFleetView.data.agents.every((agent) => labMissions.has(agent.missionId))).toBe(true);
    expect(researchAgentFleetView.data.conversations.every((conversation) => labAgents.has(conversation.agentId))).toBe(true);
  });

  it("keeps queue, incidents and command actions linked to known agents and missions", () => {
    const agentIds = new Set(researchAgentFleetView.data.agents.map((agent) => agent.agentId));
    const missionIds = new Set(researchAgentFleetView.data.agents.map((agent) => agent.missionId));

    expect(researchAgentFleetView.data.queue.every((item) => agentIds.has(item.agentId) && missionIds.has(item.missionId))).toBe(true);
    expect(researchAgentFleetView.data.incidents.every((incident) => agentIds.has(incident.agentId))).toBe(true);
    expect(researchAgentFleetView.data.commandActions.every((action) => agentIds.has(action.agentId))).toBe(true);
  });

  it("does not confuse AI workers with deterministic engines", () => {
    const forbidden = /risk engine|execution engine|portfolio engine|broker engine|risk\/execution\/portfolio/i;
    const searchableAgentText = researchAgentFleetView.data.agents
      .flatMap((agent) => [agent.agentId, agent.name, agent.type, agent.role, agent.currentTask, agent.model])
      .join("\n");

    expect(searchableAgentText).not.toMatch(forbidden);
    expect(researchAgentFleetView.data.agents.every((agent) => agent.type !== undefined && agent.model.startsWith("codex-"))).toBe(true);
  });

  it("turns agent actions into Command Runtime requests", () => {
    const allowedActions = researchAgentFleetView.data.commandActions.filter((item) => item.permission === "ALLOWED");

    expect(allowedActions.length).toBeGreaterThanOrEqual(2);
    for (const action of allowedActions) {
      const prepared = prepareDeskCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Research agent action confirmed: ${action.label}`,
        payload: action.payload
      });

      expect(action.commandType).toMatch(/^research\.(agent|mission)\./);
      expect(prepared.status).toBe("REQUESTED");
      expect(prepared.expectedVersion).toBe(action.actionId);
    }
  });
});
