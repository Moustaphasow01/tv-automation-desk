import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaBell, FaTimes } from "react-icons/fa";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import type { EventEnvelope } from "@/domains/realtime/eventEnvelope";

const ALERT_PREFERENCE_KEY = "desk-control-plane:realtime-alerts";
const SOUND_PREFERENCE_KEY = "desk-control-plane:realtime-alert-sound";
const ALERT_PREFERENCE_EVENT = "desk-control-plane:realtime-alert-preference";
const ALERT_EVENT_TYPES = new Set([
  "signal.created", "strategy.signal.created", "signal.expiring",
  "risk.warning.created",
  "order_intent.created", "order_intent.expiring", "order_intent.expired",
  "human_gate.created", "human_gate.expiring", "human_gate.expired",
  "incident.created",
]);

export type RealtimeAlertPresentation = { title: string; detail: string; route: string; tone: "info" | "warning" | "danger" };

export function RealtimeAlertCenter() {
  const realtime = useContext(RealtimeContext);
  const [dismissedEventId, setDismissedEventId] = useState<string | null>(null);
  const notifiedEventIdRef = useRef<string | null>(null);
  const event = realtime?.events.recentEvents.find((candidate) => ALERT_EVENT_TYPES.has(candidate.eventType)) ?? null;
  const presentation = useMemo(() => event ? presentRealtimeAlert(event) : null, [event]);
  const [enabled, setEnabled] = useState(readRealtimeAlertPreference);
  const [soundEnabled, setSoundEnabled] = useState(readRealtimeSoundPreference);

  useEffect(() => {
    const refreshPreference = () => {
      setEnabled(readRealtimeAlertPreference());
      setSoundEnabled(readRealtimeSoundPreference());
    };
    window.addEventListener(ALERT_PREFERENCE_EVENT, refreshPreference);
    return () => window.removeEventListener(ALERT_PREFERENCE_EVENT, refreshPreference);
  }, []);

  useEffect(() => {
    if (!enabled || !event || !presentation || notifiedEventIdRef.current === event.eventId) return;
    notifiedEventIdRef.current = event.eventId;
    if (soundEnabled) playAlertTone(presentation.tone);
    if (typeof window.Notification !== "undefined" && window.Notification.permission === "granted" && document.visibilityState !== "visible") {
      new window.Notification(presentation.title, { body: presentation.detail, tag: event.eventId });
    }
  }, [enabled, event, presentation, soundEnabled]);

  if (!enabled || !event || !presentation || dismissedEventId === event.eventId) return null;
  return (
    <div className={`desk-realtime-alert desk-realtime-alert--${presentation.tone}`} role={presentation.tone === "danger" ? "alert" : "status"} aria-live={presentation.tone === "danger" ? "assertive" : "polite"}>
      <FaBell aria-hidden="true" />
      <div><strong>{presentation.title}</strong><span>{presentation.detail}</span><small>{formatAlertTime(event.occurredAt)} · {event.source || "backend"}</small></div>
      <Link to={presentation.route}>Ouvrir</Link>
      <button type="button" aria-label="Masquer cette alerte" onClick={() => setDismissedEventId(event.eventId)}><FaTimes aria-hidden="true" /></button>
    </div>
  );
}

export function presentRealtimeAlert(event: EventEnvelope): RealtimeAlertPresentation {
  const payload = asObject(event.payload);
  const signalId = text(payload.signalId ?? payload.signal_id ?? event.aggregateId);
  const orderIntentId = text(payload.orderIntentId ?? payload.order_intent_id ?? payload.portfolioOrderIntentId ?? payload.portfolio_order_intent_id ?? event.aggregateId);
  const instrument = text(payload.instrument ?? payload.instrument_code ?? payload.symbol, "Instrument non publié");
  const direction = text(payload.direction ?? payload.side);
  const expiresAt = text(payload.expiresAt ?? payload.expires_at);
  const instrumentAndDirection = [instrument, direction].filter(Boolean).join(" · ");
  const expiry = expiresAt ? ` · échéance ${formatAlertTime(expiresAt)}` : "";
  if (["signal.created", "strategy.signal.created"].includes(event.eventType)) return { title: "Nouveau signal de stratégie", detail: `${instrumentAndDirection} · évaluation backend publiée${expiry}`, route: signalId ? `/live/signals/${encodeURIComponent(signalId)}` : "/live", tone: "info" };
  if (["signal.expiring", "order_intent.expiring", "human_gate.expiring"].includes(event.eventType)) return { title: "Décision bientôt expirée", detail: `${instrumentAndDirection} · vérifier immédiatement l’échéance publiée${expiry}`, route: orderIntentId ? `/execution/orders/${encodeURIComponent(orderIntentId)}` : signalId ? `/live/signals/${encodeURIComponent(signalId)}` : "/orders", tone: "warning" };
  if (["order_intent.expired", "human_gate.expired"].includes(event.eventType)) return { title: "Décision expirée", detail: `${instrument} · aucune action n’est désormais autorisée`, route: orderIntentId ? `/execution/orders/${encodeURIComponent(orderIntentId)}` : "/orders", tone: "danger" };
  if (["order_intent.created", "human_gate.created"].includes(event.eventType)) return { title: event.eventType === "human_gate.created" ? "Décision opérateur requise" : "OrderIntent créé", detail: `${instrumentAndDirection} · vérifier les termes autorisés${expiry}`, route: orderIntentId ? `/execution/orders/${encodeURIComponent(orderIntentId)}` : "/orders", tone: "warning" };
  if (event.eventType === "risk.warning.created") return { title: "Alerte de risque", detail: text(payload.reason ?? payload.message, "Une limite de risque requiert une vérification."), route: "/risk", tone: "danger" };
  return { title: "Incident opérationnel", detail: text(payload.title ?? payload.message, "Un incident backend a été publié."), route: "/operations/incidents", tone: "danger" };
}

export function setRealtimeAlertPreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ALERT_PREFERENCE_KEY, enabled ? "enabled" : "disabled");
  window.dispatchEvent(new Event(ALERT_PREFERENCE_EVENT));
}

export function readRealtimeAlertPreference() { return typeof window === "undefined" || window.localStorage.getItem(ALERT_PREFERENCE_KEY) !== "disabled"; }
export function setRealtimeSoundPreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? "enabled" : "disabled");
  if (enabled) playAlertTone("info");
  window.dispatchEvent(new Event(ALERT_PREFERENCE_EVENT));
}
export function readRealtimeSoundPreference() { return typeof window !== "undefined" && window.localStorage.getItem(SOUND_PREFERENCE_KEY) === "enabled"; }
export function desktopNotificationPermission(): NotificationPermission | "unsupported" {
  return typeof window === "undefined" || typeof window.Notification === "undefined" ? "unsupported" : window.Notification.permission;
}
export async function requestDesktopNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") return "unsupported";
  return window.Notification.requestPermission();
}
function playAlertTone(tone: RealtimeAlertPresentation["tone"]) {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone === "danger" ? "square" : "sine";
    oscillator.frequency.value = tone === "danger" ? 330 : tone === "warning" ? 520 : 720;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (tone === "danger" ? 0.34 : 0.2));
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (tone === "danger" ? 0.35 : 0.21));
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Alert rendering remains functional when the browser blocks audio.
  }
}
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, fallback = "") {
  const normalized = String(value ?? "").trim();
  if (!normalized || ["unavailable", "unknown", "undefined"].includes(normalized.toLowerCase())) return fallback;
  return normalized
    .replace(/\bunavailable\b/gi, "non disponible")
    .replace(/\bundefined\b/gi, "non publié")
    .replace(/\bunknown\b/gi, "inconnu");
}
function formatAlertTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Heure non publiée" : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date); }
