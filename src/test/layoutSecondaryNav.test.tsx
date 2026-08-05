import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, NavLink } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { secondaryNavExactMatchPaths } from "@/components/layout";
import { navigationSpaces } from "@/navigation";

// Reproduces the exact NavLink/`end` rendering pattern used by the secondary nav in
// src/components/layout.tsx (AppShell can't be mounted directly here: it pulls in
// react-query hooks, DeskContext and localStorage access that aren't available in this
// suite's Node test environment). This pins down the regression from commit 491c144,
// where "/live" was missing from secondaryNavExactMatchPaths: because NavLink defaults to
// prefix matching, both "Session en direct" (to="/live") and "Plan actif" (to="/live/thesis")
// rendered as active/current at once on /live/thesis.
function SecondaryNav({ items }: { items: { to: string; label: string }[] }) {
  return <div>
    {items.map(item => <NavLink
      key={item.to}
      to={item.to}
      end={secondaryNavExactMatchPaths.includes(item.to)}
    ><span>{item.label}</span></NavLink>)}
  </div>;
}

describe("secondary nav active-state matching", () => {
  it("marque un seul item actif sur /live/thesis, pas /live et /live/thesis simultanément", () => {
    const today = navigationSpaces.find(space => space.id === "today")!;

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/live/thesis"]}>
        <SecondaryNav items={today.items}/>
      </MemoryRouter>
    );

    const anchorTags = [...html.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
    expect(anchorTags.length).toBe(today.items.length);

    const activeTags = anchorTags.filter(tag => tag.includes('aria-current="page"'));
    expect(activeTags).toHaveLength(1);

    const liveTag = anchorTags.find(tag => tag.includes('href="/live"'));
    const thesisTag = anchorTags.find(tag => tag.includes('href="/live/thesis"'));
    expect(liveTag).toBeDefined();
    expect(thesisTag).toBeDefined();
    expect(liveTag).not.toContain('aria-current="page"');
    expect(thesisTag).toContain('aria-current="page"');
  });
});
