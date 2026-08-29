import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { FaCheckCircle, FaClock, FaSatelliteDish, FaTimes } from "react-icons/fa";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import type { LiveTradingModel } from "./model";
import { operatorStateForSignal } from "./signalOperatorState";

type CatchUpSummary = { newSignals: number; newlyExpired: number; actionable: number };

export function LiveAttentionCenter({ model }: { model: LiveTradingModel }) {
  const realtime = useContext(RealtimeContext);
  const [catchUp, setCatchUp] = useState<CatchUpSummary | null>(null);
  const hiddenSnapshot = useRef(snapshot(model));
  const current = useMemo(() => snapshot(model), [model]);
  const pageAgeSeconds = Math.max(0, Math.floor(((realtime?.now.getTime() ?? Date.now()) - Date.parse(model.meta.asOf)) / 1000));
  const connectionHealthy = realtime?.connectionStatus === "OPEN" && !realtime.resyncing;

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenSnapshot.current = current;
        return;
      }
      const before = hiddenSnapshot.current;
      const summary = {
        newSignals: Math.max(0, current.signalIds.size - intersectionSize(before.signalIds, current.signalIds)),
        newlyExpired: Math.max(0, current.expiredIds.size - intersectionSize(before.expiredIds, current.expiredIds)),
        actionable: current.actionable,
      };
      if (summary.newSignals || summary.newlyExpired || summary.actionable) setCatchUp(summary);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [current]);

  return (
    <aside className="lt-attention-center" aria-label="Fraîcheur et rattrapage du cockpit">
      <span className={connectionHealthy ? "is-fresh" : "is-stale"} role="status">
        <FaSatelliteDish aria-hidden="true" />
        <strong>{connectionHealthy ? "Page synchronisée" : realtime?.resyncing ? "Resynchronisation" : "Temps réel interrompu"}</strong>
        <small>projection reçue il y a {relativeAge(pageAgeSeconds)}</small>
      </span>
      {catchUp ? (
        <div className="lt-catch-up" role="status" aria-live="polite">
          <FaClock aria-hidden="true" />
          <p><strong>Pendant votre absence</strong><span>{catchUp.newSignals} nouveau(x) signal(aux) · {catchUp.newlyExpired} expiré(s) · {catchUp.actionable} décision(s) à prendre</span></p>
          <button type="button" onClick={() => setCatchUp(null)} aria-label="Fermer le résumé de rattrapage"><FaTimes aria-hidden="true" /></button>
        </div>
      ) : (
        <span className="lt-attention-center__quiet"><FaCheckCircle aria-hidden="true" />Aucun événement manqué détecté dans cette session navigateur</span>
      )}
    </aside>
  );
}

function snapshot(model: LiveTradingModel) {
  const signals = [...model.source.signals, ...model.source.canonicalRuntime.latestSignals];
  return {
    signalIds: new Set(signals.map((signal) => signal.signalId)),
    expiredIds: new Set(signals.filter((signal) => operatorStateForSignal(model, signal).code === "EXPIRED").map((signal) => signal.signalId)),
    actionable: signals.filter((signal) => operatorStateForSignal(model, signal).code === "ACTIONABLE").length,
  };
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function relativeAge(seconds: number): string {
  if (!Number.isFinite(seconds)) return "durée inconnue";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}
