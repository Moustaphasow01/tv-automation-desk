# Research Coverage & Priority V1 — TD2-511

## Objectif

`TD2-511` rend visibles les trous de recherche et classe les prochaines candidates à étudier. Le Research Lab ne doit pas générer des idées au hasard : il doit savoir quelles familles, régimes, instruments, timeframes ou sessions sont sous-couverts, puis prioriser selon nouveauté, potentiel, coût et risque.

## Contrat domaine

Implémentation : `packages/desk-domain/src/research-coverage-priority-v1.js`.

Exports principaux :

- `buildResearchCoverageModelV1`
- `scoreResearchPriorityV1`
- `rankResearchPrioritiesV1`
- `summarizeResearchCoverageForFrontV1`

## Dimensions de couverture

Dimensions canoniques :

- `families`
- `regimes`
- `instruments`
- `timeframes`
- `sessions`

La couverture peut être calculée depuis :

- des candidates/génomes explicites ;
- le `Research Knowledge Graph V1` (`TD2-509`) ;
- une projection d’artefacts Research.

Chaque dimension expose :

- valeurs cibles ;
- valeurs observées ;
- valeurs manquantes ;
- `coverage_ratio` ;
- `gap_ratio`.

## Scoring de priorité

Facteurs V1 :

- `coverage_gap` : capacité de la candidate à couvrir un trou ;
- `novelty` : nouveauté attendue ;
- `potential` : potentiel métier/stratégique ;
- `cost` : coût compute ou temps ;
- `risk` : risque de recherche ou complexité.

Poids V1 :

- `coverage_gap`: `0.35`
- `novelty`: `0.25`
- `potential`: `0.25`
- `cost`: `-0.10`
- `risk`: `-0.05`

Décisions :

- `HIGH_PRIORITY`
- `MEDIUM_PRIORITY`
- `LOW_PRIORITY`
- `DEFER`

Chaque score contient un audit avec les poids et les gaps couverts.

## Front transitoire

`summarizeResearchCoverageForFrontV1` produit un résumé compact :

- nombre de vecteurs/candidates ;
- nombre de gaps ;
- dimension la plus faible ;
- top priorités.

Ce résumé est conçu pour alimenter le cockpit Research Lab sans exposer une forêt d’identifiants techniques.

## Limites

La V1 ne décide pas seule de lancer du compute. Elle fournit une priorisation auditable à combiner avec les budgets `TD2-506`, la mémoire d’échecs `TD2-508` et les validations contradictoires.
