import { describe, expect, it } from "vitest";
import { detectDeskDensityMode } from "@/shell/DeskDensityViewport";

describe("desk density", () => {
  it("compensates a Windows Full HD workstation scaled to 150 percent", () => {
    expect(
      detectDeskDensityMode("auto", {
        devicePixelRatio: 1.5,
        innerWidth: 1280,
        platform: "Win32",
        screenWidth: 1280
      })
    ).toBe("workstation");
  });

  it("keeps a native desktop viewport unchanged", () => {
    expect(
      detectDeskDensityMode("auto", {
        devicePixelRatio: 1,
        innerWidth: 1920,
        platform: "Win32",
        screenWidth: 1920
      })
    ).toBe("native");
  });

  it("respects the explicit accessibility preference", () => {
    expect(
      detectDeskDensityMode("native", {
        devicePixelRatio: 1.5,
        innerWidth: 1280,
        platform: "Win32",
        screenWidth: 1280
      })
    ).toBe("native");
  });
});
