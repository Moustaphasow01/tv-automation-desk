import type { DeskTone } from "./tokens";

export type LabelPresentation = {
  code: string;
  label: string;
  tone: DeskTone;
  known: boolean;
};

type Registry = Readonly<Record<string, { label: string; tone: DeskTone }>>;

function humanizeFallback(code: string): string {
  return code
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function makePresenter(registry: Registry, fallbackTone: DeskTone = "neutral") {
  return function present(rawCode: string | null | undefined): LabelPresentation {
    const code = String(rawCode ?? "").trim().toUpperCase();
    if (!code) return { code: "—", label: "—", tone: "neutral", known: true };
    const entry = registry[code];
    if (entry) return { code, label: entry.label, tone: entry.tone, known: true };
    return { code, label: humanizeFallback(code), tone: fallbackTone, known: false };
  };
}

/** Mode d'exécution d'une stratégie : jusqu'où le backend est autorisé à agir. */
export const presentExecutionMode = makePresenter({
  SHADOW: { label: "Observation seule", tone: "info" },
  PAPER: { label: "Simulation (papier)", tone: "accent" },
  SEMI_MANUAL: { label: "Semi-manuel", tone: "warning" },
  LIVE: { label: "Réel", tone: "danger" },
  ADVISORY: { label: "Consultatif", tone: "accent" },
  OFF: { label: "Inactif", tone: "neutral" },
});

/** Statut de validation d'une version de stratégie dans son cycle de vie. */
export const presentVersionStatus = makePresenter({
  DRAFT: { label: "Brouillon", tone: "neutral" },
  VALIDATED: { label: "Validée", tone: "success" },
  REJECTED: { label: "Rejetée", tone: "danger" },
  DEPRECATED: { label: "Dépréciée", tone: "warning" },
  RETIRED: { label: "Retirée", tone: "neutral" },
});

/** État runtime d'une instance de stratégie ou d'un service. */
export const presentRuntimeStatus = makePresenter({
  STOPPED: { label: "Arrêtée", tone: "neutral" },
  STARTING: { label: "Démarrage…", tone: "info" },
  RUNNING: { label: "En cours", tone: "success" },
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "En pause", tone: "warning" },
  DRAINING: { label: "Vidage en cours", tone: "warning" },
  DRAINED: { label: "Vidée", tone: "warning" },
  WAITING: { label: "En attente", tone: "info" },
  WAITING_SESSION: { label: "En attente de la séance CBOT", tone: "info" },
  MARKET_CLOSED: { label: "Marché fermé", tone: "neutral" },
  FAILED: { label: "En échec", tone: "danger" },
  QUEUED: { label: "En file", tone: "info" },
  PASSED: { label: "Validé", tone: "success" },
});

/** Santé opérationnelle live d'une stratégie ou d'un composant. */
export const presentHealth = makePresenter({
  OK: { label: "OK", tone: "success" },
  WATCH: { label: "À surveiller", tone: "warning" },
  DEGRADED: { label: "Dégradée", tone: "danger" },
  OFF: { label: "Inactive", tone: "neutral" },
});

/** Disponibilité d'une source, d'un provider ou d'un flux de données. */
export const presentAvailability = makePresenter({
  AVAILABLE: { label: "Disponible", tone: "success" },
  UNAVAILABLE: { label: "Indisponible", tone: "danger" },
  DEGRADED: { label: "Dégradée", tone: "warning" },
  CONNECTED_EMPTY: { label: "Connecté, sans donnée", tone: "info" },
  DISABLED_BY_POLICY: { label: "Désactivé par politique", tone: "neutral" },
  NOT_APPLICABLE_CURRENT_MODE: { label: "Non applicable au mode courant", tone: "neutral" },
  KNOWN: { label: "Connu", tone: "success" },
  UNKNOWN: { label: "Inconnu", tone: "warning" },
  RECONCILING: { label: "Réconciliation en cours", tone: "warning" },
  INSTALLED: { label: "Installé", tone: "info" },
  VALIDATION_PENDING: { label: "Validation en attente", tone: "warning" },
  DISCONNECTED: { label: "Déconnecté", tone: "danger" },
  LAST_KNOWN: { label: "Dernière valeur connue", tone: "info" },
  STALE: { label: "Périmée", tone: "warning" },
  PARTIAL: { label: "Partielle", tone: "warning" },
  ORDER_INTENT_PUBLISHED: { label: "Intention publiée", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  OFF: { label: "Inactive", tone: "neutral" },
  NOT_CONFIGURED: { label: "Non configuré", tone: "neutral" },
  DEMO: { label: "Démo", tone: "info" },
  STANDBY: { label: "En réserve", tone: "info" },
  READY: { label: "Prêt", tone: "success" },
  MISSING: { label: "Manquant", tone: "danger" },
  DISABLED: { label: "Désactivé", tone: "neutral" },
});

/** Absence de valeur métier : indique si l'opérateur doit attendre, ignorer ou constater une non-publication. */
export type DataAbsenceKind = "COMPUTING" | "NOT_APPLICABLE" | "NOT_PUBLISHED";
export const presentDataAbsence = makePresenter({
  COMPUTING: { label: "En cours de calcul", tone: "info" },
  NOT_APPLICABLE: { label: "Non applicable", tone: "neutral" },
  NOT_PUBLISHED: { label: "Non publié", tone: "neutral" },
});

/** Fraîcheur d'une projection ou d'un flux de données. */
export const presentFreshness = makePresenter({
  LIVE: { label: "Live", tone: "success" },
  FRESH: { label: "À jour", tone: "success" },
  STALE: { label: "Périmée", tone: "warning" },
  PARTIAL: { label: "Partielle", tone: "warning" },
  WATCH: { label: "À surveiller", tone: "warning" },
});

/** Orientation d'un facteur de contexte marché (positif/négatif pour le signal). */
export const presentContextTone = makePresenter({
  POSITIVE: { label: "Favorable", tone: "success" },
  NEUTRAL: { label: "Neutre", tone: "neutral" },
  NEGATIVE: { label: "Défavorable", tone: "danger" },
  WATCH: { label: "À surveiller", tone: "warning" },
});

/** Résolution d'un conflit de portefeuille (corrélation, position, budget risque). */
export const presentConflictResolution = makePresenter({
  CLEAR: { label: "Levé", tone: "success" },
  SCALED: { label: "Réduit", tone: "warning" },
  BLOCKED: { label: "Bloqué", tone: "danger" },
  WATCH: { label: "À surveiller", tone: "warning" },
});

/** Décision d'arbitrage portefeuille sur un signal. */
export const presentArbitrationDecision = makePresenter({
  ACCEPTED: { label: "Accepté", tone: "success" },
  REJECTED: { label: "Rejeté", tone: "danger" },
  SCALED: { label: "Réduit", tone: "warning" },
});

/** État de conflit global d'un arbitrage portefeuille. */
export const presentConflictStatus = makePresenter({
  CLEAR: { label: "Aucun conflit", tone: "success" },
  CORRELATED: { label: "Corrélé", tone: "warning" },
  CONFLICT: { label: "Conflit", tone: "danger" },
});

/** Décision opérateur ou conseil IA sur un signal (take/reduce/wait/reject). */
export const presentTradeDecision = makePresenter({
  TAKE: { label: "Prendre", tone: "success" },
  TAKE_REDUCED: { label: "Prendre (réduit)", tone: "warning" },
  WAIT: { label: "Attendre", tone: "info" },
  REJECT: { label: "Rejeter", tone: "danger" },
});

/** Droit d'accès d'un opérateur sur une action ou une ressource. */
export const presentPermission = makePresenter({
  ALLOWED: { label: "Autorisé", tone: "success" },
  DENIED: { label: "Refusé", tone: "danger" },
  STEP_UP_REQUIRED: { label: "Vérification renforcée requise", tone: "warning" },
  INVITED: { label: "Invité", tone: "info" },
  READ_ONLY: { label: "Lecture seule", tone: "neutral" },
});

/** Sévérité d'un incident ou d'une alerte. */
export const presentSeverity = makePresenter({
  LOW: { label: "Faible", tone: "info" },
  MEDIUM: { label: "Moyenne", tone: "warning" },
  HIGH: { label: "Élevée", tone: "danger" },
  CRITICAL: { label: "Critique", tone: "danger" },
  EMERGENCY: { label: "Urgence", tone: "danger" },
});

/** Statut d'un item dans une file d'opérations (missions, événements, gates). */
export const presentQueueStatus = makePresenter({
  UNAVAILABLE: { label: "Non publié", tone: "neutral" },
  UNKNOWN: { label: "État non publié", tone: "neutral" },
  OPERATOR_GATE_REQUIRED: { label: "Validation opérateur requise", tone: "warning" },
  WAITING_EVENT: { label: "En attente d'événement", tone: "info" },
  DLQ: { label: "File d'erreurs", tone: "danger" },
  RETRYING: { label: "Nouvelle tentative…", tone: "warning" },
  DONE: { label: "Terminé", tone: "success" },
  RUNNING: { label: "En cours", tone: "success" },
  BLOCKED: { label: "Bloqué", tone: "danger" },
  PASS: { label: "Validé", tone: "success" },
  RECEIVED: { label: "Reçu", tone: "success" },
  EXPECTED: { label: "Attendu", tone: "info" },
  STALE: { label: "Périmé", tone: "warning" },
  READY: { label: "Prêt", tone: "success" },
  OK: { label: "OK", tone: "success" },
  FAILED: { label: "En échec", tone: "danger" },
  WATCH: { label: "À surveiller", tone: "warning" },
  BREACH: { label: "Dépassement", tone: "danger" },
  OPEN: { label: "Ouvert", tone: "danger" },
  ACKED: { label: "Pris en compte", tone: "warning" },
  MITIGATED: { label: "Atténué", tone: "success" },
  BLOCK: { label: "Bloqué", tone: "danger" },
});

/**
 * État opérationnel générique partagé par les surfaces de supervision.
 *
 * Ce registre ne crée aucun état métier : il garantit seulement qu'un même
 * code backend garde la même gravité visuelle partout dans le Desk.
 */
export const presentOperationalStatus = makePresenter({
  OK: { label: "OK", tone: "success" },
  NOMINAL: { label: "Nominal", tone: "success" },
  HEALTHY: { label: "Sain", tone: "success" },
  FRESH: { label: "À jour", tone: "success" },
  READY: { label: "Prêt", tone: "success" },
  APPROVED: { label: "Approuvé", tone: "success" },
  ACCEPTED: { label: "Accepté", tone: "success" },
  DONE: { label: "Terminé", tone: "success" },
  FILLED: { label: "Exécuté", tone: "success" },
  COMPLETED: { label: "Terminé", tone: "success" },
  PASS: { label: "Validé", tone: "success" },
  CONTROLLED: { label: "Sous contrôle", tone: "success" },
  TAKE: { label: "Prendre", tone: "success" },
  BLOCKED: { label: "Bloqué", tone: "danger" },
  BLOCK: { label: "Bloqué", tone: "danger" },
  KILL_SWITCH_ACTIVE: { label: "Kill switch actif", tone: "danger" },
  CRITICAL: { label: "Critique", tone: "danger" },
  DOWN: { label: "Indisponible", tone: "danger" },
  FAILED: { label: "En échec", tone: "danger" },
  REJECTED: { label: "Rejeté", tone: "danger" },
  BREACH: { label: "Dépassement", tone: "danger" },
  STOP: { label: "Arrêt critique", tone: "danger" },
  UNAVAILABLE: { label: "Indisponible", tone: "danger" },
  DEGRADED: { label: "Dégradé", tone: "warning" },
  STALE: { label: "Périmé", tone: "warning" },
  DELAYED: { label: "En retard", tone: "warning" },
  WATCH: { label: "À surveiller", tone: "warning" },
  WAIT: { label: "En attente", tone: "warning" },
  WAITING: { label: "En attente", tone: "warning" },
  PARTIAL: { label: "Partiel", tone: "warning" },
  TAKE_REDUCED: { label: "Prendre avec risque réduit", tone: "warning" },
  AWAITING: { label: "En attente", tone: "warning" },
  UNKNOWN: { label: "Inconnu", tone: "warning" },
  CONNECTED_EMPTY: { label: "Connecté, sans donnée", tone: "info" },
  NO_NOMINAL_DECISION: { label: "Aucune décision requise", tone: "info" },
  ORDER_INTENT_PUBLISHED: { label: "Intention publiée", tone: "info" },
  LAST_KNOWN: { label: "Dernière valeur connue", tone: "info" },
  EXPIRED: { label: "Expiré", tone: "warning" },
  DISABLED_BY_POLICY: { label: "Désactivé par politique", tone: "info" },
  MARKET_CLOSED: { label: "Marché fermé", tone: "info" },
});

/**
 * Nettoie uniquement la copie présentée à l'opérateur. La valeur brute reste
 * disponible dans les contrats et inspecteurs techniques ; elle n'est jamais
 * utilisée pour déduire un état métier.
 */
export function presentOperatorText(value: unknown, fallback = "Non publié"): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || ["unavailable", "undefined", "unknown", "none"].includes(normalized.toLowerCase())) return fallback;
  return normalized
    .replace(/\bunavailable\b/gi, "non disponible")
    .replace(/\bundefined\b/gi, "non publié")
    .replace(/\bunknown\b/gi, "inconnu");
}

/** État d'un signal de stratégie dans son cycle de vie. */
export const presentSignalState = makePresenter({
  NEW: { label: "Nouveau", tone: "info" },
  ARBITRATED: { label: "Arbitré", tone: "accent" },
  ORDERED: { label: "Ordonné", tone: "info" },
  FILLED: { label: "Exécuté", tone: "success" },
  REJECTED: { label: "Rejeté", tone: "danger" },
  EXPIRED: { label: "Expiré", tone: "warning" },
});

/** Résultat d'une gate de validation (backtest, robustesse, risque, etc.). */
export const presentGateState = makePresenter({
  PASS: { label: "Validée", tone: "success" },
  WATCH: { label: "À surveiller", tone: "warning" },
  FAIL: { label: "Échec", tone: "danger" },
  PENDING: { label: "En attente", tone: "neutral" },
});

/** Conditions déterministes publiées par les moteurs de stratégie. */
export const presentStrategyPredicate = makePresenter({
  US_GRAINS_RTH_ONLY: { label: "Session grains US ouverte", tone: "info" },
  CONTEXT_AVAILABLE: { label: "Contexte de marché disponible", tone: "info" },
  SESSION_US: { label: "Dans la session américaine", tone: "info" },
  BREAKOUT_CONFIRMED: { label: "Cassure confirmée", tone: "accent" },
  PRICE_RELATION: { label: "Relation de prix validée", tone: "accent" },
  PRICE_CROSS: { label: "Franchissement de prix validé", tone: "accent" },
  ZONE_TOUCH: { label: "Zone technique touchée", tone: "accent" },
  BREAKOUT_CLOSE: { label: "Bougie clôturée au-delà du niveau", tone: "accent" },
  BREAKOUT_CLOSE_ABOVE_RANGE: { label: "Clôture de cassure au-dessus du range", tone: "accent" },
  BREAK_RETEST_SEQUENCE: { label: "Cassure puis retest confirmés", tone: "accent" },
  RETEST_ZONE_CONFIRMED: { label: "Retest de zone confirmé", tone: "accent" },
  REJECTION_PATTERN: { label: "Rejet de niveau confirmé", tone: "accent" },
  VWAP_RELATION: { label: "Position relative à la VWAP validée", tone: "accent" },
  RSI_THRESHOLD: { label: "Seuil RSI atteint", tone: "accent" },
  TIME_WINDOW: { label: "Fenêtre horaire respectée", tone: "info" },
  INTERMARKET_CONFIRMATION: { label: "Confirmation intermarché présente", tone: "accent" },
  CROSS_ASSET_VOL_FILTER_OK: { label: "Volatilité des marchés liés compatible", tone: "accent" },
  PORTFOLIO_CORRELATION_WATCH: { label: "Corrélation du portefeuille à surveiller", tone: "warning" },
  EVENT_BLACKOUT: { label: "Aucun blackout événementiel actif", tone: "info" },
});

/** Ce qu'un opérateur est autorisé à demander pour une stratégie donnée. */
export const presentCommandEligibility = makePresenter({
  CAN_REQUEST_SHADOW: { label: "Test en observation disponible", tone: "info" },
  CAN_REQUEST_PAPER: { label: "Test en simulation disponible", tone: "info" },
  READ_ONLY: { label: "Lecture seule", tone: "neutral" },
});

/** Niveau d'attention d'un événement récent (journal stratégie). */
export const presentEventTone = makePresenter({
  INFO: { label: "Info", tone: "accent" },
  WATCH: { label: "À surveiller", tone: "warning" },
  HIGH: { label: "Important", tone: "danger" },
});

/** Portée d'accès admin d'un opérateur ou d'un groupe de comptes. */
export const presentAccessState = makePresenter({
  FULL_ADMIN: { label: "Administration complète", tone: "danger" },
  READ_ONLY: { label: "Lecture seule", tone: "neutral" },
  DENIED: { label: "Refusé", tone: "danger" },
  ACTIVE: { label: "Actif", tone: "success" },
  LOCKED: { label: "Verrouillé", tone: "danger" },
  INVITED: { label: "Invité", tone: "info" },
  REVOKED: { label: "Révoqué", tone: "danger" },
  REQUIRED: { label: "Requis", tone: "warning" },
  READY: { label: "Prêt", tone: "success" },
  EXPIRING: { label: "Expire bientôt", tone: "warning" },
  AVAILABLE: { label: "Disponible", tone: "success" },
});

/** Décision d'autorisation RBAC sur une capability (permet/refuse/conditionne). */
export const presentDecision = makePresenter({
  ALLOW: { label: "Autorisé", tone: "success" },
  DENY: { label: "Refusé", tone: "danger" },
  READ_ONLY: { label: "Lecture seule", tone: "neutral" },
  STEP_UP_REQUIRED: { label: "Vérification renforcée requise", tone: "warning" },
});

/** Niveau d'accès d'un opérateur à un provider d'exécution. */
export const presentAccessLevel = makePresenter({
  READ: { label: "Lecture", tone: "neutral" },
  COMMAND: { label: "Commande", tone: "warning" },
  DENIED: { label: "Refusé", tone: "danger" },
});

/** Résultat d'un événement d'audit (accès, commande admin). */
export const presentAuditStatus = makePresenter({
  ACCEPTED: { label: "Acceptée", tone: "success" },
  DENIED: { label: "Refusée", tone: "danger" },
  APPLIED: { label: "Appliquée", tone: "success" },
  FAILED: { label: "Échouée", tone: "danger" },
});

/** Voie d'un événement d'audit : source de vérité ou avis consultatif. */
export const presentEventLane = makePresenter({
  AUTHORITATIVE: { label: "Autoritaire", tone: "success" },
  ADVISORY: { label: "Consultatif", tone: "accent" },
});

/** Domaine métier d'un événement d'audit ou d'une relation causale (events-audit). */
export const presentDomain = makePresenter({
  RESEARCH: { label: "Recherche", tone: "info" },
  STRATEGY: { label: "Stratégie", tone: "accent" },
  LIVE: { label: "Direct", tone: "danger" },
  PORTFOLIO: { label: "Portefeuille", tone: "accent" },
  RISK: { label: "Risque", tone: "warning" },
  EXECUTION: { label: "Exécution", tone: "info" },
  JARVIS: { label: "Jarvis", tone: "accent" },
  SYSTEM: { label: "Système", tone: "neutral" },
});

/** Type de relation causale entre deux événements d'audit (events-audit). */
export const presentRelationKind = makePresenter({
  CAUSES: { label: "Cause", tone: "accent" },
  FOLLOWS: { label: "Suit", tone: "neutral" },
  ADVISES: { label: "Conseille", tone: "info" },
  BLOCKS: { label: "Bloque", tone: "danger" },
});

/** État de la connexion temps réel (flux SSE du Control Plane). */
export const presentConnectionStatus = makePresenter({
  CONNECTING: { label: "Connexion...", tone: "warning" },
  OPEN: { label: "Connecté", tone: "success" },
  RECONNECTING: { label: "Reconnexion...", tone: "warning" },
  CLOSED: { label: "Fermé", tone: "neutral" },
  FAILED: { label: "Échec", tone: "danger" },
});

/** Verdict de validation d'un candidat de recherche (rapport d'évaluation). */
export const presentResearchDecision = makePresenter({
  PROMOTED: { label: "Promu", tone: "success" },
  REJECTED: { label: "Rejeté", tone: "danger" },
  REVIEW: { label: "En revue", tone: "warning" },
});

/** Statut du cycle de vie d'une commande opérateur suivie (front-control-plane). */
export const presentCommandStatus = makePresenter({
  REQUESTED: { label: "Demandée", tone: "neutral" },
  ACCEPTED: { label: "Acceptée", tone: "info" },
  RUNNING: { label: "En cours", tone: "accent" },
  SUCCEEDED: { label: "Réussie", tone: "success" },
  FAILED: { label: "Échouée", tone: "danger" },
  CONFLICT: { label: "Conflit", tone: "warning" },
  REJECTED: { label: "Rejetée", tone: "danger" },
  CANCELLED: { label: "Annulée", tone: "neutral" },
  TIMED_OUT: { label: "Expirée", tone: "warning" },
});

/** Statut d'un incident d'exécution dans son cycle de vie (execution-incidents). */
export const presentIncidentStatus = makePresenter({
  OPEN: { label: "Ouvert", tone: "accent" },
  ACKNOWLEDGED: { label: "Pris en compte", tone: "accent" },
  RECONCILING: { label: "Réconciliation en cours", tone: "warning" },
  RETRYING: { label: "Nouvelle tentative…", tone: "warning" },
  RESOLVED: { label: "Résolu", tone: "success" },
  ESCALATED: { label: "Remonté", tone: "danger" },
  DLQ: { label: "File d'erreurs", tone: "danger" },
});

/** Domaine fonctionnel touché par un incident d'exécution. */
export const presentIncidentDomain = makePresenter({
  LIVE: { label: "Live", tone: "danger" },
  ORDER: { label: "Ordre", tone: "accent" },
  POSITION: { label: "Position", tone: "accent" },
  RISK: { label: "Risque", tone: "warning" },
  PROVIDER: { label: "Fournisseur", tone: "accent" },
  STRATEGY: { label: "Stratégie", tone: "accent" },
  SYSTEM: { label: "Système", tone: "neutral" },
});

/** État d'une étape de chronologie incident (post-mortem, replay). */
export const presentChronologyState = makePresenter({
  DONE: { label: "Terminée", tone: "success" },
  WAITING: { label: "En attente", tone: "info" },
  FAILED: { label: "Échouée", tone: "danger" },
  SKIPPED: { label: "Ignorée", tone: "neutral" },
});

/** État d'une tentative de retry (file de dead letters incident). */
export const presentRetryState = makePresenter({
  SCHEDULED: { label: "Planifiée", tone: "info" },
  RUNNING: { label: "En cours", tone: "accent" },
  FAILED: { label: "Échouée", tone: "danger" },
  SUCCEEDED: { label: "Réussie", tone: "success" },
  ABANDONED: { label: "Abandonnée", tone: "danger" },
});

/** Résultat d'une vérification de réconciliation (orders/fills/positions). */
export const presentReconciliationStatus = makePresenter({
  MATCH: { label: "Conforme", tone: "success" },
  DELTA: { label: "Écart", tone: "warning" },
  MISSING: { label: "Manquant", tone: "danger" },
  REPAIRED: { label: "Réparé", tone: "success" },
});

/** Niveau de gate opérateur requis pour agir sur un incident. */
export const presentOperatorGate = makePresenter({
  NONE: { label: "Aucune", tone: "neutral" },
  OPTIONAL: { label: "Optionnelle", tone: "info" },
  REQUIRED: { label: "Requise", tone: "warning" },
  EMERGENCY_ONLY: { label: "Urgence uniquement", tone: "danger" },
});

/** Sévérité d'une règle de notification opérateur (operator-settings). */
export const presentNotificationSeverity = makePresenter({
  INFO: { label: "Info", tone: "accent" },
  WARNING: { label: "Avertissement", tone: "warning" },
  CRITICAL: { label: "Critique", tone: "danger" },
});

/** État d'un appareil enregistré (settings desk opérateur). */
export const presentDeviceState = makePresenter({
  ACTIVE: { label: "Active", tone: "success" },
  STALE: { label: "Périmée", tone: "warning" },
  REVOKABLE: { label: "Révocable", tone: "warning" },
});

/** Fallback générique : humanise n'importe quel code SCREAMING_SNAKE_CASE
 * sans dictionnaire dédié, pour qu'aucun code brut ne s'affiche jamais tel quel. */
export const presentGeneric = makePresenter({});
