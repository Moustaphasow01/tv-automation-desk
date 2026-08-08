# ADR-0020 — Pipeline GPT-first maintenu en parallèle jusqu'au cutover opérateur explicite (Phase 11)

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-4 (`01` §3)

## Contexte

La transformation décrite dans ce dossier s'étale sur 12 phases numérotées (`03` §1). Sans garantie explicite de continuité, un ticket individuel pourrait, par erreur ou par optimisation locale, désactiver ou modifier une partie du pipeline GPT-first actuel avant que son successeur ne soit validé.

## Décision

Le pipeline GPT-first actuel (orchestration Codex CLI existante, moteur déterministe existant) reste pleinement opérationnel, inchangé dans son comportement observable, tout au long des Phases -1 à 10. Sa désactivation progressive ne commence qu'en Phase 11 (Production Cutover) et se termine en Phase 12 (Decommission), toutes deux détaillées dans `21-CUTOVER-AND-GPT-FIRST-DECOMMISSION.md`, sous gate opérateur explicite à chaque étape. Aucun ticket des phases antérieures n'a le droit de modifier le comportement observable du pipeline GPT-first en production sans passer par cette ADR et une revalidation.

## Alternatives rejetées

- **Basculer progressivement dès qu'un composant cible est prêt, composant par composant** : rejetée — créerait un état hybride non testé et non documenté comme tel, où il devient impossible de savoir avec certitude quel mécanisme (ancien ou nouveau) a produit une décision donnée à un instant donné.
- **Couper le pipeline GPT-first dès que le Live Strategy Runtime (Phase 6) est fonctionnel** : rejetée — le Live Strategy Runtime n'a de sens en production qu'une fois l'Arbitrage Portefeuille (Phase 7) et l'Execution Gateway (Phase 9) également en place ; couper prématurément laisserait le système sans mécanisme d'exécution éprouvé pendant la transition.

## Conséquences

- Chaque ticket de `17-EXECUTABLE-BACKLOG.md` des Phases -1 à 10 inclut un test de non-régression explicite prouvant que le comportement du pipeline GPT-first n'a pas changé.
- Le plan de rollback de chaque phase renvoie toujours, en dernier recours, à « revenir au pipeline GPT-first inchangé », qui reste donc une cible de rollback valide jusqu'à la Phase 12.

## Preuve AS-IS

Pipeline GPT-first confirmé pleinement fonctionnel dans l'AS-IS actuel (`02` §1-§4), sous réserve du hold `ENGINE_V5_VALIDATION_HOLD` déjà en place (§8), qui est un état opérationnel préexistant et non introduit par ce dossier.
