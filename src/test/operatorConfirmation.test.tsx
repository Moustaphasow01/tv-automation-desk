import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OperatorConfirmation, operatorConfirmationIsValid } from "@/pages/SetupPage";
import type { DeskOperatorCapability } from "@/types";

const capability: DeskOperatorCapability = {
  command: "take_partial",
  enabled: true,
  reason: null,
  targetId: "position-1",
  confirmationPhrase: "TAKE_PARTIAL",
  dangerLevel: "high"
};

describe("OperatorConfirmation", () => {
  it("rend la confirmation verrouillée avec la cible, la révision et la phrase attendue", () => {
    const html = renderToStaticMarkup(<OperatorConfirmation
      capability={capability}
      revision={7}
      onCancel={vi.fn()}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(html).toContain("position-1");
    expect(html).toContain("TAKE_PARTIAL");
    expect(html).toContain("Fraction à sortir");
    expect(html).toContain("disabled");
  });

  it("n’autorise que la phrase exacte avec une justification non vide", () => {
    expect(operatorConfirmationIsValid("TAKE_PARTIAL", "TAKE_PARTIAL", "TP1 atteint")).toBe(true);
    expect(operatorConfirmationIsValid("take_partial", "TAKE_PARTIAL", "TP1 atteint")).toBe(false);
    expect(operatorConfirmationIsValid("TAKE_PARTIAL", "TAKE_PARTIAL", "  ")).toBe(false);
  });
});
