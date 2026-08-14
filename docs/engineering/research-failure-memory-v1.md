# Research Failure Memory V1 — TD2-508

## Objectif

`TD2-508` transforme les résultats négatifs du Research Lab en mémoire exploitable. Une candidate rejetée ne disparaît pas : elle devient une preuve consultable par les futurs agents, le moteur de nouveauté et le graphe logique.

## Contrat domaine

Implémentation : `packages/desk-domain/src/research-failure-memory-v1.js`.

Exports principaux :

- `buildResearchFailureRecordV1`
- `matchResearchFailureMemoryV1`
- `evaluateResearchFailureMemoryGateV1`
- `buildResearchFailureKnowledgeNodeV1`

## Failure record

Un rejet est normalisé en `research_failure_record_v1` avec :

- `failure_id`
- `research_candidate_id`
- `cause_codes`
- `root_cause_summary`
- `negative_result_ref`
- `evidence_refs`
- `metrics_snapshot`
- `candidate_genome`
- `failure_hash`

La validation exige au minimum une cause, une preuve, une référence de résultat négatif et un résumé causal. Cela évite les rejets opaques du type “ça ne marche pas”.

## Causes V1

Causes canoniques :

- `LOW_EDGE`
- `OVERFIT`
- `REGIME_DEPENDENT`
- `INSUFFICIENT_SAMPLE`
- `HIGH_DRAWDOWN`
- `POOR_RR`
- `EXECUTION_FRICTION`
- `DUPLICATE_OR_TOO_CLOSE`
- `DATA_QUALITY`
- `CONTRACT_VIOLATION`
- `OPERATOR_REJECTED`
- `UNKNOWN`

## Matching mémoire

`matchResearchFailureMemoryV1` compare une nouvelle candidate aux échecs actifs via le génome `TD2-507`.

Décisions :

- `BLOCK_RETEST` si la candidate est un doublon ou trop similaire à un échec actif.
- `REQUIRE_REVISION` si elle est proche et doit expliciter son changement avant compute.
- `ALLOW_WITH_MEMORY` si elle est distincte mais qu’un échec passé reste informatif.
- `NO_MATCH` si aucune mémoire active ne s’applique.

Seuils par défaut :

- blocage : `0.92`
- revue : `0.78`

## Gate exploitable par agent

`evaluateResearchFailureMemoryGateV1` retourne :

- `rejected` pour `BLOCK_RETEST` ;
- `review_required` pour `REQUIRE_REVISION` ;
- `accepted` pour `ALLOW_WITH_MEMORY` et `NO_MATCH`.

Le but n’est pas de freiner la recherche : c’est d’éviter de brûler du compute et du temps humain sur des idées déjà invalidées.

## Graphe logique

`buildResearchFailureKnowledgeNodeV1` produit un node consommable par `TD2-509` :

- labels `ResearchFailure`, `NegativeResult`, famille stratégique ;
- propriétés de cause, statut, candidate et hash ;
- edges `FAILED_CANDIDATE`, `HAS_GENOME`, `FAILED_BECAUSE`, `EVIDENCED_BY`.

## Limites

La V1 reste un contrat domaine pur. Elle ne persiste pas encore les records et ne remplace pas le rapport scientifique. Elle prépare la persistance, l’affichage Research et le graphe logique.
