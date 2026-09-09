import { lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DeskHome } from "@/features/command-center/DeskHome";

const Supervision = lazy(() => import("@/features/command-center/CommandCenterSupervision").then((module) => ({ default: module.CommandCenterSupervision })));

export function CommandCenterPage() {
  const [params] = useSearchParams();
  if (params.get("view") !== "supervision") return <DeskHome />;
  return <><Link className="dj-supervision-back" to="/command-center">Retour à l’accueil de séance</Link><Suspense fallback={<p role="status">Chargement de la supervision…</p>}><Supervision /></Suspense></>;
}
