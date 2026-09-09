import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusQueueItem } from "../focusJournalModel";
import { advanceWorkspaceAlerts, initialAlertState } from "./workspaceAlertModel";

export function useWorkspaceAlerts(tickets: readonly FocusQueueItem[], now: number) {
  const [state, setState] = useState(initialAlertState);
  useEffect(() => { setState((previous) => advanceWorkspaceAlerts(previous, tickets, now)); }, [tickets, now]);
  const markRead = useCallback((id: string) => setState((previous) => ({ ...previous, alerts: previous.alerts.map((alert) => alert.id === id ? { ...alert, read: true } : alert) })), []);
  return { alerts: state.alerts, unread: state.alerts.filter((alert) => !alert.read).length, markRead };
}

export function useWorkspaceAlertSound(unread: number, enabled: boolean) {
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef(unread);
  const lastSound = useRef(0);
  const [status, setStatus] = useState("Son inactif dans cette session.");
  const enable = useCallback(async () => {
    if (typeof AudioContext === "undefined") { setStatus("Son non disponible dans ce navigateur."); return false; }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setStatus("Son activé dans cet onglet.");
      return true;
    } catch { setStatus("Le navigateur n’a pas autorisé le son. Les alertes visuelles restent actives."); return false; }
  }, []);
  useEffect(() => {
    const increased = unread > previous.current;
    previous.current = unread;
    const context = audio.current;
    if (!enabled || !increased || !context || context.state !== "running" || Date.now() - lastSound.current < 3_000) return;
    lastSound.current = Date.now();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.frequency.value = 520;
    gain.gain.setValueAtTime(0.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
    oscillator.start(); oscillator.stop(context.currentTime + 0.2);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }, [unread, enabled]);
  useEffect(() => () => { void audio.current?.close(); audio.current = null; }, []);
  return { enable, status: enabled ? status : "Notifications sonores en sourdine." };
}
