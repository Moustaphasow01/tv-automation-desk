import { useEffect, type ReactNode } from "react";
import type { ViewMeta } from "@/shared/contracts";
import { ViewTruthBanner } from "@/design-system/states";
import { parisTime } from "@/features/live-trading/workspace/workspaceModel";
import "@/features/live-trading/workspace/workspace.tokens.css";
import "./journey.css";

export function useJourneySurface() {
  useEffect(() => {
    document.documentElement.classList.add("journey-document");
    document.body.classList.add("journey-document");
    return () => {
      document.documentElement.classList.remove("journey-document");
      document.body.classList.remove("journey-document");
    };
  }, []);
}

export function JourneySection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="dj-section"><header><h2>{title}</h2>{action}</header>{children}</section>;
}

export function JourneyDisclosure({ title, children }: { title: string; children: ReactNode }) {
  return <details className="dj-disclosure"><summary>{title}</summary><div>{children}</div></details>;
}

export function JourneyFreshness({ meta }: { meta: ViewMeta }) {
  const current = !meta.stale && meta.availability === "AVAILABLE";
  return <div className="dj-freshness" data-current={current}>
    <span>{journeyAvailability(meta)} · <time dateTime={meta.asOf}>{parisTime(meta.asOf, true)} Paris</time></span>
    <span>Sources du desk</span>
  </div>;
}

export function journeyAvailability(meta: Pick<ViewMeta, "availability" | "stale">): string {
  if (meta.stale || meta.availability === "STALE") return "Données anciennes · à vérifier";
  if (meta.availability === "AVAILABLE") return "Vue publiée";
  if (meta.availability === "PARTIAL") return "Données partielles · à vérifier";
  if (meta.availability === "UNAVAILABLE") return "Données indisponibles";
  return "Qualité de la vue non publiée";
}

export function JourneyProvenance({ meta }: { meta: ViewMeta }) {
  return <JourneyDisclosure title="Qualité des données et provenance">
    <ViewTruthBanner meta={meta} />
    <dl className="dj-detail-lines"><div><dt>Vue arrêtée à</dt><dd>{meta.asOf}</dd></div><div><dt>Référence de lecture</dt><dd>{meta.correlationId}</dd></div></dl>
    {meta.sources?.map((source) => <p key={source.source}>{source.source} · {source.state === "AVAILABLE" ? "Disponible" : "Indisponible"}</p>)}
  </JourneyDisclosure>;
}

export function JourneyMessage({ title, children, retry }: { title: string; children: ReactNode; retry?(): void }) {
  return <section className="dj-message" role="status"><h2>{title}</h2><p>{children}</p>{retry ? <button type="button" onClick={retry}>Réessayer</button> : null}</section>;
}
