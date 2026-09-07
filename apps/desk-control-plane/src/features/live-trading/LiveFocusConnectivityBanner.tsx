import { FaExclamationTriangle, FaSatelliteDish, FaSyncAlt, FaWifi } from "react-icons/fa";
import type { RealtimeStatus } from "@/domains/realtime/RealtimeProvider";

export function LiveFocusConnectivityBanner({ realtime, projectionAsOf }: {
  realtime: RealtimeStatus | null;
  projectionAsOf: string;
}) {
  const state = liveFocusConnectivityState(realtime, projectionAsOf);
  if (!state) return null;
  const Icon = state.kind === "offline" ? FaWifi : state.kind === "failed" ? FaExclamationTriangle : state.kind === "resyncing" ? FaSyncAlt : FaSatelliteDish;
  return (
    <aside className="live-focus-connectivity" data-kind={state.kind} role={state.assertive ? "alert" : "status"} aria-live={state.assertive ? "assertive" : "polite"}>
      <Icon aria-hidden="true" className={state.kind === "resyncing" ? "is-spinning" : undefined} />
      <div>
        <strong>{state.title}</strong>
        <span>{state.detail}</span>
      </div>
      <small>Dernière projection connue · {dateTimeLabel(projectionAsOf)}</small>
    </aside>
  );
}

export function liveFocusConnectivityState(realtime: RealtimeStatus | null, projectionAsOf: string) {
  if (!realtime || (realtime.connectionStatus === "OPEN" && !realtime.resyncing)) return null;
  if (realtime.resyncing) return {
    kind: "resyncing",
    title: "Connexion rétablie — vérification de la vérité backend",
    detail: "Le Desk resynchronise toutes les vues actives. Les actions restent bloquées jusqu’à la fin du contrôle.",
    assertive: false,
  } as const;
  if (realtime.connectionStatus === "OFFLINE") return {
    kind: "offline",
    title: "Réseau indisponible",
    detail: "Vous consultez la dernière projection reçue. Aucune action sensible ne peut être transmise hors connexion.",
    assertive: true,
  } as const;
  if (realtime.connectionStatus === "FAILED" || realtime.connectionStatus === "CLOSED") return {
    kind: "failed",
    title: "Connexion au Desk interrompue",
    detail: "Le flux temps réel est arrêté. Les données conservées restent consultables mais ne sont plus présentées comme fraîches.",
    assertive: true,
  } as const;
  return {
    kind: realtime.connectionStatus === "CONNECTING" ? "connecting" : "resyncing",
    title: realtime.connectionStatus === "CONNECTING" ? "Connexion au Desk en cours" : "Reconnexion automatique en cours",
    detail: "La dernière projection reste visible et datée. Les actions opérateur sont temporairement bloquées.",
    assertive: realtime.connectionStatus === "RECONNECTING",
  } as const;
}

function dateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "horodatage non publié";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
