import type { LabelPresentation } from "./labels";

type OperatorTerm =
  | "ORDER_INTENT"
  | "HUMAN_GATE"
  | "PROVIDER"
  | "WORKER"
  | "RUNBOOK"
  | "DLQ"
  | "SNAPSHOT"
  | "PAYLOAD"
  | "TIMELINE"
  | "POST_RISK";

const TERMS: Readonly<Record<OperatorTerm, string>> = {
  ORDER_INTENT: "Ordre proposé",
  HUMAN_GATE: "Votre validation",
  PROVIDER: "Fournisseur",
  WORKER: "Agent de calcul",
  RUNBOOK: "Procédure",
  DLQ: "Traitements en échec",
  SNAPSHOT: "État instantané",
  PAYLOAD: "Contenu de l’événement",
  TIMELINE: "Chronologie",
  POST_RISK: "Après contrôle du risque",
};

const CODES: Readonly<Record<string, string>> = {
  ACCEPTED: "Accepté",
  ACKED: "Accusé de réception reçu",
  ACTION_REQUIRED: "Action requise",
  ACTIVE: "Actif",
  ALLOWED: "Autorisé",
  APPROVED: "Approuvé",
  ASIA_OPEN: "Ouverture Asie",
  AWAITING_MANUAL_CONFIRMATION: "En attente de votre validation",
  BASELINE: "Référence",
  BLOCKED: "Bloqué",
  BUY: "Achat",
  CANCELLED: "Annulé",
  CBOT_GRAINS_RTH: "Séance CBOT grains",
  CBOT_GRAINS_PREOPEN: "Pré-séance CBOT grains",
  CBOT_GRAINS_CLOSED: "Marché CBOT grains fermé",
  CONFIRMED: "Validé",
  CONSUMED: "Traité",
  CONTROLLED: "Sous contrôle",
  CRITICAL: "Critique",
  DEGRADED: "Dégradé",
  DENIED: "Refusé",
  DESK_ALERTS: "Alertes du desk",
  DESK_RESEARCH: "Recherche interne",
  DISABLED_BY_POLICY: "Désactivé par la politique du desk",
  DONE: "Terminé",
  EMERGENCY: "Urgence",
  ERROR: "Erreur",
  EXPIRED: "Expiré",
  FAILED: "Échec",
  FILLED: "Exécuté",
  FRESH: "À jour",
  HEALTHY: "Sain",
  HIGH: "Élevé",
  IDEA: "Idée",
  INACTIVE: "Inactif",
  ITERATION: "Itération",
  INCIDENT_CREATED: "Incident ouvert",
  LAST_KNOWN: "Dernière valeur connue",
  LIVE_MASTER: "Flux principal",
  LOW: "Faible",
  LONG: "Achat",
  MARKET_CANDLES: "Bougies de marché",
  MARKET_CLOSED: "Marché fermé",
  MEDIUM: "Modéré",
  NEEDS_OPERATOR: "Intervention requise",
  NONE: "Aucun",
  NOT_APPLICABLE_CURRENT_MODE: "Sans objet dans le mode actuel",
  NOT_IMPLEMENTED: "Non disponible",
  NOT_LINKED: "Non rattaché",
  NO_ACTIVE_RUN: "Aucun calcul en cours",
  NO_RUNBOOK_LINKED: "Aucune procédure rattachée",
  OFF: "Désactivé",
  OK: "Sain",
  OPEN: "Ouvert",
  OOS: "Validation hors échantillon",
  PAPER_READY: "Prêt pour test réel",
  PARTIAL: "Partiellement exécuté",
  PARTIALLY_FILLED: "Partiellement exécuté",
  PASSED: "Validé",
  PENDING: "En attente",
  PLATFORM_OPS: "Exploitation plateforme",
  PRIMARY: "Principal",
  PROMOTED: "Promu",
  READ_ONLY: "Lecture seule",
  READY: "Prêt",
  REDUCED: "Réduit",
  REJECTED: "Refusé",
  REJECT: "Refusé",
  RESEARCH_ROBUSTNESS_REVIEW: "Revue de robustesse",
  ROBUSTNESS: "Robustesse",
  RUNNING: "En cours",
  SELL: "Vente",
  SEMI_AUTO: "Semi-automatique",
  SEMI_MANUAL: "Semi-manuel",
  SHADOW: "Observation seule",
  SHADOW_LIVE: "Compte d’observation",
  SHORT: "Vente",
  STEP_UP_REQUIRED: "Confirmation renforcée requise",
  STALE: "Périmé",
  SUCCEEDED: "Réussi",
  TASK_CLAIMED: "Tâche prise en charge",
  TASK_COMPLETED: "Tâche terminée",
  TAKE: "Retenu",
  TAKE_REDUCED: "Retenu avec risque réduit",
  VALIDATED: "Validé",
  WAIT: "En attente",
  WAITING: "En attente",
  WAITING_SESSION: "En attente de la séance CBOT",
  WARNING: "Avertissement",
  WARN: "Avertissement",
  WORKING: "En cours au broker",
  CONVERSATION_ATTACHED: "Conversation rattachée",
  EXECUTION_POLICY_RESOLVED: "Politique d'exécution déterminée",
};

const REASON_CODES: Readonly<Record<string, string>> = {
  BEARISH: "Orientation baissière",
  BREAKOUT_CONFIRMED: "Cassure confirmée",
  BFF_EVENTS_INVALID_MESSAGE: "Événement temps réel illisible",
  BFF_EVENTS_RECONNECTING: "Reconnexion au flux d’événements",
  BFF_EVENTS_UNSUPPORTED: "Flux temps réel non pris en charge",
  BULLISH: "Orientation haussière",
  CONTEXT_AVAILABLE: "Contexte de marché disponible",
  EVENT_BLACKOUT: "Aucune restriction événementielle active",
  INTERMARKET_CONFIRMATION: "Confirmation des marchés liés",
  MACRO_BLACKOUT: "Fenêtre macroéconomique à éviter",
  MACRO_EVENT_IMMINENT: "Annonce macroéconomique imminente",
  NEUTRAL: "Orientation neutre",
  NORMAL: "Conditions normales",
  NO_SETUP: "Aucun setup détecté",
  RANGE: "Marché en range",
  RISK_OFF: "Contexte défensif",
  RISK_ON: "Contexte favorable au risque",
  TRENDING: "Marché en tendance",
  US_GRAINS_RTH_ONLY: "Séance grains US ouverte",
  US_OPEN_TREND: "Tendance à l’ouverture US",
  VWAP_RELATION: "Position par rapport à la VWAP validée",
};

const PHRASES: readonly (readonly [RegExp, string])[] = [
  [/\bOrderIntent\b/gi, "ordre proposé"],
  [/\bOrderIntents\b/gi, "ordres proposés"],
  [/\bHuman Gate\b/gi, "votre validation"],
  [/\bRunbooks?\b/gi, "procédures"],
  [/\bProvider\b/gi, "fournisseur"],
  [/\bProviders\b/gi, "fournisseurs"],
  [/\bWorkers?\b/gi, "agents de calcul"],
  [/\bSnapshots?\b/gi, "états instantanés"],
  [/\bPayloads?\b/gi, "contenus d’événement"],
  [/\bPost-Risk\b/gi, "après contrôle du risque"],
  [/\bRisk Engine\b/gi, "moteur de risque"],
  [/\bStrategy Runtime\b/gi, "stratégies en fonctionnement"],
  [/\bNet Liquidation\b/gi, "valeur du compte"],
  [/\bTimeline\b/gi, "chronologie"],
  [/\basOf\b/gi, "arrêté à"],
  [/\bDLQ\b/g, "traitements en échec"],
  [/\bBFF\b/g, "service du desk"],
  [/\bcapabilit(?:y|é)\b/gi, "action possible"],
  [/\bEvent Explorer\b/gi, "Journal des événements"],
  [/\bRisk Center\b/gi, "Centre de risque"],
];

export function operatorTerm(term: OperatorTerm): string {
  return TERMS[term];
}

export function operatorCode(raw: unknown, fallback = "Non publié"): string {
  const code = normalizeCode(raw);
  if (!code || ["UNAVAILABLE", "UNDEFINED", "UNKNOWN", "NULL", "NAN"].includes(code)) return fallback;
  return CODES[code] ?? REASON_CODES[code] ?? humanizeCode(code);
}

export function operatorReason(raw: unknown, fallback = "Aucun motif supplémentaire publié"): string {
  const code = normalizeCode(raw);
  if (!code || ["UNAVAILABLE", "UNDEFINED", "UNKNOWN", "NONE"].includes(code)) return fallback;
  return REASON_CODES[code] ?? CODES[code] ?? humanizeCode(code);
}

export function operatorCopy(raw: unknown, fallback = "Non publié"): string {
  const value = String(raw ?? "").trim();
  if (!value || /^(unavailable|undefined|unknown|null|nan|none)$/i.test(value)) return fallback;
  const exact = normalizeCode(value);
  if (CODES[exact] || REASON_CODES[exact]) return operatorCode(exact, fallback);
  return PHRASES.reduce((copy, [pattern, replacement]) => copy.replace(pattern, replacement), value);
}

export function operatorDuration(totalSeconds: number | null | undefined): string {
  if (!Number.isFinite(totalSeconds)) return "Durée non publiée";
  const seconds = Math.max(0, Math.floor(Number(totalSeconds)));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} j ${remainingHours} h` : `${days} j`;
}

export function operatorStatusPresentation(raw: unknown): LabelPresentation {
  const code = normalizeCode(raw) || "UNKNOWN";
  const label = operatorCode(code, "État non publié");
  const danger = ["CRITICAL", "ERROR", "REJECTED"].includes(code);
  const warning = ["DEGRADED", "EXPIRED", "PARTIAL", "PENDING", "STALE", "WARNING", "WARN"].includes(code);
  const success = ["ACTIVE", "APPROVED", "CONFIRMED", "CONSUMED", "CONTROLLED", "DONE", "FILLED", "FRESH", "HEALTHY", "READY", "RUNNING"].includes(code);
  return { code, label, tone: danger ? "danger" : warning ? "warning" : success ? "success" : "neutral", known: Boolean(CODES[code] || REASON_CODES[code]) };
}

function normalizeCode(raw: unknown): string {
  return String(raw ?? "").trim().replace(/[.\s-]+/g, "_").toUpperCase();
}

function humanizeCode(code: string): string {
  return code.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
