import { describe, expect, it } from "vitest";
import { resolveSignalTemporalState } from "./signalTemporalState";

describe("signal temporal presentation", () => {
  it("presents a non-terminal backend signal as expired once its deadline is elapsed", () => {
    const result = resolveSignalTemporalState({
      state: "NEW",
      expiresAt: "2026-08-27T22:05:00.000Z",
    }, "2026-08-28T08:00:00.000Z");

    expect(result.effectiveState).toBe("EXPIRED");
    expect(result.backendState).toBe("NEW");
    expect(result.mismatch).toBe(true);
  });

  it("does not overwrite terminal backend states", () => {
    const result = resolveSignalTemporalState({
      state: "FILLED",
      expiresAt: "2026-08-27T22:05:00.000Z",
    }, "2026-08-28T08:00:00.000Z");

    expect(result.effectiveState).toBe("FILLED");
    expect(result.mismatch).toBe(false);
  });

  it("prefers the backend projection effective state when published", () => {
    const result = resolveSignalTemporalState({
      state: "ARBITRATED",
      effectiveState: "EXPIRED",
      expiresAt: "unavailable",
    }, "2026-08-28T08:00:00.000Z");

    expect(result.effectiveState).toBe("EXPIRED");
    expect(result.mismatch).toBe(true);
  });
});
