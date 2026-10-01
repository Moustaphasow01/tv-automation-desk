# OOS Batch — contrat opérateur

## Placement et objectif

Page `/replay/oos`, opérateur authentifié : voir où en est chaque journée, ouvrir ses preuves, reprendre une opération technique. Aucun ordre, aucun calcul de stratégie. Backend propriétaire de l'état ; le client ne simule pas la progression.

## Direction visuelle

Réutiliser le desk : fond #03070e, panneau #071522, trait #15304b, texte #e8f2ff, accent #159dc4, alerte #ff9d2e. Police sans du desk pour lire, monospace pour empreintes et plan. Une table de contrôle et une planche de huit preuves constituent la signature ; ni jauge inventée ni animation de marché. Sur petit écran, tableau défilable nommé et formulaire empilé ; images à hauteur naturelle.

## États et transitions

Lecture : chargement → données / vide / refus / incident. Actualisation échouée avec données : conserver la dernière lecture, signaler qu'elle est ancienne. Commande : prêt → envoi → reçu en file → traitement → terminé ou erreur. Un reçu de commande n'est pas une preuve de replay terminé.

| État backend | Action explicite |
|---|---|
| NEW / CAPTURING | Capturer le pré-market |
| PREMARKET_READY / WAITING_SCENARIO / PLAN_RECEIVED / VALIDATING_PLAN | Demander / reprendre le plan externe |
| FROZEN / REPLAYING / CAPTURING_RESULTS | Rejouer / reprendre |
| FAILED_TECHNICAL | Réessayer |
| FAILED_PLAN_VALIDATION | Demander un nouveau plan externe |
| COMPLETED | Lire les preuves, aucune relance |

Les actions nécessitent l'autorisation serveur desk.write. L'identifiant de commande reste identique lors d'une reprise réseau. Une nouvelle commande est distincte et visible. Date, cutoff et symbole sont explicites ; aucun horaire de trading n'est présupposé.

## Règles de recette

Sélection UI/UX : UXR0960,0349,0481,0060,0181,0183,0482,0633,0453,0499,0182,0184. Labels persistants, erreurs actionnables, focus visible, retour de soumission, absence de données distincte de zéro, dates lisibles, navigation clavier, lecture mobile, contexte conservé dans l'URL. Aucun résultat fictif, aucune mutation optimiste du statut.

Tester : chargement, vide, erreur, lecture ancienne, reçu en attente, plan refusé, accès refusé, hash long, plan multiline exact, artefact manquant, données partiellement disponibles.

## Préparation autonome PREMARKET

Le panneau « Préparer les bundles » expose « Préparer journée » et « Préparer
plage ». Dates V1 juillet/août 2026, MES/09:00 Paris/CLOSED_ONLY fixes et visibles.
Les commandes serveur persistent immédiatement ; l'UI ne lance pas TradingView
et n'annonce pas une capture terminée avant le reçu backend.

La lecture de la file affiche Ready / Failed / Completed, prochaine journée en
attente de scénario, dates en file et heure d'observation serveur. Le batch
sélectionné (`prepare_batch`) et le filtre de journée (`state`) restent dans
l'URL. Le filtre PREMARKET_READY permet de repérer les bundles à consommer.
Après une erreur réseau, la même intention conserve son identifiant de transport.
Sans desk.write, aucun formulaire de préparation n'est affiché.
