import { useEffect, useState } from "react";
import { DESK_UPDATE_AVAILABLE_EVENT } from "@/pwa/buildInfo";

export function DeskUpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const showUpdate = () => setAvailable(true);
    window.addEventListener(DESK_UPDATE_AVAILABLE_EVENT, showUpdate);
    return () => window.removeEventListener(DESK_UPDATE_AVAILABLE_EVENT, showUpdate);
  }, []);

  if (!available) return null;
  return (
    <aside className="desk-update-banner" role="status" aria-label="Mise à jour de l’application disponible">
      <span>Nouvelle version disponible</span>
      <button type="button" onClick={() => window.location.reload()}>Recharger</button>
    </aside>
  );
}
