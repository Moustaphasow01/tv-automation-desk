import { describe, expect, it } from "vitest";
import { resolveAutomaticSession } from "@/context/DeskContext";

describe("automatic market phase (Europe/Paris)", () => {
  it.each([
    ["2026-07-14T05:59:00.000Z", "asia", "asia_open", "08:00"],
    ["2026-07-14T06:00:00.000Z", "london", "asia_open", "15:30"],
    ["2026-07-14T13:29:00.000Z", "london", "asia_open", "15:30"],
    ["2026-07-14T13:30:00.000Z", "ny", "ny_open", "00:00"],
    ["2026-07-14T21:59:00.000Z", "ny", "ny_open", "00:00"],
    ["2026-07-14T22:00:00.000Z", "asia", "asia_open", "08:00"],
  ])("maps %s to %s", (iso, phase, sessionId, nextPhaseAt) => {
    expect(resolveAutomaticSession(new Date(iso))).toMatchObject({ phase, sessionId, nextPhaseAt });
  });
});
