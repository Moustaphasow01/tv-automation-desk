import { describe, expect, it } from "vitest";
import { deskSessionFixture } from "@/test/fixtures/deskSessionFixture";
import { mergeDeskSessionResources } from "@/hooks/useDesk";
import type { DeskAuditResource, DeskMarketResource, DeskPositionResource, DeskSession } from "@/types";

const session = () => structuredClone(deskSessionFixture.sessions.ny_open) as unknown as DeskSession;

const meta = {
  contract: "DeskFrontTestResource",
  schemaVersion: "1.0.0",
  scope: {
    strategyId: "ny_open_1530",
    session: "ny_open",
    tradingDate: "2026-07-13",
    mode: "live"
  }
} as const;

describe("mergeDeskSessionResources", () => {
  it("conserve l’agrégat quand une ressource optionnelle échoue", () => {
    const aggregate = session();
    const merged = mergeDeskSessionResources(aggregate, {});

    expect(merged.position).toEqual(aggregate.position);
    expect(merged.market).toEqual(aggregate.market);
    expect(merged.news).toEqual(aggregate.news);
  });

  it("remonte les données stale sans dupliquer les avertissements", () => {
    const aggregate = session();
    const market: DeskMarketResource = {
      ...meta,
      warnings: ["market_snapshot_stale", "market_snapshot_stale"],
      lastDataAt: aggregate.lastDataAt,
      market: aggregate.market,
      marketBrief: aggregate.marketBrief,
      crossAssetBrief: aggregate.crossAssetBrief,
      levels: aggregate.levels
    };
    const audit: DeskAuditResource = {
      ...meta,
      warnings: ["market_snapshot_stale"],
      dataQuality: {
        ...aggregate.dataQuality,
        status: "degraded",
        warnings: ["news_digest_missing"]
      },
      audit: aggregate.audit
    };

    const merged = mergeDeskSessionResources(aggregate, { market, audit });

    expect(merged.dataQuality.status).toBe("degraded");
    expect(merged.dataQuality.warnings).toEqual(["news_digest_missing", "market_snapshot_stale"]);
  });

  it("donne la priorité à la position d’exécution dédiée en cas de contradiction", () => {
    const aggregate = session();
    const position: DeskPositionResource = {
      ...meta,
      warnings: ["aggregate_position_contradiction"],
      position: {
        ...aggregate.position,
        active: true,
        status: "protected",
        current: 29_570,
        note: "État canonique d’exécution plus récent."
      }
    };

    const merged = mergeDeskSessionResources(aggregate, { position });

    expect(aggregate.position.status).toBe("CLOSED");
    expect(merged.position.status).toBe("protected");
    expect(merged.position.active).toBe(true);
    expect(merged.dataQuality.warnings).toContain("aggregate_position_contradiction");
  });
});
