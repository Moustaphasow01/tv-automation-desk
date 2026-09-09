import { describe, expect, it } from "vitest";
import { commandCenterView } from "@/mocks/canonicalDataset";
import { homeDecisionMessage, homeSummary } from "./homeModel";

describe("Home reads published facts without manufacturing a trading state", () => {
  const fixture = () => structuredClone(commandCenterView);
  it("distinguishes a published zero from missing data", () => {
    const envelope = fixture(); envelope.meta.availability = "AVAILABLE"; envelope.meta.stale = false;
    envelope.data.humanGate.available = true; envelope.data.summary.pendingCommands = 0;
    envelope.data.risk.openPositions = null;
    expect(homeSummary(envelope)[0].value).toBe("0");
    expect(homeSummary(envelope)[1].value).toBe("À vérifier");
    expect(homeDecisionMessage(envelope.data)).toContain("Aucune décision en attente");
  });
  it.each(["PARTIAL", "STALE", "UNAVAILABLE"] as const)("does not label %s counters current", (availability) => {
    const envelope = fixture(); envelope.meta.availability = availability;
    expect(homeSummary(envelope).every((item) => item.value === "À vérifier")).toBe(true);
  });
  it("does not call an unavailable gate empty", () => {
    const envelope = fixture(); envelope.meta.availability = "AVAILABLE"; envelope.meta.stale = false;
    envelope.data.humanGate.available = false; envelope.data.summary.pendingCommands = 0;
    expect(homeSummary(envelope)[0].value).toBe("À vérifier");
    expect(homeDecisionMessage(envelope.data)).toContain("n’est pas disponible");
  });
  it("does not use historical rows as the current pending count", () => {
    const envelope = fixture(); envelope.meta.availability = "AVAILABLE"; envelope.meta.stale = false;
    envelope.data.humanGate.available = true; envelope.data.summary.pendingCommands = 0;
    envelope.data.humanGate.rows = [{ orderIntentId: "expired", instrument: "ZC", quantity: 1, side: "BUY", executionMode: "SEMI_AUTO", status: "EXPIRED", allowedActions: ["VIEW"], ageSeconds: 100 }];
    expect(homeSummary(envelope)[0].value).toBe("0");
  });
  it("rejects nonfinite counts without reporting a nominal desk", () => {
    const envelope = fixture(); envelope.meta.availability = "AVAILABLE"; envelope.meta.stale = false;
    envelope.data.risk.openPositions = NaN; envelope.data.summary.deskStatus = "UNKNOWN";
    expect(homeSummary(envelope)[1].value).toBe("À vérifier");
    expect(homeSummary(envelope)[3].value).toBe("État non publié");
  });
});
