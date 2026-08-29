import { describe, expect, it } from "vitest";
import { statusTone } from "./mapper";

describe("command center operational status tones", () => {
  it.each([
    "BLOCKED",
    "KILL_SWITCH_ACTIVE",
    "FAILED",
    "CRITICAL",
    "REJECTED",
  ])("renders %s as a danger state", (status) => {
    expect(statusTone(status)).toBe("danger");
  });

  it("does not promote an unknown backend status to healthy", () => {
    expect(statusTone("NEW_BACKEND_STATUS")).toBe("info");
  });
});
