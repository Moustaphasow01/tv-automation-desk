# ADR-0010 — Un seul moteur d'évaluation canonique, partagé simulation et exécution réelle

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-3 (`01` §5)

## Contexte

Un risque classique dans les systèmes de trading algorithmique est la divergence entre le moteur utilisé pour la simulation historique et celui utilisé pour l'exécution réelle (« simulation-live parity gap »), qui invalide silencieusement les résultats de backtest. Le système actuel dispose déjà d'un moteur déterministe mature (`packages/desk-domain`) utilisé pour l'exécution réelle.

## Décision

Le Canonical Runtime cible (`04-TARGET-SYSTEM-ARCHITECTURE.md` §3) **est** le moteur déterministe actuel (`packages/desk-domain`), non un nouveau moteur parallèle. Le Simulation Engine (Phase 3) et le Live Strategy Runtime (Phase 6) invoquent tous deux exactement le même code d'évaluation, avec les mêmes prédicats/gates du même catalogue de conditions versionné. Seules les sources de données diffèrent (historiques rejouées vs flux live).

## Alternatives rejetées

- **Construire un moteur de simulation optimisé séparé pour la vitesse** : rejetée — réintroduit exactement le risque de divergence que ce dossier cherche à éliminer ; la reproductibilité bit-à-bit (SC-3) devient impossible à garantir entre deux implémentations distinctes.
- **Réécrire le moteur déterministe existant pour l'occasion** : rejetée — le moteur actuel est mature, testé, et déjà en production ; le réécrire introduirait un risque de régression majeur sans bénéfice architectural (voir `04` §4, « ce qui ne change pas »).

## Conséquences

- Toute optimisation de performance du Simulation Engine doit se faire par parallélisation des runs (plusieurs runs indépendants en parallèle), jamais par une version allégée ou approximative du moteur d'évaluation lui-même.
- Le versionning du Canonical Runtime reste gouverné par `ACTIVE_STRATEGY_RUNTIME_VERSIONS` (ADR-0001), garantissant que simulation et exécution réelle utilisent toujours la même version tant qu'elles ne sont pas explicitement migrées ensemble.

## Preuve AS-IS

`packages/desk-domain` confirmé comme moteur déterministe pur, zéro dépendance externe, déjà en production (`02` §3). Aucune duplication de logique d'évaluation trouvée ailleurs dans le dépôt lors de l'audit.
