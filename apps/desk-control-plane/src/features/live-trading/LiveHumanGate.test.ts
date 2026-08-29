import { describe, expect, it } from "vitest";
import { gateTiming } from "./LiveHumanGate";

describe("gateTiming", () => {
  it("exposes comfortable, attention and urgent tiers", () => {
    const start = "2026-08-29T10:00:00Z";
    const end = "2026-08-29T10:20:00Z";
    expect(gateTiming(start, end, new Date("2026-08-29T10:05:00Z")).urgency).toBe("comfortable");
    expect(gateTiming(start, end, new Date("2026-08-29T10:12:00Z")).urgency).toBe("attention");
    expect(gateTiming(start, end, new Date("2026-08-29T10:19:00Z")).urgency).toBe("urgent");
  });
  it("closes the action window at the published expiry", () => {
    expect(gateTiming("2026-08-29T10:00:00Z", "2026-08-29T10:20:00Z", new Date("2026-08-29T10:20:00Z"))).toMatchObject({ expired: true, remainingPct: 0, label: "Expiré" });
  });
});
