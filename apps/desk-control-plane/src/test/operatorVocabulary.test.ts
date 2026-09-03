import { describe, expect, it } from "vitest";
import { operatorCode, operatorCopy, operatorDuration, operatorReason, operatorTerm } from "@/design-system/operatorVocabulary";

describe("operator vocabulary", () => {
  it("translates platform terms and backend codes into operator language", () => {
    expect(operatorTerm("ORDER_INTENT")).toBe("Ordre proposé");
    expect(operatorTerm("HUMAN_GATE")).toBe("Votre validation");
    expect(operatorCode("AWAITING_MANUAL_CONFIRMATION")).toBe("En attente de votre validation");
    expect(operatorCode("market_closed")).toBe("Marché fermé");
    expect(operatorReason("US_GRAINS_RTH_ONLY")).toBe("Séance grains US ouverte");
    expect(operatorCopy("OrderIntent post-Risk via Provider")).toBe("ordre proposé après contrôle du risque via fournisseur");
    expect(operatorCode("LIMIT")).toBe("Ordre limite");
    expect(operatorReason("Market context stale")).toBe("Contexte de marché périmé");
    expect(operatorCopy("Market context stale · No signal reached human gate")).toBe("Contexte de marché périmé · Aucun signal n’a atteint la validation humaine");
    expect(operatorCopy("Both grains suffered late selling and rebounded in the cutoff-valid 18:15 one-minute bars, but the latest five-minute bars remain unreconciled, leaving no active side."))
      .toBe("Les deux grains ont subi une pression vendeuse tardive puis ont rebondi sur les bougies une minute valides au point de coupure 18:15, mais les dernières bougies cinq minutes restent non réconciliées : aucun biais actif.");
    expect(operatorCopy("LATE_SYNCHRONIZED_SELLING_WITH_INITIAL_ONE_MINUTE_REBOUND_AND_UNRECONCILED_LATEST_FIVE_MINUTE_BARS"))
      .toBe("Pression vendeuse synchronisée tardive, rebond initial M1 et dernières M5 non réconciliées");
  });

  it("never exposes missing sentinel values", () => {
    for (const value of ["unavailable", "undefined", "unknown", "null", "NaN"]) {
      expect(operatorCode(value)).toBe("Non publié");
      expect(operatorCopy(value)).toBe("Non publié");
    }
  });

  it("formats long durations in units an operator can read", () => {
    expect(operatorDuration(45)).toBe("45 s");
    expect(operatorDuration(252)).toBe("4 min 12 s");
    expect(operatorDuration(81_171)).toBe("22 h 32 min");
    expect(operatorDuration(171_310)).toBe("1 j 23 h");
  });
});
