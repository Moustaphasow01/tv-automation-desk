import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deskSessionFixture } from "@/test/fixtures/deskSessionFixture";
import type { DeskSession } from "@/types";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>
}));

vi.mock("@/context/DeskContext", () => ({
  useDeskContext: () => ({ sessionId: "ny_open" })
}));

vi.mock("@/hooks/useDesk", () => ({
  useDeskSession: () => mocks.query
}));

import { DeskPage } from "@/pages/pageState";

describe("DeskPage", () => {
  beforeEach(() => {
    mocks.query = { isLoading: false, isError: false, data: undefined, refetch: vi.fn() };
  });

  it("affiche une erreur explicite de chargement du premier agrégat", () => {
    const refetch = vi.fn();
    mocks.query = {
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("live_desk_unavailable"),
      refetch
    };

    const html = renderToStaticMarkup(<DeskPage>{() => <p>Desk chargé</p>}</DeskPage>);
    expect(html).toContain("Session Live indisponible");
    expect(html).toContain("live_desk_unavailable");
    expect(html).toContain("Réessayer");
    expect(refetch).not.toHaveBeenCalled();
  });

  it("rend la vue quand l’agrégat est disponible", () => {
    const data = structuredClone(deskSessionFixture.sessions.ny_open) as unknown as DeskSession;
    mocks.query = { isLoading: false, isError: false, data, refetch: vi.fn() };

    const html = renderToStaticMarkup(<DeskPage>{value => <p>{value.master.id}</p>}</DeskPage>);
    expect(html).toContain("master_ny_2026_07_13_1530");
  });
});
