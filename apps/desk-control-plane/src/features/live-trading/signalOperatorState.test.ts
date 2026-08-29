import { describe, expect, it } from "vitest";
import { resolveSignalOperatorState } from "./signalOperatorState";

describe("signal operator state", () => {
  it("publishes actionability only from a fresh backend authorization", () => {
    expect(resolveSignalOperatorState({ temporalState: "NEW", projectionAvailable: true, confirmAllowed: true }).code).toBe("ACTIONABLE");
    expect(resolveSignalOperatorState({ temporalState: "NEW", projectionAvailable: false, confirmAllowed: true }).code).toBe("WATCHED");
    expect(resolveSignalOperatorState({ temporalState: "NEW", projectionAvailable: true, confirmAllowed: false }).code).toBe("WATCHED");
  });

  it.each([
    [{ temporalState: "EXPIRED", projectionAvailable: true }, "EXPIRED"],
    [{ temporalState: "NEW", projectionAvailable: true, riskDecision: "BLOCK" }, "REJECTED"],
    [{ temporalState: "NEW", projectionAvailable: true, contextDecision: "WAIT" }, "EVALUATING"],
    [{ temporalState: "FILLED", projectionAvailable: true, theoreticallyTracked: true }, "WATCHED"],
  ] as const)("maps backend facts without inventing a transition", (facts, expected) => {
    expect(resolveSignalOperatorState(facts).code).toBe(expected);
  });
});
