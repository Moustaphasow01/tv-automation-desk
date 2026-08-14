import { describe, expect, it } from "vitest";
import { researchLabView } from "@/mocks/canonicalDataset";
import { isResearchLabView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("research lab front contract", () => {
  it("accepts the canonical Research Lab view envelope", () => {
    const envelope = assertViewEnvelope(researchLabView, isResearchLabView);

    expect(envelope.data.pipeline.map((stage) => stage.stageId)).toEqual([
      "IDEA",
      "BASELINE",
      "ITERATION",
      "ROBUSTNESS",
      "OOS",
      "PAPER_READY"
    ]);
    expect(envelope.data.experiments.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.agents.length).toBeGreaterThanOrEqual(4);
    expect(envelope.data.computeQueue.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.commandActions.some((action) => action.commandType === "research.bootstrap_demo_paper")).toBe(true);
  });

  it("keeps research entities linked by stable mission, run, agent and compute ids without human assignees", () => {
    const { experiments, agents, computeQueue } = researchLabView.data;
    const missionIds = new Set(experiments.map((experiment) => experiment.missionId));
    const allowedResearchAgents = new Set([
      "Hypothesis Agent",
      "Experiment Agent",
      "Strategy Builder",
      "Quantitative Validator",
      "Robustness Auditor",
      "OOS Validator",
      "Research Reviewer",
      "Data Scout",
      "Knowledge Curator"
    ]);

    expect([...missionIds].every((missionId) => missionId.startsWith("mission_research_"))).toBe(true);
    expect(experiments.every((experiment) => experiment.runId.startsWith("run_research_"))).toBe(true);
    expect(agents.every((agent) => agent.agentId.startsWith("agent_"))).toBe(true);
    expect(agents.every((agent) => allowedResearchAgents.has(agent.name))).toBe(true);
    expect(computeQueue.every((job) => missionIds.has(job.missionId))).toBe(true);
    expect(JSON.stringify(researchLabView.data).toLowerCase()).not.toMatch(/assign|assigned|humain|moustapha/);
  });
});
