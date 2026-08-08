# ADR-0023 — Run Registry intégré au chantier Simulation Engine (Phase 3), pas différé

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-3 (`01` §5)

## Contexte

La première version du plan d'évolution positionnait le Run Registry comme faisant partie de l'Experiment Registry (alors Phase 3 de l'ancienne numérotation), séparé du chantier Simulation Engine lui-même. L'addendum de passation a demandé explicitement de déplacer un Run Registry minimal dans le chantier Simulation Engine, en observant qu'un Simulation Engine sans registre des runs déjà exécutés ne peut pas, par construction, prouver la reproductibilité qu'il prétend offrir — chaque run resterait un événement isolé, non comparable à ses exécutions précédentes.

## Décision

Un Run Registry (`05` §3.2) minimal — au moins l'enregistrement de `(strategy_version_id, dataset_id, parameters_hash, status, metrics_ref, reproducibility_seed)` — fait partie intégrante de la **Phase 3** (Strategy DSL, Canonical Runtime, Simulation Engine), livré avec le Simulation Engine lui-même, pas différé à la Phase 4 (Experiment Registry). L'Experiment Registry de la Phase 4 **consomme** les entrées du Run Registry pour les comparer entre elles ; il ne le remplace pas et n'a pas besoin d'en réimplémenter la persistance.

## Alternatives rejetées

- **Différer tout enregistrement de run à la Phase 4** : rejetée — rendrait SC-3 invérifiable pendant toute la durée de la Phase 3, alors que des Strategy Versions pourraient déjà être validées et publiées sur cette base non tracée.
- **Construire un Run Registry complet avec interface de comparaison dès la Phase 3** : rejetée par souci de scope — la comparaison structurée entre runs est explicitement le rôle de l'Experiment Registry (Phase 4) ; la Phase 3 ne livre que la persistance minimale nécessaire à la reproductibilité, pas l'outillage de comparaison.

## Conséquences

- `17-EXECUTABLE-BACKLOG.md` et `16-END-TO-END-MIGRATION-ROADMAP.md` listent le Run Registry minimal comme livrable de sortie de la Phase 3, pas de la Phase 4.
- `08-SIMULATION-AND-EXPERIMENT-PLATFORM.md` documente cette frontière précise entre ce qui est livré en Phase 3 (persistance) et ce qui est livré en Phase 4 (comparaison).

## Preuve AS-IS

Aucun Run Registry n'existe actuellement (`03` §8, écart `ABSENT`) — décision de séquencement pure, actée suite à la correction explicite demandée dans l'addendum de passation déjà validé comme base de travail.
