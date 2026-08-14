import { describe, expect, it } from "vitest";
import {
  isExecutionReconciliationView,
  isLiveNewsView,
  isLivePlanView,
  isLiveTimelineView,
  isOperationsObservabilityView,
  isSessionsView
} from "@/domains/front-api/viewModels";

describe("operational P0 view contracts", () => {
  it("accepts the six normalized BFF projections", () => {
    expect(isSessionsView({ summary: {}, sessions: [] })).toBe(true);
    expect(isLivePlanView({ summary: {}, scope: {}, brief: {}, claim: {}, master: {}, thesis: {}, setup: {}, position: {}, levels: [] })).toBe(true);
    expect(isLiveNewsView({ summary: {}, scope: {}, macroEvents: [], headlines: [] })).toBe(true);
    expect(isLiveTimelineView({ summary: {}, scope: {}, events: [] })).toBe(true);
    expect(isExecutionReconciliationView({ summary: {}, reconciliations: [], parityRuns: [], providers: [], accounts: [] })).toBe(true);
    expect(isOperationsObservabilityView({ summary: {}, queue: {}, coverage: {}, runtimeSettings: {}, workerSummary: {}, workers: [], processes: [], workflowBreakdown: [] })).toBe(true);
  });

  it("rejects missing collections instead of accepting a legacy raw payload", () => {
    expect(isSessionsView({ summary: {} })).toBe(false);
    expect(isLivePlanView({ summary: {}, scope: {} })).toBe(false);
    expect(isLiveNewsView({ summary: {}, scope: {}, macro: [] })).toBe(false);
    expect(isLiveTimelineView({ summary: {}, scope: {} })).toBe(false);
    expect(isExecutionReconciliationView({ summary: {}, reconciliations: [] })).toBe(false);
    expect(isOperationsObservabilityView({ summary: {}, queue: {} })).toBe(false);
  });
});
