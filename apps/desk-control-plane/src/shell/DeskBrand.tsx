import { Link } from "react-router-dom";

export function DeskBrand() {
  return (
    <Link className="desk-brand" to="/command-center" aria-label="Desk Control Plane · ouvrir le centre de contrôle">
      <svg className="desk-brand__mark" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M7 10h9l7 10-7 10H7" />
        <path d="M20 10h6l7 10-7 10h-6l7-10-7-10Z" />
        <circle cx="33" cy="20" r="2.4" />
      </svg>
      <span className="desk-brand__copy"><strong>Desk Control Plane</strong><small>Recherche · Risque · Exécution</small></span>
    </Link>
  );
}
