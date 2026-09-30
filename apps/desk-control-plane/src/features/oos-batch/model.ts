import type { OosAction, OosDay, OosRequest } from "@/domains/front-api/oosBatchContract";
export const states: Record<string, string> = { NEW: "À capturer", CAPTURING: "Capture en cours", PREMARKET_READY: "Pré-market prêt",
  WAITING_SCENARIO: "En attente du plan", PLAN_RECEIVED: "Plan reçu", VALIDATING_PLAN: "Vérification technique",
  FROZEN: "Plan figé", REPLAYING: "Rejeu en cours", CAPTURING_RESULTS: "Archivage des résultats", COMPLETED: "Terminé",
  FAILED_TECHNICAL: "Incident technique", FAILED_PLAN_VALIDATION: "Plan refusé" };
export const actions: Record<OosAction, string> = { capture: "Capturer", "retry-capture": "Reprendre les captures", scenario: "Demander le plan", replay: "Rejouer", retry: "Réessayer", "new-plan": "Demander un nouveau plan", run: "Lancer le parcours" };
export const valueLabel = (v: number | null | undefined) => v == null ? "Non fourni" : v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
export const dateLabel = (v: string) => new Date(v.length === 10 ? `${v}T12:00:00Z` : v).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "medium", ...(v.length === 10 ? {} : { timeStyle: "short" }) });
export function dayRequest(day: OosDay, action: OosAction): OosRequest {
  return { batch_id: day.batch_id, date: day.day, symbol: day.definition.symbol, cutoff_time: day.definition.cutoff.slice(11, 16), action };
}
export function errorLabel(error: Error | null): string {
  if (!error) return "";
  if (/AUTH|401|unauthorized|SCOPE|403/.test(error.message)) return "Accès refusé. Connectez-vous avec un compte opérateur autorisé.";
  if (/NOT_CONFIGURED|CONFIGURATION|503/.test(error.message)) return "Parcours non raccordé : l’administrateur doit configurer les connexions OOS.";
  return `La demande n’a pas abouti (${error.message}). Vous pouvez réessayer sans dupliquer la commande.`;
}
