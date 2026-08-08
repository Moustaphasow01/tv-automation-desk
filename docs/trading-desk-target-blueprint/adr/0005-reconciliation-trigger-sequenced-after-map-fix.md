# ADR-0005 — Déclenchement périodique de la réconciliation séquencé strictement après le correctif d'agrégation

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-8 (`01` §3), errata de sûreté point 1

## Contexte

Une première version du plan d'évolution proposait d'activer le déclenchement périodique automatique de la réconciliation (Ticket alors numéroté 0.4) **avant** la correction du bug de collision d'agrégation de position (Ticket alors numéroté 0.5). L'errata de sûreté a signalé que cet ordre convertirait un bug latent en incident automatique périodique : activer la réconciliation sur une agrégation buguée déclencherait des alertes de désynchronisation compte à intervalle régulier, potentiellement des actions de correction automatique sur une base de données déjà fausse.

## Décision

L'ordre est inversé et fixé : le correctif d'agrégation de position (désormais Ticket 0.4, voir ADR-0003) doit être terminé, testé et fusionné **avant** que le déclenchement périodique de la réconciliation (désormais Ticket 0.5) ne puisse être activé, même en configuration désactivée par défaut. Le Ticket 0.5 déclare une dépendance bloquante explicite sur le Ticket 0.4 dans `17-EXECUTABLE-BACKLOG.md` et `implementation-backlog.yaml`.

## Alternatives rejetées

- **Activer la réconciliation en mode lecture seule avant le correctif** : rejetée — même en lecture seule, une réconciliation sur données d'agrégation fausses produirait des rapports trompeurs consommés par l'opérateur, créant une fausse confiance ou une fausse alerte.
- **Corriger les deux tickets dans un seul commit combiné** : rejetée — viole le principe de petits changements testables indépendamment (voir méthode de `17`), et rendrait le rollback partiel impossible en cas de problème sur l'un des deux.

## Conséquences

- Le backlog exécutable encode cette dépendance comme un blocage dur, pas une simple recommandation d'ordre.
- Aucun agent d'implémentation ne peut démarrer le Ticket 0.5 tant que le Ticket 0.4 n'est pas marqué `PASSED` dans `phase-gates.yaml`.

## Preuve AS-IS

Constat du bug d'agrégation : voir ADR-0003 et `02` §6. La conséquence opérationnelle (déclenchement automatique sur base faussée) est une déduction logique directe, pas un fait testé en production — le risque est documenté aussi dans `20-RISK-REGISTER.md`.
