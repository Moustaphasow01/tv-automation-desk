import type { DeskTone } from "@/design-system/tokens";

export type StatusPresentation = {
  code: string;
  label: string;
  helper: string;
  tone: DeskTone;
  severity: "INFO" | "SUCCESS" | "WARNING" | "DANGER";
  known: boolean;
};

const REGISTRY: Readonly<Record<string, Omit<StatusPresentation, "code" | "known">>> = {
  AWAITING_MANUAL_CONFIRMATION: { label: "Confirmation requise", helper: "Aucune transmission provider n'est encore autorisée.", tone: "warning", severity: "WARNING" },
  INTENT: { label: "Intention", helper: "L'ordre n'a pas encore été transmis à un provider.", tone: "neutral", severity: "INFO" },
  CANCELLED: { label: "Annulé", helper: "L'ordre a été annulé avant exécution complète.", tone: "neutral", severity: "INFO" },
  CONFIRMED: { label: "Confirmé par l'opérateur", helper: "La confirmation n'est ni un ACK ni un fill broker.", tone: "info", severity: "INFO" },
  REJECTED: { label: "Rejeté", helper: "Le cycle est arrêté par l'autorité qui publie cet état.", tone: "danger", severity: "DANGER" },
  EXPIRED: { label: "Expiré", helper: "L'intention n'est plus exécutable.", tone: "warning", severity: "WARNING" },
  INVALIDATED: { label: "Invalidé", helper: "Un nouveau cycle backend est requis.", tone: "warning", severity: "WARNING" },
  EXECUTION_BLOCKED: { label: "Exécution bloquée", helper: "Le backend interdit la transmission provider.", tone: "danger", severity: "DANGER" },
  PROVIDER_COMMAND_READY: { label: "Commande prête", helper: "La commande provider existe mais n'est pas un ACK.", tone: "info", severity: "INFO" },
  LEASED: { label: "Réclamé", helper: "Le runtime provider a réclamé la commande.", tone: "info", severity: "INFO" },
  SENT: { label: "Transmis", helper: "La commande a été transmise ; l'exécution n'est pas encore prouvée.", tone: "info", severity: "INFO" },
  ACKNOWLEDGED: { label: "ACK provider", helper: "Le provider a accusé réception ; aucun fill n'est déduit.", tone: "accent", severity: "INFO" },
  ACKED: { label: "ACK provider", helper: "Le provider a accusé réception ; aucun fill n'est déduit.", tone: "accent", severity: "INFO" },
  ORDER_ACCEPTED: { label: "Accepté par le provider", helper: "L'acceptation provider n'est pas un fill.", tone: "accent", severity: "INFO" },
  PARTIALLY_FILLED: { label: "Partiellement exécuté", helper: "Seule une partie de la quantité est exécutée.", tone: "warning", severity: "WARNING" },
  PARTIAL: { label: "Partiellement exécuté", helper: "Seule une partie de la quantité est exécutée.", tone: "warning", severity: "WARNING" },
  ORDER_PARTIALLY_FILLED: { label: "Partiellement exécuté", helper: "Seule une partie de la quantité est exécutée.", tone: "warning", severity: "WARNING" },
  FILLED: { label: "Exécuté", helper: "Le fill est publié par l'autorité broker/provider.", tone: "success", severity: "SUCCESS" },
  ORDER_FILLED: { label: "Exécuté", helper: "Le fill est publié par l'autorité broker/provider.", tone: "success", severity: "SUCCESS" },
  ORDER_REJECTED: { label: "Rejet provider", helper: "La raison brute reste disponible dans l'inspecteur.", tone: "danger", severity: "DANGER" },
  RECONCILIATION_REQUIRED: { label: "Réconciliation requise", helper: "L'état attendu et l'état broker doivent être comparés.", tone: "danger", severity: "DANGER" },
  PASS: { label: "Réconcilié", helper: "Le backend publie une réconciliation sans divergence.", tone: "success", severity: "SUCCESS" },
  FILL_INCOMPLETE: { label: "Fill incomplet", helper: "La réconciliation publie une exécution incomplète.", tone: "warning", severity: "WARNING" },
  CONTROLLED_DIVERGENCE: { label: "Divergence contrôlée", helper: "Une divergence reste explicitement suivie.", tone: "warning", severity: "WARNING" },
  NO_ACTIVITY: { label: "Aucune activité", helper: "Aucun événement broker n'est à réconcilier.", tone: "neutral", severity: "INFO" },
  CLOSED: { label: "Circuit fermé", helper: "Le circuit breaker n'interdit pas la route.", tone: "success", severity: "SUCCESS" },
  HALF_OPEN: { label: "Circuit en test", helper: "La disponibilité est limitée par le backend.", tone: "warning", severity: "WARNING" },
  OPEN: { label: "Circuit ouvert", helper: "L'exécution provider est indisponible.", tone: "danger", severity: "DANGER" },
};

export function presentBackendStatus(rawCode: string): StatusPresentation {
  const code = rawCode.trim().toUpperCase() || "UNKNOWN_STATUS";
  const known = REGISTRY[code];
  if (known) return { code, known: true, ...known };
  return {
    code,
    label: "Statut inconnu",
    helper: "Le backend a publié un code que cette version du Front ne connaît pas.",
    tone: "neutral",
    severity: "WARNING",
    known: false,
  };
}

export function presentOrderLifecycleEvidence(summary: {
  state: string;
  orderedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
}): StatusPresentation {
  const raw = presentBackendStatus(summary.state);
  const claimsFilled = ["FILLED", "ORDER_FILLED"].includes(raw.code);
  const quantitiesDisproveFill = summary.filledQuantity < summary.orderedQuantity || summary.remainingQuantity > 0;
  if (claimsFilled && quantitiesDisproveFill) {
    return {
      code: raw.code,
      label: "État incohérent",
      helper: `${raw.code} publié, mais ${summary.filledQuantity}/${summary.orderedQuantity} exécuté et ${summary.remainingQuantity} restant : preuve broker insuffisante.`,
      tone: "danger",
      severity: "DANGER",
      known: true,
    };
  }
  return raw;
}
