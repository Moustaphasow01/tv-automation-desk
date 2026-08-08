# ADR-0014 — Politique de batch par défaut `TIMEOUT_WITH_PARTIAL_RESULTS` pour les pipelines à haute fréquence

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : disponibilité opérationnelle, cohérent avec le principe fail-closed de `01` §4 appliqué à la disponibilité plutôt qu'à l'exécution

## Contexte

Le Multi-Agent Runtime généralisé (ADR-0013) introduit des `Batch` avec plusieurs politiques d'agrégation possibles (`ALL`/`ANY`/`FIRST_SOCK`/`QUORUM`/`TIMEOUT_WITH_PARTIAL_RESULTS`, `05` §4.5). Pour un pipeline à haute fréquence comme le moniteur de thèse horaire, une politique `ALL` (attendre que tous les sous-agents terminent) exposerait le pipeline entier à être bloqué par un seul agent lent ou défaillant.

## Décision

Les pipelines migrés à fréquence élevée (moniteur de thèse horaire en particulier) utilisent par défaut la politique `TIMEOUT_WITH_PARTIAL_RESULTS` : le batch retourne les résultats disponibles à l'expiration du délai, en marquant explicitement les tâches non terminées comme telles, plutôt que de bloquer l'ensemble du cycle. Les pipelines à fréquence faible et à criticité de complétude élevée (ex. génération de plan d'analyse de marché initial) peuvent utiliser `ALL` ou `QUORUM` selon leur besoin spécifique, documenté au cas par cas dans `09`.

## Alternatives rejetées

- **Politique `ALL` uniforme pour tous les pipelines migrés** : rejetée — créerait un point de blocage systémique sur les pipelines à haute fréquence, dégradant la disponibilité globale du système sans bénéfice de sûreté correspondant (une thèse non réévaluée à temps est moins risqué qu'un pipeline bloqué indéfiniment).
- **Timeout sans résultats partiels (tout ou rien)** : rejetée — perdrait le travail des sous-agents déjà terminés, gaspillant le coût déjà engagé (contraire à SC-9, réduction de coût).

## Conséquences

- Chaque tâche non terminée à l'expiration du délai est explicitement marquée comme telle dans l'`Event Envelope` correspondant, jamais silencieusement ignorée.
- Le choix de politique par pipeline est documenté explicitement dans `09-RESEARCH-LAB-AND-MULTI-AGENT-RUNTIME.md`, pas laissé à la discrétion de l'implémentation.

## Preuve AS-IS

Aucun mécanisme de batch générique n'existe actuellement (`03` §9, écart `ABSENT`) — décision de conception motivée par le comportement de fréquence connu du pipeline moniteur de thèse horaire existant (`02` §4).
