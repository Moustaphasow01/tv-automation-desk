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
  ACTIVE: { label: "Active", tone: "danger" },
  OFF: { label: "Inactive", tone: "neutral" },
  NOT_CONFIGURED: { label: "Non configuré", tone: "neutral" },
  DEMO: { label: "Démo", tone: "info" },
  STANDBY: { label: "En réserve", tone: "info" },
  READY: { label: "Prêt", tone: "success" },
  MISSING: { label: "Manquant", tone: "danger" },
  DISABLED: { label: "Désactivé", tone: "neutral" },
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
  WATCH: { label: "À surveiller", tone: "warning" },
  BREACH: { label: "Dépassement", tone: "danger" },
  OPEN: { label: "Ouvert", tone: "danger" },
  ACKED: { label: "Pris en compte", tone: "warning" },
  MITIGATED: { label: "Atténué", tone: "success" },
  BLOCK: { label: "Bloqué", tone: "danger" },
});

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
});

/** Ce qu'un opérateur est autorisé à demander pour une stratégie donnée. */
export const presentCommandEligibility = makePresenter({
  CAN_REQUEST_SHADOW: { label: "Shadow test disponible", tone: "info" },
  CAN_REQUEST_PAPER: { label: "Paper test disponible", tone: "info" },
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

/** Fallback générique : humanise n'importe quel code SCREAMING_SNAKE_CASE
 * sans dictionnaire dédié, pour qu'aucun code brut ne s'affiche jamais tel quel. */
export const presentGeneric = makePresenter({});
