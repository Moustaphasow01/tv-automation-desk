# Research Knowledge Graph V1 — TD2-509

## Objectif

`TD2-509` donne au Research Lab une projection graphe déterministe : les relations importantes ne restent plus cachées dans du texte libre. Les agents peuvent demander le voisinage d’une candidate, d’un échec, d’une hypothèse ou d’un rapport sans reconstruire le contexte à la main.

## Contrat domaine

Implémentation : `packages/desk-domain/src/research-knowledge-graph-v1.js`.

Exports principaux :

- `buildResearchKnowledgeNodeV1`
- `buildResearchKnowledgeEdgeV1`
- `buildResearchKnowledgeGraphV1`
- `buildResearchKnowledgeGraphFromArtifactsV1`
- `queryResearchKnowledgeGraphV1`
- `summarizeResearchKnowledgeGraphV1`

## Nœuds V1

Types canoniques :

- `ResearchExperiment`
- `ResearchHypothesis`
- `ResearchCandidate`
- `StrategyGenome`
- `ResearchFailure`
- `EvaluationReport`
- `Dataset`
- `Feature`
- `StrategyVersion`
- `MarketRegime`
- `StrategyFamily`
- `Unknown`

Chaque nœud porte un `node_hash` stable.

## Relations V1

Relations canoniques principales :

- `CONTAINS_HYPOTHESIS`
- `TESTS_CANDIDATE`
- `HAS_GENOME`
- `HAS_FAMILY`
- `TARGETS_REGIME`
- `FAILED_CANDIDATE`
- `FAILED_BECAUSE`
- `EVIDENCED_BY`
- `PRODUCED_REPORT`
- `SUPPORTS_HYPOTHESIS`
- `FALSIFIES_HYPOTHESIS`
- `SIMILAR_TO`
- `DUPLICATES`
- `BLOCKED_BY_FAILURE`

Chaque edge porte un `edge_hash` stable.

## Projection depuis les artefacts

`buildResearchKnowledgeGraphFromArtifactsV1` assemble :

- expériences et hypothèses ;
- candidates et génomes `TD2-507` ;
- mémoire d’échecs `TD2-508` ;
- rapports d’évaluation.

La projection ajoute des nœuds de référence pour les familles, régimes, causes ou preuves afin d’éviter les relations orphelines.

## Requête agent/front

`queryResearchKnowledgeGraphV1` retourne un voisinage filtrable par :

- `node_id` ou `node_ids` ;
- `edge_types` ;
- `node_types`.

Cette V1 cible les besoins immédiats des agents et du front transitoire : “montre-moi pourquoi cette candidate ressemble à un échec”, “quelles preuves invalident cette famille”, “quels régimes sont couverts”.

## Limites

La V1 est une projection en mémoire. Elle ne choisit pas encore une base graphe dédiée et ne remplace pas la persistance PostgreSQL. Elle fournit le contrat stable pour l’API/front et les tickets suivants.
