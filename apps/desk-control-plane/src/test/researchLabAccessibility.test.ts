import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../..");

describe("research lab accessibility regression", () => {
  it("keeps compact ranking indices readable on dark surfaces", () => {
    const styles = readFileSync(resolve(appRoot, "src/features/research-lab/research-lab.css"), "utf8");

    expect(styles).toContain(".rl-rank-index { flex: 0 0 auto;");
    expect(styles).toContain("color: var(--rl-secondary); font-size: 10px; font-weight: 700;");
  });
});
