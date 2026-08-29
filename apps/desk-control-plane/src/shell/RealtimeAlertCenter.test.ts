import { describe, expect, it } from "vitest";
import { presentRealtimeAlert } from "@/shell/RealtimeAlertCenter";
import type { EventEnvelope } from "@/domains/realtime/eventEnvelope";

function event(eventType: string, payload: Record<string, unknown>): EventEnvelope {
  return { eventId: "evt-1", eventType, occurredAt: "2026-08-29T10:00:00Z", correlationId: "corr-1", schemaVersion: "1.0.0", payload };
}

describe("alertes opérateur temps réel", () => {
  it("links a signal alert to its canonical signal dossier", () => {
    expect(presentRealtimeAlert(event("strategy.signal.created", { signal_id: "signal-1", instrument: "ZW", direction: "LONG", expires_at: "2026-08-29T10:20:00Z" }))).toMatchObject({
      title: "Nouveau signal de stratégie",
      route: "/live/signals/signal-1",
      tone: "info",
      detail: expect.stringContaining("ZW · LONG"),
    });
  });

  it("keeps Human Gate distinct from broker execution", () => {
    expect(presentRealtimeAlert(event("human_gate.created", { portfolio_order_intent_id: "intent-1", instrument: "ZC" }))).toMatchObject({
      title: "Décision opérateur requise",
      route: "/execution/orders/intent-1",
      tone: "warning",
    });
  });

  it("distinguishes an expiry warning from a backend-confirmed expiration", () => {
    const expiring = presentRealtimeAlert(event("human_gate.expiring", { orderIntentId: "intent-42", instrument: "ZW" }));
    const expired = presentRealtimeAlert(event("human_gate.expired", { orderIntentId: "intent-42", instrument: "ZW" }));
    expect(expiring).toMatchObject({ title: "Décision bientôt expirée", tone: "warning", route: "/execution/orders/intent-42" });
    expect(expired).toMatchObject({ title: "Décision expirée", tone: "danger", route: "/execution/orders/intent-42" });
  });
});
