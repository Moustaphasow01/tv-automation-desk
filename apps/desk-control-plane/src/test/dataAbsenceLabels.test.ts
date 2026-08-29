import { describe, expect, it } from "vitest";
import { presentDataAbsence, presentOperatorText } from "@/design-system/labels";

describe("operator data absence vocabulary", () => {
  it("distinguishes waiting, irrelevance and missing publication", () => {
    expect(presentDataAbsence("COMPUTING").label).toBe("En cours de calcul");
    expect(presentDataAbsence("NOT_APPLICABLE").label).toBe("Non applicable");
    expect(presentDataAbsence("NOT_PUBLISHED").label).toBe("Non publié");
  });

  it("keeps raw backend placeholders out of operator copy", () => {
    expect(presentOperatorText("unavailable")).toBe("Non publié");
    expect(presentOperatorText("Strategy Runtime UNAVAILABLE")).toBe("Strategy Runtime non disponible");
    expect(presentOperatorText("undefined")).toBe("Non publié");
  });
});
