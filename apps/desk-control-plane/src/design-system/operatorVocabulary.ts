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
  LIMIT: "Ordre limite",
  LIVE_MASTER: "Flux principal",
  LOW: "Faible",
  LONG: "Achat",
  MARKET: "Ordre au marché",
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
  STOP: "Stop",
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
  NO_SIGNAL_REACHED_HUMAN_GATE: "Aucun signal n’a atteint la validation humaine",
};

const REASON_CODES: Readonly<Record<string, string>> = {
  BEARISH: "Orientation baissière",
  BREAKOUT_CONFIRMED: "Cassure confirmée",
  BFF_EVENTS_INVALID_MESSAGE: "Événement temps réel illisible",
  BFF_EVENTS_RECONNECTING: "Reconnexion au flux d’événements",
  BFF_NETWORK_OFFLINE: "Réseau indisponible",
  BFF_EVENTS_UNSUPPORTED: "Flux temps réel non pris en charge",
  BULLISH: "Orientation haussière",
  CONTEXT_AVAILABLE: "Contexte de marché disponible",
  CUTOFF_VALID: "Valide au point de coupure",
  EVENT_BLACKOUT: "Aucune restriction événementielle active",
  INTERMARKET_CONFIRMATION: "Confirmation des marchés liés",
  LATEST_FIVE_MINUTE_BARS_UNRECONCILED: "Dernières bougies cinq minutes non réconciliées",
  LATE_SYNCHRONIZED_SELLING_WITH_INITIAL_ONE_MINUTE_REBOUND_AND_UNRECONCILED_LATEST_FIVE_MINUTE_BARS: "Pression vendeuse synchronisée tardive, rebond initial M1 et dernières M5 non réconciliées",
  MACRO_BLACKOUT: "Fenêtre macroéconomique à éviter",
  MACRO_EVENT_IMMINENT: "Annonce macroéconomique imminente",
  MARKET_CONTEXT_STALE: "Contexte de marché périmé",
  NEUTRAL: "Orientation neutre",
  NO_ACTIVE_SIDE: "Aucun biais actif",
  NO_SIGNAL_REACHED_HUMAN_GATE: "Aucun signal n’a atteint la validation humaine",
  NORMAL: "Conditions normales",
  NO_SETUP: "Aucun setup détecté",
  OBSERVATION_ONLY: "Observation uniquement",
  HIGH_WITH_ZW_STRUCTURALLY_MORE_VOLATILE: "Volatilité élevée, ZW structurellement plus volatil",
  CAUTIOUS_BEARISH_PRESSURE_WITH_NO_ACTIVE_SIDE: "Pression baissière prudente, sans biais actif",
  RANGE: "Marché en range",
  RISK_OFF: "Contexte défensif",
  RISK_ON: "Contexte favorable au risque",
  TRENDING: "Marché en tendance",
  US_GRAINS_RTH_ONLY: "Séance grains US ouverte",
  US_OPEN_TREND: "Tendance à l’ouverture US",
  VWAP_RELATION: "Position par rapport à la VWAP validée",
};

const PHRASES: readonly (readonly [RegExp, string])[] = [
  [/\bBoth grains suffered late selling and rebounded in the cutoff-valid ([^,]+?) one-minute bars, but the latest five-minute bars remain unreconciled, leaving no active side\./gi, "Les deux grains ont subi une pression vendeuse tardive puis ont rebondi sur les bougies une minute valides au point de coupure $1, mais les dernières bougies cinq minutes restent non réconciliées : aucun biais actif."],
  [/\b([A-Z]{1,5}) reached ([0-9.,]+) and closed ([0-9.,]+) at ([0-9:]+) after exceptional late selling volume\./g, "$1 a atteint $2 puis a clôturé à $3 à $4 après un volume vendeur tardif exceptionnel."],
  [/\b([A-Z]{1,5}) rebounded from ([0-9.,]+) to ([0-9.,]+) after printing ([0-9.,]+) at ([0-9:]+)\./g, "$1 a rebondi de $2 à $3 après un point bas à $4 à $5."],
  [/\bThe five-minute bars labeled ([0-9:]+) are excluded from directional confirmation because their values cannot be formed from the cutoff-valid one-minute data supplied\./gi, "Les bougies cinq minutes marquées $1 sont exclues de la confirmation directionnelle car leurs valeurs ne peuvent pas être reconstruites à partir des données une minute valides au point de coupure."],
  [/\bLate synchronized selling with initial one minute rebound and unreconciled latest five minute bars\b/gi, "Pression vendeuse synchronisée tardive, rebond initial M1 et dernières M5 non réconciliées"],
  [/\bHigh with ZW structurally more volatile\b/gi, "Élevée, avec ZW structurellement plus volatil"],
  [/\bCautious bearish pressure with no active side\b/gi, "Pression baissière prudente, sans biais actif"],
  [/\bcutoff-valid one-minute constituents for the five-minute bars labeled ([0-9:]+)\b/gi, "les bougies M1 valides au point de coupure pour les bougies M5 marquées $1"],
  [/\bclarification of the one-minute and five-minute timestamp convention\b/gi, "la clarification de la convention d’horodatage M1/M5"],
  [/\bthe missing ([0-9:]+) and ([0-9:]+) one-minute records or an explicit gap explanation\b/gi, "les bougies M1 manquantes de $1 et $2, ou une explication explicite de l’écart"],
  [/\breconciliation of covered=false ohlcv readiness flags with the available series\b/gi, "la réconciliation des indicateurs de préparation OHLCV non couverts avec les séries disponibles"],
  [/\ba session-state observation valid at or before ([0-9:]+z)\b/gi, "un état de séance valide au plus tard à $1"],
  [/\bcutoff-valid confirmation of stabilization or renewed weakness for each instrument\b/gi, "une confirmation, valide au point de coupure, de stabilisation ou de reprise de faiblesse pour chaque instrument"],
  [/\bthe september 1 grain crushings outcome and availability timestamp if contextually relevant\b/gi, "le résultat Grain Crushings du 1er septembre et son horodatage de disponibilité s’il est pertinent"],
  [/\bTreating opportunity zones as orders\b/gi, "Assimiler les zones d’opportunité à des ordres"],
  [/\bUsing the five minute bars labeled ([0-9:]+) as cutoff facts before reconciliation\b/gi, "Utiliser les bougies M5 marquées $1 comme faits au point de coupure avant réconciliation"],
  [/\bUsing post cutoff postclose or waiting session states as cutoff facts\b/gi, "Utiliser des états post-coupure, post-clôture ou d’attente comme faits au point de coupure"],
  [/\bChasing the late decline or initial rebound\b/gi, "Courir après la baisse tardive ou le rebond initial"],
  [/\bReusing historical signals as current authority\b/gi, "Réutiliser des signaux historiques comme autorité actuelle"],
  [/\bAssuming weather, news, macro facts, vwap, or usda outcomes absent from the bundle\b/gi, "Supposer des éléments météo, news, macro, VWAP ou USDA absents du bundle"],
  [/\bCreating provider, risk, execution, or humangate actions\b/gi, "Créer des actions fournisseur, risque, exécution ou validation humaine"],
  [/\bTargetPosition\b/gi, "position cible"],
  [/\bHumanGate\b/gi, "validation humaine"],
  [/\bMarket context stale\b/gi, "Contexte de marché périmé"],
  [/\bNo signal reached human gate\b/gi, "Aucun signal n’a atteint la validation humaine"],
  [/\bObservation only\b/gi, "Observation uniquement"],
  [/\bBoth grains\b/gi, "Les deux grains"],
  [/\bUS grains\b/gi, "les grains US"],
  [/\bsuffered late selling\b/gi, "ont subi une pression vendeuse tardive"],
  [/\blate selling\b/gi, "pression vendeuse tardive"],
  [/\brebounded\b/gi, "ont rebondi"],
  [/\bcutoff-valid\b/gi, "valide au point de coupure"],
  [/\bone-minute bars\b/gi, "bougies une minute"],
  [/\bfive-minute bars\b/gi, "bougies cinq minutes"],
  [/\blatest five-minute bars remain unreconciled\b/gi, "les dernières bougies cinq minutes restent non réconciliées"],
  [/\bleaving no active side\b/gi, "sans biais actif"],
  [/\bafter exceptional late selling volume\b/gi, "après un volume vendeur tardif exceptionnel"],
  [/\bThe five-minute bars labeled\b/gi, "Les bougies cinq minutes marquées"],
  [/\bare excluded from directional confirmation\b/gi, "sont exclues de la confirmation directionnelle"],
  [/\bbecause their values cannot be formed from the cutoff-valid one-minute data supplied\b/gi, "car leurs valeurs ne peuvent pas être reconstruites à partir des données une minute valides au point de coupure"],
  [/\bNo active side\b/gi, "Aucun biais actif"],
  [/\bclosed above\b/gi, "a clôturé au-dessus de"],
  [/\bclosed below\b/gi, "a clôturé sous"],
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
