import { Link } from "react-router-dom";
import { Card, StatusBadge } from "@/design-system/primitives";
import { OperatorPageHeader } from "@/design-system/workspace";
import type { VNextRoute } from "@/app/routes";

export function CapabilityUnavailablePage({ route }: { route: VNextRoute }) {
  return (
    <div className="operator-page capability-unavailable-page">
      <OperatorPageHeader
        title={route.title}
        description={route.description}
        actions={<Link to="/command-center">Retour Command Center</Link>}
      />
      <Card title="Capacité backend indisponible" eyebrow="Fonction non disponible" tone="warning" density="compact">
        <div className="capability-unavailable">
          <StatusBadge tone="warning">Dépendance backend</StatusBadge>
          <p>La route frontend existe, mais aucune projection BFF canonique n'est encore publiée pour cet écran.</p>
          <dl>
            <div><dt>Route</dt><dd>/{route.path}</dd></div>
            <div><dt>Capability</dt><dd>{route.capability}</dd></div>
            <div><dt>Parcours</dt><dd>{route.journey}</dd></div>
          </dl>
          <p>Aucune métrique, action ou donnée simulée n'est affichée. Le branchement sera activé lorsque le contrat backend correspondant sera disponible.</p>
        </div>
      </Card>
    </div>
  );
}
