# ADR-0018 — Stratégie de rollback feature-flag-first pour tout changement du chemin d'exécution réel

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-4, INV-5 (`01` §3)

## Contexte

Une bascule de code brutale et irréversible (déploiement qui remplace directement l'ancien comportement) rend tout rollback dépendant d'un nouveau déploiement, potentiellement lent en situation d'incident. Le plan directeur et la North Star (`01` §1.7) exigent explicitement la réversibilité de chaque changement du chemin d'exécution réel.

## Décision

Tout changement touchant, même indirectement, le chemin d'exécution réel (Phases 1, 6, 7, 8, 9, 11) est protégé par un feature flag par défaut désactivé. L'activation se fait par bascule de configuration, pas par déploiement de code. Le rollback consiste à désactiver le flag, jamais à revert un commit en urgence. Chaque ticket introduisant un tel changement documente explicitement son flag et son comportement par défaut (désactivé) dans `17-EXECUTABLE-BACKLOG.md`.

## Alternatives rejetées

- **Déploiement direct avec rollback par revert de commit** : rejetée — plus lent en situation d'incident, et risque de conflit si d'autres commits sont arrivés depuis.
- **Feature flags pour tous les changements, y compris ceux de la couche Recherche sans impact sur le capital réel** : jugée disproportionnée — la couche Recherche (`04` §2) n'a par construction aucun impact sur le capital réel, un flag y ajouterait de la complexité sans bénéfice de sûreté ; les flags sont réservés aux changements pouvant affecter, même indirectement, une décision réelle.

## Conséquences

- `phase-gates.yaml` référence, pour chaque phase concernée, le ou les flags associés et leur valeur par défaut attendue.
- Le passage d'un flag de désactivé à activé en production reste une décision opérateur explicite (cohérent avec INV-5), jamais une bascule automatique liée à l'avancement du développement.

## Preuve AS-IS

Aucun système de feature flag générique n'a été confirmé existant dans l'AS-IS actuel — décision de conception adoptée pour la trajectoire à venir, cohérente avec le hold `ENGINE_V5_VALIDATION_HOLD` déjà utilisé comme mécanisme de gel volontaire (`02` §8), qui démontre que ce type de gouvernance est déjà une pratique du projet.
