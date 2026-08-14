import { describe, expect, it } from "vitest";
import { researchComputeSchedulerView, researchLabView } from "@/mocks/canonicalDataset";
import { prepareDeskCommand } from "@/domains/realtime/commandRuntime";
import { isResearchComputeSchedulerView } from "@/domains/front-api/viewModels";
import { assertViewEnvelope } from "@/shared/contracts";

describe("research compute scheduler front contract", () => {
  it("accepts the canonical Research Compute Scheduler view envelope", () => {
    const envelope = assertViewEnvelope(researchComputeSchedulerView, isResearchComputeSchedulerView);

    expect(envelope.data.summary.runningJobs).toBeGreaterThanOrEqual(3);
    expect(envelope.data.pools.length).toBeGreaterThanOrEqual(3);
    expect(envelope.data.workers.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.jobs.length).toBeGreaterThanOrEqual(5);
    expect(envelope.data.commandActions.length).toBeGreaterThanOrEqual(4);
  });

  it("uses the same research compute job ids as Research Lab", () => {
    const schedulerJobIds = new Set(researchComputeSchedulerView.data.jobs.map((job) => job.jobId));
    const labJobIds = new Set(researchLabView.data.computeQueue.map((job) => job.jobId));

    expect([...labJobIds].every((jobId) => schedulerJobIds.has(jobId))).toBe(true);
  });

  it("keeps jobs, workers, reservations and DLQ linked to known pools/jobs", () => {
    const poolIds = new Set(researchComputeSchedulerView.data.pools.map((pool) => pool.poolId));
    const jobIds = new Set(researchComputeSchedulerView.data.jobs.map((job) => job.jobId));

    expect(researchComputeSchedulerView.data.jobs.every((job) => poolIds.has(job.poolId))).toBe(true);
    expect(researchComputeSchedulerView.data.workers.every((worker) => poolIds.has(worker.poolId))).toBe(true);
    expect(researchComputeSchedulerView.data.workers.every((worker) => !worker.currentJobId || jobIds.has(worker.currentJobId))).toBe(true);
    expect(researchComputeSchedulerView.data.reservations.every((reservation) => poolIds.has(reservation.poolId))).toBe(true);
    expect(researchComputeSchedulerView.data.dlq.every((item) => jobIds.has(item.jobId))).toBe(true);
  });

  it("makes LIVE reserved capacity explicit and protected", () => {
    const livePool = researchComputeSchedulerView.data.pools.find((pool) => pool.mode === "LIVE_RESERVED");
    const liveReservation = researchComputeSchedulerView.data.reservations.find((reservation) => reservation.scope === "LIVE");
    const liveJob = researchComputeSchedulerView.data.jobs.find((job) => job.priority === "LIVE_PROTECTED");

    expect(livePool).toBeDefined();
    expect(livePool!.reservedForLivePct).toBe(100);
    expect(liveReservation?.active).toBe(true);
    expect(researchComputeSchedulerView.data.summary.liveReservedPct).toBeGreaterThanOrEqual(35);
    expect(liveJob?.poolId).toBe(livePool!.poolId);
  });

  it("turns compute actions into Command Runtime requests", () => {
    const allowedActions = researchComputeSchedulerView.data.commandActions.filter((item) => item.permission === "ALLOWED");

    expect(allowedActions.length).toBeGreaterThanOrEqual(3);
    for (const action of allowedActions) {
      const prepared = prepareDeskCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Research compute action confirmed: ${action.label}`,
        payload: action.payload
      });

      expect(action.commandType).toMatch(/^research\.compute\./);
      expect(prepared.status).toBe("REQUESTED");
      expect(prepared.expectedVersion).toBe(action.actionId);
    }
  });
});
