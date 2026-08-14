import { Link, useParams } from "react-router-dom";
import type { VNextRoute } from "@/app/routes";
import { DataFreshnessBanner } from "@/design-system/primitives";
import { SurfaceCard, StatusPill } from "@/design-system/components";
import { useFrontView } from "@/domains/front-api/repositories";
import type { FrontViewName } from "@/shared/contracts";

type SkeletonPageProps = {
  route: VNextRoute | null;
};

export function SkeletonPage({ route }: SkeletonPageProps) {
  const params = useParams();

  if (!route) {
    return (
      <section className="route-hero">
        <div className="hero-copy">
          <p className="eyebrow">404</p>
          <h1>Écran introuvable</h1>
          <p>Ce chemin n’existe pas encore dans le Control Plane VNext.</p>
          <Link className="desk-button" to="/command-center">
            Retour Command Center
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="route-hero">
        <div className="hero-copy">
          <p className="eyebrow">{route.journey}</p>
          <h1>{route.title}</h1>
          <p>{route.description}</p>
          <StatusPill status={route.status === "foundation" ? "ok" : "pending"}>
            {route.status === "foundation" ? "Socle prêt" : "Golden slice à venir"}
          </StatusPill>
        </div>

        <SurfaceCard tone={route.viewEndpoint ? "accent" : "default"}>
          <p className="eyebrow">Source cible</p>
          <h2>{route.viewEndpoint ?? "Route locale / configuration"}</h2>
          <p>
            {route.viewEndpoint
              ? `Lecture prévue via /front-api/v1${route.viewEndpoint}.`
              : "Cette vue ne doit pas accéder directement au domaine métier."}
          </p>
          <ViewSourcePreview route={route} />
        </SurfaceCard>
      </section>

      <section className="route-grid" aria-label="Préparation de la page">
        <SurfaceCard>
          <p className="eyebrow">Capacité</p>
          <h2>{route.capability}</h2>
          <p>Le scope opérateur sera appliqué ici avant toute mutation ou zoom sensible.</p>
        </SurfaceCard>

        <SurfaceCard tone="warning">
          <p className="eyebrow">État</p>
          <h2>Front from scratch</h2>
          <p>Aucun composant legacy, aucun store historique, aucun CSS ancien importé.</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="eyebrow">Paramètres route</p>
          <pre>{JSON.stringify(params, null, 2)}</pre>
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </SurfaceCard>
      </section>
    </>
  );
}

function ViewSourcePreview({ route }: { route: VNextRoute }) {
  const viewName = frontViewNameFromEndpoint(route.viewEndpoint);

  if (!viewName) {
    return null;
  }

  return <ViewQueryPreview viewName={viewName} />;
}

function ViewQueryPreview({ viewName }: { viewName: FrontViewName }) {
  const query = useFrontView(viewName);

  if (query.isLoading) {
    return (
      <div aria-label="Chargement source">
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </div>
    );
  }

  if (query.isError) {
    return <p className="empty-state">Contrat indisponible : {(query.error as Error).message}</p>;
  }

  if (!query.data) {
    return <p className="empty-state">Aucune projection disponible.</p>;
  }

  return (
    <div className="view-source-preview">
      <DataFreshnessBanner
        stale={query.data.meta.stale}
        generatedAt={query.data.meta.generatedAt}
        latencyMs={query.data.meta.latencyMs}
      />
      <p className="empty-state">Correlation ID : {query.data.meta.correlationId}</p>
    </div>
  );
}

function frontViewNameFromEndpoint(endpoint: string | undefined): FrontViewName | null {
  switch (endpoint) {
    case "/views/command-center":
      return "command-center";
    case "/views/research-lab":
      return "research-lab";
    case "/views/strategy-center":
      return "strategy-center";
    case "/views/live-trading":
      return "live-trading";
    case "/views/portfolio":
      return "portfolio";
    case "/views/jarvis-workspace":
      return "jarvis-workspace";
    default:
      return null;
  }
}
