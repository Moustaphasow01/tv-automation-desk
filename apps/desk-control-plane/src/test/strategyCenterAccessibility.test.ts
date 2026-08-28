import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../..");

describe("strategy center accessibility regression", () => {
  it("keeps an accessible name on the catalog filter", () => {
    const source = readFileSync(resolve(appRoot, "src/pages/StrategyCenterPage.tsx"), "utf8");

    expect(source).toContain('<span className="sr-only">Filtrer le catalogue des stratégies</span>');
  });

  it("uses readable semantic tokens for cold and selected labels", () => {
    const styles = readFileSync(resolve(appRoot, "src/features/strategy-center/strategy-center.css"), "utf8");

    expect(styles).toContain(".sc-header__search kbd { color: var(--sc-muted);");
    expect(styles).toContain(".sc-catalog-row--active small { color: var(--sc-secondary); }");
    expect(styles).toContain('.sc-meta-item strong[data-unavailable="true"] { color: var(--sc-muted);');
  });
});
