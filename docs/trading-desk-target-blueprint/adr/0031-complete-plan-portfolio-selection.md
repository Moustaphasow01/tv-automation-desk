# ADR 0031 — Sélection Portfolio d'un plan complet

Date : 2026-09-06. Statut : implémenté localement, activation VPS non certifiée.
Suivi : TD2-429. Propriétaire : Portfolio / Global Risk.

## Constat et décision

Le netting historique peut réunir plusieurs signaux dans une allocation. Risk
refuse correctement d'en fabriquer un prix ou un risque unitaire : plusieurs
plans ne constituent pas un plan exécutable canonique, même avec le même sens.

Ajout d'une politique opt-in `BEST_COMPLETE_PLAN_V1` dans le domaine Portfolio,
après les contrôles d'admissibilité et avant Risk. Chaque groupe compte/instrument
retient un seul signal muni d'un plan et d'une économie `KNOWN`, cohérents avec
l'instrument et le sens. Le classement est confiance décroissante, date du signal
croissante, puis ID canonique lexical croissant. Il ne consulte aucun résultat
futur ni statistique optimisée sur les jours rejoués.

Le plan retenu garde entrée, stop, objectifs et quantité demandée. Risk reste seul
responsable du dimensionnement autorisé. Les autres signaux restent dans le bus
et sont audités comme non retenus, avec leur ID et celui du signal sélectionné.
Un groupe ne produit jamais simultanément un achat et une vente.

Le plan passe par le normaliseur canonique existant : version, empreinte du plan,
contenu économique et empreinte économique doivent concorder. Une simple étiquette
`KNOWN` ou une empreinte copiée sur un contenu modifié ne suffit pas. Un ID répété
avec un contenu identique est dédupliqué ; des contenus divergents sous un même ID
sont tous refusés, avec les empreintes conservées dans le motif d'arbitrage.

## Placement et consommateurs

- Domaine pur : `portfolio-signal-selection-v1.js`, consommé par le builder
  `portfolio-candidate-allocation-v1.js` existant.
- Application : le pipeline de signaux transmet `allocation_policy` ; les clés
  automatiques d'idempotence incluent cette politique.
- Infrastructure : transactions et verrou de compte existants, aucune table ou
  migration supplémentaire. Refus conservés dans le plan d'arbitrage persisté.
- Replay : politique figée explicitement et empreinte de code/données. Un ancien
  fichier sans ce champ épingle `NET_BY_DIRECTION`, sans héritage caché du VPS.

## Alternatives écartées

- Fusionner les prix, agréger les quantités ou laisser Risk choisir un signal :
  mélange des autorités et perte de traçabilité.
- Rejeter tous les doublons : perd une proposition complète exploitable.
- Classer sur la performance des jours rejoués : fuite du résultat et surajustement.
- Appliquer la sélection dans les moteurs : ces derniers doivent publier tous
  les signaux qui satisfont leurs conditions.

## Compatibilité, sécurité et limites

`NET_BY_DIRECTION` reste le défaut. `DESK_SHADOW_PORTFOLIO_SELECTION_POLICY`
permet une activation applicative explicite. Une politique inconnue ne sélectionne
aucun signal ; les contrats de replay mal formés sont refusés au chargement.
L'application refuse une politique explicite mal formée avant persistance, sans
supprimer les champs des politiques historiques encore supportés. Une politique
omise garde le comportement historique ; le replay explicite ne prend pas de
valeur cachée dans l'environnement.
Retour arrière : restaurer la politique précédente pour les nouveaux signaux,
sans réécrire les plans déjà autorisés ni les réserves. Aucun changement de
capability, de Human Gate, de LIVE/AUTO ou de provider.

La confiance de stratégies distinctes n'est pas encore calibrée comme une
probabilité comparable : ce classement est une règle opérationnelle stable, pas
une preuve de supériorité financière. Les signaux arrivant dans des lots différents
restent soumis à la réservation existante ; aucun regroupement temporel artificiel.
Une donnée M1 manquante ne devient pas une absence de fill prouvée.

## Preuves requises

Tests de permutation, opposition, incomplétude, compte/instrument, immutabilité,
idempotence et parcours PostgreSQL bus → Context → Portfolio → Risk → Intent →
Human Gate, avec zéro commande provider. Replay comparatif versionné sur les
mêmes données ; rapport de résultats et limites avant décision d'activation.
