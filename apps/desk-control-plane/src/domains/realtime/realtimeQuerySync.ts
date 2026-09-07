import type { QueryClient } from "@tanstack/react-query";
import { matchesFrontViewQuery, type FrontViewScopeMatch } from "@/domains/front-api/repositories";
import {
  frontViewNamesForRealtimeEvent,
  frontViewNamesForRealtimeRecovery,
  reduceRealtimeEvent,
  type EventEnvelope,
  type RealtimeEventState,
} from "@/domains/realtime/eventEnvelope";
import type { FrontViewName } from "@/shared/contracts";

type RealtimeQueryCallbacks = {
  onError(message: string | null): void;
  onRecoveryState(active: boolean): void;
};

type QueryFailure = {
  operationId: number;
  source: "CONNECTION" | "QUERY";
};

export type RealtimeEventAdmission = {
  state: RealtimeEventState;
  disposition: "ACCEPTED" | "DUPLICATE" | "OUT_OF_ORDER" | "SEQUENCE_GAP";
  applyCommandEffect: boolean;
  refreshCanonicalQueries: boolean;
  requiresRecovery: boolean;
};

export function admitRealtimeEvent(
  current: RealtimeEventState,
  event: EventEnvelope,
): RealtimeEventAdmission {
  const state = reduceRealtimeEvent(current, event);
  if (state.duplicateCount > current.duplicateCount) {
    return { state, disposition: "DUPLICATE", applyCommandEffect: false, refreshCanonicalQueries: false, requiresRecovery: false };
  }
  if (state.sequenceGapCount > current.sequenceGapCount) {
    return { state, disposition: "SEQUENCE_GAP", applyCommandEffect: false, refreshCanonicalQueries: false, requiresRecovery: true };
  }
  if (state.outOfOrderCount > current.outOfOrderCount) {
    return { state, disposition: "OUT_OF_ORDER", applyCommandEffect: false, refreshCanonicalQueries: true, requiresRecovery: false };
  }
  return { state, disposition: "ACCEPTED", applyCommandEffect: true, refreshCanonicalQueries: true, requiresRecovery: false };
}

export function invalidateRealtimeEventQueries(
  queryClient: QueryClient,
  event: EventEnvelope,
): Promise<void> {
  return invalidateMatchingQueries(queryClient, frontViewNamesForRealtimeEvent(event), "DESK_ONLY");
}

export function refetchRealtimeRecoveryQueries(queryClient: QueryClient): Promise<void> {
  const viewNames = frontViewNamesForRealtimeRecovery();
  return queryClient.refetchQueries({
    type: "active",
    predicate: (query) => matchesFrontViewQuery(query.queryKey, viewNames, "INCLUDING_MARKET_SERIES"),
  }, { throwOnError: true });
}

export function invalidateFrontViewQueries(
  queryClient: QueryClient,
  viewNames: readonly FrontViewName[],
): Promise<void> {
  return invalidateMatchingQueries(queryClient, viewNames, "DESK_ONLY");
}

export class RealtimeQuerySynchronizer {
  private active = true;
  private issuedOperation = 0;
  private settledOperation = 0;
  private recoveryGeneration = 0;
  private recoveryActive = false;
  private refreshPromise: Promise<void> | null = null;
  private failure: QueryFailure | null = null;
  private readonly pendingViewNames = new Set<FrontViewName>();

  constructor(
    private readonly queryClient: QueryClient,
    private readonly callbacks: RealtimeQueryCallbacks,
  ) {}

  recordConnectionError(error: unknown): void {
    const operationId = ++this.issuedOperation;
    this.settledOperation = operationId;
    this.failure = { operationId, source: "CONNECTION" };
    if (this.active) this.callbacks.onError(errorMessage(error));
  }

  async refreshInvalidatedViews(viewNames: readonly FrontViewName[]): Promise<void> {
    if (!this.active) return;
    viewNames.forEach((viewName) => this.pendingViewNames.add(viewName));
    if (this.recoveryActive) return;
    await this.ensureRefreshDrain();
  }

  async recover(): Promise<void> {
    if (!this.active) return;
    const generation = ++this.recoveryGeneration;
    const operationId = ++this.issuedOperation;
    this.recoveryActive = true;
    this.callbacks.onRecoveryState(true);
    try {
      await this.refreshPromise;
      await refetchRealtimeRecoveryQueries(this.queryClient);
      if (!this.isCurrentRecovery(generation)) return;
      await this.flushPendingViews();
      this.settleSuccess(operationId, "ALL");
    } catch (error) {
      if (this.isCurrentRecovery(generation)) this.settleFailure(operationId, error);
    } finally {
      if (this.isCurrentRecovery(generation)) {
        this.recoveryActive = false;
        this.callbacks.onRecoveryState(false);
        if (this.pendingViewNames.size > 0) void this.ensureRefreshDrain();
      }
    }
  }

  close(): void {
    this.active = false;
    this.recoveryGeneration += 1;
    this.pendingViewNames.clear();
  }

  private async flushPendingViews(): Promise<void> {
    while (this.pendingViewNames.size > 0) {
      const viewNames = [...this.pendingViewNames];
      this.pendingViewNames.clear();
      await invalidateFrontViewQueries(this.queryClient, viewNames);
    }
  }

  private ensureRefreshDrain(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    const refreshPromise = this.drainInvalidatedViews().finally(() => {
      if (this.refreshPromise !== refreshPromise) return;
      this.refreshPromise = null;
      if (this.active && !this.recoveryActive && this.pendingViewNames.size > 0) {
        void this.ensureRefreshDrain();
      }
    });
    this.refreshPromise = refreshPromise;
    return refreshPromise;
  }

  private async drainInvalidatedViews(): Promise<void> {
    while (this.active && !this.recoveryActive && this.pendingViewNames.size > 0) {
      const viewNames = [...this.pendingViewNames];
      this.pendingViewNames.clear();
      const operationId = ++this.issuedOperation;
      try {
        await invalidateFrontViewQueries(this.queryClient, viewNames);
        this.settleSuccess(operationId, "QUERY_ONLY");
      } catch (error) {
        this.settleFailure(operationId, error);
      }
    }
  }

  private isCurrentRecovery(generation: number): boolean {
    return this.active && generation === this.recoveryGeneration;
  }

  private settleFailure(operationId: number, error: unknown): void {
    if (!this.active || operationId < this.settledOperation) return;
    this.settledOperation = operationId;
    this.failure = { operationId, source: "QUERY" };
    this.callbacks.onError(errorMessage(error));
  }

  private settleSuccess(operationId: number, clearance: "QUERY_ONLY" | "ALL"): void {
    if (!this.active || operationId < this.settledOperation) return;
    this.settledOperation = operationId;
    if (!this.failure || this.failure.operationId > operationId) return;
    if (clearance === "QUERY_ONLY" && this.failure.source !== "QUERY") return;
    this.failure = null;
    this.callbacks.onError(null);
  }
}

function invalidateMatchingQueries(
  queryClient: QueryClient,
  viewNames: readonly FrontViewName[],
  scopeMatch: FrontViewScopeMatch,
): Promise<void> {
  return queryClient.invalidateQueries({
    refetchType: "active",
    predicate: (query) => matchesFrontViewQuery(query.queryKey, viewNames, scopeMatch),
  }, { cancelRefetch: false, throwOnError: true });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "BFF_REALTIME_REFRESH_FAILED";
}
